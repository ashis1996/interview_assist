import { describe, it, expect } from 'vitest'
import { SignJWT, exportJWK, generateKeyPair, createLocalJWKSet, type JWK } from 'jose'
import { AuthVerifier, AuthError, type AuthVerifierOptions } from '../http/authVerifier'
import { createMemoryRepositories, DEV_ACCOUNT_IDENTITY_REF } from '../repos/memory'

const ISSUER = 'https://example.test/auth/v1'

function makeVerifier() {
  const repos = createMemoryRepositories()
  const verifier = new AuthVerifier({
    jwksUrl: 'https://example.test/jwks.json',
    issuer: ISSUER,
    accounts: repos.accounts,
  })
  return { repos, verifier }
}

/**
 * Build an enforced verifier backed by a locally-signed RS256 key pair so we
 * can exercise the success path (a verifiable token) deterministically without
 * a network JWKS fetch.
 */
async function makeSigningVerifier(bootstrapSuperuserEmails?: Set<string>) {
  const repos = createMemoryRepositories()
  const { publicKey, privateKey } = await generateKeyPair('RS256')
  const publicJwk = (await exportJWK(publicKey)) as JWK
  publicJwk.kid = 'test-key'
  publicJwk.alg = 'RS256'
  const jwks = createLocalJWKSet({ keys: [publicJwk] })
  const verifier = new AuthVerifier({
    jwksUrl: 'https://example.test/jwks.json',
    issuer: ISSUER,
    accounts: repos.accounts,
    jwks: jwks as unknown as AuthVerifierOptions['jwks'],
    ...(bootstrapSuperuserEmails ? { bootstrapSuperuserEmails } : {}),
  })
  async function sign(claims: Record<string, unknown>): Promise<string> {
    return new SignJWT(claims)
      .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
      .setIssuer(ISSUER)
      .setIssuedAt()
      .setExpirationTime('5m')
      .sign(privateKey)
  }
  return { repos, verifier, sign }
}

describe('AuthVerifier', () => {
  it('bypassed mode attributes the request to the Dev_Account without a token (Req 1.12)', async () => {
    const { verifier } = makeVerifier()
    const account = await verifier.resolveAccount('bypassed', undefined)
    expect(account.identityRef).toBe(DEV_ACCOUNT_IDENTITY_REF)
  })

  it('bypassed mode returns the same Dev_Account on repeated calls', async () => {
    const { verifier } = makeVerifier()
    const a = await verifier.resolveAccount('bypassed', undefined)
    const b = await verifier.resolveAccount('bypassed', undefined)
    expect(a.id).toBe(b.id)
  })

  it('enforced mode rejects a missing token with AuthError (Req 1.8)', async () => {
    const { verifier } = makeVerifier()
    await expect(verifier.resolveAccount('enforced', undefined)).rejects.toBeInstanceOf(AuthError)
  })

  it('enforced mode rejects an invalid token with AuthError (Req 1.8)', async () => {
    const { verifier } = makeVerifier()
    await expect(verifier.resolveAccount('enforced', 'not-a-jwt')).rejects.toBeInstanceOf(AuthError)
  })

  it('enforced mode carries the JWT email claim onto the provisioned Account (Req 7.1, 7.2)', async () => {
    const { repos, verifier, sign } = await makeSigningVerifier()
    const token = await sign({ sub: 'user-123', email: 'owner@example.com' })

    const account = await verifier.resolveAccount('enforced', token)

    expect(account.identityRef).toBe('user-123')
    expect(account.email).toBe('owner@example.com')
    const stored = await repos.accounts.findByIdentityRef('user-123')
    expect(stored?.email).toBe('owner@example.com')
  })

  it('enforced mode provisions without an email when the claim is absent (Req 7.2)', async () => {
    const { verifier, sign } = await makeSigningVerifier()
    const token = await sign({ sub: 'user-456' })

    const account = await verifier.resolveAccount('enforced', token)

    expect(account.identityRef).toBe('user-456')
    expect(account.email).toBeUndefined()
  })

  describe('superuser bootstrap (Req 7.8)', () => {
    it('auto-flags a NEW account whose JWT email is in the bootstrap list', async () => {
      const { repos, verifier, sign } = await makeSigningVerifier(
        new Set(['owner@example.com'])
      )
      const token = await sign({ sub: 'owner-1', email: 'owner@example.com' })

      const account = await verifier.resolveAccount('enforced', token)

      expect(account.isSuperuser).toBe(true)
      const stored = await repos.accounts.findByIdentityRef('owner-1')
      expect(stored?.isSuperuser).toBe(true)
    })

    it('matches the bootstrap list case-insensitively / ignoring surrounding whitespace', async () => {
      const { verifier, sign } = await makeSigningVerifier(new Set(['owner@example.com']))
      const token = await sign({ sub: 'owner-2', email: '  Owner@Example.COM ' })

      const account = await verifier.resolveAccount('enforced', token)

      expect(account.isSuperuser).toBe(true)
    })

    it('does NOT flag a new account whose email is not in the bootstrap list', async () => {
      const { verifier, sign } = await makeSigningVerifier(new Set(['owner@example.com']))
      const token = await sign({ sub: 'tester-1', email: 'tester@example.com' })

      const account = await verifier.resolveAccount('enforced', token)

      expect(account.isSuperuser).toBe(false)
    })

    it('does NOT flag when no bootstrap list is configured', async () => {
      const { verifier, sign } = await makeSigningVerifier()
      const token = await sign({ sub: 'tester-2', email: 'tester@example.com' })

      const account = await verifier.resolveAccount('enforced', token)

      expect(account.isSuperuser).toBe(false)
    })

    it('does NOT modify an EXISTING account even if its email is in the bootstrap list', async () => {
      const { repos, verifier, sign } = await makeSigningVerifier(
        new Set(['owner@example.com'])
      )
      // Pre-provision the account as a regular (non-superuser) account, as if it
      // had signed in before the email was added to the bootstrap list.
      await repos.accounts.provision('owner-3', 'owner@example.com')
      const token = await sign({ sub: 'owner-3', email: 'owner@example.com' })

      const account = await verifier.resolveAccount('enforced', token)

      // Bootstrap only applies on first provision; an existing row is untouched.
      expect(account.isSuperuser).toBe(false)
    })
  })
})
