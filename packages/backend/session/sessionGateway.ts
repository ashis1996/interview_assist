// Session Gateway (Req 5, 12).
//
// Terminates one persistent WebSocket per Session. Enforces the auth handshake
// (verify token where enforced, attribute to the Dev_Account where bypassed),
// runs the pre-session credit check, creates the session, relays binary PCM
// Audio_Frames to the STT relay, drives the orchestrator, streams downbound
// messages, and owns the three session-end paths — each routed through the
// idempotent finalizeSession (Req 12.2-12.7).

import { WebSocketServer, type WebSocket } from 'ws'
import {
  decode,
  encode,
  resolveSilenceThreshold,
  type EnforcementMode,
  type Environment,
  type Profile,
  type ProtocolMessage,
  type ServerToClient,
  type SessionEndReason,
  redact,
} from '@interview-assistant/shared'
import { resolveAuthMode, resolveEnforcementMode } from '../config/environment'
import { AuthError, type AuthVerifier } from '../http/authVerifier'
import { CreditsService } from '../credits/creditsService'
import type { Repositories, SessionRecord } from '../repos/types'
import { createLlmProvider, type LlmProviderDeps } from './llmProvider'
import { SessionOrchestrator } from './sessionOrchestrator'
import type { SttRelay, SttRelayFactory } from './sttRelay/types'

export interface SessionGatewayDeps {
  environment: Environment
  repos: Repositories
  authVerifier: AuthVerifier
  creditsService: CreditsService
  sttRelayFactory: SttRelayFactory
  /** LLM config (provider/model/apiKey come from server secrets). */
  llmConfig: {
    provider?: string
    model?: string
    apiKey?: string
    visionProvider?: string
    visionModel?: string
    visionApiKey?: string
  }
  llmDeps?: LlmProviderDeps
  lowCreditThreshold: number
  defaultSttProvider: 'deepgram' | 'whisper'
}

/** Per-connection state machine for one session. */
class Connection {
  private session: SessionRecord | null = null
  private orchestrator: SessionOrchestrator | null = null
  private relay: SttRelay | null = null
  private accountId: string | null = null
  /**
   * Effective credit enforcement for this connection's session. Resolved in
   * onAuth from the account (superusers → 'bypassed', everyone else → the env
   * enforcement mode). Initialized to the fail-safe 'enforced' so a session can
   * never start unenforced before auth completes (Req 7.4, 7.5).
   */
  private effectiveEnforcement: EnforcementMode = 'enforced'
  private finalizing = false
  private audioFrames = 0
  /** Serializes control-message handling so auth completes before start_session. */
  private queue: Promise<void> = Promise.resolve()

  constructor(
    private readonly ws: WebSocket,
    private readonly deps: SessionGatewayDeps
  ) {
    ws.on('message', (data, isBinary) => void this.onMessage(data, isBinary))
    ws.on('close', () => void this.onClose())
    ws.on('error', () => void this.onClose())
  }

  private send(msg: ServerToClient): void {
    if (this.ws.readyState === this.ws.OPEN) {
      this.ws.send(encode(msg))
    }
  }

  private logGenError(err: unknown): void {
    // eslint-disable-next-line no-console
    console.error('[gateway] generation error:', err instanceof Error ? err.stack : err)
  }

  private onMessage(data: unknown, isBinary: boolean): void {
    // Binary frames are PCM audio — handle immediately (high frequency).
    if (isBinary) {
      this.onAudio(data as Buffer)
      return
    }
    const raw = typeof data === 'string' ? data : (data as Buffer).toString('utf8')
    const decoded = decode(raw, 'client')
    if (!decoded.ok) return
    // Serialize control messages IN ORDER so e.g. auth fully completes before
    // start_session is handled (otherwise the orchestrator is never created).
    this.queue = this.queue
      .then(() => this.handle(decoded.message as ProtocolMessage))
      .catch((err) => {
        // eslint-disable-next-line no-console
        console.error('[gateway] handler error:', err instanceof Error ? err.stack : err)
      })
  }

  private async handle(msg: ProtocolMessage): Promise<void> {
    // eslint-disable-next-line no-console
    console.log('[gateway] message:', msg.type)
    switch (msg.type) {
      case 'auth':
        await this.onAuth(msg.environment, msg.accessToken)
        break
      case 'start_session':
        await this.onStartSession(msg.sttProvider, msg.silenceThresholdSeconds, msg.profile)
        break
      case 'text_question':
        // Fire-and-forget so a long generation never blocks the control queue;
        // the orchestrator's generation-seq guard makes the latest request win.
        this.orchestrator?.handleQuestion(msg.text).catch((e) => this.logGenError(e))
        break
      case 'answer':
        this.orchestrator?.answerPending().catch((e) => this.logGenError(e))
        break
      case 'set_auto_generate':
        this.orchestrator?.setAutoGenerate(msg.enabled)
        break
      case 'set_coding_mode':
        this.orchestrator?.setCodingMode(msg.enabled)
        break
      case 'screenshot_question':
        // Vision answer for an on-screen question. Fire-and-forget like text;
        // the generation-seq guard makes the latest request win.
        this.orchestrator
          ?.handleScreenshot(msg.imageBase64, msg.mimeType)
          .catch((e) => this.logGenError(e))
        break
      case 'regenerate':
        this.orchestrator?.regenerate().catch((e) => this.logGenError(e))
        break
      case 'stop_session':
        await this.finalize('user-ended', true)
        break
      default:
        break
    }
  }

  private async onAuth(environment: Environment, accessToken?: string): Promise<void> {
    const authMode = resolveAuthMode(environment)
    try {
      const account = await this.deps.authVerifier.resolveAccount(authMode, accessToken)
      this.accountId = account.id
      // Superusers reuse the already-tested bypassed credit path; everyone else
      // gets the env enforcement mode. Stored on the connection and used for the
      // pre-session check, session creation, and orchestrator (Req 7.4, 7.5).
      this.effectiveEnforcement = account.isSuperuser
        ? 'bypassed'
        : resolveEnforcementMode(environment)
      const balance = await this.deps.creditsService.getBalance(account.id)
      // eslint-disable-next-line no-console
      // Note the token's PRESENCE (redacted) for debugging enforced vs bypassed
      // auth; never log the raw Access_Token value (Req 9.2; Design J).
      console.log(
        `[gateway] auth ok: env=${environment} mode=${authMode} account=${account.id} token=${redact(accessToken)}`
      )
      this.send({
        type: 'auth_ok',
        accountId: account.id,
        creditBalance: balance,
        enforcement: this.effectiveEnforcement,
      })
    } catch (err) {
      const message = err instanceof AuthError ? err.message : 'Authorization failed'
      // eslint-disable-next-line no-console
      console.error('[gateway] auth FAILED:', err instanceof Error ? err.message : err)
      this.send({ type: 'auth_error', message })
      this.ws.close()
    }
  }

  private async onStartSession(
    sttProvider: string,
    silenceThresholdSeconds?: number,
    providedProfile?: Profile
  ): Promise<void> {
    if (!this.accountId) {
      this.send({ type: 'auth_error', message: 'Not authenticated' })
      this.ws.close()
      return
    }
    const enforcement = this.effectiveEnforcement

    // Pre-session credit check (Req 8).
    const check = await this.deps.creditsService.preSessionCheck(this.accountId, enforcement)
    // eslint-disable-next-line no-console
    console.log(`[gateway] pre-session check: authorized=${check.authorized} balance=${check.balance}`)
    if (!check.authorized) {
      this.send({ type: 'auth_error', message: 'Insufficient credits to start an interview' })
      this.ws.close()
      return
    }

    // Prefer the profile supplied by the onboarding form; otherwise fall back
    // to a saved profile, then the default. The profile is snapshotted onto the
    // session (jsonb), so the onboarding company/background ride along without a
    // schema change.
    const profile =
      providedProfile ?? (await this.deps.repos.profiles.get(this.accountId)) ?? DEFAULT_PROFILE
    if (providedProfile) {
      // Persist the onboarding profile so it is remembered across sessions.
      try {
        await this.deps.repos.profiles.upsert(this.accountId, providedProfile)
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[gateway] profile upsert failed (non-fatal):', err instanceof Error ? err.message : err)
      }
      // eslint-disable-next-line no-console
      console.log(
        `[gateway] using onboarding profile: role=${providedProfile.targetRole} company=${providedProfile.company ?? '-'} bg=${providedProfile.background ? providedProfile.background.length + 'ch' : 'none'}`
      )
    }

    this.session = await this.deps.repos.sessions.create({
      accountId: this.accountId,
      profileSnapshot: profile,
      enforcement,
    })

    const llmProvider = createLlmProvider(this.deps.llmConfig, this.deps.llmDeps)
    // Warm the LLM connection now so the first answer skips cold-start latency.
    void llmProvider.prewarm?.()
    this.orchestrator = new SessionOrchestrator({
      profile,
      accountId: this.accountId,
      sessionId: this.session.id,
      enforcement,
      llmProvider,
      credits: this.deps.creditsService,
      repos: this.deps.repos,
      lowCreditThreshold: this.deps.lowCreditThreshold,
      emit: {
        topics: (topics) => this.send({ type: 'topics', topics }),
        scope: (scope, color) => this.send({ type: 'scope', scope, color }),
        answerToken: (token) => this.send({ type: 'answer_token', token }),
        answerComplete: (answer) => this.send({ type: 'answer_complete', answer }),
        answerError: (provider, message) => {
          // eslint-disable-next-line no-console
          console.error(`[gateway] answer_error provider=${provider}: ${message}`)
          this.send({ type: 'answer_error', provider, message })
        },
        lowCreditWarning: (creditBalance, threshold) =>
          this.send({ type: 'low_credit_warning', creditBalance, threshold }),
        creditsExhausted: () => void this.finalize('credits-exhausted', false),
      },
    })

    // Open the STT relay; finalize on silence drives the orchestrator.
    this.relay = this.deps.sttRelayFactory(
      {
        onPartial: (text) => this.send({ type: 'partial_transcript', text }),
        onFinal: (text) => {
          // eslint-disable-next-line no-console
          console.log('[gateway] final question:', text)
          // Send the finalized question as its own chunk so the UI can show it
          // distinctly from the still-streaming partial transcript.
          this.send({ type: 'final_question', text })
          void this.orchestrator?.handleFinalQuestion(text)
        },
        onError: (message) => {
          // eslint-disable-next-line no-console
          console.error('[gateway] stt_error:', message)
          this.send({ type: 'stt_error', message })
        },
        onMetered: (delta) => void this.orchestrator?.meterSttMinutes(delta),
      },
      { silenceThresholdSeconds: resolveSilenceThreshold(silenceThresholdSeconds) }
    )
    // eslint-disable-next-line no-console
    console.log(`[gateway] session started ${this.session.id} stt=${sttProvider}`)
    void sttProvider // provider selection is configured at the relay factory
  }

  private onAudio(buf: Buffer): void {
    if (!this.relay) return
    // Interpret the buffer as 16-bit little-endian PCM samples.
    const samples = new Int16Array(buf.buffer, buf.byteOffset, Math.floor(buf.byteLength / 2))
    this.audioFrames += 1
    if (this.audioFrames % 100 === 1) {
      // eslint-disable-next-line no-console
      console.log(`[gateway] audio frames received: ${this.audioFrames}`)
    }
    this.relay.pushAudio(samples)
  }

  private async finalize(reason: SessionEndReason, sendSummary: boolean): Promise<void> {
    if (this.finalizing || !this.session) return
    this.finalizing = true
    await this.relay?.close().catch(() => {})

    const result = await this.deps.creditsService.finalizeSession(this.session.id, reason)
    if (sendSummary && result.finalized) {
      this.send({
        type: 'session_summary',
        usage: {
          sttMinutes: result.usage.sttMinutes,
          llmTokens: result.usage.llmTokens,
          creditsConsumed: result.creditsConsumed,
        },
        creditsConsumed: result.creditsConsumed,
        sessionId: this.session.id,
      })
    }
    this.send({ type: 'session_ended', reason })
    this.ws.close()
  }

  private async onClose(): Promise<void> {
    // Socket dropped or client crashed → finalize as disconnected (Req 12.4).
    if (!this.finalizing && this.session) {
      await this.finalize('disconnected', false)
    }
  }
}

/** Minimal default profile used when an account has not yet saved one. */
const DEFAULT_PROFILE = {
  name: 'Candidate',
  targetRole: 'Software Engineer',
  experienceYears: 5,
  roleCategories: ['software-development'],
  seniority: 'Senior' as const,
  skills: ['general'],
  companyType: 'Product' as const,
}

/**
 * Attach the session gateway to an HTTP server. Returns the underlying
 * {@link WebSocketServer} so the caller can close it on shutdown.
 */
export function createSessionGateway(
  deps: SessionGatewayDeps,
  options: { server?: import('node:http').Server; port?: number }
): WebSocketServer {
  const wss = options.server
    ? new WebSocketServer({ server: options.server })
    : new WebSocketServer({ port: options.port ?? 8788 })

  wss.on('connection', (ws) => {
    // eslint-disable-next-line no-console
    console.log('[gateway] client connected')
    new Connection(ws, deps)
  })

  return wss
}
