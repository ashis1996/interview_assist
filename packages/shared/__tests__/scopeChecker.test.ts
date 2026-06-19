import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { classifyScope } from '../domain/scopeChecker'
import { DEFAULT_ROLE_ADJACENCY, DEFAULT_TOPIC_ROLE_MAP } from '../mappings'
import { TOPIC_DOMAINS, SCOPE_CLASSIFICATIONS, type TopicDomain } from '../types'

const topicArb = fc.constantFrom<TopicDomain>(...TOPIC_DOMAINS)
const rolesArb = fc.array(fc.constantFrom(...TOPIC_DOMAINS), { maxLength: 6 })

// Feature: interview-assistant-saas, Property 10: Scope classification is total (reused)
describe('Property 10: scope classification totality and rules', () => {
  it('always returns exactly one of the three classifications', () => {
    fc.assert(
      fc.property(fc.array(topicArb, { maxLength: 8 }), rolesArb, (topics, roles) => {
        const r = classifyScope(topics, roles, DEFAULT_ROLE_ADJACENCY, DEFAULT_TOPIC_ROLE_MAP)
        expect(SCOPE_CLASSIFICATIONS).toContain(r)
      }),
      { numRuns: 300 }
    )
  })

  it('classifies an empty topic set as out-of-scope', () => {
    fc.assert(
      fc.property(rolesArb, (roles) => {
        expect(
          classifyScope([], roles, DEFAULT_ROLE_ADJACENCY, DEFAULT_TOPIC_ROLE_MAP)
        ).toBe('out-of-scope')
      }),
      { numRuns: 100 }
    )
  })

  it('classifies a topic mapping directly to a profile role as in-scope', () => {
    // software-development maps to the software-development role.
    expect(
      classifyScope(
        ['software-development'],
        ['software-development'],
        DEFAULT_ROLE_ADJACENCY,
        DEFAULT_TOPIC_ROLE_MAP
      )
    ).toBe('in-scope')
  })
})
