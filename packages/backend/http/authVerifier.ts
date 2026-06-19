// Auth Verifier (Req 1.8, 1.9, 1.11, 1.12).
//
// Verifies a Supabase-issued Access_Token against the environment's JWKS and
// maps the verified identity to an Account, provisioning one on first sign-in.
// When the environment's Auth_Enforcement_Mode is bypassed (local/dev), token
// verification is skipped and the request is attributed to the Dev_Account.

import { createRemoteJWKSet, jwtVerify, type JWTPayload } from 'jose'
import type { Account, AuthMode } from '@interview-assistant/shared'
import type { AccountsRepo } from '../repos/types'

export class AuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'AuthError'
  }
}

export interface AuthVerifierOptions {
  jwksUrl: string
  issuer: string
  accounts: AccountsRepo
  /** Optional override of the JWKS resolver (test seam). */
  jwks?: ReturnType<typeof createRemoteJWKSet>
  /**
   * Optional owner-bootstrap allow-list of emails (normalized: trimmed +
   * lowercased). When a NEW account is provisioned whose JWT email is in this
   * set, its `is_superuser` flag is set to true automatically (Req 7.8). The DB
   * flag remains the source of truth; existing accounts are never modified here.
   */
  bootstrapSuperuserEmails?: Set<string>
}

/**
 * Verifies tokens and resolves the owning Account. Construct once per backend.
 *
 * The JWKS resolver is created LAZILY on the first enforced verification, so a
 * missing/invalid JWKS URL never crashes startup — important in auth-bypassed
 * environments (local/dev) where JWKS is never used (Req 1.12).
 */
export class AuthVerifier {
  private jwks: ReturnType<typeof createRemoteJWKSet> | null
  private readonly jwksUrl: string
  private readonly issuer: string
  private readonly accounts: AccountsRepo
  private readonly bootstrapSuperuserEmails: Set<string>

  constructor(opts: AuthVerifierOptions) {
    this.jwks = opts.jwks ?? null
    this.jwksUrl = opts.jwksUrl
    this.issuer = opts.issuer
    this.accounts = opts.accounts
    this.bootstrapSuperuserEmails = opts.bootstrapSuperuserEmails ?? new Set()
  }

  /** Lazily build (and cache) the JWKS resolver; throws AuthError on a bad URL. */
  private getJwks(): ReturnType<typeof createRemoteJWKSet> {
    if (this.jwks) return this.jwks
    try {
      this.jwks = createRemoteJWKSet(new URL(this.jwksUrl))
    } catch {
      throw new AuthError('Auth is not configured for this environment (invalid JWKS URL)')
    }
    return this.jwks
  }

  /**
   * Resolve the Account for a request given the environment's auth mode.
   *
   * - bypassed (local/dev): skip verification, attribute to the Dev_Account
   *   (Req 1.12, 5.2a).
   * - enforced: verify the token via JWKS; reject absent/expired/invalid tokens
   *   (Req 1.8); provision an Account on first sign-in (Req 1.9).
   *
   * @throws {AuthError} when enforced and the token is absent/invalid.
   */
  async resolveAccount(authMode: AuthMode, accessToken: string | undefined): Promise<Account> {
    if (authMode === 'bypassed') {
      return this.accounts.getOrCreateDevAccount()
    }

    if (!accessToken) {
      throw new AuthError('Access token is required')
    }

    let payload: JWTPayload
    try {
      const result = await jwtVerify(accessToken, this.getJwks(), { issuer: this.issuer })
      payload = result.payload
    } catch (err) {
      if (err instanceof AuthError) throw err
      throw new AuthError(`Invalid access token: ${err instanceof Error ? err.message : 'unknown'}`)
    }

    const sub = payload.sub
    if (!sub) {
      throw new AuthError('Access token has no subject')
    }

    // Supabase puts the user's email in the `email` claim; carry it onto the
    // Account row so it is human-readable for monitoring (Req 7.1, 7.2). Never
    // log token values.
    const email = typeof payload.email === 'string' ? payload.email : undefined

    const existing = await this.accounts.findByIdentityRef(sub)
    if (existing) return existing
    // First sign-in: provision an Account (+ empty ledger implicitly) (Req 1.9),
    // recording the email for monitoring when present (Req 7.2).
    const provisioned = await this.accounts.provision(sub, email)

    // Optional owner bootstrap (Req 7.8): when this NEW account's email is in the
    // configured allow-list, auto-grant superuser so the owner is unlimited on
    // first sign-in without a manual toggle. Only applied on provision of a new
    // account, so owner-managed flips of the flag are never overwritten here.
    if (email && this.bootstrapSuperuserEmails.size > 0 && !provisioned.isSuperuser) {
      const normalized = email.trim().toLowerCase()
      if (this.bootstrapSuperuserEmails.has(normalized)) {
        return this.accounts.setSuperuser(sub, true)
      }
    }
    return provisioned
  }
}
