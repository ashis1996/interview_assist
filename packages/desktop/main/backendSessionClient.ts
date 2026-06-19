// Backend Session Client (Req 5, 12.4).
//
// Repurposed from v1 `src/main/sidecarBridge.ts`: the reconnect/backoff and
// command-queue behaviour and the transcript event names are preserved, but it
// connects to the REMOTE Session_Gateway over WSS, sends the auth handshake
// (Access_Token) on connect, uploads binary PCM Audio_Frames, and decodes the
// downbound protocol. The WebSocket is injected so the logic is testable with a
// fake socket.

import { EventEmitter } from 'node:events'
import {
  decode,
  encode,
  type ClientToServer,
  type Environment,
  type Profile,
  type ScopeClassification,
  type ServerToClient,
  type SessionEndReason,
  type SttProviderName,
  type TopicDomain,
  type UsageSummary,
  redact,
} from '@interview-assistant/shared'

/** A minimal WebSocket abstraction (satisfied by the `ws` WebSocket). */
export interface SocketLike {
  send(data: string | ArrayBufferView): void
  close(): void
  on(event: 'open', cb: () => void): void
  on(event: 'message', cb: (data: unknown, isBinary: boolean) => void): void
  on(event: 'close', cb: () => void): void
  on(event: 'error', cb: (err: Error) => void): void
  readonly readyState: number
}

export type SocketFactory = (url: string) => SocketLike

export interface BackendSessionClientOptions {
  gatewayUrl: string
  environment: Environment
  /** Supplies the current Access_Token (absent in auth-bypassed environments). */
  getAccessToken: () => Promise<string | undefined> | string | undefined
  socketFactory: SocketFactory
  maxReconnectAttempts?: number
  reconnectBaseDelayMs?: number
  reconnectMaxDelayMs?: number
}

/** Typed event map emitted by the client (mirrors ServerToClient). */
export interface BackendSessionEvents {
  auth_ok: [{ accountId: string; creditBalance: number; enforcement: 'enforced' | 'bypassed' }]
  auth_error: [{ message: string }]
  partial_transcript: [{ text: string }]
  final_question: [{ text: string }]
  topics: [{ topics: TopicDomain[] }]
  scope: [{ scope: ScopeClassification; color: string }]
  answer_token: [{ token: string }]
  answer_complete: [{ answer: string }]
  stt_error: [{ message: string }]
  answer_error: [{ provider: string; message: string }]
  low_credit_warning: [{ creditBalance: number; threshold: number }]
  session_summary: [{ usage: UsageSummary; creditsConsumed: number; sessionId: string }]
  session_ended: [{ reason: SessionEndReason }]
  status: [{ connected: boolean; reason?: string }]
}

const DEFAULTS = { maxReconnect: 5, baseDelay: 500, maxDelay: 10_000 }

export class BackendSessionClient extends EventEmitter {
  private readonly opts: Required<
    Pick<BackendSessionClientOptions, 'maxReconnectAttempts' | 'reconnectBaseDelayMs' | 'reconnectMaxDelayMs'>
  > &
    BackendSessionClientOptions
  private ws: SocketLike | null = null
  private connected = false
  private disposed = false
  private reconnectAttempts = 0
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null
  private readonly pending: ClientToServer[] = []
  /**
   * Desired session state, re-established on every (re)connect so a dropped
   * socket never silently loses the running session. `start_session` is NOT a
   * one-shot queued command — it must be replayed after each auth handshake,
   * otherwise a reconnect leaves the server with no orchestrator and answers
   * stop appearing.
   */
  private desiredSession: ClientToServer | null = null
  private autoGenerate = false
  private captureState: { active: boolean; systemAudioAvailable: boolean } | null = null

  constructor(options: BackendSessionClientOptions) {
    super()
    this.opts = {
      ...options,
      maxReconnectAttempts: options.maxReconnectAttempts ?? DEFAULTS.maxReconnect,
      reconnectBaseDelayMs: options.reconnectBaseDelayMs ?? DEFAULTS.baseDelay,
      reconnectMaxDelayMs: options.reconnectMaxDelayMs ?? DEFAULTS.maxDelay,
    }
  }

  isConnected(): boolean {
    return this.connected
  }

  /** Open the connection (idempotent while connecting/connected). */
  start(): void {
    if (this.disposed) this.disposed = false
    this.reconnectAttempts = 0
    void this.open()
  }

  private async open(): Promise<void> {
    if (this.disposed || this.ws) return
    let socket: SocketLike
    try {
      socket = this.opts.socketFactory(this.opts.gatewayUrl)
    } catch (err) {
      this.handleDisconnect(`connect failed: ${describe(err)}`)
      return
    }
    this.ws = socket
    socket.on('open', () => void this.handleOpen())
    socket.on('message', (data, isBinary) => this.handleMessage(data, isBinary))
    socket.on('error', () => {
      /* close follows; reconnect is driven there */
    })
    socket.on('close', () => this.handleDisconnect('socket closed'))
  }

  private async handleOpen(): Promise<void> {
    this.connected = true
    this.reconnectAttempts = 0
    // Auth handshake first (Req 5.2).
    const accessToken = await this.opts.getAccessToken()
    this.writeNow({
      type: 'auth',
      environment: this.opts.environment,
      ...(accessToken ? { accessToken } : {}),
    })
    this.emit('status', { connected: true })
    // Re-establish the running session after auth so a reconnect transparently
    // resumes (new server-side Connection, fresh orchestrator). Without this a
    // dropped+reconnected socket would have auth but no session.
    if (this.desiredSession) {
      this.writeNow(this.desiredSession)
      if (this.autoGenerate) this.writeNow({ type: 'set_auto_generate', enabled: true })
      if (this.captureState) {
        this.writeNow({
          type: 'capture_state',
          active: this.captureState.active,
          systemAudioAvailable: this.captureState.systemAudioAvailable,
        })
      }
    }
    // eslint-disable-next-line no-console
    // Log the auth token's PRESENCE only (redacted); never the raw value (Req 9.2).
    console.log(
      '[client] ws open; auth=%s session=%s queued=%o',
      redact(accessToken),
      this.desiredSession ? 'resumed' : 'none',
      this.pending.map((c) => c.type)
    )
    this.flush()
  }

  private handleMessage(data: unknown, isBinary: boolean): void {
    if (isBinary) return // server never sends binary
    const raw = typeof data === 'string' ? data : String(data)
    const decoded = decode(raw, 'server')
    if (!decoded.ok) return
    const msg = decoded.message as ServerToClient
    switch (msg.type) {
      case 'auth_ok':
        this.emit('auth_ok', {
          accountId: msg.accountId,
          creditBalance: msg.creditBalance,
          enforcement: msg.enforcement,
        })
        break
      case 'auth_error':
        this.emit('auth_error', { message: msg.message })
        break
      case 'partial_transcript':
        this.emit('partial_transcript', { text: msg.text })
        break
      case 'final_question':
        this.emit('final_question', { text: msg.text })
        break
      case 'topics':
        this.emit('topics', { topics: msg.topics })
        break
      case 'scope':
        this.emit('scope', { scope: msg.scope, color: msg.color })
        break
      case 'answer_token':
        this.emit('answer_token', { token: msg.token })
        break
      case 'answer_complete':
        this.emit('answer_complete', { answer: msg.answer })
        break
      case 'stt_error':
        this.emit('stt_error', { message: msg.message })
        break
      case 'answer_error':
        this.emit('answer_error', { provider: msg.provider, message: msg.message })
        break
      case 'low_credit_warning':
        this.emit('low_credit_warning', {
          creditBalance: msg.creditBalance,
          threshold: msg.threshold,
        })
        break
      case 'session_summary':
        this.emit('session_summary', {
          usage: msg.usage,
          creditsConsumed: msg.creditsConsumed,
          sessionId: msg.sessionId,
        })
        break
      case 'session_ended':
        this.emit('session_ended', { reason: msg.reason })
        break
    }
  }

  private handleDisconnect(reason: string): void {
    const wasConnected = this.connected
    this.connected = false
    if (this.ws) {
      try {
        this.ws.close()
      } catch {
        /* already closed */
      }
      this.ws = null
    }
    if (wasConnected) this.emit('status', { connected: false, reason })
    if (this.disposed) return
    this.scheduleReconnect()
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) return
    if (this.reconnectAttempts >= this.opts.maxReconnectAttempts) {
      this.emit('status', {
        connected: false,
        reason: `giving up after ${this.reconnectAttempts} attempts`,
      })
      return
    }
    const attempt = this.reconnectAttempts++
    const delay = Math.min(
      this.opts.reconnectBaseDelayMs * 2 ** attempt,
      this.opts.reconnectMaxDelayMs
    )
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null
      void this.open()
    }, delay)
    this.reconnectTimer.unref?.()
  }

  // --- Commands -----------------------------------------------------------

  sendStartSession(
    sttProvider: SttProviderName,
    silenceThresholdSeconds?: number,
    profile?: Profile
  ): void {
    // Remember the desired session so it is re-established on every reconnect.
    this.desiredSession = {
      type: 'start_session',
      sttProvider,
      ...(silenceThresholdSeconds !== undefined ? { silenceThresholdSeconds } : {}),
      ...(profile ? { profile } : {}),
    }
    // Send now if connected; otherwise handleOpen replays desiredSession after
    // auth (do NOT also queue it, or it would be sent twice on first connect).
    if (this.connected && this.ws) this.writeNow(this.desiredSession)
  }
  sendStopSession(): void {
    this.desiredSession = null
    this.autoGenerate = false
    this.captureState = null
    this.send({ type: 'stop_session' })
  }
  sendTextQuestion(text: string): void {
    this.send({ type: 'text_question', text })
  }
  /** Manually answer the latest pending finalized question (Answer button). */
  sendAnswer(): void {
    this.send({ type: 'answer' })
  }
  /** Toggle auto-answering of finalized questions. */
  sendAutoGenerate(enabled: boolean): void {
    this.autoGenerate = enabled
    this.send({ type: 'set_auto_generate', enabled })
  }
  /** Send a screenshot for vision-based question extraction + answer (Phase 2). */
  sendScreenshotQuestion(imageBase64: string, mimeType: string): void {
    this.send({ type: 'screenshot_question', imageBase64, mimeType })
  }
  sendRegenerate(): void {
    this.send({ type: 'regenerate' })
  }
  sendCaptureState(active: boolean, systemAudioAvailable: boolean): void {
    this.captureState = { active, systemAudioAvailable }
    this.send({ type: 'capture_state', active, systemAudioAvailable })
  }

  /** Upload a binary PCM Audio_Frame (Req 5.3). Dropped while disconnected. */
  uploadAudio(frame: Int16Array): void {
    if (!this.connected || !this.ws) return
    this.ws.send(new Uint8Array(frame.buffer, frame.byteOffset, frame.byteLength))
  }

  private send(command: ClientToServer): void {
    if (!this.connected || !this.ws) {
      // eslint-disable-next-line no-console
      console.log('[client] queue (not connected):', command.type)
      this.pending.push(command)
      return
    }
    this.writeNow(command)
  }

  private writeNow(command: ClientToServer): void {
    // eslint-disable-next-line no-console
    console.log('[client] send:', command.type)
    this.ws?.send(encode(command))
  }

  private flush(): void {
    const queued = this.pending.splice(0, this.pending.length)
    for (const c of queued) this.writeNow(c)
  }

  dispose(): void {
    this.disposed = true
    this.connected = false
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer)
      this.reconnectTimer = null
    }
    if (this.ws) {
      try {
        this.ws.close()
      } catch {
        /* already closed */
      }
      this.ws = null
    }
    this.pending.length = 0
  }

  // Typed emitter overrides.
  override emit<K extends keyof BackendSessionEvents>(
    event: K,
    ...args: BackendSessionEvents[K]
  ): boolean {
    return super.emit(event as string, ...args)
  }
  override on<K extends keyof BackendSessionEvents>(
    event: K,
    listener: (...args: BackendSessionEvents[K]) => void
  ): this {
    return super.on(event as string, listener as (...args: unknown[]) => void)
  }
  override off<K extends keyof BackendSessionEvents>(
    event: K,
    listener: (...args: BackendSessionEvents[K]) => void
  ): this {
    return super.off(event as string, listener as (...args: unknown[]) => void)
  }
}

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
