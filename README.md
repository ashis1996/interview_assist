# Interview Assistant SaaS

A cross-platform desktop IT interview assistant, split into a thin Electron
client and a Node backend that share a pure domain core. During an interview the
client captures the interviewer's system audio, the backend transcribes it,
classifies topic/scope, builds a tailored prompt, and streams an LLM answer onto
a screen-capture-excluded overlay. Usage is metered by credits (enforced in
pre-prod/prod; bypassed in local/dev).

## Monorepo layout

```
packages/
  shared/    pure domain logic, shared types, client<->backend protocol, credit math
  backend/   Node service: auth verify, credits/metering, STT relay, LLM, session gateway
  desktop/   Electron client: auth, env selection, native audio capture, overlay UI
```

## Environments

| Environment | Auth        | Credits                          | Database          |
|-------------|-------------|----------------------------------|-------------------|
| local       | bypassed    | bypassed                         | local Postgres    |
| dev         | enforced    | enforced (superusers bypass)     | Supabase          |
| pre-prod    | enforced    | enforced                         | Supabase          |
| prod        | enforced    | enforced                         | Supabase          |

`local` exists for integration and performance testing — no sign-in, unlimited
usage. As of the dev release, `dev` **enforces** sign-in (Supabase JWKS) and
credits; accounts flagged `is_superuser` bypass credit enforcement per-account.
The backend fails safe to **enforced** if the environment is unknown.

## Local development (no Supabase, no cost)

Windows note: PowerShell may block `npm.ps1`. Either run `npm.cmd ...`, or once:
`Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`.

1. **Install dependencies** (from the repo root):
   ```
   npm.cmd install
   ```
2. **Start local Postgres** (schema is applied automatically):
   ```
   docker compose up -d
   ```
   No Docker? Install Postgres natively, create a `interview_assistant` database,
   and run `packages/backend/db/schema.sql` against it.
3. **Configure the backend**: copy `packages/backend/.env.example` to
   `packages/backend/.env` and set `DEEPGRAM_API_KEY` and `GEMINI_API_KEY`
   (keep `APP_ENVIRONMENT=local`). Never commit real keys.
4. **Run the backend** (listens on `:8787`):
   ```
   npm.cmd run dev --workspace @interview-assistant/backend
   ```
5. **Run the desktop client** (from the repo root):
   ```
   npm.cmd run dev
   ```
   In the app, select the **local** environment — sign-in is skipped — then
   **Start interview**.

## Deploying the Dev Release

The dev release runs the backend on Railway (as the `dev` environment) against
Supabase Postgres + Auth, and ships the desktop client as a Windows installer
that targets it. The full guide — required Railway service variables, the
startup migration, the desktop `MAIN_VITE_*` build vars, and security notes —
lives in [`packages/backend/README.md`](packages/backend/README.md#deploy-railway-dev).

## Scripts

- `npm.cmd test` — run all package test suites
- `npm.cmd run typecheck` — typecheck every package
- `npm.cmd run dev` — desktop client (electron-vite)
- `npm.cmd run dev --workspace @interview-assistant/backend` — backend (tsx watch)

## Testing

72 unit/property tests (fast-check + Vitest) cover the pure domain, credit
ledger, finalization idempotency, enforcement fail-safe, protocol round-trip,
auth, the LLM provider, and the session orchestrator. Live integration tests
(real Postgres / Supabase / Deepgram / WebSocket) require credentials to run.
