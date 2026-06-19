// Pure audio-capture toggle reducer. Relocated verbatim from v1 src/main/domain.
//
// Capture state is a boolean; each hotkey press flips it (Req 4.3). Pure,
// side-effect free, never mutates its input.

/**
 * Apply a single audio-capture hotkey press to the current capture state
 * (Req 4.3): returns the negation of the supplied state.
 *
 * @param state The current capture state (`true` = active, `false` = inactive).
 * @returns The negated capture state.
 */
export function toggleCapture(state: boolean): boolean {
  return !state
}

/**
 * Apply N audio-capture hotkey presses to an initial state. The result depends
 * only on the parity of the press count. Non-finite counts return `initial`.
 *
 * @param initial The starting capture state.
 * @param presses The number of hotkey presses to apply.
 * @returns `initial` when the normalized press count is even, otherwise `!initial`.
 */
export function applyToggles(initial: boolean, presses: number): boolean {
  if (!Number.isFinite(presses)) {
    return initial
  }
  const count = Math.abs(Math.trunc(presses))
  return count % 2 === 0 ? initial : !initial
}
