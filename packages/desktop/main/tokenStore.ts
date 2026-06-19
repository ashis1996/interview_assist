// Secure token storage (Req 2).
//
// Auth tokens are persisted ONLY in the OS secure credential store. The storage
// mechanism is abstracted behind {@link SecureStore} so the per-environment
// keying logic is unit-testable with an in-memory store, while production uses
// the Electron `safeStorage` adapter (electronSafeStorageStore).

import type { Environment } from '@interview-assistant/shared'

/** A stored token pair. */
export interface Tokens {
  accessToken: string
  refreshToken: string
}

/** Low-level encrypted key/value store (OS keychain via Electron safeStorage). */
export interface SecureStore {
  get(key: string): Promise<string | null>
  set(key: string, value: string): Promise<void>
  delete(key: string): Promise<void>
}

/** Per-environment token store keyed so each environment is isolated (Req 3.3). */
export interface TokenStore {
  save(env: Environment, tokens: Tokens): Promise<void>
  load(env: Environment): Promise<Tokens | null>
  clear(env: Environment): Promise<void>
}

function keyFor(env: Environment): string {
  return `interview-assistant:tokens:${env}`
}

/**
 * Build a {@link TokenStore} over a {@link SecureStore}. Tokens are serialized
 * as JSON; a corrupt/undecryptable value surfaces as `null` so the caller shows
 * the sign-in screen with a restore error (Req 2.6).
 */
export function createTokenStore(secure: SecureStore): TokenStore {
  return {
    async save(env, tokens) {
      await secure.set(keyFor(env), JSON.stringify(tokens))
    },
    async load(env) {
      const raw = await secure.get(keyFor(env))
      if (!raw) return null
      try {
        const parsed = JSON.parse(raw) as Tokens
        if (typeof parsed.accessToken === 'string' && typeof parsed.refreshToken === 'string') {
          return parsed
        }
        return null
      } catch {
        return null
      }
    },
    async clear(env) {
      await secure.delete(keyFor(env))
    },
  }
}

/** A simple in-memory {@link SecureStore} for tests. */
export function inMemorySecureStore(): SecureStore {
  const map = new Map<string, string>()
  return {
    async get(k) {
      return map.get(k) ?? null
    },
    async set(k, v) {
      map.set(k, v)
    },
    async delete(k) {
      map.delete(k)
    },
  }
}
