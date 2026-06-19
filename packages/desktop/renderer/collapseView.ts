// Pure minimize-to-pill view decision (Req 8). Extracted from App.tsx so the
// collapse/expand behavior is unit-testable in the node test harness (no DOM /
// no @testing-library) while App.tsx keeps using it as the single source of
// truth for what gets rendered.
//
// The two invariants this encodes:
//  - When collapsed, the app renders ONLY the floating pill, regardless of the
//    active phase/screen (sign-in, onboarding, ready, interview) (Req 8.1, 8.2).
//  - Collapsing and expanding never mutate the phase, so the previously active
//    screen reappears on expand and auth/interview state is preserved (Req 8.3,
//    8.6).

export type Phase = 'loading' | 'auth' | 'ready' | 'interview'

/** The four top-level screens (plus the transient loading phase) (Req 8.1). */
export const PHASES: readonly Phase[] = ['loading', 'auth', 'ready', 'interview']

/** What the app shell renders: the pill when collapsed, otherwise the phase. */
export type ViewKind = 'pill' | Phase

/**
 * Decide what the app renders. Collapsed → the floating pill on every screen;
 * otherwise the current phase's screen (Req 8.1, 8.2).
 */
export function collapseView(collapsed: boolean, phase: Phase): ViewKind {
  return collapsed ? 'pill' : phase
}

export interface CollapseState {
  collapsed: boolean
  phase: Phase
}

/** Collapse to the pill. Phase is intentionally untouched (Req 8.3, 8.6). */
export function collapse(state: CollapseState): CollapseState {
  return { collapsed: true, phase: state.phase }
}

/** Expand from the pill. Phase is untouched so the prior screen returns (Req 8.3, 8.6). */
export function expand(state: CollapseState): CollapseState {
  return { collapsed: false, phase: state.phase }
}
