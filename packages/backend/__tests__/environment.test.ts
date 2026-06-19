import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { resolveEnforcementMode, resolveAuthMode } from '../config/environment'
import { ENVIRONMENTS } from '@interview-assistant/shared'

// Feature: interview-assistant-saas, Property 6: Enforcement-mode resolution is total and fails safe to enforced
describe('Property 6: enforcement/auth mode resolution is total and fails safe', () => {
  it('returns exactly one of enforced/bypassed for any input', () => {
    fc.assert(
      fc.property(
        fc.oneof(
          fc.constantFrom(...ENVIRONMENTS),
          fc.string(),
          fc.constant(undefined),
          fc.constant(null)
        ),
        (env) => {
          for (const mode of [
            resolveEnforcementMode(env as never),
            resolveAuthMode(env as never),
          ]) {
            expect(mode === 'enforced' || mode === 'bypassed').toBe(true)
          }
        }
      ),
      { numRuns: 300 }
    )
  })

  it('bypasses only local (dev is now enforced for both auth and credits)', () => {
    expect(resolveEnforcementMode('local')).toBe('bypassed')
    expect(resolveAuthMode('local')).toBe('bypassed')
  })

  it('enforces dev for both auth and credits (dev-release Req 6.1, 6.5, 7.5)', () => {
    expect(resolveEnforcementMode('dev')).toBe('enforced')
    expect(resolveAuthMode('dev')).toBe('enforced')
  })

  it('enforces pre-prod, prod, and every missing/unknown input (fail-safe)', () => {
    expect(resolveEnforcementMode('pre-prod')).toBe('enforced')
    expect(resolveEnforcementMode('prod')).toBe('enforced')
    expect(resolveEnforcementMode(undefined)).toBe('enforced')
    expect(resolveEnforcementMode(null)).toBe('enforced')
    expect(resolveAuthMode('pre-prod')).toBe('enforced')
    expect(resolveAuthMode('prod')).toBe('enforced')
    expect(resolveAuthMode(undefined)).toBe('enforced')
    expect(resolveAuthMode(null)).toBe('enforced')
    fc.assert(
      fc.property(
        fc.string().filter((s) => !['local', 'dev', 'pre-prod', 'prod'].includes(s)),
        (s) => {
          expect(resolveEnforcementMode(s as never)).toBe('enforced')
          expect(resolveAuthMode(s as never)).toBe('enforced')
        }
      ),
      { numRuns: 200 }
    )
  })
})
