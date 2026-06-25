// LLM_Provider backends with streaming, timeout, and usage metering.
//
// Modified from v1 `src/main/llmProvider.ts`: the provider-agnostic streaming +
// 30-second-timeout structure and the Claude/OpenAI/Gemini backends are kept,
// but API keys are sourced from server-side secrets (Req 18.1, 18.4) and a
// token-usage metering hook (`onUsage`) is added so the Credits_Service can
// meter LLM tokens (Req 9.2).

import Anthropic from '@anthropic-ai/sdk'
import OpenAI from 'openai'
import { GoogleGenerativeAI } from '@google/generative-ai'

import { recognizeProvider, resolveModel, resolveVisionModel, type LlmProviderName } from '@interview-assistant/shared'

/** A prior question/answer turn in the same session, for conversational memory. */
export interface LlmTurn {
  question: string
  answer: string
}

/** A request to generate an answer: the system prompt plus the question text. */
export interface LlmRequest {
  systemPrompt: string
  question: string
  /** Recent prior turns in this session (oldest first) for follow-up/context. */
  history?: LlmTurn[]
  /** Optional screenshot image (base64, no data: prefix) for vision questions. */
  imageBase64?: string
  /** MIME type of {@link imageBase64} (e.g. 'image/png'). */
  imageMimeType?: string
}

/** Token usage reported by a backend for metering (Req 9.2). */
export interface LlmUsage {
  promptTokens: number
  completionTokens: number
}

/** The result of an answer-generation attempt. */
export type LlmResult =
  | { kind: 'ok'; answer: string; usage?: LlmUsage }
  | {
      kind: 'error'
      provider: string
      reason: 'timeout' | 'backend-error' | 'configuration'
      message: string
    }

/** The streaming answer generator. */
export interface LlmProvider {
  generate(
    req: LlmRequest,
    onToken: (t: string) => void,
    onUsage?: (u: LlmUsage) => void
  ): Promise<LlmResult>
  /**
   * Optionally open/warm the upstream connection so the first real answer does
   * not pay cold TLS/DNS/model-routing cost. Safe to call fire-and-forget.
   */
  prewarm?(): Promise<void>
}

export const DEFAULT_TIMEOUT_MS = 30_000

export interface Clock {
  setTimeout(handler: () => void, ms: number): unknown
  clearTimeout(handle: unknown): void
}

const REAL_CLOCK: Clock = {
  setTimeout: (handler, ms) => setTimeout(handler, ms),
  clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
}

/** An individual backend: maps a request to a token stream + final usage. */
export interface Backend {
  readonly providerName: LlmProviderName
  stream(
    req: LlmRequest,
    onToken: (t: string) => void,
    signal: AbortSignal
  ): Promise<{ answer: string; usage?: LlmUsage }>
  /** Optional: warm the network connection / model route ahead of first use. */
  prewarm?(): Promise<void>
}

export interface LlmProviderDeps {
  timeoutMs?: number
  clock?: Clock
  backendFactory?: (provider: LlmProviderName, model: string, apiKey: string) => Backend
}

const MAX_TOKENS = 4096

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

class ClaudeBackend implements Backend {
  readonly providerName = 'claude' as const
  constructor(private readonly client: Anthropic, private readonly model: string) {}
  async stream(req: LlmRequest, onToken: (t: string) => void, signal: AbortSignal) {
    const history = (req.history ?? []).flatMap((t) => [
      { role: 'user' as const, content: t.question },
      { role: 'assistant' as const, content: t.answer },
    ])
    const userContent: Anthropic.MessageParam['content'] = req.imageBase64
      ? [
          { type: 'text', text: req.question },
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: (req.imageMimeType ?? 'image/png') as 'image/png',
              data: req.imageBase64,
            },
          },
        ]
      : req.question
    const stream = await this.client.messages.create(
      {
        model: this.model,
        max_tokens: MAX_TOKENS,
        system: req.systemPrompt,
        messages: [...history, { role: 'user', content: userContent }],
        stream: true,
      },
      { signal }
    )
    let answer = ''
    let usage: LlmUsage | undefined
    for await (const event of stream) {
      if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
        onToken(event.delta.text)
        answer += event.delta.text
      } else if (event.type === 'message_start') {
        usage = {
          promptTokens: event.message.usage?.input_tokens ?? 0,
          completionTokens: 0,
        }
      } else if (event.type === 'message_delta') {
        usage = {
          promptTokens: usage?.promptTokens ?? 0,
          completionTokens: event.usage?.output_tokens ?? usage?.completionTokens ?? 0,
        }
      }
    }
    return { answer, ...(usage ? { usage } : {}) }
  }
}

class OpenAIBackend implements Backend {
  readonly providerName: LlmProviderName
  constructor(
    private readonly client: OpenAI,
    private readonly model: string,
    providerName: LlmProviderName = 'openai'
  ) {
    this.providerName = providerName
  }
  async stream(req: LlmRequest, onToken: (t: string) => void, signal: AbortSignal) {
    const history = (req.history ?? []).flatMap((t) => [
      { role: 'user' as const, content: t.question },
      { role: 'assistant' as const, content: t.answer },
    ])
    const isGroqReasoning = this.providerName === 'groq' && /gpt-oss/i.test(this.model)
    const userContent: OpenAI.Chat.ChatCompletionUserMessageParam['content'] = req.imageBase64
      ? [
          { type: 'text', text: req.question },
          {
            type: 'image_url',
            image_url: { url: `data:${req.imageMimeType ?? 'image/png'};base64,${req.imageBase64}` },
          },
        ]
      : req.question
    const params = {
      model: this.model,
      messages: [
        { role: 'system' as const, content: req.systemPrompt },
        ...history,
        { role: 'user' as const, content: userContent },
      ],
      stream: true as const,
      stream_options: { include_usage: true },
      // Groq gpt-oss reasoning controls (ignored/omitted for other providers).
      ...(isGroqReasoning ? { reasoning_effort: 'low', reasoning_format: 'hidden' } : {}),
    }
    const stream = await this.client.chat.completions.create(
      params as OpenAI.Chat.ChatCompletionCreateParamsStreaming,
      { signal }
    )
    let answer = ''
    let usage: LlmUsage | undefined
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta?.content
      if (delta) {
        onToken(delta)
        answer += delta
      }
      if (chunk.usage) {
        usage = {
          promptTokens: chunk.usage.prompt_tokens ?? 0,
          completionTokens: chunk.usage.completion_tokens ?? 0,
        }
      }
    }
    return { answer, ...(usage ? { usage } : {}) }
  }

  async prewarm(): Promise<void> {
    // Prime the keep-alive HTTPS connection so the first answer skips cold-start.
    const isGroqReasoning = this.providerName === 'groq' && /gpt-oss/i.test(this.model)
    await this.client.chat.completions.create({
      model: this.model,
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 1,
      stream: false,
      ...(isGroqReasoning ? { reasoning_effort: 'low' } : {}),
    } as OpenAI.Chat.ChatCompletionCreateParamsNonStreaming)
  }
}

class GeminiBackend implements Backend {
  readonly providerName = 'gemini' as const
  constructor(private readonly client: GoogleGenerativeAI, private readonly model: string) {}
  async stream(req: LlmRequest, onToken: (t: string) => void, signal: AbortSignal) {
    const generativeModel = this.client.getGenerativeModel({
      model: this.model,
      systemInstruction: req.systemPrompt,
      // Low-latency config: the Gemini 2.5 family runs an internal "thinking"
      // pass before emitting any text, which adds seconds to time-to-first-
      // token. thinkingBudget: 0 disables it so the answer starts streaming
      // immediately — the biggest perceived-speed win for an interview overlay.
      generationConfig: {
        maxOutputTokens: MAX_TOKENS,
        temperature: 0.6,
        thinkingConfig: { thinkingBudget: 0 },
      } as never,
    })
    // Prior turns as chat history so follow-ups ("how many states does it
    // have?") resolve against earlier questions.
    const chat = generativeModel.startChat({
      history: (req.history ?? []).flatMap((t) => [
        { role: 'user', parts: [{ text: t.question }] },
        { role: 'model', parts: [{ text: t.answer }] },
      ]),
    })
    const result = await chat.sendMessageStream(
      req.imageBase64
        ? [
            { text: req.question },
            { inlineData: { mimeType: req.imageMimeType ?? 'image/png', data: req.imageBase64 } },
          ]
        : req.question
    )
    let answer = ''
    let usage: LlmUsage | undefined
    for await (const chunk of result.stream) {
      if (signal.aborted) throw new Error('Request aborted')
      const text = chunk.text()
      if (text) {
        onToken(text)
        answer += text
      }
      const meta = chunk.usageMetadata
      if (meta) {
        usage = {
          promptTokens: meta.promptTokenCount ?? 0,
          completionTokens: meta.candidatesTokenCount ?? 0,
        }
      }
    }
    return { answer, ...(usage ? { usage } : {}) }
  }

  async prewarm(): Promise<void> {
    // A throwaway 1-token request that primes the HTTPS keep-alive socket to
    // generativelanguage.googleapis.com and the model route, so the first real
    // answer skips cold-connection setup. Errors are ignored.
    const m = this.client.getGenerativeModel({ model: this.model })
    await m.generateContent({
      contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
      generationConfig: { maxOutputTokens: 1, thinkingConfig: { thinkingBudget: 0 } } as never,
    })
  }
}

function defaultBackendFactory(
  provider: LlmProviderName,
  model: string,
  apiKey: string
): Backend {
  switch (provider) {
    case 'claude':
      return new ClaudeBackend(new Anthropic({ apiKey }), model)
    case 'openai':
      return new OpenAIBackend(new OpenAI({ apiKey }), model)
    case 'gemini':
      return new GeminiBackend(new GoogleGenerativeAI(apiKey), model)
    case 'groq':
      // Groq exposes an OpenAI-compatible API; reuse the OpenAI client with
      // Groq's base URL (very low latency, many open models).
      return new OpenAIBackend(
        new OpenAI({ apiKey, baseURL: 'https://api.groq.com/openai/v1' }),
        model,
        'groq'
      )
  }
}

async function runWithTimeout(
  provider: LlmProviderName,
  timeoutMs: number,
  clock: Clock,
  run: (signal: AbortSignal) => Promise<{ answer: string; usage?: LlmUsage }>
): Promise<LlmResult> {
  const controller = new AbortController()
  let timer: unknown
  let timedOut = false

  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timer = clock.setTimeout(() => {
      timedOut = true
      controller.abort()
      reject(new Error('timeout'))
    }, timeoutMs)
  })
  timeoutPromise.catch(() => {})

  const runPromise = run(controller.signal)
  runPromise.catch(() => {})

  try {
    const { answer, usage } = await Promise.race([runPromise, timeoutPromise])
    return { kind: 'ok', answer, ...(usage ? { usage } : {}) }
  } catch (err) {
    if (timedOut || controller.signal.aborted) {
      return {
        kind: 'error',
        provider,
        reason: 'timeout',
        message: `The "${provider}" provider did not respond within ${timeoutMs} ms.`,
      }
    }
    return {
      kind: 'error',
      provider,
      reason: 'backend-error',
      message: `The "${provider}" provider backend invocation failed: ${errorMessage(err)}`,
    }
  } finally {
    if (timer !== undefined) clock.clearTimeout(timer)
  }
}

/**
 * Create an {@link LlmProvider} for the given configuration. The API key comes
 * from server-side secrets (Req 18). Empty/unrecognized providers resolve to a
 * configuration error rather than throwing (Req 15.6).
 */
export function createLlmProvider(
  config: {
    provider?: string
    model?: string
    apiKey?: string
    /** Screenshot/vision overrides — may target a DIFFERENT provider than text. */
    visionProvider?: string
    visionModel?: string
    visionApiKey?: string
  },
  deps: LlmProviderDeps = {}
): LlmProvider {
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const clock = deps.clock ?? REAL_CLOCK
  const rawProvider = config.provider

  if (rawProvider === undefined || rawProvider.trim().length === 0) {
    return {
      generate: async () => ({
        kind: 'error',
        provider: '',
        reason: 'configuration',
        message: 'No LLM provider is configured.',
      }),
    }
  }

  const recognized = recognizeProvider(rawProvider)
  if (recognized.kind === 'error') {
    const message = recognized.message
    return {
      generate: async () => ({
        kind: 'error',
        provider: rawProvider,
        reason: 'configuration',
        message,
      }),
    }
  }

  const provider = recognized.provider
  const model = resolveModel(provider, config.model)
  const apiKey = config.apiKey ?? ''
  const buildBackend = deps.backendFactory ?? defaultBackendFactory

  let backend: Backend
  try {
    backend = buildBackend(provider, model, apiKey)
  } catch (err) {
    const message = `Failed to initialize the "${provider}" provider: ${errorMessage(err)}`
    return {
      generate: async () => ({ kind: 'error', provider, reason: 'backend-error', message }),
    }
  }

  // A separate VISION-capable backend for screenshot questions. This MAY be a
  // different provider than the text model (e.g. text = Groq for speed/cost,
  // vision = Gemini for quality) — each with its own model + API key. Falls
  // back to the text provider/model when not separately configured, and to the
  // text backend entirely if a cross-provider vision backend can't be built
  // (e.g. its API key is missing).
  let visionBackend: Backend = backend
  let visionProvider: LlmProviderName = provider
  try {
    const recognizedVision =
      config.visionProvider && config.visionProvider.trim().length > 0
        ? recognizeProvider(config.visionProvider)
        : { kind: 'ok' as const, provider }
    visionProvider = recognizedVision.kind === 'ok' ? recognizedVision.provider : provider
    const visionModel = resolveVisionModel(visionProvider, config.visionModel)

    if (visionProvider !== provider) {
      // Cross-provider vision needs its own key; without one, keep the text
      // backend so we never construct an unauthenticated client.
      const visionKey = config.visionApiKey ?? ''
      if (visionKey) visionBackend = buildBackend(visionProvider, visionModel, visionKey)
      else visionProvider = provider
    } else if (visionModel !== model) {
      visionBackend = buildBackend(provider, visionModel, apiKey)
    }
  } catch {
    visionBackend = backend
    visionProvider = provider
  }

  return {
    generate: async (req, onToken, onUsage) => {
      const useVision = Boolean(req.imageBase64)
      const chosen = useVision ? visionBackend : backend
      const chosenProvider = useVision ? visionProvider : provider
      const result = await runWithTimeout(chosenProvider, timeoutMs, clock, (signal) =>
        chosen.stream(req, onToken, signal)
      )
      if (result.kind === 'ok' && result.usage && onUsage) {
        onUsage(result.usage)
      }
      return result
    },
    prewarm: async () => {
      try {
        await backend.prewarm?.()
      } catch {
        /* warming is best-effort; ignore failures */
      }
    },
  }
}
