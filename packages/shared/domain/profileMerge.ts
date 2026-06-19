// Pure profile merge logic. Relocated verbatim from v1 src/main/domain.
//
// The Session_Profile is the Default_Profile combined with any one-time
// Session_Override. This module contains only the pure, side-effect-free merge.

import type { Profile } from '../types'

/**
 * Merge a one-time session override onto a base profile to produce the active
 * Session_Profile (Req 17.2). For every field the override value wins when
 * present (not `undefined`); otherwise the base value is retained. Never mutates
 * its arguments.
 *
 * @param base The Default_Profile providing fallback values for every field.
 * @param override A partial set of one-time session changes; present fields win.
 * @returns A new Profile combining the override (where present) over the base.
 */
export function mergeSession(base: Profile, override: Partial<Profile>): Profile {
  const merged: Profile = { ...base }

  for (const key of Object.keys(override) as Array<keyof Profile>) {
    if (!Object.prototype.hasOwnProperty.call(override, key)) {
      continue
    }
    const value = override[key]
    if (value !== undefined) {
      ;(merged as Record<keyof Profile, unknown>)[key] = value
    }
  }

  return merged
}
