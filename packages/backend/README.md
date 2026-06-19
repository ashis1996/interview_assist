# Interview Assistant — Backend

Node/Fastify backend: Supabase JWT verification, credits/metering, STT relay,
LLM provider, and the realtime session gateway. All provider secrets live here
(server-side only) and are never shipped to the desktop client.

For local development see the [repo root README](../../README.md).

## Deploy (Railway dev)

The dev release runs this backend on [Railway](https://railway.app) as the
`dev` environment against a Supabase-hosted Postgres + Auth. Railway terminates
TLS/WSS at its edge and serves the backend on a stable `*.up.railway.app`
domain, so the desktop client always reaches the same URL.

### How the deploy is wired

- **Build:** [`railway.json`](../../railway.json) (at the repo root, where Railway
  reads its config) pins a Dockerfile build at
  [`packages/backend/Dockerfile`](./Dockerfile). The Docker build context is the
  **repo root** (monorepo-aware: it runs `npm ci` at the root so the
  `@interview-assistant/shared` workspace resolves).
- **Health check:** Railway probes `GET /healthz`; the deploy is marked healthy
  once that responds.
- **Port:** Railway **injects `PORT`** and the backend binds `0.0.0.0:$PORT`.
  Do **not** hardcode or set a fixed `PORT` — let Railway provide it.
- **Startup migration:** on boot the backend applies
  [`db/schema.sql`](./db/schema.sql) automatically (idempotent). This converges
  the schema on every deploy, including the `accounts.email` and
  `accounts.is_superuser` columns and the `profiles.company` / `background`
  columns. If the migration fails, the process exits non-zero so the deploy is
  marked failed rather than serving a stale schema.

### Required Railway service variables

Set these as service variables in the Railway dashboard. Variable names match
[`config/secrets.ts`](./config/secrets.ts) exactly.

| Variable | Required | Purpose |
|---|---|---|
| `APP_ENVIRONMENT=dev` | Yes | Resolves the backend environment to `dev` → **auth + credits enforced** (superusers bypass per-account, see below). |
| `DATABASE_URL` | Yes | Supabase Postgres connection string (e.g. `postgresql://postgres:<pw>@db.<ref>.supabase.co:5432/postgres`). |
| `SUPABASE_URL` | Yes | Supabase project URL (e.g. `https://<ref>.supabase.co`). The backend derives `SUPABASE_JWKS_URL` and `SUPABASE_JWT_ISSUER` from this for JWT verification. |
| `DEEPGRAM_API_KEY` | Yes (if STT = deepgram) | Deepgram speech-to-text key. |
| `DEFAULT_STT_PROVIDER` | Recommended | `deepgram` \| `whisper` (default `deepgram`). |
| `DEFAULT_LLM_PROVIDER` | Recommended | `claude` \| `openai` \| `gemini` \| `groq` (default `claude`). |
| LLM provider key | Yes (matching the provider) | One of `GROQ_API_KEY`, `GEMINI_API_KEY`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` — must match `DEFAULT_LLM_PROVIDER`. |
| `DEFAULT_LLM_MODEL` | Optional | Override the provider's default model (e.g. `gemini-2.5-flash`, `llama-3.3-70b-versatile`). |
| `SUPABASE_SERVICE_ROLE_KEY` | Optional | Server-only; only if admin operations need it. Never expose to the client. |
| `SUPERUSER_BOOTSTRAP_EMAILS` | Optional | Comma-separated emails (include the owner). When a matching account is first provisioned, its `is_superuser` flag is auto-set to `true`. |
| `LOW_CREDIT_THRESHOLD` | Optional | Low-credit warning threshold (default `5`). |
| `CREDITS_PER_STT_MINUTE` | Optional | Credit conversion rate for STT minutes (default `1`). |
| `CREDITS_PER_LLM_TOKEN` | Optional | Credit conversion rate per LLM token (default `0.0001`). |

> **Do not set `PORT`.** Railway injects it; the backend reads `process.env.PORT`
> and binds `0.0.0.0:$PORT`. `HOST` also defaults to `0.0.0.0` and rarely needs
> setting.

### Auth + credits in dev (changed for the dev release)

The dev release **enforces** authentication and credits in `dev` — this differs
from the earlier behavior where dev bypassed both:

- **Auth:** every request must carry a valid Supabase access token, verified via
  the Supabase JWKS derived from `SUPABASE_URL`. Absent, expired, or invalid
  tokens are rejected.
- **Credits:** regular accounts are subject to the pre-session credit check and
  the credit-exhaustion hard stop.
- **Superusers:** an account with `is_superuser = true` bypasses credit
  enforcement per-account (sessions always authorized, never hard-stopped) while
  usage is still recorded. Set the flag via `SUPERUSER_BOOTSTRAP_EMAILS` or by
  toggling `accounts.is_superuser` in the Supabase Table Editor. Changes take
  effect on the account's next session — no redeploy or client rebuild needed.

Only `local` bypasses auth + credits. Unknown environments fail safe to
enforced.

### Supabase project setup (dev)

- Enable the Email/Password and Google providers.
- Add the desktop loopback redirect URL (used by the PKCE flow) to the allowed
  redirect list.
- Copy the project URL, the publishable (anon) key, and the Postgres
  `DATABASE_URL` for use in the Railway variables (backend) and the desktop
  build vars (client, see below).

## Desktop build-time variables (`MAIN_VITE_*`)

The desktop installer bakes its `dev` endpoints + Supabase publishable key at
build time. These are **public values, not secrets** (the anon key is designed
to ship in clients; the URLs are public endpoints). **No Provider_Secret ever
belongs in the client.** Full reference:
[`packages/desktop/.env.example`](../desktop/.env.example).

| Variable | Purpose |
|---|---|
| `MAIN_VITE_APP_ENV=dev` | Packaged build resolves its environment to `dev`. |
| `MAIN_VITE_DEV_BACKEND_URL` | HTTPS endpoint, e.g. `https://<app>.up.railway.app`. |
| `MAIN_VITE_DEV_GATEWAY_URL` | WSS endpoint, e.g. `wss://<app>.up.railway.app`. |
| `MAIN_VITE_DEV_SUPABASE_URL` | Supabase project URL (public). |
| `MAIN_VITE_DEV_SUPABASE_ANON_KEY` | Supabase publishable (anon) key (public). |

## Security notes

- Provider secrets (Deepgram, LLM, Supabase service-role key) live **only** on
  the host (Railway service variables). They are never bundled into the desktop
  client and never returned in any client-facing response.
- **Never commit `.env`** — it is gitignored. Commit only `.env.example`.
- **Rotate any keys** that may have been shared before configuring them as host
  secrets.
- Code signing is **out of scope** for the dev release — testers may see a
  Windows SmartScreen prompt when running the installer.
