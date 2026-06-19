// Pure silence-threshold resolution. Relocated verbatim from v1 src/main/domain.
//
// The STT_Provider finalizes a Question after a silence interval that meets or
// exceeds a configured threshold (seconds). This module owns the pure
// clamp-and-default logic for that threshold (Req 13.6).

/** Minimum allowed silence threshold in seconds (Req 13.6). */
export const MIN_SILENCE_THRESHOLD_SECONDS = 0.3
/** Maximum allowed silence threshold in seconds (Req 13.6). */
export const MAX_SILENCE_THRESHOLD_SECONDS = 5.0
/** Default silence threshold in seconds applied when none is configured (Req 13.6). */
export const DEFAULT_SILENCE_THRESHOLD_SECONDS = 1.5

/**
 * Resolve the effective silence threshold (in seconds) from an optional
 * configured value (Req 13.6).
 *
 * - The result is always within [0.3, 5.0].
 * - Absent (`undefined`) or `NaN` → the default of 1.5.
 * - In-range values are returned unchanged.
 * - Out-of-range values are clamped to the nearest bound.
 *
 * @param configured The configured silence threshold in seconds, if any.
 * @returns The resolved silence threshold within [0.3, 5.0].
 */
export function resolveSilenceThreshold(configured?: number): number {
  if (configured === undefined || Number.isNaN(configured)) {
    return DEFAULT_SILENCE_THRESHOLD_SECONDS
  }
  if (configured < MIN_SILENCE_THRESHOLD_SECONDS) {
    return MIN_SILENCE_THRESHOLD_SECONDS
  }
  if (configured > MAX_SILENCE_THRESHOLD_SECONDS) {
    return MAX_SILENCE_THRESHOLD_SECONDS
  }
  return configured
}
