-- Interview Assistant SaaS — Postgres schema (per-environment Supabase project).
--
-- Each environment (dev / pre-prod / prod) is a SEPARATE Supabase project, so
-- isolation across environments is structural (Req 19.6, 19.7). Within a
-- project, every user-owned table carries account_id and is protected by RLS so
-- a user reads only their own rows (Req 17.7, 20.5).

-- Accounts: one per verified identity. Provisioned on first sign-in (Req 1.9, 17.1).
-- In auth-bypassed environments (local/dev) a fixed synthetic Dev_Account row is
-- seeded with a reserved identity_ref ('dev-account') and used to attribute all
-- Sessions/usage/ledger entries (Req 1.12, 19.8).
CREATE TABLE IF NOT EXISTS accounts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  identity_ref  text NOT NULL UNIQUE,          -- Supabase auth user id (sub), or 'dev-account'
  created_at    timestamptz NOT NULL DEFAULT now()
);
-- Migration for existing databases (idempotent). email is captured from the JWT
-- for human-readable monitoring; is_superuser grants unlimited (bypassed) usage
-- via the existing effective-enforcement path (Req 7.1-7.5, 7.7, 7.8).
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS email        text;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS is_superuser boolean NOT NULL DEFAULT false;

-- Profiles: one current profile per account (Req 17.2). Replaces the v1 local file.
CREATE TABLE IF NOT EXISTS profiles (
  account_id        uuid PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
  name              text NOT NULL,
  target_role       text NOT NULL,
  experience_years  int  NOT NULL CHECK (experience_years BETWEEN 0 AND 60),
  role_categories   text[] NOT NULL,
  seniority         text NOT NULL,             -- Junior|Mid|Senior|Staff|Principal
  skills            text[] NOT NULL,
  company_type      text NOT NULL,             -- Startup|Product|Service|FAANG
  company           text,                      -- specific company being interviewed at
  background        text,                      -- resume summary / pasted background
  updated_at        timestamptz NOT NULL DEFAULT now()
);
-- Migration for existing databases (idempotent).
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS company    text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS background text;

-- Sessions: one per interview, with end reason and timing (Req 17.4, 12).
CREATE TABLE IF NOT EXISTS sessions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id       uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  profile_snapshot jsonb NOT NULL,             -- frozen Profile at session start
  started_at       timestamptz NOT NULL DEFAULT now(),
  ended_at         timestamptz,
  end_reason       text,                       -- user-ended|credits-exhausted|disconnected
  finalized_at     timestamptz,                -- exactly-once finalization guard (Req 12.7)
  enforcement      text NOT NULL               -- enforced|bypassed at session time
);
CREATE INDEX IF NOT EXISTS sessions_account_started_idx ON sessions(account_id, started_at DESC);

-- Transcript / Q&A history: one row per finalized Q&A pair (Req 17.5).
-- Deletable on session deletion; the ledger entry is retained (Req 20.4).
CREATE TABLE IF NOT EXISTS qna_entries (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id  uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  seq         int  NOT NULL,
  question    text NOT NULL,
  answer      text NOT NULL,
  topics      text[] NOT NULL,
  scope       text NOT NULL,                   -- in-scope|adjacent|out-of-scope
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (session_id, seq)
);

-- Append-only credit ledger (Req 11). Balance = SUM over enforced-affecting rows (Req 11.2).
CREATE TABLE IF NOT EXISTS credit_ledger (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE RESTRICT,
  type        text NOT NULL,                   -- usage-debit|non-enforced-debit|purchase-credit
  amount      numeric NOT NULL,                -- signed; debits negative, credits positive
  session_id  uuid REFERENCES sessions(id) ON DELETE SET NULL,  -- retained after session delete (Req 20.4)
  created_at  timestamptz NOT NULL DEFAULT now()
);
-- Exactly-once: at most one debit per session (Req 12.7).
CREATE UNIQUE INDEX IF NOT EXISTS one_debit_per_session
  ON credit_ledger(session_id, type)
  WHERE type IN ('usage-debit', 'non-enforced-debit');
-- Append-only: no UPDATE or DELETE permitted (Req 11.3). Corrections are made by
-- appending compensating entries.
REVOKE UPDATE, DELETE ON credit_ledger FROM PUBLIC;

-- Usage records: metered STT minutes + LLM tokens per session (Req 17.6, 9).
CREATE TABLE IF NOT EXISTS usage_records (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id   uuid NOT NULL UNIQUE REFERENCES sessions(id) ON DELETE CASCADE,
  account_id   uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  stt_minutes  numeric NOT NULL DEFAULT 0,
  llm_tokens   bigint  NOT NULL DEFAULT 0,
  latency_ms   jsonb,                          -- per-stage latency (Req 16.3)
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Row-Level Security: restrict every user-owned table to the owning account.
-- The backend uses the service role for writes; these policies defend reads
-- exposed via PostgREST/anon and document the isolation intent (Req 17.7, 20.5).
ALTER TABLE profiles      ENABLE ROW LEVEL SECURITY;
ALTER TABLE sessions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE qna_entries   ENABLE ROW LEVEL SECURITY;
ALTER TABLE credit_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE usage_records ENABLE ROW LEVEL SECURITY;

-- Seed the synthetic Dev_Account used by auth-bypassed environments (Req 1.12).
INSERT INTO accounts (identity_ref)
VALUES ('dev-account')
ON CONFLICT (identity_ref) DO NOTHING;
