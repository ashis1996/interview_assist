// Repository interfaces for the Backend persistence layer.
//
// Defining the persistence surface as interfaces lets the credits service and
// orchestrator be property-/unit-tested against a deterministic in-memory model
// (repos/memory.ts) while production uses the Postgres implementation
// (repos/postgres.ts). Entities reuse the shared types where possible.

import type {
  Account,
  EnforcementMode,
  LedgerEntry,
  Profile,
  QnAEntry,
  SessionEndReason,
} from '@interview-assistant/shared'

/** A persisted interview session row (Req 17.4). */
export interface SessionRecord {
  id: string
  accountId: string
  profileSnapshot: Profile
  startedAt: string
  endedAt?: string
  endReason?: SessionEndReason
  /** Set exactly once when the session is finalized (idempotency guard, Req 12.7). */
  finalizedAt?: string
  /** The enforcement mode in effect at session start. */
  enforcement: EnforcementMode
}

/** A metered usage record for a session (Req 17.6). */
export interface UsageRecord {
  sessionId: string
  accountId: string
  sttMinutes: number
  llmTokens: number
  /** Per-stage latency measurements (Req 16.3), keyed by stage name. */
  latencyMs?: Record<string, number>
}

/** Thrown by {@link LedgerRepo.append} when a duplicate debit for a session is rejected. */
export class LedgerUniqueViolation extends Error {
  constructor(sessionId: string, type: string) {
    super(`duplicate ledger entry for session ${sessionId} of type ${type}`)
    this.name = 'LedgerUniqueViolation'
  }
}

/** Accounts: provision-on-first-sign-in and Dev_Account lookup (Req 1.9, 17.1). */
export interface AccountsRepo {
  findByIdentityRef(identityRef: string): Promise<Account | null>
  /**
   * Create an Account for a verified identity (with an empty ledger implicitly).
   * When `email` is supplied it is upserted so the stored email stays current
   * for monitoring (Req 7.2); the existing `is_superuser` flag is preserved.
   */
  provision(identityRef: string, email?: string): Promise<Account>
  /**
   * Set (or clear) the `is_superuser` flag for an existing account, returning
   * the updated Account. Used by the optional owner bootstrap to auto-grant
   * superuser on first provision (Req 7.8); the DB flag remains the source of
   * truth and is otherwise owner-managed (Req 7.7).
   */
  setSuperuser(identityRef: string, value: boolean): Promise<Account>
  /** The fixed synthetic Dev_Account for auth-bypassed environments (Req 1.12). */
  getOrCreateDevAccount(): Promise<Account>
}

/** Profiles: one current profile per account (Req 17.2). Replaces v1 local file. */
export interface ProfilesRepo {
  get(accountId: string): Promise<Profile | null>
  upsert(accountId: string, profile: Profile): Promise<void>
}

/** Sessions: lifecycle + finalization guard (Req 12, 17.4). */
export interface SessionsRepo {
  create(input: {
    accountId: string
    profileSnapshot: Profile
    enforcement: EnforcementMode
  }): Promise<SessionRecord>
  get(id: string): Promise<SessionRecord | null>
  listByAccount(accountId: string): Promise<SessionRecord[]>
  /**
   * Atomically set `finalizedAt`/`endReason` iff not already finalized.
   * Returns true when this call performed the finalization, false if the
   * session was already finalized (idempotency, Req 12.7).
   */
  markFinalized(id: string, endReason: SessionEndReason, finalizedAt: string): Promise<boolean>
  /** Delete a session's transcript/Q&A; ledger entries are retained (Req 20.4). */
  deleteSession(id: string): Promise<void>
}

/** Append-only credit ledger (Req 11). */
export interface LedgerRepo {
  /** Append an entry. Throws {@link LedgerUniqueViolation} on a duplicate session debit. */
  append(entry: LedgerEntry): Promise<void>
  entriesByAccount(accountId: string): Promise<LedgerEntry[]>
}

/** Usage records per session (Req 17.6, 9). */
export interface UsageRepo {
  upsertForSession(record: UsageRecord): Promise<void>
  getForSession(sessionId: string): Promise<UsageRecord | null>
}

/** Persisted Q&A history per session (Req 17.5). */
export interface QnaRepo {
  append(sessionId: string, accountId: string, entry: QnAEntry): Promise<void>
  listBySession(sessionId: string): Promise<QnAEntry[]>
  deleteBySession(sessionId: string): Promise<void>
}

/** Aggregate of all repositories, injected into the credits service / gateway. */
export interface Repositories {
  accounts: AccountsRepo
  profiles: ProfilesRepo
  sessions: SessionsRepo
  ledger: LedgerRepo
  usage: UsageRepo
  qna: QnaRepo
}
