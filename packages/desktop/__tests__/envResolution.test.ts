// Desktop environment resolution + auth-mode tests (dev-release Task 4.5).
//
// Covers design §C (environment precedence + baked dev-endpoint resolution) and
// §D (dev = enforced auth). Validates correctness property 1 (a packaged dev
// build resolves to `dev`, never `prod`) and the dev-requires-sign-in behavior
// (property 2-adjacent): `resolveAuthMode('dev') === 'enforced'`.

import { describe, it, expect, vi } from 'vitest'
import fc from 'fast-check'
import { ENVIRONMENTS, type Environment } from '@interview-assistant/shared'

// appController imports `electron` at module load; stub it so the pure
// `resolveEnvironment` helper can be imported under the node test environment.
vi.mock('electron', () => ({
  app: { isPackaged: false },
  BrowserWindow: { getAllWindows: () => [] },
  ipcMain: { handle: () => {}, on: () => {}, removeHandler: () => {}, removeAllListeners: () => {} },
  session: { defaultSession: {} },
  desktopCapturer: {},
  clipboard: {},
  shell: {},
}))

import { resolveEnvironment } from '../main/appController'
import { defaultEnvConfig, backendConfigError } from '../main/envConfig'
import { resolveAuthMode } from '../main/envAuth'

describe('resolveEnvironment precedence (design §C, Req 4.1–4.4)', () => {
  it('uses an explicit valid APP_ENV over everything else', () => {
    expect(resolveEnvironment('dev', 'prod', true)).toBe('dev')
    expect(resolveEnvironment('local', 'prod', true)).toBe('local')
    expect(resolveEnvironment('pre-prod', undefined, false)).toBe('pre-prod')
  })

  it('falls back to the baked MAIN_VITE_APP_ENV when explicit is absent', () => {
    expect(resolveEnvironment(undefined, 'dev', true)).toBe('dev')
    expect(resolveEnvironment(undefined, 'pre-prod', false)).toBe('pre-prod')
  })

  it('skips an invalid explicit value and uses the baked value', () => {
    expect(resolveEnvironment('staging', 'dev', true)).toBe('dev')
    expect(resolveEnvironment('', 'prod', true)).toBe('prod')
  })

  it('falls back to isPackaged ? prod : local when neither env is set', () => {
    expect(resolveEnvironment(undefined, undefined, true)).toBe('prod')
    expect(resolveEnvironment(undefined, undefined, false)).toBe('local')
  })

  it('ignores an invalid baked value and uses the packaged default', () => {
    expect(resolveEnvironment(undefined, 'bogus', true)).toBe('prod')
    expect(resolveEnvironment(undefined, 'bogus', false)).toBe('local')
  })

  // Correctness property 1: a packaged dev build resolves to `dev`, never `prod`.
  it('resolves a packaged build with baked dev to dev, NOT prod (property 1)', () => {
    expect(resolveEnvironment(undefined, 'dev', true)).toBe('dev')
    expect(resolveEnvironment(undefined, 'dev', true)).not.toBe('prod')
  })

  it('resolves an unpackaged build with nothing set to local', () => {
    expect(resolveEnvironment(undefined, undefined, false)).toBe('local')
  })

  // Property-style check: a packaged build that bakes any valid env never
  // silently resolves to prod against the baked intent. **Validates: Requirements 4.2, 4.4**
  it('a packaged build with a baked valid env always resolves to that env (property 1)', () => {
    fc.assert(
      fc.property(fc.constantFrom(...ENVIRONMENTS), (baked) => {
        const resolved = resolveEnvironment(undefined, baked, true)
        expect(resolved).toBe(baked)
        if (baked !== 'prod') expect(resolved).not.toBe('prod')
      })
    )
  })
})

describe('defaultEnvConfig dev-endpoint resolution (design §C, Req 2.5, 4.1–4.3)', () => {
  const devEnv: NodeJS.ProcessEnv = {
    DEV_BACKEND_URL: 'https://app.up.railway.app',
    DEV_GATEWAY_URL: 'wss://app.up.railway.app',
    DEV_SUPABASE_URL: 'https://ref.supabase.co',
    DEV_SUPABASE_ANON_KEY: 'anon-publishable-key',
  }

  it('resolves the dev entry from injected DEV_* env values', () => {
    const cfg = defaultEnvConfig(devEnv)
    expect(cfg.dev).toEqual({
      backendBaseUrl: 'https://app.up.railway.app',
      sessionGatewayUrl: 'wss://app.up.railway.app',
      supabaseUrl: 'https://ref.supabase.co',
      supabasePublishableKey: 'anon-publishable-key',
    })
  })

  it('keeps localhost defaults on the local entry', () => {
    const cfg = defaultEnvConfig(devEnv)
    expect(cfg.local.backendBaseUrl).toBe('http://127.0.0.1:8787')
    expect(cfg.local.sessionGatewayUrl).toBe('ws://127.0.0.1:8787')
  })

  it('carries no provider-secret fields on any entry (Req 2.5)', () => {
    const cfg = defaultEnvConfig(devEnv)
    const allowedKeys = [
      'backendBaseUrl',
      'sessionGatewayUrl',
      'supabaseUrl',
      'supabasePublishableKey',
    ].sort()
    for (const env of ENVIRONMENTS) {
      expect(Object.keys(cfg[env]).sort()).toEqual(allowedKeys)
    }
    // No field name or value hints at a provider API key / service-role secret.
    const serialized = JSON.stringify(cfg).toLowerCase()
    expect(serialized).not.toContain('service_role')
    expect(serialized).not.toContain('api_key')
    expect(serialized).not.toContain('apikey')
  })

  it('produces empty dev endpoints when neither runtime nor baked values exist', () => {
    const cfg = defaultEnvConfig({})
    expect(cfg.dev.backendBaseUrl).toBe('')
    expect(cfg.dev.sessionGatewayUrl).toBe('')
  })
})

describe('resolveAuthMode dev=enforced (design §D, Req 6.1)', () => {
  it('bypasses auth only for local', () => {
    expect(resolveAuthMode('local')).toBe('bypassed')
  })

  it('enforces auth for dev (sign-in required)', () => {
    expect(resolveAuthMode('dev')).toBe('enforced')
  })

  it('enforces auth for pre-prod and prod', () => {
    expect(resolveAuthMode('pre-prod')).toBe('enforced')
    expect(resolveAuthMode('prod')).toBe('enforced')
  })

  it('enforces auth for unknown/undefined/null as a fail-safe', () => {
    expect(resolveAuthMode(undefined)).toBe('enforced')
    expect(resolveAuthMode(null)).toBe('enforced')
    expect(resolveAuthMode('staging' as Environment)).toBe('enforced')
  })

  // Only `local` may ever be bypassed; every other environment is enforced.
  it('treats every non-local environment as enforced', () => {
    for (const env of ENVIRONMENTS) {
      expect(resolveAuthMode(env)).toBe(env === 'local' ? 'bypassed' : 'enforced')
    }
  })
})

describe('backendConfigError missing-config detection (design §J, Req 9.3)', () => {
  it('reports an error when dev endpoints are empty (missing baked config)', () => {
    const cfg = defaultEnvConfig({})
    const err = backendConfigError('dev', cfg.dev)
    expect(err).not.toBeNull()
    expect(err).toContain('configured backend')
    expect(err).toContain('dev')
  })

  it('reports an error when only the backend URL is empty', () => {
    const err = backendConfigError('dev', {
      backendBaseUrl: '',
      sessionGatewayUrl: 'wss://app.up.railway.app',
      supabaseUrl: '',
      supabasePublishableKey: '',
    })
    expect(err).not.toBeNull()
  })

  it('reports an error when only the gateway URL is empty', () => {
    const err = backendConfigError('dev', {
      backendBaseUrl: 'https://app.up.railway.app',
      sessionGatewayUrl: '',
      supabaseUrl: '',
      supabasePublishableKey: '',
    })
    expect(err).not.toBeNull()
  })

  it('returns null when both dev endpoints are present', () => {
    const cfg = defaultEnvConfig({
      DEV_BACKEND_URL: 'https://app.up.railway.app',
      DEV_GATEWAY_URL: 'wss://app.up.railway.app',
    })
    expect(backendConfigError('dev', cfg.dev)).toBeNull()
  })

  // `local` carries localhost defaults, so it never trips the missing-config
  // check even with an empty process env — the unreachable state is specific to
  // envs whose endpoints must be baked (dev/pre-prod/prod) (Req 9.3).
  it('returns null for local even with an empty environment (localhost defaults)', () => {
    const cfg = defaultEnvConfig({})
    expect(backendConfigError('local', cfg.local)).toBeNull()
  })
})
