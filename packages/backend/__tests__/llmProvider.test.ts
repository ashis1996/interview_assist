import { describe, it, expect, vi } from 'vitest'
import { createLlmProvider, type Backend, type Clock } from '../session/llmProvider'
import type { LlmProviderName } from '@interview-assistant/shared'

function fakeBackend(provider: LlmProviderName, impl: Backend['stream']): Backend {
  return { providerName: provider, stream: impl }
}

describe('LLM provider (Req 9.2, 15.6)', () => {
  it('streams tokens and reports usage via onUsage', async () => {
    const provider = createLlmProvider(
      { provider: 'openai', apiKey: 'k' },
      {
        backendFactory: () =>
          fakeBackend('openai', async (_req, onToken) => {
            onToken('Hello ')
            onToken('world')
            return { answer: 'Hello world', usage: { promptTokens: 12, completionTokens: 5 } }
          }),
      }
    )
    const tokens: string[] = []
    const usages: Array<{ promptTokens: number; completionTokens: number }> = []
    const result = await provider.generate({ systemPrompt: 's', question: 'q' }, (t) => tokens.push(t), (u) => usages.push(u))
    expect(result).toMatchObject({ kind: 'ok', answer: 'Hello world' })
    expect(tokens.join('')).toBe('Hello world')
    expect(usages).toEqual([{ promptTokens: 12, completionTokens: 5 }])
  })

  it('returns a configuration error for an empty provider (Req 15.6)', async () => {
    const provider = createLlmProvider({ provider: '' })
    const result = await provider.generate({ systemPrompt: 's', question: 'q' }, () => {})
    expect(result).toMatchObject({ kind: 'error', reason: 'configuration' })
  })

  it('times out via the injected clock and reports a timeout error (Req 15.6)', async () => {
    let fire: (() => void) | undefined
    const clock: Clock = {
      setTimeout: (handler) => {
        fire = handler
        return 1
      },
      clearTimeout: () => {},
    }
    const provider = createLlmProvider(
      { provider: 'claude', apiKey: 'k' },
      {
        clock,
        timeoutMs: 30_000,
        backendFactory: () =>
          fakeBackend('claude', (_req, _onToken, signal) =>
            new Promise((_resolve, reject) => {
              signal.addEventListener('abort', () => reject(new Error('aborted')))
            })),
      }
    )
    const p = provider.generate({ systemPrompt: 's', question: 'q' }, () => {})
    // Trigger the timeout.
    fire?.()
    const result = await p
    expect(result).toMatchObject({ kind: 'error', reason: 'timeout', provider: 'claude' })
  })

  it('reports a backend-error when the backend rejects', async () => {
    const provider = createLlmProvider(
      { provider: 'gemini', apiKey: 'k' },
      {
        backendFactory: () =>
          fakeBackend('gemini', async () => {
            throw new Error('boom')
          }),
      }
    )
    const result = await provider.generate({ systemPrompt: 's', question: 'q' }, () => {})
    expect(result).toMatchObject({ kind: 'error', reason: 'backend-error', provider: 'gemini' })
  })

  // Silence unused import warning in strict mode.
  void vi
})
