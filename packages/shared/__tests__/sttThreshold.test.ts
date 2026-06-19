import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import {
  resolveSilenceThreshold,
  MIN_SILENCE_THRESHOLD_SECONDS,
  MAX_SILENCE_THRESHOLD_SECONDS,
  DEFAULT_SILENCE_THRESHOLD_SECONDS,
} from '../domain/sttThreshold'

// Feature: interview-assistant-saas, Property 11: Silence-threshold clamping (reused)
describe('Property 11: silence-threshold clamping and default', () => {
  it('always returns a value within [0.3, 5.0]', () => {
    fc.assert(
      fc.property(fc.double({ min: -1000, max: 1000, noNaN: true }), (v) => {
        const r = resolveSilenceThreshold(v)
        expect(r).toBeGreaterThanOrEqual(MIN_SILENCE_THRESHOLD_SECONDS)
        expect(r).toBeLessThanOrEqual(MAX_SILENCE_THRESHOLD_SECONDS)
      }),
      { numRuns: 200 }
    )
  })

  it('returns the default for absent and NaN', () => {
    expect(resolveSilenceThreshold(undefined)).toBe(DEFAULT_SILENCE_THRESHOLD_SECONDS)
    expect(resolveSilenceThreshold(Number.NaN)).toBe(DEFAULT_SILENCE_THRESHOLD_SECONDS)
  })

  it('returns in-range values unchanged and clamps out-of-range to the nearest bound', () => {
    fc.assert(
      fc.property(fc.double({ min: -1000, max: 1000, noNaN: true }), (v) => {
        const r = resolveSilenceThreshold(v)
        if (v >= MIN_SILENCE_THRESHOLD_SECONDS && v <= MAX_SILENCE_THRESHOLD_SECONDS) {
          expect(r).toBe(v)
        } else if (v < MIN_SILENCE_THRESHOLD_SECONDS) {
          expect(r).toBe(MIN_SILENCE_THRESHOLD_SECONDS)
        } else {
          expect(r).toBe(MAX_SILENCE_THRESHOLD_SECONDS)
        }
      }),
      { numRuns: 200 }
    )
  })
})
