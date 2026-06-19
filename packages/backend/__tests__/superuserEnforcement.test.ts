// Task 3.6 — Superuser monitoring (email) + unlimited usage (effective
// enforcement). Validates the accounts-repo email/is_superuser semantics
// (Req 7.1, 7.2) and the design-F effective-enforcement behavior that backs
// correctness properties 3 (superusers never blocked, Req 7.4), 4 (regular
// accounts enforced, Req 7.5), and 7 (toggle without rebuild/redeploy, Req 7.7).
//
// A full WebSocket gateway harness is impractical here, so we exercise the exact
// decision the gateway's onAuth makes — `account.isSuperuser ? 'bypassed' :
// resolveEnforcementMode(env)` — and feed the resulting EnforcementMode through
// the real CreditsService.preSessionCheck and SessionOrchestrator hard-stop
// paths. This is the most direct, deterministic validation of properties 3/4/7.

import { describe, it, expect } from 'vitest'
import { CreditsService } from '../credits/creditsService'
import { SessionOrchestrator, type OrchestratorEmitter } from '../session/sessionOrchestrator'
import { createMemoryRepositories } from '../repos/memory'
import { resolveEnforcementMode } from '../config/environment'
import type { LlmProvider } from '../session/llmProvider'
import type { Repositories } from '../repos/types'
import type { Account, ConversionRate, EnforcementMode, Profile } from '@interview-assistant/shared'

const RATE: ConversionRate = { creditsPerSttMinute: 1, creditsPerLlmToken: 1 }
const LOW = 5

const PROFILE: Profile = {
  name: 'Dev',
  targetRole: 'Engineer',
  experienceYears: 5,
  roleCategories: ['software-development'],
  seniority: 'Senior',
  skills: ['typescript'],
  companyType: 'Product',
}

/**
 * Mirror of `sessionGateway.onAuth`'s effective-enforcement decision (design F):
 * superusers reuse the bypassed credit path; everyone else gets the env mode.
 * Driving the test through this keeps it faithful to the gateway behavior.
 */
function effectiveEnforcementFor(account: Account, env: 'dev'): EnforcementMode {
  return account.isSuperuser ? 'bypassed' : resolveEnforcementMode(env)
}

function makeCredits(repos: Repositories): CreditsService {
  return new CreditsService({ repos, conversionRate: RATE, lowCreditThreshold: LOW })
}

function recordingEmitter() {
  const events: Record<string, unknown[]> = {
    topics: [],
    scope: [],
    answerToken: [],
    answerComplete: [],
    answerError: [],
    lowCreditWarning: [],
    creditsExhausted: [],
  }
  const emit: OrchestratorEmitter = {
    topics: (t) => events.topics!.push(t),
    scope: (s, c) => events.scope!.push([s, c]),
    answerToken: (t) => events.answerToken!.push(t),
    answerComplete: (a) => events.answerComplete!.push(a),
    answerError: (p, m) => events.answerError!.push([p, m]),
    lowCreditWarning: (b, t) => events.lowCreditWarning!.push([b, t]),
    creditsExhausted: () => events.creditsExhausted!.push(true),
  }
  return { events, emit }
}

// An LLM that consumes 30 token-credits per answer — enough to exhaust a small
// enforced balance, so a hard stop is observable.
const okLlm: LlmProvider = {
  async generate(_req, onToken, onUsage) {
    onToken('answer')
    onUsage?.({ promptTokens: 10, completionTokens: 20 })
    return { kind: 'ok', answer: 'answer', usage: { promptTokens: 10, completionTokens: 20 } }
  },
}

describe('Accounts repo: email + is_superuser (Req 7.1, 7.2)', () => {
  it('provision returns is_superuser=false by default and upserts the email', async () => {
    const repos = createMemoryRepositories()
    const account = await repos.accounts.provision('user-1', 'user@example.com')
    expect(account.isSuperuser).toBe(false)
    expect(account.email).toBe('user@example.com')
  })

  it('provision without an email leaves email undefined but still defaults is_superuser=false', async () => {
    const repos = createMemoryRepositories()
    const account = await repos.accounts.provision('user-2')
    expect(account.email).toBeUndefined()
    expect(account.isSuperuser).toBe(false)
  })

  it('provision upserts a refreshed email on a returning account, preserving is_superuser', async () => {
    const repos = createMemoryRepositories()
    await repos.accounts.provision('user-3', 'old@example.com')
    await repos.accounts.setSuperuser('user-3', true)

    const again = await repos.accounts.provision('user-3', 'new@example.com')

    expect(again.email).toBe('new@example.com')
    // Re-provision must not clear an owner-managed superuser flag.
    expect(again.isSuperuser).toBe(true)
  })

  it('setSuperuser flips the flag and findByIdentityRef returns email + isSuperuser', async () => {
    const repos = createMemoryRepositories()
    await repos.accounts.provision('user-4', 'user4@example.com')

    await repos.accounts.setSuperuser('user-4', true)
    let stored = await repos.accounts.findByIdentityRef('user-4')
    expect(stored?.email).toBe('user4@example.com')
    expect(stored?.isSuperuser).toBe(true)

    // Clearing the flag works too (owner revokes the grant).
    await repos.accounts.setSuperuser('user-4', false)
    stored = await repos.accounts.findByIdentityRef('user-4')
    expect(stored?.isSuperuser).toBe(false)
  })

  it('setSuperuser throws when the account does not exist', async () => {
    const repos = createMemoryRepositories()
    await expect(repos.accounts.setSuperuser('missing', true)).rejects.toThrow()
  })
})

// Property 3: Superusers never blocked (Req 7.4)
describe('Property 3: superusers are never blocked (Req 7.4)', () => {
  it('a superuser with zero balance is authorized by the pre-session check', async () => {
    const repos = createMemoryRepositories()
    const account = await repos.accounts.provision('su-1', 'su@example.com')
    await repos.accounts.setSuperuser('su-1', true)
    const resolved = (await repos.accounts.findByIdentityRef('su-1'))!
    const enforcement = effectiveEnforcementFor(resolved, 'dev')
    expect(enforcement).toBe('bypassed')

    const credits = makeCredits(repos)
    expect(await credits.getBalance(account.id)).toBe(0)
    const check = await credits.preSessionCheck(account.id, enforcement)
    expect(check.authorized).toBe(true)
  })

  it('a superuser session is never hard-stopped and still records metered usage', async () => {
    const repos = createMemoryRepositories()
    const account = await repos.accounts.provision('su-2', 'su2@example.com')
    await repos.accounts.setSuperuser('su-2', true)
    const resolved = (await repos.accounts.findByIdentityRef('su-2'))!
    const enforcement = effectiveEnforcementFor(resolved, 'dev')

    const credits = makeCredits(repos)
    const session = await repos.sessions.create({
      accountId: account.id,
      profileSnapshot: PROFILE,
      enforcement,
    })
    const { events, emit } = recordingEmitter()
    const orch = new SessionOrchestrator({
      profile: PROFILE,
      accountId: account.id,
      sessionId: session.id,
      enforcement,
      llmProvider: okLlm,
      credits,
      repos,
      lowCreditThreshold: LOW,
      emit,
    })

    // Many answers on a zero balance: a regular account would exhaust; a
    // superuser (bypassed) never hard-stops.
    await orch.handleQuestion('How would you scale a service?')
    await orch.handleQuestion('And how would you cache it?')
    await orch.handleQuestion('What about the database?')

    expect(events.creditsExhausted).toEqual([])
    // Usage is still recorded for monitoring (Req 7.4).
    const usage = await repos.usage.getForSession(session.id)
    expect((usage?.llmTokens ?? 0)).toBeGreaterThan(0)
  })
})

// Property 4: Regular accounts enforced (Req 7.5)
describe('Property 4: regular dev accounts are enforced (Req 7.5)', () => {
  it('a regular dev account with zero balance is rejected by the pre-session check', async () => {
    const repos = createMemoryRepositories()
    const account = await repos.accounts.provision('reg-1', 'reg@example.com')
    const resolved = (await repos.accounts.findByIdentityRef('reg-1'))!
    const enforcement = effectiveEnforcementFor(resolved, 'dev')
    expect(enforcement).toBe('enforced')

    const credits = makeCredits(repos)
    const check = await credits.preSessionCheck(account.id, enforcement)
    expect(check.authorized).toBe(false)
    expect(check.reason).toBe('insufficient-credits')
  })

  it('a regular dev account hard-stops mid-session when its credits are exhausted', async () => {
    const repos = createMemoryRepositories()
    const account = await repos.accounts.provision('reg-2', 'reg2@example.com')
    const resolved = (await repos.accounts.findByIdentityRef('reg-2'))!
    const enforcement = effectiveEnforcementFor(resolved, 'dev')

    // Small positive balance so the session can start but is exhausted by one
    // answer (30 token-credits consumed).
    await repos.ledger.append({
      id: 'seed-reg-2',
      accountId: account.id,
      type: 'purchase-credit',
      amount: 5,
      createdAt: new Date().toISOString(),
    })
    const credits = makeCredits(repos)
    expect((await credits.preSessionCheck(account.id, enforcement)).authorized).toBe(true)

    const session = await repos.sessions.create({
      accountId: account.id,
      profileSnapshot: PROFILE,
      enforcement,
    })
    const { events, emit } = recordingEmitter()
    const orch = new SessionOrchestrator({
      profile: PROFILE,
      accountId: account.id,
      sessionId: session.id,
      enforcement,
      llmProvider: okLlm,
      credits,
      repos,
      lowCreditThreshold: LOW,
      emit,
    })

    await orch.handleQuestion('How would you scale a service?')
    expect(events.creditsExhausted).toEqual([true])
  })
})

// Property 7: Superuser toggled without rebuild or redeploy (Req 7.7)
describe('Property 7: toggling is_superuser changes membership on the next session (Req 7.7)', () => {
  it('the same account flips from enforced to bypassed purely from the DB flag', async () => {
    const repos = createMemoryRepositories()
    const account = await repos.accounts.provision('toggle-1', 'toggle@example.com')
    const credits = makeCredits(repos)

    // Before: regular account, zero balance -> enforced -> rejected.
    let resolved = (await repos.accounts.findByIdentityRef('toggle-1'))!
    let enforcement = effectiveEnforcementFor(resolved, 'dev')
    expect(enforcement).toBe('enforced')
    expect((await credits.preSessionCheck(account.id, enforcement)).authorized).toBe(false)

    // Owner toggles the flag in the DB (no rebuild, no redeploy).
    await repos.accounts.setSuperuser('toggle-1', true)

    // After: the next session resolves to bypassed -> authorized with zero balance.
    resolved = (await repos.accounts.findByIdentityRef('toggle-1'))!
    enforcement = effectiveEnforcementFor(resolved, 'dev')
    expect(enforcement).toBe('bypassed')
    expect((await credits.preSessionCheck(account.id, enforcement)).authorized).toBe(true)
  })
})
