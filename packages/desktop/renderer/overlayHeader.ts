// Pure header-content helper for the Overlay_UI header badge.
// Relocated verbatim from v1 (Req 11.4 equivalent / Property 15).

import type { Profile, SeniorityLevel } from '@interview-assistant/shared'

export interface HeaderBadgeContent {
  roles: string[]
  seniority: SeniorityLevel
}

/** Every role (order preserved) + seniority. Pure; returns a fresh array. */
export function overlayHeaderContent(profile: Profile): HeaderBadgeContent {
  return { roles: [...profile.roleCategories], seniority: profile.seniority }
}

/** Single-line rendering containing every role and the seniority. */
export function overlayHeaderText(profile: Profile): string {
  const { roles, seniority } = overlayHeaderContent(profile)
  return `${roles.join(', ')} · ${seniority}`
}
