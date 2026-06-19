import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { audioCaptureInternals } from '../renderer/audioCapture'

const { downmixToMono, resampleTo16k, floatToInt16, TARGET_SAMPLE_RATE } = audioCaptureInternals

describe('audio capture DSP (Req 4)', () => {
  it('downmix averages channels and preserves length', () => {
    const a = Float32Array.of(1, 0, -1, 0.5)
    const b = Float32Array.of(0, 0, 1, -0.5)
    const mono = downmixToMono([a, b])
    expect(Array.from(mono)).toEqual([0.5, 0, 0, 0])
  })

  it('downmix of a single channel returns it unchanged', () => {
    const a = Float32Array.of(0.2, -0.4)
    expect(downmixToMono([a])).toBe(a)
  })

  it('resampling targets 16 kHz and is a no-op when already 16 kHz', () => {
    const input = new Float32Array(1000).fill(0.1)
    expect(resampleTo16k(input, TARGET_SAMPLE_RATE)).toBe(input)
    const out = resampleTo16k(new Float32Array(44100).fill(0.1), 44100)
    expect(out.length).toBe(TARGET_SAMPLE_RATE)
  })

  it('floatToInt16 clamps to the int16 range for any input', () => {
    fc.assert(
      fc.property(fc.array(fc.double({ min: -5, max: 5, noNaN: true }), { maxLength: 64 }), (arr) => {
        const out = floatToInt16(Float32Array.from(arr))
        for (const v of out) {
          expect(v).toBeGreaterThanOrEqual(-32768)
          expect(v).toBeLessThanOrEqual(32767)
        }
      }),
      { numRuns: 200 }
    )
  })
})
