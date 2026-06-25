// Pure LLM provider-name recognition and default-model resolution.
// Relocated verbatim from v1 src/main/domain. Pure, deterministic, no I/O.

/** The canonical, lowercase names of the supported LLM providers. */
export const SUPPORTED_LLM_PROVIDERS = ['claude', 'openai', 'gemini', 'groq'] as const

/** A recognized LLM provider in its canonical lowercase form. */
export type LlmProviderName = (typeof SUPPORTED_LLM_PROVIDERS)[number]

/** The result of attempting to recognize a configured provider-name string. */
export type RecognizeResult =
  | { kind: 'ok'; provider: LlmProviderName }
  | {
      kind: 'error'
      message: string
      offendingInput: string
      supported: LlmProviderName[]
    }

/** Default model names per provider, used when no model is configured. */
const DEFAULT_MODELS: Record<LlmProviderName, string> = {
  claude: 'claude-sonnet-4',
  openai: 'gpt-4.1',
  gemini: 'gemini-1.5-pro',
  // Groq's fast, capable default; override via DEFAULT_LLM_MODEL (e.g.
  // 'llama-3.1-8b-instant' for lowest latency).
  groq: 'llama-3.3-70b-versatile',
}

/**
 * Recognize a configured LLM provider-name string (case-insensitive).
 * Unrecognized names yield an error naming the offending input and the
 * supported providers (Req 15.2–15.4). Pure.
 *
 * @param name - The configured provider name as read from configuration.
 * @returns A {@link RecognizeResult} discriminated on `kind`.
 */
export function recognizeProvider(name: string): RecognizeResult {
  const normalized = name.trim().toLowerCase()

  const match = SUPPORTED_LLM_PROVIDERS.find((p) => p === normalized)
  if (match !== undefined) {
    return { kind: 'ok', provider: match }
  }

  const supported = [...SUPPORTED_LLM_PROVIDERS]
  return {
    kind: 'error',
    message:
      `Unrecognized LLM provider "${name}". ` +
      `Supported providers are: ${supported.join(', ')}.`,
    offendingInput: name,
    supported,
  }
}

/**
 * Resolve the model name to use for a recognized provider. Returns the
 * configured model when present and non-empty, else the provider default.
 *
 * @param provider - A recognized provider in canonical lowercase form.
 * @param configuredModel - The configured model name, if any.
 * @returns The resolved model name.
 */
export function resolveModel(provider: LlmProviderName, configuredModel?: string): string {
  if (configuredModel !== undefined && configuredModel.trim().length > 0) {
    return configuredModel
  }
  return DEFAULT_MODELS[provider]
}

/**
 * Default VISION-capable model per provider, used for screenshot questions when
 * no explicit vision model is configured. The primary chat model may be
 * text-only (e.g. Groq's gpt-oss family), so screenshots route to these
 * image-capable models instead. Override via DEFAULT_LLM_VISION_MODEL.
 */
const DEFAULT_VISION_MODELS: Record<LlmProviderName, string> = {
  claude: 'claude-sonnet-4',
  openai: 'gpt-4o-mini',
  gemini: 'gemini-2.5-flash',
  // Groq's current multimodal model (Llama 4 Scout supports image input).
  groq: 'meta-llama/llama-4-scout-17b-16e-instruct',
}

/**
 * Resolve the model to use for a vision (screenshot) request. Returns the
 * configured vision model when present and non-empty, else the provider's
 * image-capable default.
 */
export function resolveVisionModel(provider: LlmProviderName, configuredModel?: string): string {
  if (configuredModel !== undefined && configuredModel.trim().length > 0) {
    return configuredModel
  }
  return DEFAULT_VISION_MODELS[provider]
}
