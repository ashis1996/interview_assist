// Fastify HTTP API (Req 7.1, 7.3, 7.4, 17.7, 20.5).
//
// Account-scoped REST endpoints backing the credit-balance display and session
// history. Every route is guarded by the auth verifier (auth-mode aware) and
// returns only the authenticated account's own data.

import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify'
import { exportSessionMarkdown, type Environment } from '@interview-assistant/shared'
import { resolveAuthMode } from '../config/environment'
import { AuthError, type AuthVerifier } from './authVerifier'
import { CreditsService } from '../credits/creditsService'
import type { Repositories } from '../repos/types'

export interface HttpServerDeps {
  environment: Environment
  repos: Repositories
  authVerifier: AuthVerifier
  creditsService: CreditsService
}

function bearer(req: FastifyRequest): string | undefined {
  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) return undefined
  return header.slice('Bearer '.length)
}

/** Build the Fastify HTTP app. The caller listens on the configured port. */
export function buildHttpServer(deps: HttpServerDeps): FastifyInstance {
  const app = Fastify({ logger: false })

  // Resolve the account for every request (auth-mode aware) (Req 1.8, 1.12).
  async function requireAccountId(req: FastifyRequest): Promise<string> {
    const authMode = resolveAuthMode(deps.environment)
    const account = await deps.authVerifier.resolveAccount(authMode, bearer(req))
    return account.id
  }

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof AuthError) {
      void reply.code(401).send({ error: err.message })
      return
    }
    void reply.code(500).send({ error: 'Internal error' })
  })

  // Unauthenticated liveness probe for the Hosting_Provider health check
  // (Req 1.1, 1.2). Trivial and side-effect free: it never calls
  // requireAccountId, so the platform can poll it without a token and a healthy
  // process always responds 200 { ok: true }. Declared before the
  // auth-required routes so it is never gated by auth.
  app.get('/healthz', async () => ({ ok: true }))

  // Current credit balance (Req 7.1).
  app.get('/credits/balance', async (req) => {
    const accountId = await requireAccountId(req)
    return { balance: await deps.creditsService.getBalance(accountId) }
  })

  // The saved profile for prefilling the onboarding form (null if none yet).
  app.get('/profile', async (req) => {
    const accountId = await requireAccountId(req)
    return { profile: await deps.repos.profiles.get(accountId) }
  })

  // Save/update the profile (so it is remembered across sessions).
  app.put('/profile', async (req) => {
    const accountId = await requireAccountId(req)
    const profile = (req.body as { profile?: unknown })?.profile
    if (profile && typeof profile === 'object') {
      await deps.repos.profiles.upsert(accountId, profile as never)
    }
    return { ok: true }
  })

  // Session history list (Req 7.3).
  app.get('/sessions', async (req) => {
    const accountId = await requireAccountId(req)
    const sessions = await deps.repos.sessions.listByAccount(accountId)
    return {
      sessions: sessions.map((s) => ({
        id: s.id,
        startedAt: s.startedAt,
        endedAt: s.endedAt ?? null,
        endReason: s.endReason ?? null,
      })),
    }
  })

  // A single session's transcript + Q&A, account-scoped (Req 7.4, 20.5).
  app.get('/sessions/:id', async (req, reply) => {
    const accountId = await requireAccountId(req)
    const { id } = req.params as { id: string }
    const session = await deps.repos.sessions.get(id)
    if (!session || session.accountId !== accountId) {
      return reply.code(404).send({ error: 'Not found' })
    }
    const entries = await deps.repos.qna.listBySession(id)
    return { session: { id: session.id, startedAt: session.startedAt }, entries }
  })

  // Markdown export of a session (Req 7.5).
  app.get('/sessions/:id/export', async (req, reply) => {
    const accountId = await requireAccountId(req)
    const { id } = req.params as { id: string }
    const session = await deps.repos.sessions.get(id)
    if (!session || session.accountId !== accountId) {
      return reply.code(404).send({ error: 'Not found' })
    }
    const entries = await deps.repos.qna.listBySession(id)
    const md = exportSessionMarkdown({
      profileSnapshot: session.profileSnapshot,
      entries,
      startedAt: session.startedAt,
    })
    return reply.header('content-type', 'text/markdown').send(md)
  })

  // Delete a session: remove transcript, retain ledger entry (Req 20.4, 20.6).
  app.delete('/sessions/:id', async (req, reply) => {
    const accountId = await requireAccountId(req)
    const { id } = req.params as { id: string }
    const session = await deps.repos.sessions.get(id)
    if (!session || session.accountId !== accountId) {
      return reply.code(404).send({ error: 'Not found' })
    }
    try {
      await deps.repos.qna.deleteBySession(id)
      await deps.repos.sessions.deleteSession(id)
    } catch {
      return reply.code(500).send({ error: 'Deletion incomplete', complete: false })
    }
    return { deleted: true }
  })

  return app
}
