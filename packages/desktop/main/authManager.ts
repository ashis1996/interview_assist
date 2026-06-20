// Auth Manager (Req 1, 2).
//
// Orchestrates Supabase email/password and Google OAuth (PKCE via system
// browser) sign-in, secure token persistence, session restoration, and silent
// refresh. The Supabase calls and the system-browser/loopback OAuth dance are
// behind the injected {@link SupabaseAuthAdapter} so the restore/refresh/sign-out
// decision logic is unit-testable. Where the environment's auth mode is
// bypassed (local/dev) the caller skips sign-in entirely (Req 1.12).

import type { Environment } from '@interview-assistant/shared'
import type { TokenStore, Tokens } from './tokenStore'

/**
 * Decode a JWT's `exp` (seconds since epoch) without verifying the signature —
 * the gateway verifies; here we only need to know whether to refresh first.
 * Returns null when the token isn't a parseable JWT.
 */
function decodeJwtExpSeconds(token: string): number | null {
  const parts = token.split('.')
  if (parts.length < 2) return null
  try {
    const b64 = parts[1]!.replace(/-/g, '+').replace(/_/g, '/')
    const json = Buffer.from(b64, 'base64').toString('utf8')
    const payload = JSON.parse(json) as { exp?: number }
    return typeof payload.exp === 'number' ? payload.exp : null
  } catch {
    return null
  }
}

/** Refresh slightly BEFORE the real expiry to absorb clock skew + request latency. */
const EXPIRY_SKEW_MS = 60_000

/**
 * Default access-token expiry check used in production: parse the JWT `exp`
 * claim and treat the token as expired once it is within {@link EXPIRY_SKEW_MS}
 * of expiring. This is what makes silent refresh actually fire — without it the
 * gateway receives a stale token and rejects auth with an `"exp" claim` error.
 * If the token isn't a parseable JWT we assume it's still valid and let the
 * gateway/refresh path decide.
 */
export function defaultIsAccessTokenExpired(tokens: Tokens): boolean {
  const exp = decodeJwtExpSeconds(tokens.accessToken)
  if (exp === null) return false
  return exp * 1000 <= Date.now() + EXPIRY_SKEW_MS
}

/** Result of an authentication attempt. */
export type AuthResult =
  | { ok: true; tokens: Tokens }
  | { ok: false; message: string }

/** The state the UI should present. */
export type AuthState =
  | { kind: 'authenticated'; tokens: Tokens }
  | { kind: 'signed-out' }
  | { kind: 'signed-out'; restoreError: string }

/**
 * Adapter over Supabase Auth for one environment's project. Implemented in
 * production with `@supabase/supabase-js`; faked in tests.
 */
export interface SupabaseAuthAdapter {
  /** Email/password grant (Req 1.1). Rejects on bad credentials. */
  signInWithPassword(email: string, password: string): Promise<Tokens>
  /** Run the Google OAuth auth-code + PKCE flow in the system browser (Req 1.2). */
  signInWithGoogle(): Promise<Tokens>
  /** Exchange a refresh token for a new session (Req 1.6). Rejects if invalid. */
  refresh(refreshToken: string): Promise<Tokens>
  /** End the provider session (Req 1.10). */
  signOut(accessToken: string): Promise<void>
}

export interface AuthManagerOptions {
  environment: Environment
  tokenStore: TokenStore
  adapter: SupabaseAuthAdapter
  /** Test seam: treat a token as expired. Defaults to never (adapter refreshes lazily). */
  isAccessTokenExpired?: (tokens: Tokens) => boolean
}

export class AuthManager {
  private readonly env: Environment
  private readonly store: TokenStore
  private readonly adapter: SupabaseAuthAdapter
  private readonly isExpired: (t: Tokens) => boolean

  constructor(opts: AuthManagerOptions) {
    this.env = opts.environment
    this.store = opts.tokenStore
    this.adapter = opts.adapter
    this.isExpired = opts.isAccessTokenExpired ?? defaultIsAccessTokenExpired
  }

  /** Email/password sign-in. Errors are masked generically (Req 1.4). */
  async signInWithPassword(email: string, password: string): Promise<AuthResult> {
    try {
      const tokens = await this.adapter.signInWithPassword(email, password)
      await this.store.save(this.env, tokens)
      return { ok: true, tokens }
    } catch {
      // Do not reveal which field was wrong (Req 1.4).
      return { ok: false, message: 'Authentication failed. Check your email and password.' }
    }
  }

  /** Google OAuth sign-in via the system browser (Req 1.2). */
  async signInWithGoogle(): Promise<AuthResult> {
    try {
      const tokens = await this.adapter.signInWithGoogle()
      await this.store.save(this.env, tokens)
      return { ok: true, tokens }
    } catch {
      return { ok: false, message: 'Google sign-in failed. Please try again.' }
    }
  }

  /**
   * Restore the session on launch (Req 2.2, 2.3, 2.6). If a stored token exists
   * and the access token is still valid, return it. If expired, refresh via the
   * refresh token (Req 1.6); on refresh failure return to sign-in (Req 1.7). A
   * corrupt/undecryptable token surfaces a restore error (Req 2.6). With no
   * token, present the sign-in screen (Req 2.4).
   */
  async restore(): Promise<AuthState> {
    let stored: Tokens | null
    try {
      stored = await this.store.load(this.env)
    } catch {
      return { kind: 'signed-out', restoreError: 'Saved session could not be restored.' }
    }

    if (!stored) {
      return { kind: 'signed-out' }
    }

    if (!this.isExpired(stored)) {
      return { kind: 'authenticated', tokens: stored }
    }

    // Access token expired: attempt a silent refresh (Req 1.6).
    try {
      const refreshed = await this.adapter.refresh(stored.refreshToken)
      await this.store.save(this.env, refreshed)
      return { kind: 'authenticated', tokens: refreshed }
    } catch {
      await this.store.clear(this.env).catch(() => {})
      return { kind: 'signed-out' } // refresh failed -> sign-in (Req 1.7)
    }
  }

  /** Obtain a fresh access token for an authorized request (Req 1.6). */
  async getValidAccessToken(): Promise<string | undefined> {
    const stored = await this.store.load(this.env).catch(() => null)
    if (!stored) return undefined
    if (!this.isExpired(stored)) return stored.accessToken
    try {
      const refreshed = await this.adapter.refresh(stored.refreshToken)
      await this.store.save(this.env, refreshed)
      return refreshed.accessToken
    } catch {
      await this.store.clear(this.env).catch(() => {})
      return undefined
    }
  }

  /** Sign out: clear stored tokens and end the provider session (Req 1.10). */
  async signOut(): Promise<void> {
    const stored = await this.store.load(this.env).catch(() => null)
    if (stored) {
      await this.adapter.signOut(stored.accessToken).catch(() => {})
    }
    await this.store.clear(this.env).catch(() => {})
  }
}
