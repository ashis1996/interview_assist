// Per-environment client configuration and selection rules (Req 3, 18.6).
//
// Replaces the v1 `config.yaml` / bring-your-own-key model. The client holds
// ONLY backend URLs and the Supabase publishable (anon) key per environment —
// never a provider API key (Req 18.3, 18.5, 18.6). The selection helpers
// (indicator visibility, next-launch default) are pure and unit-tested.

import type { Environment } from '@interview-assistant/shared'

/** Connection settings for a single environment. */
export interface EnvEntry {
  /** HTTP base for the Credits_Service / session-history API. */
  backendBaseUrl: string
  /** WSS base for the Session_Gateway. */
  sessionGatewayUrl: string
  /** Supabase project URL. */
  supabaseUrl: string
  /** Supabase publishable (anon) key — NOT a provider secret (Req 18.6). */
  supabasePublishableKey: string
}

export type EnvConfig = Record<Environment, EnvEntry>

/**
 * Build-time inlined env values (electron-vite / Vite `define`). In a packaged
 * `dev` installer these carry the baked `dev` endpoints + Supabase publishable
 * key as `import.meta.env.MAIN_VITE_DEV_*` (design §C, Req 2.5, 4.1–4.5).
 *
 * Access is guarded so this is safe everywhere it runs:
 * - Packaged build: `import.meta.env.MAIN_VITE_*` are inlined literals.
 * - Local `tsx`/Node run: `import.meta` exists but has no `env` → `{}`.
 * - Vitest: `import.meta.env` exists but the `MAIN_VITE_*` keys are undefined.
 * In every non-packaged case the `process.env` path below takes precedence, so
 * unit tests can drive the resolver purely through the injected `env` argument.
 */
function bakedEnv(): Record<string, string | undefined> {
  const meta = import.meta as unknown as { env?: Record<string, string | undefined> }
  return meta.env ?? {}
}

/**
 * Built-in environment configuration. Values are read from build-time
 * environment variables where available, with localhost defaults for `local`.
 * No provider API keys ever appear here.
 *
 * For `dev`, the precedence is: a runtime `process.env.DEV_*` override (retained
 * for local dev runs / tests) first, then the build-time baked
 * `import.meta.env.MAIN_VITE_DEV_*` values, then empty.
 */
export function defaultEnvConfig(env: NodeJS.ProcessEnv = process.env): EnvConfig {
  const baked = bakedEnv()
  const entry = (prefix: string, fallback: Partial<EnvEntry> = {}): EnvEntry => ({
    backendBaseUrl: env[`${prefix}_BACKEND_URL`] ?? fallback.backendBaseUrl ?? '',
    sessionGatewayUrl: env[`${prefix}_GATEWAY_URL`] ?? fallback.sessionGatewayUrl ?? '',
    supabaseUrl: env[`${prefix}_SUPABASE_URL`] ?? fallback.supabaseUrl ?? '',
    supabasePublishableKey:
      env[`${prefix}_SUPABASE_ANON_KEY`] ?? fallback.supabasePublishableKey ?? '',
  })
  return {
    local: entry('LOCAL', {
      backendBaseUrl: 'http://127.0.0.1:8787',
      sessionGatewayUrl: 'ws://127.0.0.1:8787',
    }),
    dev: entry('DEV', {
      backendBaseUrl: baked['MAIN_VITE_DEV_BACKEND_URL'],
      sessionGatewayUrl: baked['MAIN_VITE_DEV_GATEWAY_URL'],
      supabaseUrl: baked['MAIN_VITE_DEV_SUPABASE_URL'],
      supabasePublishableKey: baked['MAIN_VITE_DEV_SUPABASE_ANON_KEY'],
    }),
    'pre-prod': entry('PREPROD'),
    prod: entry('PROD'),
  }
}

/**
 * The environment indicator to display. Returns the environment name when one
 * is selected, or `null` when none is selected so the UI hides the indicator
 * (Req 3.4, 3.5).
 */
export function environmentIndicator(selected: Environment | null): string | null {
  return selected ?? null
}

/**
 * The environment the client should default to on the next launch. When the
 * current selection is `prod`, the next launch defaults to `prod` (Req 3.7);
 * otherwise the last selection is retained.
 */
export function nextLaunchDefault(selected: Environment | null): Environment | null {
  if (selected === 'prod') return 'prod'
  return selected
}

/**
 * Validate that a resolved environment's required backend endpoints are usable
 * at launch (design §J, Req 9.3). The `backendBaseUrl` (HTTPS) and
 * `sessionGatewayUrl` (WSS) are both required to reach the backend; if either
 * is empty/missing the config is unusable and we must surface an explicit
 * "can't reach the configured backend" state rather than silently falling
 * through to another environment.
 *
 * Returns a human-readable error message when the config is invalid, or `null`
 * when it is usable. Pure (no electron) so it is unit-testable directly.
 *
 * Note: `local` always carries localhost defaults, so it never trips this; this
 * matters specifically for `dev` (and any non-local env) whose endpoints are
 * expected to be baked at build time.
 */
export function backendConfigError(env: Environment, entry: EnvEntry): string | null {
  if (!entry.backendBaseUrl || !entry.sessionGatewayUrl) {
    return `Can't reach the configured backend. This build is missing its ${env} backend configuration.`
  }
  return null
}
