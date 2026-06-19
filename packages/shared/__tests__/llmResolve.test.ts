import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { recognizeProvider, resolveModel, SUPPORTED_LLM_PROVIDERS } from '../domain/llmResolve'

describe('reused: llm provider resolution', () => {
  it('recognizes the supported providers case-insensitively', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...SUPPORTED_LLM_PROVIDERS),
        fc.boolean(),
        (provider, upper) => {
          const input = upper ? provider.toUpperCase() : `  ${provider}  `
          const r = recognizeProvider(input)
          expect(r.kind).toBe('ok')
          if (r.kind === 'ok') expect(r.provider).toBe(provider)
        }
      ),
      { numRuns: 100 }
    )
  })

  it('rejects unrecognized providers, naming the offending input', () => {
    fc.assert(
      fc.property(
        fc.string().filter((s) => !SUPPORTED_LLM_PROVIDERS.includes(s.trim().toLowerCase() as never)),
        (input) => {
          const r = recognizeProvider(input)
          expect(r.kind).toBe('error')
          if (r.kind === 'error') {
            expect(r.offendingInput).toBe(input)
            expect(r.supported).toEqual([...SUPPORTED_LLM_PROVIDERS])
          }
        }
      ),
      { numRuns: 200 }
    )
  })

  it('resolves the default model when none configured, else the configured one', () => {
    expect(resolveModel('claude')).toBe('claude-sonnet-4')
    expect(resolveModel('openai')).toBe('gpt-4.1')
    expect(resolveModel('gemini')).toBe('gemini-1.5-pro')
    expect(resolveModel('openai', 'gpt-4o-mini')).toBe('gpt-4o-mini')
    expect(resolveModel('claude', '   ')).toBe('claude-sonnet-4')
  })
})
