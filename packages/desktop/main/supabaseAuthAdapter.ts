// Production SupabaseAuthAdapter (Req 1.1, 1.2, 1.6, 1.10).
//
// Implements the AuthManager's adapter using @supabase/supabase-js for
// email/password, refresh, and sign-out, and an authorization-code + PKCE flow
// in the SYSTEM BROWSER (via an injected browser opener + loopback listener) for
// Google OAuth. No embedded webview is ever used.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { SupabaseAuthAdapter } from './authManager'
import type { Tokens } from './tokenStore'
import { createPkcePair, loopbackRedirectUri } from './pkce'

/** Opens a URL in the user's default system browser. */
export type BrowserOpener = (url: string) => Promise<void> | void

/**
 * Waits for the OAuth redirect on a loopback listener and resolves with the
 * `code` (and `state`) once the browser redirects back. Injected so the adapter
 * stays free of a hard http-server dependency and is testable.
 */
export type LoopbackWaiter = (
  port: number,
  expectedState: string
) => Promise<{ code: string }>

export interface SupabaseAuthAdapterOptions {
  supabaseUrl: string
  publishableKey: string
  openBrowser: BrowserOpener
  waitForRedirect: LoopbackWaiter
  loopbackPort?: number
}

export function createSupabaseAuthAdapter(opts: SupabaseAuthAdapterOptions): SupabaseAuthAdapter {
  const client: SupabaseClient = createClient(opts.supabaseUrl, opts.publishableKey, {
    auth: { flowType: 'pkce', persistSession: false, autoRefreshToken: false },
  })
  const port = opts.loopbackPort ?? 53682

  function toTokens(session: { access_token: string; refresh_token: string } | null): Tokens {
    if (!session) throw new Error('No session returned')
    return { accessToken: session.access_token, refreshToken: session.refresh_token }
  }

  return {
    async signInWithPassword(email, password) {
      const { data, error } = await client.auth.signInWithPassword({ email, password })
      if (error) throw error
      return toTokens(data.session)
    },

    async signInWithGoogle() {
      const pkce = createPkcePair()
      const redirectTo = loopbackRedirectUri(port)
      const { data, error } = await client.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo,
          skipBrowserRedirect: true,
          queryParams: { code_challenge: pkce.codeChallenge, code_challenge_method: 'S256' },
        },
      })
      if (error) throw error
      if (!data.url) throw new Error('No authorization URL')
      await opts.openBrowser(data.url)
      const { code } = await opts.waitForRedirect(port, pkce.state)
      const { data: ex, error: exErr } = await client.auth.exchangeCodeForSession(code)
      if (exErr) throw exErr
      return toTokens(ex.session)
    },

    async refresh(refreshToken) {
      const { data, error } = await client.auth.refreshSession({ refresh_token: refreshToken })
      if (error) throw error
      return toTokens(data.session)
    },

    async signOut() {
      await client.auth.signOut().catch(() => {})
    },
  }
}
