// Client-side auth-mode resolution, mirroring the backend's authoritative
// resolver (Req 19.8-19.10). The client uses this only to decide whether to
// show the sign-in screen; the backend remains the source of truth and applies
// the same fail-safe (enforced on unknown).

import type { AuthMode, Environment } from '@interview-assistant/shared'

export function resolveAuthMode(env: Environment | undefined | null): AuthMode {
  // Only `local` bypasses auth. `dev` now enforces sign-in (Req 6.1) alongside
  // pre-prod/prod; unknown stays enforced as a fail-safe.
  if (env === 'local') return 'bypassed'
  if (env === 'dev' || env === 'pre-prod' || env === 'prod') return 'enforced'
  return 'enforced'
}
