// Deterministic scope-to-color mapping. Relocated verbatim from v1 src/main/domain.
//
// Req 6.7: when a Scope_Classification is assigned, the Overlay_UI displays it
// using a distinct and consistent badge color for each of in-scope, adjacent,
// and out-of-scope.

import { type ScopeClassification } from '../types'

/**
 * Canonical badge colors for each {@link ScopeClassification}, as hex strings.
 * The three values are pairwise distinct and the mapping is total.
 */
export const SCOPE_COLORS: Readonly<Record<ScopeClassification, string>> = {
  'in-scope': '#2e7d32', // green 800
  adjacent: '#f9a825', // amber 800
  'out-of-scope': '#c62828', // red 800
} as const

/**
 * Returns the deterministic badge color for a given scope classification.
 *
 * @param scope - the scope classification to color
 * @returns the badge color as a hex string (e.g. `'#2e7d32'`)
 */
export function scopeColor(scope: ScopeClassification): string {
  return SCOPE_COLORS[scope]
}
