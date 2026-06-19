import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { environmentIndicator, nextLaunchDefault } from '../main/envConfig'
import {
  createPkcePair,
  deriveCodeChallenge,
  generateCodeVerifier,
  loopbackRedirectUri,
} from '../main/pkce'
import { createTokenStore, inMemorySecureStore } from '../main/tokenStore'
import { ENVIRONMENTS, type Environment } from '@interview-assistant/shared'

describe('envConfig selection rules (Req 3)', () => {
  it('shows the indicator when selected and hides it when none (Req 3.4, 3.5)', () => {
    for (const e of ENVIRONMENTS) expect(environmentIndicator(e)).toBe(e)
    expect(environmentIndicator(null)).toBeNull()
  })

  it('defaults next launch to prod only when prod was selected (Req 3.7)', () => {
    expect(nextLaunchDefault('prod')).toBe('prod')
    expect(nextLaunchDefault('dev')).toBe('dev')
    expect(nextLaunchDefault('local')).toBe('local')
    expect(nextLaunchDefault(null)).toBeNull()
  })
})

describe('PKCE helpers (Req 1.2)', () => {
  it('produces a verifier in the RFC 7636 length range and a matching S256 challenge', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 50 }), () => {
        const verifier = generateCodeVerifier()
        expect(verifier.length).toBeGreaterThanOrEqual(43)
        expect(verifier.length).toBeLessThanOrEqual(128)
        // base64url alphabet only.
        expect(/^[A-Za-z0-9_-]+$/.test(verifier)).toBe(true)
        const challenge = deriveCodeChallenge(verifier)
        expect(deriveCodeChallenge(verifier)).toBe(challenge) // deterministic
        expect(/^[A-Za-z0-9_-]+$/.test(challenge)).toBe(true)
      }),
      { numRuns: 100 }
    )
  })

  it('generates unique verifiers/state across pairs', () => {
    const a = createPkcePair()
    const b = createPkcePair()
    expect(a.codeVerifier).not.toBe(b.codeVerifier)
    expect(a.state).not.toBe(b.state)
  })

  it('builds a loopback redirect uri', () => {
    expect(loopbackRedirectUri(54321)).toBe('http://127.0.0.1:54321/oauth/callback')
  })
})

describe('token store (Req 2)', () => {
  it('round-trips tokens per environment and isolates them', async () => {
    const store = createTokenStore(inMemorySecureStore())
    await store.save('dev', { accessToken: 'a-dev', refreshToken: 'r-dev' })
    await store.save('prod', { accessToken: 'a-prod', refreshToken: 'r-prod' })
    expect(await store.load('dev')).toEqual({ accessToken: 'a-dev', refreshToken: 'r-dev' })
    expect(await store.load('prod')).toEqual({ accessToken: 'a-prod', refreshToken: 'r-prod' })
    await store.clear('dev')
    expect(await store.load('dev')).toBeNull()
    expect(await store.load('prod')).not.toBeNull()
  })

  it('returns null for an absent or corrupt value (Req 2.6)', async () => {
    const secure = inMemorySecureStore()
    const store = createTokenStore(secure)
    expect(await store.load('local' as Environment)).toBeNull()
    await secure.set('interview-assistant:tokens:local', 'not-json{')
    expect(await store.load('local')).toBeNull()
  })
})
