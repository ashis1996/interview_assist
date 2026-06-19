import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { overlayHeaderContent, overlayHeaderText } from '../renderer/overlayHeader'
import { SENIORITY_LEVELS, COMPANY_TYPES, type Profile } from '@interview-assistant/shared'

const profileArb: fc.Arbitrary<Profile> = fc.record({
  name: fc.string({ maxLength: 40 }),
  targetRole: fc.string({ maxLength: 40 }),
  experienceYears: fc.integer({ min: 0, max: 60 }),
  roleCategories: fc.array(fc.string({ minLength: 1, maxLength: 12 }), { minLength: 1, maxLength: 8 }),
  seniority: fc.constantFrom(...SENIORITY_LEVELS),
  skills: fc.array(fc.string({ minLength: 1 }), { minLength: 1, maxLength: 10 }),
  companyType: fc.constantFrom(...COMPANY_TYPES),
})

// Feature: interview-assistant-saas, header badge content (reused / Property 15)
describe('overlay header content (Req 11.4 equivalent)', () => {
  it('includes every role and the seniority, dropping none', () => {
    fc.assert(
      fc.property(profileArb, (p) => {
        const content = overlayHeaderContent(p)
        expect(content.roles).toEqual(p.roleCategories)
        expect(content.seniority).toBe(p.seniority)
        const text = overlayHeaderText(p)
        expect(text).toContain(p.seniority)
        for (const role of p.roleCategories) expect(text).toContain(role)
      }),
      { numRuns: 150 }
    )
  })

  it('returns a fresh roles array (no aliasing)', () => {
    const p = {
      name: 'x',
      targetRole: 'y',
      experienceYears: 1,
      roleCategories: ['a', 'b'],
      seniority: 'Senior' as const,
      skills: ['s'],
      companyType: 'Product' as const,
    }
    expect(overlayHeaderContent(p).roles).not.toBe(p.roleCategories)
  })
})
