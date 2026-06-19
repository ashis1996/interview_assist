// Postgres-backed repository implementations (Req 17).
//
// Production persistence for the repository interfaces. The pure session
// transforms and credit math live in @interview-assistant/shared; this layer is
// the thin SQL boundary. Account-scoped reads + the append-only ledger + the
// one-debit-per-session unique index enforce the data invariants at the database
// (see db/schema.sql).

import type { Pool } from 'pg'
import type {
  Account,
  Profile,
  QnAEntry,
  SessionEndReason,
} from '@interview-assistant/shared'
import type { LedgerEntry } from '@interview-assistant/shared'
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

export const DEV_ACCOUNT_IDENTITY_REF = 'dev-account'

/** Postgres unique-violation error code. */
const PG_UNIQUE_VIOLATION = '23505'

function mapAccount(row: {
  id: string
  identity_ref: string
  created_at: Date
  email?: string | null
  is_superuser?: boolean | null
}): Account {
  return {
    id: row.id,
    identityRef: row.identity_ref,
    createdAt: row.created_at.toISOString(),
    ...(row.email != null ? { email: row.email } : {}),
    isSuperuser: row.is_superuser ?? false,
  }
}

function mapSession(row: Record<string, unknown>): SessionRecord {
  return {
    id: row['id'] as string,
    accountId: row['account_id'] as string,
    profileSnapshot: row['profile_snapshot'] as Profile,
    startedAt: (row['started_at'] as Date).toISOString(),
    endedAt: row['ended_at'] ? (row['ended_at'] as Date).toISOString() : undefined,
    endReason: (row['end_reason'] as SessionEndReason) ?? undefined,
    finalizedAt: row['finalized_at'] ? (row['finalized_at'] as Date).toISOString() : undefined,
    enforcement: row['enforcement'] as SessionRecord['enforcement'],
  }
}

export function createPostgresRepositories(pool: Pool): Repositories {
  const accounts: AccountsRepo = {
    async findByIdentityRef(identityRef) {
      const { rows } = await pool.query(
        'SELECT id, identity_ref, created_at, email, is_superuser FROM accounts WHERE identity_ref = $1',
        [identityRef]
      )
      return rows[0] ? mapAccount(rows[0]) : null
    },
    async provision(identityRef, email) {
      // Upsert the email so it stays current on every sign-in (Req 7.2); only
      // overwrite the stored email when a non-null value is supplied so the
      // Dev_Account / email-less provisions don't clear an existing email.
      // is_superuser is left untouched (owner-managed; Req 7.7).
      const { rows } = await pool.query(
        `INSERT INTO accounts (identity_ref, email) VALUES ($1, $2)
         ON CONFLICT (identity_ref) DO UPDATE SET
           email = COALESCE(EXCLUDED.email, accounts.email)
         RETURNING id, identity_ref, created_at, email, is_superuser`,
        [identityRef, email ?? null]
      )
      return mapAccount(rows[0])
    },
    async setSuperuser(identityRef, value) {
      // Owner bootstrap (Req 7.8): explicitly set the flag for an existing
      // account. Only ever called with `true` on first provision; owner-managed
      // toggles via the dashboard remain the source of truth (Req 7.7).
      const { rows } = await pool.query(
        `UPDATE accounts SET is_superuser = $2 WHERE identity_ref = $1
         RETURNING id, identity_ref, created_at, email, is_superuser`,
        [identityRef, value]
      )
      return mapAccount(rows[0])
    },
    async getOrCreateDevAccount() {
      return this.provision(DEV_ACCOUNT_IDENTITY_REF)
    },
  }

  const profiles: ProfilesRepo = {
    async get(accountId) {
      const { rows } = await pool.query('SELECT * FROM profiles WHERE account_id = $1', [accountId])
      const r = rows[0]
      if (!r) return null
      return {
        name: r.name,
        targetRole: r.target_role,
        experienceYears: r.experience_years,
        roleCategories: r.role_categories,
        seniority: r.seniority,
        skills: r.skills,
        companyType: r.company_type,
        ...(r.company ? { company: r.company } : {}),
        ...(r.background ? { background: r.background } : {}),
      } as Profile
    },
    async upsert(accountId, p) {
      await pool.query(
        `INSERT INTO profiles
           (account_id, name, target_role, experience_years, role_categories, seniority, skills, company_type, company, background, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now())
         ON CONFLICT (account_id) DO UPDATE SET
           name=$2, target_role=$3, experience_years=$4, role_categories=$5,
           seniority=$6, skills=$7, company_type=$8, company=$9, background=$10, updated_at=now()`,
        [
          accountId,
          p.name,
          p.targetRole,
          p.experienceYears,
          p.roleCategories,
          p.seniority,
          p.skills,
          p.companyType,
          p.company ?? null,
          p.background ?? null,
        ]
      )
    },
  }

  const sessions: SessionsRepo = {
    async create(input) {
      const { rows } = await pool.query(
        `INSERT INTO sessions (account_id, profile_snapshot, enforcement)
         VALUES ($1, $2, $3) RETURNING *`,
        [input.accountId, input.profileSnapshot, input.enforcement]
      )
      return mapSession(rows[0])
    },
    async get(id) {
      const { rows } = await pool.query('SELECT * FROM sessions WHERE id = $1', [id])
      return rows[0] ? mapSession(rows[0]) : null
    },
    async listByAccount(accountId) {
      const { rows } = await pool.query(
        'SELECT * FROM sessions WHERE account_id = $1 ORDER BY started_at DESC',
        [accountId]
      )
      return rows.map(mapSession)
    },
    async markFinalized(id, endReason, finalizedAt) {
      // Compare-and-set: only the first finalization sets finalized_at (Req 12.7).
      const { rowCount } = await pool.query(
        `UPDATE sessions SET finalized_at = $2, ended_at = $2, end_reason = $3
         WHERE id = $1 AND finalized_at IS NULL`,
        [id, finalizedAt, endReason]
      )
      return (rowCount ?? 0) > 0
    },
    async deleteSession(id) {
      // Detach ledger entries (retain per Req 20.4) then delete the session;
      // qna_entries cascade. The ledger.session_id ON DELETE SET NULL preserves
      // the debit entry.
      await pool.query('DELETE FROM sessions WHERE id = $1', [id])
    },
  }

  const ledger: LedgerRepo = {
    async append(entry: LedgerEntry) {
      try {
        await pool.query(
          `INSERT INTO credit_ledger (id, account_id, type, amount, session_id, created_at)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [entry.id, entry.accountId, entry.type, entry.amount, entry.sessionId ?? null, entry.createdAt]
        )
      } catch (err) {
        if ((err as { code?: string }).code === PG_UNIQUE_VIOLATION) {
          throw new LedgerUniqueViolation(entry.sessionId ?? 'unknown', entry.type)
        }
        throw err
      }
    },
    async entriesByAccount(accountId) {
      const { rows } = await pool.query(
        'SELECT * FROM credit_ledger WHERE account_id = $1 ORDER BY created_at ASC',
        [accountId]
      )
      return rows.map((r) => ({
        id: r.id,
        accountId: r.account_id,
        type: r.type,
        amount: Number(r.amount),
        sessionId: r.session_id ?? undefined,
        createdAt: (r.created_at as Date).toISOString(),
      }))
    },
  }

  const usage: UsageRepo = {
    async upsertForSession(record: UsageRecord) {
      await pool.query(
        `INSERT INTO usage_records (session_id, account_id, stt_minutes, llm_tokens, latency_ms)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (session_id) DO UPDATE SET
           stt_minutes = $3, llm_tokens = $4, latency_ms = $5`,
        [
          record.sessionId,
          record.accountId,
          record.sttMinutes,
          Math.round(record.llmTokens),
          record.latencyMs ? JSON.stringify(record.latencyMs) : null,
        ]
      )
    },
    async getForSession(sessionId) {
      const { rows } = await pool.query('SELECT * FROM usage_records WHERE session_id = $1', [
        sessionId,
      ])
      const r = rows[0]
      if (!r) return null
      return {
        sessionId: r.session_id,
        accountId: r.account_id,
        sttMinutes: Number(r.stt_minutes),
        llmTokens: Number(r.llm_tokens),
        latencyMs: r.latency_ms ?? undefined,
      }
    },
  }

  const qna: QnaRepo = {
    async append(sessionId, accountId, entry: QnAEntry) {
      await pool.query(
        `INSERT INTO qna_entries (session_id, account_id, seq, question, answer, topics, scope, created_at)
         VALUES ($1,$2,(SELECT COALESCE(MAX(seq),0)+1 FROM qna_entries WHERE session_id=$1),$3,$4,$5,$6,$7)`,
        [sessionId, accountId, entry.question, entry.answer, entry.topics, entry.scope, entry.timestamp]
      )
    },
    async listBySession(sessionId) {
      const { rows } = await pool.query(
        'SELECT * FROM qna_entries WHERE session_id = $1 ORDER BY seq ASC',
        [sessionId]
      )
      return rows.map((r) => ({
        question: r.question,
        answer: r.answer,
        topics: r.topics,
        scope: r.scope,
        timestamp: (r.created_at as Date).toISOString(),
      }))
    },
    async deleteBySession(sessionId) {
      await pool.query('DELETE FROM qna_entries WHERE session_id = $1', [sessionId])
    },
  }

  return { accounts, profiles, sessions, ledger, usage, qna }
}
