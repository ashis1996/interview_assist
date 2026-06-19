// Server-side secrets and runtime configuration (Req 18).
//
// All provider API keys (Deepgram, OpenAI, Anthropic, Gemini) and the Supabase
// service-role key live ONLY here, sourced from environment variables on the
// Backend instance. They are never serialized to any client-facing response and
// each is handed only to its matching provider client. The Desktop_Client holds
// none of these (Req 18.1-18.5).

import type { Environment } from '@interview-assistant/shared'

/** Provider secrets, each supplied only to its own provider client (Req 18.2). */
export interface ProviderSecrets {
  deepgramApiKey?: string
  openaiApiKey?: string
  anthropicApiKey?: string
  geminiApiKey?: string
  groqApiKey?: string
}

/** Supabase configuration for this environment's project (Req 19.7). */
export interface SupabaseConfig {
  /** Project URL, e.g. https://<ref>.supabase.co */
  url: string
  /** JWKS endpoint used by the auth verifier (derived from `url` if absent). */
  jwksUrl: string
  /** Expected token audience/issuer for verification. */
  issuer: string
  /** Service-role key — server-side only, never exposed to the client (Req 18.6). */
  serviceRoleKey?: string
}

/** The fully resolved backend runtime configuration. */
export interface BackendConfig {
  environment: Environment
  port: number
  databaseUrl?: string
  supabase: SupabaseConfig
  secrets: ProviderSecrets
  /** Default LLM + STT provider selection for sessions. */
  defaultLlmProvider: string
  /** Optional explicit LLM model; falls back to the provider default when absent. */
  defaultLlmModel?: string
  defaultSttProvider: 'deepgram' | 'whisper'
}

function env(name: string): string | undefined {
  const v = process.env[name]
  return v && v.length > 0 ? v : undefined
}

function requireEnv(name: string): string {
  const v = env(name)
  if (!v) {
    throw new Error(`Missing required environment variable: ${name}`)
  }
  return v
}

/**
 * Resolve the backend configuration from environment variables. The
 * `APP_ENVIRONMENT` value drives the credit/auth enforcement mode elsewhere; a
 * missing value is left undefined so {@link resolveEnforcementMode} fails safe
 * to enforced.
 */
export function loadBackendConfig(): BackendConfig {
  const supabaseUrl = env('SUPABASE_URL') ?? ''
  return {
    environment: env('APP_ENVIRONMENT') as Environment,
    port: Number(env('PORT') ?? '8787'),
    databaseUrl: env('DATABASE_URL'),
    supabase: {
      url: supabaseUrl,
      jwksUrl: env('SUPABASE_JWKS_URL') ?? `${supabaseUrl}/auth/v1/.well-known/jwks.json`,
      issuer: env('SUPABASE_JWT_ISSUER') ?? `${supabaseUrl}/auth/v1`,
      serviceRoleKey: env('SUPABASE_SERVICE_ROLE_KEY'),
    },
    secrets: {
      deepgramApiKey: env('DEEPGRAM_API_KEY'),
      openaiApiKey: env('OPENAI_API_KEY'),
      anthropicApiKey: env('ANTHROPIC_API_KEY'),
      geminiApiKey: env('GEMINI_API_KEY'),
      groqApiKey: env('GROQ_API_KEY'),
    },
    defaultLlmProvider: env('DEFAULT_LLM_PROVIDER') ?? 'claude',
    defaultLlmModel: env('DEFAULT_LLM_MODEL'),
    defaultSttProvider: (env('DEFAULT_STT_PROVIDER') as 'deepgram' | 'whisper') ?? 'deepgram',
  }
}

export { requireEnv }
