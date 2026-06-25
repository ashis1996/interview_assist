// Client <-> Backend session WebSocket protocol.
//
// Evolved from v1 `src/shared/bridge.ts` (the newline-delimited JSON protocol
// between the Electron main process and the Python sidecar). The four v1 event
// names — `partial_transcript`, `final_question`, `stt_error`, `capture_state`
// — are preserved so the repurposed desktop session client keeps its shape; new
// messages are added for the auth handshake, credits, and finalization.
//
// Transport: a single persistent WebSocket per Session. Control messages are
// JSON text frames (encoded/decoded here); Audio_Frames are sent as binary
// frames (little-endian 16-bit PCM) and are NOT modeled by this union.

import type {
  Environment,
  EnforcementMode,
  Profile,
  ScopeClassification,
  SessionEndReason,
  SttProviderName,
  TopicDomain,
  UsageSummary,
} from './types'

/** Upbound control messages (Desktop_Client -> Session_Gateway). */
export type ClientToServer =
  // Auth handshake — first frame after the socket opens (Req 5.2). In
  // auth-bypassed environments `accessToken` may be omitted (Req 5.2a).
  | { type: 'auth'; environment: Environment; accessToken?: string }
  // Start relaying after the pre-session credit check passes (Req 12.1). The
  // optional `profile` carries the onboarding form (role, company, resume
  // background) so answers are personalized and domain-disambiguated.
  | {
      type: 'start_session'
      sttProvider: SttProviderName
      silenceThresholdSeconds?: number
      profile?: Profile
    }
  // Declare capture state from the client (Req 4.3, 4.4).
  | { type: 'capture_state'; active: boolean; systemAudioAvailable: boolean }
  // A question typed by the user instead of spoken (Req 14, reused pipeline).
  | { type: 'text_question'; text: string }
  // Manually answer the latest finalized (spoken) question — the "Answer" button.
  | { type: 'answer' }
  // Toggle auto-answer: when on, each finalized question is answered immediately.
  | { type: 'set_auto_generate'; enabled: boolean }
  // Toggle coding mode: when on, force code-first answers for the session.
  | { type: 'set_coding_mode'; enabled: boolean }
  // Answer a question extracted from a screenshot via the vision model (Phase 2).
  | { type: 'screenshot_question'; imageBase64: string; mimeType: string }
  // Regenerate the answer for the current question.
  | { type: 'regenerate' }
  // Graceful stop initiated by the user (Req 5.8, 12.2).
  | { type: 'stop_session' }

/** Downbound control messages (Session_Gateway -> Desktop_Client). */
export type ServerToClient =
  // Connection accepted / rejected after auth verification (Req 5.2).
  | { type: 'auth_ok'; accountId: string; creditBalance: number; enforcement: EnforcementMode }
  | { type: 'auth_error'; message: string }
  // Live transcript + finalized question (reused v1 event names) (Req 5.4, 5.6).
  | { type: 'partial_transcript'; text: string }
  | { type: 'final_question'; text: string }
  // Topic + scope badges for the current question (Req 6.6, 6.7).
  | { type: 'topics'; topics: TopicDomain[] }
  | { type: 'scope'; scope: ScopeClassification; color: string }
  // Streamed answer tokens + completion (Req 5.5, 15.5).
  | { type: 'answer_token'; token: string }
  | { type: 'answer_complete'; answer: string }
  // STT failure — session stays open (reused name) (Req 5.7, 13.8).
  | { type: 'stt_error'; message: string }
  // LLM backend/timeout error — no answer for that question (Req 15.6).
  | { type: 'answer_error'; provider: string; message: string }
  // Credit warnings + lifecycle (Req 10.1, 12.6).
  | { type: 'low_credit_warning'; creditBalance: number; threshold: number }
  | { type: 'session_summary'; usage: UsageSummary; creditsConsumed: number; sessionId: string }
  | { type: 'session_ended'; reason: SessionEndReason }

/** Any protocol message in either direction. */
export type ProtocolMessage = ClientToServer | ServerToClient

/**
 * The result of decoding a raw text frame.
 *
 * - `ok`: the frame was valid JSON with a recognized `type`; `message` is the
 *   parsed message.
 * - `ignored`: the frame was malformed (not JSON, not an object, or no `type`).
 *   Callers ignore it rather than treating it as an error, mirroring v1's
 *   "ignore unrecognized line" behavior.
 */
export type DecodeResult<T extends ProtocolMessage = ProtocolMessage> =
  | { ok: true; message: T }
  | { ok: false; reason: 'ignored' }

/** The recognized client->server message discriminants. */
const CLIENT_TYPES = new Set<ClientToServer['type']>([
  'auth',
  'start_session',
  'capture_state',
  'text_question',
  'answer',
  'set_auto_generate',
  'set_coding_mode',
  'screenshot_question',
  'regenerate',
  'stop_session',
])

/** The recognized server->client message discriminants. */
const SERVER_TYPES = new Set<ServerToClient['type']>([
  'auth_ok',
  'auth_error',
  'partial_transcript',
  'final_question',
  'topics',
  'scope',
  'answer_token',
  'answer_complete',
  'stt_error',
  'answer_error',
  'low_credit_warning',
  'session_summary',
  'session_ended',
])

/** Every recognized message discriminant. */
const ALL_TYPES = new Set<string>([...CLIENT_TYPES, ...SERVER_TYPES])

/**
 * Encode a protocol message to a JSON text frame. Pure and total for any valid
 * {@link ProtocolMessage}.
 */
export function encode(message: ProtocolMessage): string {
  return JSON.stringify(message)
}

/**
 * Decode a raw text frame into a protocol message. Malformed input (invalid
 * JSON, non-object, or an unrecognized/absent `type`) decodes to an `ignored`
 * result rather than throwing, so a bad frame never crashes the connection.
 *
 * @param raw The raw text frame received on the socket.
 * @param recognize Which discriminant set to accept: `'client'`, `'server'`, or
 *   `'any'` (default). Useful so each side only accepts the other side's frames.
 */
export function decode(
  raw: string,
  recognize: 'client' | 'server' | 'any' = 'any'
): DecodeResult {
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { ok: false, reason: 'ignored' }
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return { ok: false, reason: 'ignored' }
  }

  const type = (parsed as { type?: unknown }).type
  if (typeof type !== 'string') {
    return { ok: false, reason: 'ignored' }
  }

  const allowed =
    recognize === 'client' ? CLIENT_TYPES : recognize === 'server' ? SERVER_TYPES : ALL_TYPES
  if (!allowed.has(type)) {
    return { ok: false, reason: 'ignored' }
  }

  return { ok: true, message: parsed as ProtocolMessage }
}
