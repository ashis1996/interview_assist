import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { redact, redactToken } from '../redact'

describe('redact (Req 9.1, 9.2, 9.4)', () => {
  it('reports absent values without leaking', () => {
    expect(redact(undefined)).toBe('(absent)')
    expect(redact(null)).toBe('(absent)')
    expect(redact('')).toBe('(absent)')
  })

  it('fully masks a present secret', () => {
    expect(redact('eyJhbGciOiJIUzI1NiJ9.payload.sig')).toBe('***')
    expect(redact('sk-deepgram-super-secret-key')).toBe('***')
  })

  // Core safety property: the masked output never contains the full secret.
  it('never returns the full secret value', () => {
    fc.assert(
      fc.property(
        // Realistic token/secret shapes: length >= 9 of url-safe characters.
        fc.stringOf(
          fc.constantFrom(...'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.'.split('')),
          { minLength: 9, maxLength: 256 }
        ),
        (secret) => {
          expect(redact(secret).includes(secret)).toBe(false)
          expect(redactToken(secret).includes(secret)).toBe(false)
        }
      )
    )
  })
})

describe('redactToken', () => {
  it('reports absent values without leaking', () => {
    expect(redactToken(undefined)).toBe('(absent)')
    expect(redactToken('')).toBe('(absent)')
  })

  it('fully masks short values', () => {
    expect(redactToken('12345678')).toBe('***')
  })

  it('keeps only a non-reconstructable last-4 hint for long tokens', () => {
    const token = 'abcdefghijklmnopqrstuvwxyz1234'
    const masked = redactToken(token)
    expect(masked).toBe('tok…1234')
    expect(masked.includes(token)).toBe(false)
  })
})
