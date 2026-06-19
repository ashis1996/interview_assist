import { describe, it, expect } from 'vitest'
import type { ConversionRate } from '@interview-assistant/shared'
import { buildHttpServer } from '../http/server'
import { AuthVerifier } from '../http/authVerifier'
import { CreditsService } from '../credits/creditsService'
import { createMemoryRepositories } from '../repos/memory'

const RATE: ConversionRate = { creditsPerSttMinute: 1, creditsPerLlmToken: 0.0001 }

/** Build the HTTP app wired to in-memory repos for inject-based tests. */
function buildTestApp() {
  const repos = createMemoryRepositories()
  // JWKS is resolved lazily and never used by /healthz, so a placeholder URL is
  // fine here — the health probe is unauthenticated.
  const authVerifier = new AuthVerifier({
    jwksUrl: 'https://example.test/jwks',
    issuer: 'https://example.test',
    accounts: repos.accounts,
  })
  const creditsService = new CreditsService({
    repos,
    conversionRate: RATE,
    lowCreditThreshold: 5,
  })
  return buildHttpServer({ environment: 'dev', repos, authVerifier, creditsService })
}

describe('GET /healthz', () => {
  it('returns 200 { ok: true } without an Authorization header', async () => {
    const app = buildTestApp()
    try {
      const res = await app.inject({ method: 'GET', url: '/healthz' })
      expect(res.statusCode).toBe(200)
      expect(res.json()).toEqual({ ok: true })
    } finally {
      await app.close()
    }
  })

  it('does not require auth even though account-scoped routes do (401)', async () => {
    const app = buildTestApp()
    try {
      // Health probe: no auth needed.
      const health = await app.inject({ method: 'GET', url: '/healthz' })
      expect(health.statusCode).toBe(200)

      // An account-scoped route in dev (enforced auth) rejects without a token,
      // confirming /healthz is genuinely unauthenticated rather than auth being
      // globally bypassed.
      const balance = await app.inject({ method: 'GET', url: '/credits/balance' })
      expect(balance.statusCode).toBe(401)
    } finally {
      await app.close()
    }
  })
})
