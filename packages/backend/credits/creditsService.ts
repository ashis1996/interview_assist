// Credits_Service: pre-session check, live metering, low-credit warning, hard
// stop, and exactly-once finalization (Req 7-12).
//
// Built on the pure credits core (usageToCredits / ledgerBalance) and the
// repository interfaces, so all of its decision logic is deterministic and
// property-testable against the in-memory repositories.

import {
  ledgerBalance,
  usageToCredits,
  type ConversionRate,
  type EnforcementMode,
  type LedgerEntry,
  type SessionEndReason,
  type Usage,
} from '@interview-assistant/shared'
import {
  LedgerUniqueViolation,
  type Repositories,
  type UsageRecord,
} from '../repos/types'
import { randomUUID } from 'node:crypto'

/** Result of a pre-session credit check (Req 8). */
export interface PreSessionResult {
  authorized: boolean
  balance: number
  reason?: 'insufficient-credits'
}

/** Result of finalizing a session (Req 11, 12). */
export interface FinalizeResult {
  /** True when this call performed the finalization; false if already finalized. */
  finalized: boolean
  creditsConsumed: number
  usage: Usage
}

export interface CreditsServiceOptions {
  repos: Repositories
  conversionRate: ConversionRate
  /** Balance at or below which a low-credit warning is raised (Req 10.1). */
  lowCreditThreshold: number
  /** Injectable id/clock seams for deterministic tests. */
  now?: () => string
  newId?: () => string
}

/**
 * The Credits_Service. One instance per backend; methods take the account and
 * session ids they operate on. Pure decision helpers (authorize/low/exhausted)
 * are separated from the persistence steps so they can be reasoned about and
 * tested directly.
 */
export class CreditsService {
  private readonly repos: Repositories
  private readonly rate: ConversionRate
  private readonly lowCreditThreshold: number
  private readonly now: () => string
  private readonly newId: () => string

  constructor(opts: CreditsServiceOptions) {
    this.repos = opts.repos
    this.rate = opts.conversionRate
    this.lowCreditThreshold = opts.lowCreditThreshold
    this.now = opts.now ?? (() => new Date().toISOString())
    this.newId = opts.newId ?? (() => randomUUID())
  }

  /** The account's current enforced Credit_Balance (Req 11.2). */
  async getBalance(accountId: string): Promise<number> {
    return ledgerBalance(await this.repos.ledger.entriesByAccount(accountId))
  }

  /**
   * Pre-session check (Req 8). Bypassed always authorizes (Req 8.4). Enforced
   * authorizes iff the balance is strictly greater than zero (Req 8.2, 8.3).
   */
  async preSessionCheck(
    accountId: string,
    enforcement: EnforcementMode
  ): Promise<PreSessionResult> {
    const balance = await this.getBalance(accountId)
    if (enforcement === 'bypassed') {
      return { authorized: true, balance }
    }
    if (balance > 0) {
      return { authorized: true, balance }
    }
    return { authorized: false, balance, reason: 'insufficient-credits' }
  }

  /**
   * Record (accumulate) metered usage for a session as it accrues (Req 9.1, 9.2).
   * Stored as a Usage_Record regardless of enforcement (Req 9.5).
   */
  async recordUsage(
    sessionId: string,
    accountId: string,
    delta: Usage,
    latencyMs?: Record<string, number>
  ): Promise<UsageRecord> {
    const existing = await this.repos.usage.getForSession(sessionId)
    const merged: UsageRecord = {
      sessionId,
      accountId,
      sttMinutes: (existing?.sttMinutes ?? 0) + delta.sttMinutes,
      llmTokens: (existing?.llmTokens ?? 0) + delta.llmTokens,
      ...(latencyMs || existing?.latencyMs
        ? { latencyMs: { ...existing?.latencyMs, ...latencyMs } }
        : {}),
    }
    await this.repos.usage.upsertForSession(merged)
    return merged
  }

  /** Credits a usage value converts to under the configured rate (Req 9.3). */
  creditsFor(usage: Usage): number {
    return usageToCredits(this.rate, usage)
  }

  /**
   * The live balance during a session: the enforced ledger balance minus the
   * credits the session's accrued usage will consume (only when enforced).
   * Bypassed sessions never reduce the live balance (Req 9.4, 9.5).
   */
  async liveBalance(
    accountId: string,
    sessionId: string,
    enforcement: EnforcementMode
  ): Promise<number> {
    const balance = await this.getBalance(accountId)
    if (enforcement === 'bypassed') return balance
    const usage = await this.repos.usage.getForSession(sessionId)
    const consumed = usage
      ? this.creditsFor({ sttMinutes: usage.sttMinutes, llmTokens: usage.llmTokens })
      : 0
    return balance - consumed
  }

  /** Whether a live balance is at or below the low-credit threshold (Req 10.1). */
  isLowCredit(liveBalance: number, enforcement: EnforcementMode): boolean {
    return enforcement === 'enforced' && liveBalance <= this.lowCreditThreshold
  }

  /** Whether an enforced session has exhausted its credits (Req 10.2). */
  isExhausted(liveBalance: number, enforcement: EnforcementMode): boolean {
    return enforcement === 'enforced' && liveBalance <= 0
  }

  /**
   * Finalize a session exactly once (Req 11.1, 12.5, 12.7). The session row's
   * `finalizedAt` is a compare-and-set guard; only the first caller writes the
   * single debit ledger entry. The unique constraint on (sessionId, type) is a
   * backstop against a race, swallowed as a no-op.
   *
   * The entry type is `usage-debit` when enforced (reduces the balance) or
   * `non-enforced-debit` when bypassed (recorded but excluded from the enforced
   * balance, Req 11.5).
   */
  async finalizeSession(
    sessionId: string,
    endReason: SessionEndReason
  ): Promise<FinalizeResult> {
    const session = await this.repos.sessions.get(sessionId)
    const usageRecord = await this.repos.usage.getForSession(sessionId)
    const usage: Usage = {
      sttMinutes: usageRecord?.sttMinutes ?? 0,
      llmTokens: usageRecord?.llmTokens ?? 0,
    }
    const creditsConsumed = this.creditsFor(usage)

    if (!session) {
      return { finalized: false, creditsConsumed, usage }
    }

    const claimed = await this.repos.sessions.markFinalized(sessionId, endReason, this.now())
    if (!claimed) {
      // Already finalized by an earlier trigger; idempotent no-op (Req 12.7).
      return { finalized: false, creditsConsumed, usage }
    }

    const type = session.enforcement === 'enforced' ? 'usage-debit' : 'non-enforced-debit'
    const entry: LedgerEntry = {
      id: this.newId(),
      accountId: session.accountId,
      type,
      amount: -creditsConsumed,
      sessionId,
      createdAt: this.now(),
    }
    try {
      await this.repos.ledger.append(entry)
    } catch (err) {
      if (!(err instanceof LedgerUniqueViolation)) throw err
      // Duplicate debit for this session: another path already wrote it.
    }

    return { finalized: true, creditsConsumed, usage }
  }
}
