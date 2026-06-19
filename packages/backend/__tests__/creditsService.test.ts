import { describe, it, expect } from 'vitest'
import fc from 'fast-check'
import { CreditsService } from '../credits/creditsService'
import { createMemoryRepositories } from '../repos/memory'
import type { Repositories } from '../repos/types'
import {
  ledgerBalance,
  type ConversionRate,
  type EnforcementMode,
  type Profile,
} from '@interview-assistant/shared'

const RATE: ConversionRate = { creditsPerSttMinute: 1, creditsPerLlmToken: 0.0001 }
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

function makeService(repos: Repositories): CreditsService {
  return new CreditsService({ repos, conversionRate: RATE, lowCreditThreshold: LOW })
}

/** Seed an account's balance by appending a purchase-credit entry. */
async function seedBalance(repos: Repositories, accountId: string, amount: number): Promise<void> {
  if (amount === 0) return
  await repos.ledger.append({
    id: `seed-${accountId}-${amount}`,
    accountId,
    type: 'purchase-credit',
    amount,
    createdAt: new Date().toISOString(),
  })
}

// Feature: interview-assistant-saas, Property 5: Pre-session check authorizes correctly
describe('Property 5: pre-session check authorizes correctly', () => {
  it('authorizes iff bypassed, or enforced with balance > 0', () => {
    return fc.assert(
      fc.asyncProperty(
        fc.constantFrom<EnforcementMode>('enforced', 'bypassed'),
        fc.double({ min: -100, max: 100, noNaN: true }),
        async (enforcement, balance) => {
          const repos = createMemoryRepositories()
          const acct = await repos.accounts.provision('user')
          await seedBalance(repos, acct.id, balance)
          const svc = makeService(repos)
          const r = await svc.preSessionCheck(acct.id, enforcement)
          const expected = enforcement === 'bypassed' || balance > 0
          expect(r.authorized).toBe(expected)
          if (!r.authorized) expect(r.reason).toBe('insufficient-credits')
        }
      ),
      { numRuns: 200 }
    )
  })
})

// Feature: interview-assistant-saas, Property 2: Finalization is exactly-once (idempotent)
describe('Property 2: finalization is exactly-once', () => {
  it('produces at most one debit entry no matter how many finalize triggers fire', () => {
    return fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 8 }),
        fc.double({ min: 0, max: 100, noNaN: true }),
        fc.integer({ min: 0, max: 100000 }),
        async (triggers, sttMinutes, llmTokens) => {
          const repos = createMemoryRepositories()
          const acct = await repos.accounts.provision('user')
          await seedBalance(repos, acct.id, 1000)
          const svc = makeService(repos)
          const session = await repos.sessions.create({
            accountId: acct.id,
            profileSnapshot: PROFILE,
            enforcement: 'enforced',
          })
          await svc.recordUsage(session.id, acct.id, { sttMinutes, llmTokens })

          const results = await Promise.all(
            Array.from({ length: triggers }, () => svc.finalizeSession(session.id, 'user-ended'))
          )

          const debits = (await repos.ledger.entriesByAccount(acct.id)).filter(
            (e) => e.sessionId === session.id
          )
          expect(debits.length).toBe(1)
          expect(results.filter((r) => r.finalized).length).toBe(1)
        }
      ),
      { numRuns: 150 }
    )
  })
})

// Feature: interview-assistant-saas, Property 4: Bypassed enforcement never decrements the enforced balance
describe('Property 4: bypassed enforcement never decrements the enforced balance', () => {
  it('records usage but leaves the enforced balance unchanged', () => {
    return fc.assert(
      fc.asyncProperty(
        fc.double({ min: 0, max: 100, noNaN: true }),
        fc.integer({ min: 0, max: 100000 }),
        fc.double({ min: 0, max: 1000, noNaN: true }),
        async (sttMinutes, llmTokens, startBalance) => {
          const repos = createMemoryRepositories()
          const acct = await repos.accounts.provision('user')
          await seedBalance(repos, acct.id, startBalance)
          const svc = makeService(repos)
          const before = await svc.getBalance(acct.id)

          const session = await repos.sessions.create({
            accountId: acct.id,
            profileSnapshot: PROFILE,
            enforcement: 'bypassed',
          })
          await svc.recordUsage(session.id, acct.id, { sttMinutes, llmTokens })
          await svc.finalizeSession(session.id, 'user-ended')

          const after = await svc.getBalance(acct.id)
          expect(after).toBeCloseTo(before, 6)
          // Usage is still recorded.
          const usage = await repos.usage.getForSession(session.id)
          expect(usage?.sttMinutes).toBeCloseTo(sttMinutes, 6)
        }
      ),
      { numRuns: 150 }
    )
  })

  it('enforced sessions DO decrement the balance by the credits consumed', async () => {
    const repos = createMemoryRepositories()
    const acct = await repos.accounts.provision('user')
    await seedBalance(repos, acct.id, 100)
    const svc = makeService(repos)
    const session = await repos.sessions.create({
      accountId: acct.id,
      profileSnapshot: PROFILE,
      enforcement: 'enforced',
    })
    await svc.recordUsage(session.id, acct.id, { sttMinutes: 10, llmTokens: 0 })
    const res = await svc.finalizeSession(session.id, 'user-ended')
    expect(res.creditsConsumed).toBeCloseTo(10, 6)
    expect(await svc.getBalance(acct.id)).toBeCloseTo(90, 6)
  })
})

// Feature: interview-assistant-saas, Property 7: Per-account data isolation
describe('Property 7: per-account data isolation', () => {
  it('one account never sees another account ledger entries or sessions', () => {
    return fc.assert(
      fc.asyncProperty(
        fc.double({ min: 1, max: 1000, noNaN: true }),
        fc.double({ min: 1, max: 1000, noNaN: true }),
        async (balA, balB) => {
          const repos = createMemoryRepositories()
          const a = await repos.accounts.provision('user-a')
          const b = await repos.accounts.provision('user-b')
          await seedBalance(repos, a.id, balA)
          await seedBalance(repos, b.id, balB)
          await repos.sessions.create({
            accountId: a.id,
            profileSnapshot: PROFILE,
            enforcement: 'enforced',
          })

          const aEntries = await repos.ledger.entriesByAccount(a.id)
          const bEntries = await repos.ledger.entriesByAccount(b.id)
          expect(aEntries.every((e) => e.accountId === a.id)).toBe(true)
          expect(bEntries.every((e) => e.accountId === b.id)).toBe(true)
          expect((await repos.sessions.listByAccount(b.id)).length).toBe(0)
          expect((await repos.sessions.listByAccount(a.id)).length).toBe(1)
        }
      ),
      { numRuns: 150 }
    )
  })
})

// Feature: interview-assistant-saas, Property 8: Session deletion retains the ledger entry
describe('Property 8: session deletion retains the ledger entry', () => {
  it('deletes the transcript but keeps the ledger entry and balance', async () => {
    const repos = createMemoryRepositories()
    const acct = await repos.accounts.provision('user')
    await seedBalance(repos, acct.id, 100)
    const svc = makeService(repos)
    const session = await repos.sessions.create({
      accountId: acct.id,
      profileSnapshot: PROFILE,
      enforcement: 'enforced',
    })
    await repos.qna.append(session.id, acct.id, {
      question: 'q',
      answer: 'a',
      topics: [],
      scope: 'out-of-scope',
      timestamp: new Date().toISOString(),
    })
    await svc.recordUsage(session.id, acct.id, { sttMinutes: 5, llmTokens: 0 })
    await svc.finalizeSession(session.id, 'user-ended')

    const balanceAfterFinalize = await svc.getBalance(acct.id)
    const ledgerBefore = await repos.ledger.entriesByAccount(acct.id)

    await repos.qna.deleteBySession(session.id)
    await repos.sessions.deleteSession(session.id)

    expect(await repos.qna.listBySession(session.id)).toEqual([])
    const ledgerAfter = await repos.ledger.entriesByAccount(acct.id)
    expect(ledgerAfter.length).toBe(ledgerBefore.length)
    expect(ledgerBalance(ledgerAfter)).toBeCloseTo(balanceAfterFinalize, 6)
  })
})
