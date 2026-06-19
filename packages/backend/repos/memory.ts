// In-memory repository implementations.
//
// Deterministic, dependency-free implementations of the repository interfaces,
// used by property/unit tests so the credits service, finalization idempotency,
// per-account isolation, and deletion semantics can be exercised at 100+
// iterations without Postgres or network. The semantics mirror the Postgres
// constraints: the ledger enforces at-most-one debit per (sessionId, type), and
// session finalization is a compare-and-set guard.

import type {
  Account,
  LedgerEntry,
  Profile,
  QnAEntry,
  SessionEndReason,
} from '@interview-assistant/shared'
import {
  LedgerUniqueViolation,
  type AccountsRepo,
  type LedgerRepo,
  type ProfilesRepo,
  type QnaRepo,
  type Repositories,
  type SessionRecord,
  type SessionsRepo,
  type UsageRecord,
  type UsageRepo,
} from './types'

/** The reserved identity reference used for the synthetic Dev_Account. */
export const DEV_ACCOUNT_IDENTITY_REF = 'dev-account'

let counter = 0
function nextId(prefix: string): string {
  counter += 1
  return `${prefix}-${counter}`
}

class MemoryAccountsRepo implements AccountsRepo {
  private readonly byRef = new Map<string, Account>()

  async findByIdentityRef(identityRef: string): Promise<Account | null> {
    return this.byRef.get(identityRef) ?? null
  }

  async provision(identityRef: string, email?: string): Promise<Account> {
    const existing = this.byRef.get(identityRef)
    if (existing) {
      // Mirror Postgres: refresh the stored email when a new one is supplied,
      // preserving the existing is_superuser flag (owner-managed).
      if (email !== undefined) existing.email = email
      return existing
    }
    const account: Account = {
      id: nextId('acct'),
      identityRef,
      createdAt: new Date().toISOString(),
      isSuperuser: false,
      ...(email !== undefined ? { email } : {}),
    }
    this.byRef.set(identityRef, account)
    return account
  }

  async setSuperuser(identityRef: string, value: boolean): Promise<Account> {
    const account = this.byRef.get(identityRef)
    if (!account) {
      throw new Error(`cannot set is_superuser: no account for identity ${identityRef}`)
    }
    account.isSuperuser = value
    return account
  }

  async getOrCreateDevAccount(): Promise<Account> {
    return this.provision(DEV_ACCOUNT_IDENTITY_REF)
  }
}

class MemoryProfilesRepo implements ProfilesRepo {
  private readonly byAccount = new Map<string, Profile>()
  async get(accountId: string): Promise<Profile | null> {
    return this.byAccount.get(accountId) ?? null
  }
  async upsert(accountId: string, profile: Profile): Promise<void> {
    this.byAccount.set(accountId, profile)
  }
}

class MemorySessionsRepo implements SessionsRepo {
  private readonly byId = new Map<string, SessionRecord>()

  async create(input: {
    accountId: string
    profileSnapshot: Profile
    enforcement: SessionRecord['enforcement']
  }): Promise<SessionRecord> {
    const record: SessionRecord = {
      id: nextId('sess'),
      accountId: input.accountId,
      profileSnapshot: input.profileSnapshot,
      startedAt: new Date().toISOString(),
      enforcement: input.enforcement,
    }
    this.byId.set(record.id, record)
    return record
  }

  async get(id: string): Promise<SessionRecord | null> {
    return this.byId.get(id) ?? null
  }

  async listByAccount(accountId: string): Promise<SessionRecord[]> {
    return [...this.byId.values()].filter((s) => s.accountId === accountId)
  }

  async markFinalized(
    id: string,
    endReason: SessionEndReason,
    finalizedAt: string
  ): Promise<boolean> {
    const s = this.byId.get(id)
    if (!s) return false
    if (s.finalizedAt !== undefined) return false // compare-and-set guard
    s.finalizedAt = finalizedAt
    s.endReason = endReason
    s.endedAt = finalizedAt
    return true
  }

  async deleteSession(id: string): Promise<void> {
    // Session row is retained; only the transcript/Q&A is deleted by QnaRepo.
    // (Ledger entries are retained per Req 20.4.) Kept as a no-op marker here.
    void id
  }
}

class MemoryLedgerRepo implements LedgerRepo {
  private readonly entries: LedgerEntry[] = []
  private readonly debitKeys = new Set<string>()

  async append(entry: LedgerEntry): Promise<void> {
    if (entry.type === 'usage-debit' || entry.type === 'non-enforced-debit') {
      if (entry.sessionId !== undefined) {
        const key = `${entry.sessionId}:${entry.type}`
        if (this.debitKeys.has(key)) {
          throw new LedgerUniqueViolation(entry.sessionId, entry.type)
        }
        this.debitKeys.add(key)
      }
    }
    this.entries.push({ ...entry })
  }

  async entriesByAccount(accountId: string): Promise<LedgerEntry[]> {
    return this.entries.filter((e) => e.accountId === accountId).map((e) => ({ ...e }))
  }
}

class MemoryUsageRepo implements UsageRepo {
  private readonly bySession = new Map<string, UsageRecord>()
  async upsertForSession(record: UsageRecord): Promise<void> {
    this.bySession.set(record.sessionId, { ...record })
  }
  async getForSession(sessionId: string): Promise<UsageRecord | null> {
    const r = this.bySession.get(sessionId)
    return r ? { ...r } : null
  }
}

class MemoryQnaRepo implements QnaRepo {
  private readonly bySession = new Map<string, QnAEntry[]>()
  async append(sessionId: string, _accountId: string, entry: QnAEntry): Promise<void> {
    const list = this.bySession.get(sessionId) ?? []
    list.push(entry)
    this.bySession.set(sessionId, list)
  }
  async listBySession(sessionId: string): Promise<QnAEntry[]> {
    return [...(this.bySession.get(sessionId) ?? [])]
  }
  async deleteBySession(sessionId: string): Promise<void> {
    this.bySession.delete(sessionId)
  }
}

/** Build a fresh set of in-memory repositories. */
export function createMemoryRepositories(): Repositories {
  return {
    accounts: new MemoryAccountsRepo(),
    profiles: new MemoryProfilesRepo(),
    sessions: new MemorySessionsRepo(),
    ledger: new MemoryLedgerRepo(),
    usage: new MemoryUsageRepo(),
    qna: new MemoryQnaRepo(),
  }
}
