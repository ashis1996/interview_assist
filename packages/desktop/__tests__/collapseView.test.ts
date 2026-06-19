import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { collapseView, collapse, expand, PHASES, type Phase } from '../renderer/collapseView'

// Feature: dev-release, task 5.5 — minimize-to-pill on every screen (Req 8).
// These tests exercise the pure decision helper that App.tsx uses to decide
// what to render, proving the minimize-on-every-screen behavior without a DOM:
//  - collapse renders the pill on each phase (Req 8.1, 8.2)
//  - expand returns to the same phase (Req 8.3)
//  - collapse/expand never change the phase, so state is preserved (Req 8.6)

const phaseArb: fc.Arbitrary<Phase> = fc.constantFrom(...PHASES)

describe('collapseView — collapse renders the pill on every screen (Req 8.1, 8.2)', () => {
  it('renders ONLY the pill on each phase when collapsed', () => {
    // Explicit per-screen check across all four top-level screens + loading.
    expect(collapseView(true, 'auth')).toBe('pill') // sign-in screen
    expect(collapseView(true, 'ready')).toBe('pill') // onboarding / ready screen
    expect(collapseView(true, 'interview')).toBe('pill') // interview overlay
    expect(collapseView(true, 'loading')).toBe('pill')
  })

  it('renders the active phase screen when not collapsed', () => {
    for (const phase of PHASES) expect(collapseView(false, phase)).toBe(phase)
  })

  // Validates: Requirements 8.1, 8.2
  it('property: collapsed always yields the pill, expanded always yields the phase', () => {
    fc.assert(
      fc.property(phaseArb, (phase) => {
        expect(collapseView(true, phase)).toBe('pill')
        expect(collapseView(false, phase)).toBe(phase)
      })
    )
  })
})

describe('collapseView — expand returns to the same phase, state preserved (Req 8.3, 8.6)', () => {
  it('collapse preserves the phase', () => {
    for (const phase of PHASES) {
      expect(collapse({ collapsed: false, phase }).phase).toBe(phase)
    }
  })

  it('expand preserves the phase', () => {
    for (const phase of PHASES) {
      expect(expand({ collapsed: true, phase }).phase).toBe(phase)
    }
  })

  it('collapse then expand returns to the same screen', () => {
    for (const phase of PHASES) {
      const collapsedState = collapse({ collapsed: false, phase })
      expect(collapsedState.collapsed).toBe(true)
      const expandedState = expand(collapsedState)
      expect(expandedState.collapsed).toBe(false)
      // Same phase reappears → previously active screen restored (Req 8.3).
      expect(expandedState.phase).toBe(phase)
      expect(collapseView(expandedState.collapsed, expandedState.phase)).toBe(phase)
    }
  })

  // Validates: Requirements 8.3, 8.6
  it('property: a collapse/expand round-trip never changes the phase', () => {
    fc.assert(
      fc.property(phaseArb, fc.boolean(), (phase, startCollapsed) => {
        const start = { collapsed: startCollapsed, phase }
        const roundTripped = expand(collapse(start))
        // Phase (auth / interview / onboarding state) is untouched (Req 8.6).
        expect(roundTripped.phase).toBe(phase)
        // And we are back to showing that phase's screen (Req 8.3).
        expect(collapseView(roundTripped.collapsed, roundTripped.phase)).toBe(phase)
      })
    )
  })
})
