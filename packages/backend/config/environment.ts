// Per-environment enforcement resolution for the Backend.
//
// Both credit enforcement and auth enforcement follow the SAME per-environment
// boundary and the SAME fail-safe: only `local` is bypassed (it exists for
// local integration and performance testing), `dev`/`pre-prod`/`prod` are
// enforced, and any missing/unknown/unreadable environment fails safe to
// enforced so bypass rules can never leak into a deployed environment. The dev
// release enforces auth and credits in `dev`; Superuser_Accounts are handled
// per-account (effective enforcement), not by the env mode
// (dev-release Req 6.1, 6.5, 6.6, 7.5).

import type { Environment, EnforcementMode, AuthMode } from '@interview-assistant/shared'

/**
 * Resolve the Credit_Enforcement_Mode for an environment.
 * `bypassed` only for `local`; `enforced` for `dev`/`pre-prod`/`prod` and every
 * missing/unknown input (fail-safe). Superuser_Accounts bypass enforcement
 * per-account, not via this env mode (dev-release Req 7.5).
 *
 * @param env The environment of the Backend instance handling the request.
 * @returns `'enforced'` or `'bypassed'`.
 */
export function resolveEnforcementMode(env: Environment | undefined | null): EnforcementMode {
  if (env === 'local') return 'bypassed'
  if (env === 'dev' || env === 'pre-prod' || env === 'prod') return 'enforced'
  return 'enforced' // fail-safe: missing/unknown -> enforced
}

/**
 * Resolve the Auth_Enforcement_Mode for an environment. Same boundary and
 * fail-safe as credits: `bypassed` only for `local` (no sign-in, no token
 * verification — the Session is attributed to the Dev_Account), `enforced` for
 * `dev`/`pre-prod`/`prod` and every missing/unknown input. The dev release
 * requires sign-in in `dev` (dev-release Req 6.1, 6.5, 6.6).
 *
 * @param env The environment of the Backend instance handling the request.
 * @returns `'enforced'` or `'bypassed'`.
 */
export function resolveAuthMode(env: Environment | undefined | null): AuthMode {
  if (env === 'local') return 'bypassed'
  if (env === 'dev' || env === 'pre-prod' || env === 'prod') return 'enforced'
  return 'enforced' // fail-safe: missing/unknown -> enforced
}
