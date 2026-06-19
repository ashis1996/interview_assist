import { describe, it, expect } from 'vitest'
import { BackendSessionClient, type SocketLike } from '../main/backendSessionClient'
import { encode, decode, type ServerToClient } from '@interview-assistant/shared'

/** A controllable fake socket implementing the SocketLike contract. */
class FakeSocket {
  readyState = 1
  sent: Array<string | Uint8Array> = []
  private handlers: Record<string, Array<(...a: unknown[]) => void>> = {}

  send(data: string | ArrayBufferView): void {
    this.sent.push(
      typeof data === 'string'
        ? data
        : new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    )
  }
  close(): void {
    this.emit('close')
  }
  on(event: string, cb: (...a: unknown[]) => void): void {
    ;(this.handlers[event] ??= []).push(cb)
  }
  emit(event: string, ...args: unknown[]): void {
    for (const cb of this.handlers[event] ?? []) cb(...args)
  }
  /** Helper: deliver a server message as a text frame. */
  deliver(msg: ServerToClient): void {
    this.emit('message', encode(msg), false)
  }
}

function asSocket(socket: FakeSocket): SocketLike {
  return socket as unknown as SocketLike
}

function makeClient(socket: FakeSocket, accessToken?: string) {
  return new BackendSessionClient({
    gatewayUrl: 'ws://test/gateway',
    environment: 'dev',
    getAccessToken: () => accessToken,
    socketFactory: () => asSocket(socket),
  })
}

describe('BackendSessionClient (Req 5)', () => {
  it('sends the auth handshake on open with the environment', async () => {
    const socket = new FakeSocket()
    const client = makeClient(socket, 'tok-123')
    client.start()
    socket.emit('open')
    await Promise.resolve()
    await Promise.resolve()
    const auth = socket.sent.find((s) => typeof s === 'string' && s.includes('"auth"')) as string
    const decoded = decode(auth, 'client')
    expect(decoded.ok).toBe(true)
    if (decoded.ok) {
      expect(decoded.message).toMatchObject({ type: 'auth', environment: 'dev', accessToken: 'tok-123' })
    }
  })

  it('queues commands sent before connect and flushes them on open', async () => {
    const socket = new FakeSocket()
    const client = makeClient(socket)
    client.start()
    // Not yet open: command should be queued.
    client.sendStartSession('deepgram', 1.5)
    expect(socket.sent.length).toBe(0)
    socket.emit('open')
    await Promise.resolve()
    await Promise.resolve()
    const hasStart = socket.sent.some((s) => typeof s === 'string' && s.includes('"start_session"'))
    expect(hasStart).toBe(true)
  })

  it('decodes server messages into typed events', async () => {
    const socket = new FakeSocket()
    const client = makeClient(socket)
    const tokens: string[] = []
    let ended: string | null = null
    client.on('answer_token', ({ token }) => tokens.push(token))
    client.on('final_question', ({ text }) => expect(text).toBe('scale a service'))
    client.on('session_ended', ({ reason }) => {
      ended = reason
    })
    client.start()
    socket.emit('open')
    socket.deliver({ type: 'final_question', text: 'scale a service' })
    socket.deliver({ type: 'answer_token', token: 'I ' })
    socket.deliver({ type: 'answer_token', token: 'would.' })
    socket.deliver({ type: 'session_ended', reason: 'user-ended' })
    expect(tokens.join('')).toBe('I would.')
    expect(ended).toBe('user-ended')
  })

  it('uploads audio as binary only while connected', async () => {
    const socket = new FakeSocket()
    const client = makeClient(socket)
    client.start()
    client.uploadAudio(Int16Array.of(1, 2, 3)) // dropped (not connected)
    expect(socket.sent.length).toBe(0)
    socket.emit('open')
    await Promise.resolve()
    socket.sent.length = 0 // ignore the auth frame
    client.uploadAudio(Int16Array.of(1, 2, 3))
    expect(socket.sent.length).toBe(1)
    expect(socket.sent[0]).toBeInstanceOf(Uint8Array)
  })
})
