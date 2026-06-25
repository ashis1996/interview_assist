// Backend bootstrap: wires config, persistence, auth, credits, the HTTP API,
// and the realtime session gateway into a running service.
//
// Provider keys come from server-side secrets (Req 18). The STT relay backend
// is selected per the configured default provider. Credit/auth enforcement is
// derived from the instance's environment (Req 19).

import 'dotenv/config'
import { Pool } from 'pg'
import { loadBackendConfig } from './config/secrets'
import { createPostgresRepositories } from './repos/postgres'
import { runMigrations } from './db/migrate'
import { AuthVerifier } from './http/authVerifier'
import { CreditsService } from './credits/creditsService'
import { buildHttpServer } from './http/server'
import { createSessionGateway } from './session/sessionGateway'
import { createDeepgramRelayFactory } from './session/sttRelay/deepgramClient'
import { createWhisperRelayFactory } from './session/sttRelay/whisperClient'
import type { SttRelayFactory } from './session/sttRelay/types'

const LOW_CREDIT_THRESHOLD = Number(process.env['LOW_CREDIT_THRESHOLD'] ?? '5')
const CONVERSION_RATE = {
  creditsPerSttMinute: Number(process.env['CREDITS_PER_STT_MINUTE'] ?? '1'),
  creditsPerLlmToken: Number(process.env['CREDITS_PER_LLM_TOKEN'] ?? '0.0001'),
}

/**
 * Parse the optional `SUPERUSER_BOOTSTRAP_EMAILS` allow-list (Req 7.8): a
 * comma-separated list of emails, normalized to trimmed + lowercased and
 * de-duplicated into a set. When an account is first provisioned whose JWT
 * email matches an entry, the AuthVerifier auto-sets `is_superuser=true`. Token
 * values are never logged. Returns an empty set when the var is unset/blank.
 */
function parseBootstrapSuperuserEmails(raw: string | undefined): Set<string> {
  if (!raw) return new Set()
  return new Set(
    raw
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.length > 0)
  )
}

/**
 * Infer the LLM provider from a model id when the provider isn't set explicitly.
 * Lets `DEFAULT_LLM_VISION_MODEL=gemini-2.5-flash` route to Gemini even if
 * `DEFAULT_LLM_VISION_PROVIDER` was omitted. Falls back to undefined (caller
 * then uses the text provider).
 */
function inferProviderFromModel(model: string | undefined): string | undefined {
  if (!model) return undefined
  const m = model.toLowerCase()
  if (m.startsWith('gemini')) return 'gemini'
  if (m.startsWith('claude')) return 'claude'
  // Real OpenAI ids (gpt-4o, gpt-4.1, o3, ...) — but NOT Groq's "openai/gpt-oss".
  if ((m.startsWith('gpt-') || m.startsWith('o1') || m.startsWith('o3') || m.startsWith('o4')) && !m.includes('/'))
    return 'openai'
  // llama-*, mixtral, meta-llama/*, openai/gpt-oss-* are served via Groq here.
  if (m.includes('llama') || m.includes('mixtral') || m.includes('gpt-oss')) return 'groq'
  return undefined
}

/** Select the API key matching a provider name. */
function apiKeyForProvider(provider: string | undefined, secrets: ReturnType<typeof loadBackendConfig>['secrets']): string | undefined {
  switch (provider) {
    case 'openai':
      return secrets.openaiApiKey
    case 'gemini':
      return secrets.geminiApiKey
    case 'groq':
      return secrets.groqApiKey
    default:
      return secrets.anthropicApiKey // claude
  }
}

export async function startBackend(): Promise<void> {
  const config = loadBackendConfig()
  const pool = new Pool({ connectionString: config.databaseUrl })
  const repos = createPostgresRepositories(pool)

  // Verify DB connectivity up front so failures are obvious, not silent.
  try {
    await pool.query('SELECT 1')
    // eslint-disable-next-line no-console
    console.log('[backend] database connected')
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      '[backend] DATABASE CONNECTION FAILED — auth/sessions will not work:',
      err instanceof Error ? err.message : err
    )
  }

  // Converge the schema on startup so every deploy applies pending migrations
  // before serving (Req 1.4). The schema is idempotent. A failure here means we
  // could serve against a stale schema, so fail the deploy loudly.
  try {
    await runMigrations(pool)
    // eslint-disable-next-line no-console
    console.log('[backend] schema migration applied')
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(
      '[backend] SCHEMA MIGRATION FAILED — refusing to start:',
      err instanceof Error ? err.message : err
    )
    process.exit(1)
  }

  const bootstrapSuperuserEmails = parseBootstrapSuperuserEmails(
    process.env['SUPERUSER_BOOTSTRAP_EMAILS']
  )
  if (bootstrapSuperuserEmails.size > 0) {
    // eslint-disable-next-line no-console
    console.log(
      `[backend] superuser bootstrap configured for ${bootstrapSuperuserEmails.size} email(s)`
    )
  }

  const authVerifier = new AuthVerifier({
    jwksUrl: config.supabase.jwksUrl,
    issuer: config.supabase.issuer,
    accounts: repos.accounts,
    bootstrapSuperuserEmails,
  })

  const creditsService = new CreditsService({
    repos,
    conversionRate: CONVERSION_RATE,
    lowCreditThreshold: LOW_CREDIT_THRESHOLD,
  })

  const sttRelayFactory: SttRelayFactory =
    config.defaultSttProvider === 'whisper'
      ? createWhisperRelayFactory(config.secrets.openaiApiKey ?? '')
      : createDeepgramRelayFactory(config.secrets.deepgramApiKey ?? '')

  const llmApiKey = apiKeyForProvider(config.defaultLlmProvider, config.secrets)

  // The vision (screenshot) provider may differ from the text provider. Resolve
  // it from the explicit env, else INFER it from the vision model id (so setting
  // only DEFAULT_LLM_VISION_MODEL=gemini-... still routes to Gemini), else fall
  // back to the text provider. Use that provider's own API key.
  const visionProvider =
    config.defaultLlmVisionProvider ??
    inferProviderFromModel(config.defaultLlmVisionModel) ??
    config.defaultLlmProvider
  const visionApiKey = apiKeyForProvider(visionProvider, config.secrets)

  // eslint-disable-next-line no-console
  console.log(
    `[backend] LLM text=${config.defaultLlmProvider}/${config.defaultLlmModel ?? '(default)'}` +
      ` vision=${visionProvider}/${config.defaultLlmVisionModel ?? '(default)'}` +
      ` (textKey=${llmApiKey ? 'set' : 'MISSING'}, visionKey=${visionApiKey ? 'set' : 'MISSING'})`
  )

  const httpApp = buildHttpServer({
    environment: config.environment,
    repos,
    authVerifier,
    creditsService,
  })

  // Attach the WebSocket session gateway to Fastify's underlying HTTP server,
  // then let Fastify bind it. This is the reliable pattern for WS upgrades.
  createSessionGateway(
    {
      environment: config.environment,
      repos,
      authVerifier,
      creditsService,
      sttRelayFactory,
      llmConfig: {
        provider: config.defaultLlmProvider,
        ...(config.defaultLlmModel ? { model: config.defaultLlmModel } : {}),
        apiKey: llmApiKey,
        visionProvider,
        ...(config.defaultLlmVisionModel ? { visionModel: config.defaultLlmVisionModel } : {}),
        ...(visionApiKey ? { visionApiKey } : {}),
      },
      lowCreditThreshold: LOW_CREDIT_THRESHOLD,
      defaultSttProvider: config.defaultSttProvider,
    },
    { server: httpApp.server }
  )

  const host = process.env['HOST'] ?? '0.0.0.0'
  const port = Number(process.env['PORT'] ?? 8787)
  await httpApp.listen({ port, host })
  // eslint-disable-next-line no-console
  console.log(`[backend] listening on ${host}:${port} (env=${config.environment ?? 'unknown'})`)
}

// Allow `node index.js` style execution.
if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))) {
  startBackend().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[backend] failed to start', err)
    process.exit(1)
  })
}
