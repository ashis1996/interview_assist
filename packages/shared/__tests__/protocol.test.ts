import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { encode, decode, type ClientToServer, type ServerToClient } from '../protocol'
import type {
  Environment,
  EnforcementMode,
  SessionEndReason,
  SttProviderName,
} from '../types'

const clientArb: fc.Arbitrary<ClientToServer> = fc.oneof(
  fc.record({
    type: fc.constant<'auth'>('auth'),
    environment: fc.constantFrom<Environment>('local', 'dev', 'pre-prod', 'prod'),
    accessToken: fc.string(),
  }),
  fc.record({
    type: fc.constant<'start_session'>('start_session'),
    sttProvider: fc.constantFrom<SttProviderName>('deepgram', 'whisper'),
    silenceThresholdSeconds: fc.double({ min: 0.3, max: 5, noNaN: true }),
  }),
  fc.record({
    type: fc.constant<'capture_state'>('capture_state'),
    active: fc.boolean(),
    systemAudioAvailable: fc.boolean(),
  }),
  fc.record({ type: fc.constant<'text_question'>('text_question'), text: fc.string() }),
  fc.constant<ClientToServer>({ type: 'regenerate' }),
  fc.constant<ClientToServer>({ type: 'stop_session' })
)

const serverArb: fc.Arbitrary<ServerToClient> = fc.oneof(
  fc.record({
    type: fc.constant<'auth_ok'>('auth_ok'),
    accountId: fc.uuid(),
    creditBalance: fc.double({ min: 0, max: 1000, noNaN: true }),
    enforcement: fc.constantFrom<EnforcementMode>('enforced', 'bypassed'),
  }),
  fc.record({ type: fc.constant<'partial_transcript'>('partial_transcript'), text: fc.string() }),
  fc.record({ type: fc.constant<'final_question'>('final_question'), text: fc.string() }),
  fc.record({ type: fc.constant<'answer_token'>('answer_token'), token: fc.string() }),
  fc.record({
    type: fc.constant<'low_credit_warning'>('low_credit_warning'),
    creditBalance: fc.double({ min: 0, max: 100, noNaN: true }),
    threshold: fc.double({ min: 0, max: 100, noNaN: true }),
  }),
  fc.record({
    type: fc.constant<'session_ended'>('session_ended'),
    reason: fc.constantFrom<SessionEndReason>('user-ended', 'credits-exhausted', 'disconnected'),
  })
)

// Feature: interview-assistant-saas, Property 9: Session protocol message round-trip
describe('Property 9: protocol message round-trip', () => {
  it('encodes then decodes any client message to a deep-equal message', () => {
    fc.assert(
      fc.property(clientArb, (msg) => {
        const r = decode(encode(msg), 'client')
        expect(r.ok).toBe(true)
        if (r.ok) expect(r.message).toEqual(msg)
      }),
      { numRuns: 300 }
    )
  })

  it('encodes then decodes any server message to a deep-equal message', () => {
    fc.assert(
      fc.property(serverArb, (msg) => {
        const r = decode(encode(msg), 'server')
        expect(r.ok).toBe(true)
        if (r.ok) expect(r.message).toEqual(msg)
      }),
      { numRuns: 300 }
    )
  })

  it('decodes malformed input to an ignored result rather than throwing', () => {
    fc.assert(
      fc.property(fc.string(), (raw) => {
        const r = decode(raw)
        // Never throws; either recognized or ignored.
        expect(typeof r.ok).toBe('boolean')
      }),
      { numRuns: 300 }
    )
    expect(decode('not json').ok).toBe(false)
    expect(decode('123').ok).toBe(false)
    expect(decode('{"type":"nope"}').ok).toBe(false)
    expect(decode('[]').ok).toBe(false)
  })
})
