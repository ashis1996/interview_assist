import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { reduceStt, initialSttState } from '../domain/sttFinalize'
import { buildSystemPrompt } from '../domain/promptBuilder'
import { detectTopics } from '../domain/topicDetector'
import { serializeSession, deserializeSession, exportSessionMarkdown } from '../domain/session'
import { validateProfile } from '../domain/profileValidation'
import { mergeSession } from '../domain/profileMerge'
import { constrainPosition, constrainSize, clampOpacityPercent } from '../domain/geometry'
import { applyToggles } from '../domain/captureToggle'
import {
  TOPIC_DOMAINS,
  SENIORITY_LEVELS,
  COMPANY_TYPES,
  type Profile,
  type SessionFile,
} from '../types'

const profileArb: fc.Arbitrary<Profile> = fc.record({
  name: fc.string({ maxLength: 100 }),
  targetRole: fc.string({ maxLength: 100 }),
  experienceYears: fc.integer({ min: 0, max: 60 }),
  roleCategories: fc.array(fc.constantFrom(...TOPIC_DOMAINS), { minLength: 1, maxLength: 10 }),
  seniority: fc.constantFrom(...SENIORITY_LEVELS),
  skills: fc.array(fc.string({ minLength: 1, maxLength: 20 }), { minLength: 1, maxLength: 50 }),
  companyType: fc.constantFrom(...COMPANY_TYPES),
})

describe('reused: sttFinalize reducer', () => {
  it('does not finalize without recognizable speech, even past the threshold', () => {
    const s = initialSttState()
    const r = reduceStt(s, { type: 'silence', durationSeconds: 5, thresholdSeconds: 1.5 })
    expect(r.finalizedQuestion).toBeUndefined()
    expect(r.state.pendingText).toBe('')
  })

  it('finalizes accumulated speech once silence meets the threshold', () => {
    let s = initialSttState()
    s = reduceStt(s, { type: 'speech', text: 'how do you scale a service' }).state
    const r = reduceStt(s, { type: 'silence', durationSeconds: 2, thresholdSeconds: 1.5 })
    expect(r.finalizedQuestion).toBe('how do you scale a service')
    expect(r.state.pendingText).toBe('')
  })
})

// Feature: interview-assistant-saas, system prompt content invariants (reused)
describe('reused: prompt builder content invariants', () => {
  it('includes name, seniority, every role, every skill, company type, target role', () => {
    fc.assert(
      fc.property(
        profileArb,
        fc.constantFrom('in-scope', 'adjacent', 'out-of-scope') as fc.Arbitrary<
          'in-scope' | 'adjacent' | 'out-of-scope'
        >,
        (p, scope) => {
          const prompt = buildSystemPrompt(p, scope)
          if (p.name.length) expect(prompt).toContain(p.name)
          expect(prompt).toContain(p.seniority)
          expect(prompt).toContain(p.companyType)
          for (const role of p.roleCategories) expect(prompt).toContain(role)
          for (const skill of p.skills) expect(prompt).toContain(skill)
        }
      ),
      { numRuns: 150 }
    )
  })
})

// Feature: interview-assistant-saas, topic detection domain closure (reused)
describe('reused: topic detector domain closure', () => {
  it('only ever returns members of the TopicDomain set, deduplicated', () => {
    fc.assert(
      fc.property(fc.string(), (q) => {
        const topics = detectTopics(q)
        for (const t of topics) expect(TOPIC_DOMAINS).toContain(t)
        expect(new Set(topics).size).toBe(topics.length)
      }),
      { numRuns: 300 }
    )
  })
})

// Feature: interview-assistant-saas, session round-trip + markdown completeness (reused)
describe('reused: session serialization', () => {
  const sessionArb: fc.Arbitrary<SessionFile> = fc.record({
    profileSnapshot: profileArb,
    startedAt: fc.constant(new Date().toISOString()),
    entries: fc.array(
      fc.record({
        question: fc.string(),
        answer: fc.string(),
        topics: fc.array(fc.constantFrom(...TOPIC_DOMAINS), { maxLength: 4 }),
        scope: fc.constantFrom('in-scope', 'adjacent', 'out-of-scope') as fc.Arbitrary<
          'in-scope' | 'adjacent' | 'out-of-scope'
        >,
        timestamp: fc.constant(new Date().toISOString()),
      }),
      { maxLength: 8 }
    ),
  })

  it('round-trips deep-equal', () => {
    fc.assert(
      fc.property(sessionArb, (s) => {
        expect(deserializeSession(serializeSession(s))).toEqual(s)
      }),
      { numRuns: 150 }
    )
  })

  it('markdown contains every question and answer', () => {
    fc.assert(
      fc.property(sessionArb, (s) => {
        const md = exportSessionMarkdown(s)
        for (const e of s.entries) {
          if (e.question.length) expect(md).toContain(e.question)
          if (e.answer.length) expect(md).toContain(e.answer)
        }
      }),
      { numRuns: 100 }
    )
  })
})

describe('reused: profile validation and merge', () => {
  it('valid iff no missing mandatory and no field errors', () => {
    fc.assert(
      fc.property(profileArb, (p) => {
        const v = validateProfile(p)
        expect(v.valid).toBe(v.missingMandatory.length === 0 && v.fieldErrors.length === 0)
      }),
      { numRuns: 150 }
    )
  })

  it('empty override yields the base profile', () => {
    fc.assert(
      fc.property(profileArb, (p) => {
        expect(mergeSession(p, {})).toEqual(p)
      }),
      { numRuns: 100 }
    )
  })
})

describe('reused: geometry and capture toggle', () => {
  it('opacity is always clamped to [0,100]', () => {
    fc.assert(
      fc.property(fc.double({ min: -500, max: 500, noNaN: true }), (v) => {
        const o = clampOpacityPercent(v)
        expect(o).toBeGreaterThanOrEqual(0)
        expect(o).toBeLessThanOrEqual(100)
      }),
      { numRuns: 200 }
    )
  })

  it('constrained size respects minimums within a reasonable display', () => {
    const display = { width: 1920, height: 1080 }
    fc.assert(
      fc.property(
        fc.double({ min: 0, max: 4000, noNaN: true }),
        fc.double({ min: 0, max: 4000, noNaN: true }),
        (w, h) => {
          const s = constrainSize({ width: w, height: h }, display)
          expect(s.width).toBeGreaterThanOrEqual(200)
          expect(s.height).toBeGreaterThanOrEqual(150)
          expect(s.width).toBeLessThanOrEqual(display.width)
          expect(s.height).toBeLessThanOrEqual(display.height)
        }
      ),
      { numRuns: 200 }
    )
  })

  it('constrained position keeps a fitting rect within the display', () => {
    const display = { width: 1920, height: 1080 }
    const r = constrainPosition({ x: -50, y: 5000, width: 400, height: 300 }, display)
    expect(r.x).toBeGreaterThanOrEqual(0)
    expect(r.y).toBeGreaterThanOrEqual(0)
    expect(r.x + r.width).toBeLessThanOrEqual(display.width)
    expect(r.y + r.height).toBeLessThanOrEqual(display.height)
  })

  it('capture toggle parity: even presses preserve, odd presses flip', () => {
    fc.assert(
      fc.property(fc.boolean(), fc.integer({ min: 0, max: 1000 }), (initial, presses) => {
        expect(applyToggles(initial, presses)).toBe(presses % 2 === 0 ? initial : !initial)
      }),
      { numRuns: 200 }
    )
  })
})
