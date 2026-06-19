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

  const llmApiKey =
    config.defaultLlmProvider === 'openai'
      ? config.secrets.openaiApiKey
      : config.defaultLlmProvider === 'gemini'
        ? config.secrets.geminiApiKey
        : config.defaultLlmProvider === 'groq'
          ? config.secrets.groqApiKey
          : config.secrets.anthropicApiKey

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
