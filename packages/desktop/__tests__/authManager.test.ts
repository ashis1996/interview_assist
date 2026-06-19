import { describe, it, expect } from 'vitest'
import { AuthManager, type SupabaseAuthAdapter } from '../main/authManager'
import { createTokenStore, inMemorySecureStore, type Tokens } from '../main/tokenStore'

function adapter(overrides: Partial<SupabaseAuthAdapter> = {}): SupabaseAuthAdapter {
  return {
    signInWithPassword: async () => ({ accessToken: 'a', refreshToken: 'r' }),
    signInWithGoogle: async () => ({ accessToken: 'a', refreshToken: 'r' }),
    refresh: async () => ({ accessToken: 'a2', refreshToken: 'r2' }),
    signOut: async () => {},
    ...overrides,
  }
}

function manager(
  opts: { adapter?: SupabaseAuthAdapter; expired?: (t: Tokens) => boolean } = {}
) {
  const store = createTokenStore(inMemorySecureStore())
  const mgr = new AuthManager({
    environment: 'prod',
    tokenStore: store,
    adapter: opts.adapter ?? adapter(),
    ...(opts.expired ? { isAccessTokenExpired: opts.expired } : {}),
  })
  return { store, mgr }
}

describe('AuthManager (Req 1, 2)', () => {
  it('masks credential errors generically (Req 1.4)', async () => {
    const { mgr } = manager({
      adapter: adapter({
        signInWithPassword: async () => {
          throw new Error('user not found')
        },
      }),
    })
    const r = await mgr.signInWithPassword('a@b.com', 'pw')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.message).not.toContain('user not found')
  })

  it('restores without prompting when a valid token exists (Req 2.2)', async () => {
    const { store, mgr } = manager()
    await store.save('prod', { accessToken: 'a', refreshToken: 'r' })
    const state = await mgr.restore()
    expect(state.kind).toBe('authenticated')
  })

  it('refreshes an expired access token on restore (Req 1.6)', async () => {
    const { store, mgr } = manager({ expired: () => true })
    await store.save('prod', { accessToken: 'old', refreshToken: 'r' })
    const state = await mgr.restore()
    expect(state.kind).toBe('authenticated')
    if (state.kind === 'authenticated') expect(state.tokens.accessToken).toBe('a2')
  })

  it('falls back to sign-in when refresh fails (Req 1.7)', async () => {
    const { store, mgr } = manager({
      expired: () => true,
      adapter: adapter({
        refresh: async () => {
          throw new Error('invalid refresh token')
        },
      }),
    })
    await store.save('prod', { accessToken: 'old', refreshToken: 'bad' })
    const state = await mgr.restore()
    expect(state.kind).toBe('signed-out')
    expect(await store.load('prod')).toBeNull()
  })

  it('shows sign-in with no stored token (Req 2.4)', async () => {
    const { mgr } = manager()
    expect((await mgr.restore()).kind).toBe('signed-out')
  })

  it('sign-out clears tokens and ends the provider session (Req 1.10)', async () => {
    let signedOut = false
    const { store, mgr } = manager({
      adapter: adapter({
        signOut: async () => {
          signedOut = true
        },
      }),
    })
    await store.save('prod', { accessToken: 'a', refreshToken: 'r' })
    await mgr.signOut()
    expect(signedOut).toBe(true)
    expect(await store.load('prod')).toBeNull()
  })
})
