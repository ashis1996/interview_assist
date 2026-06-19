# Implementation Plan

## Overview

Tasks marked **(manual)** require your own accounts/credentials (Fly.io, Supabase) and are done by you with the agent's guidance; all other tasks are code changes the agent can implement and test. Order is incremental: backend host-readiness → env/auth reconciliation → superuser → desktop config/env → minimize-everywhere → branding/packaging → hardening → deploy & verify.

## Tasks

- [x] 1. Backend host-readiness: bind + startup migration
  - [x] 1.1 Change `packages/backend/index.ts` to bind `host: process.env.HOST ?? '0.0.0.0'` and `port: Number(process.env.PORT ?? 8787)`; keep the env-name log line.
  - [x] 1.2 Add `packages/backend/db/migrate.ts` exporting `runMigrations(pool)` that reads `db/schema.sql` and executes it (idempotent), plus a `npm run migrate` script.
  - [x] 1.3 Call `await runMigrations(pool)` in `startBackend()` before `httpApp.listen(...)`; on failure log and `process.exit(1)`.
  - [x] 1.4 Unit-test `runMigrations` idempotency (running twice is a no-op) using the in-memory/throwaway pattern or a guarded integration test.
  - _Requirements: 1.4, 1.5, 1.6, 1.7_
  - _Design: A, B_

- [x] 2. Backend environment reconciliation: enforce auth + credits in dev
  - [x] 2.1 Update `packages/backend/config/environment.ts`: `resolveAuthMode` and `resolveEnforcementMode` map `dev` → `enforced` (keep `local` → bypassed; unknown → enforced fail-safe).
  - [x] 2.2 Update the `environment.test.ts` expectations so `dev` now resolves to enforced for both auth and credits; add cases asserting `local` stays bypassed and unknown stays enforced.
  - _Requirements: 6.1, 6.5, 6.6, 7.5_
  - _Design: D_

- [x] 3. Superuser via DB flag + email-on-account (unlimited usage + monitoring)
  - [x] 3.1 Add to `db/schema.sql` (idempotent): `accounts.email text` and `accounts.is_superuser boolean NOT NULL DEFAULT false`.
  - [x] 3.2 Extend shared `Account` type with optional `email` and `isSuperuser`; update the Postgres `accounts` repo (`findByIdentityRef`, `provision`, `mapAccount`) to select/return them and upsert `email` on provision.
  - [x] 3.3 `authVerifier`: on enforced verification, read `email` from the JWT payload and pass it to `provision(sub, email)` so the account row carries a human-readable email for monitoring.
  - [x] 3.4 `sessionGateway.onAuth`: set `effectiveEnforcement = account.isSuperuser ? 'bypassed' : resolveEnforcementMode(env)` and use it for `preSessionCheck` and `sessions.create({ enforcement })`.
  - [x] 3.5 Optional owner bootstrap: in `index.ts`, read `SUPERUSER_BOOTSTRAP_EMAILS` and set `is_superuser=true` when a matching account is provisioned.
  - [x] 3.6 Tests: accounts repo maps/returns email + is_superuser; gateway integration — `is_superuser=true` account with zero balance starts and is never hard-stopped; regular dev account with zero balance is rejected; bootstrap email auto-flags on first provision.
  - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.7, 7.8_
  - _Design: E, F_

- [x] 4. Desktop environment resolution + build-time config injection
  - [x] 4.1 Update `electron.vite.config.ts` to surface `MAIN_VITE_*` build env to the main bundle (electron-vite env handling / define); document the required build vars.
  - [x] 4.2 Update `packages/desktop/main/envConfig.ts` so the `dev` entry reads `import.meta.env.MAIN_VITE_DEV_*` (with the existing `process.env` path retained for local runs).
  - [x] 4.3 Update `appController.activeEnvironment()` precedence: `process.env.APP_ENV` → `import.meta.env.MAIN_VITE_APP_ENV` → `app.isPackaged ? 'prod' : 'local'`.
  - [x] 4.4 Update `packages/desktop/main/envAuth.ts`: `dev` → `enforced`; update `App.tsx` `isBypassed` so `dev` requires sign-in (only `local` bypassed).
  - [x] 4.5 Unit-test `activeEnvironment()` precedence and `envConfig` dev-endpoint resolution; update `envAuth`/screen tests for dev=enforced.
  - _Requirements: 2.5, 4.1, 4.2, 4.3, 4.4, 4.5, 6.1, 6.2, 6.3, 6.4_
  - _Design: C, D_

- [x] 5. Minimize-to-pill on every screen
  - [x] 5.1 Extract `packages/desktop/renderer/components/CollapsedPill.tsx` from the Overlay's pill markup; accept an `onExpand` handler and render the brand mark.
  - [x] 5.2 Lift `collapsed` state into `App.tsx`; render `<CollapsedPill/>` at the app level whenever collapsed (any phase); expand restores the prior phase (no phase state change).
  - [x] 5.3 Add an always-present minimize button to the non-interview chrome (top bar); the interview overlay keeps its in-toolbar collapse button, both calling the lifted handler. Remove the Overlay's local collapsed state in favor of the app-level one.
  - [x] 5.4 Confirm `windowManager.setCollapsed()` / `setContentHeight` interplay still works app-wide and content protection is preserved on every screen.
  - [x] 5.5 Desktop unit/render test: collapse renders the pill on each phase; expand returns to the same phase; state preserved.
  - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_
  - _Design: G_

- [x] 6. Branding assets + in-app brand mark
  - [x] 6.1 Add `packages/desktop/build/icon.ico` (16–256px multi-size) and `icon.png` (512); add a simple placeholder logo asset acceptable for dev.
  - [x] 6.2 Add `packages/desktop/renderer/components/Logo.tsx` (In_App_Brand_Mark) and replace placeholder `BrainLogo` usages in the toolbar and `CollapsedPill`.
  - _Requirements: 5.1, 5.2, 5.4_
  - _Design: H_

- [x] 7. Windows packaging with electron-builder
  - [x] 7.1 Add `electron-builder` devDependency and `packages/desktop/electron-builder.yml` (appId, productName "Interview Assistant", `win.target nsis`, `win.icon build/icon.ico`, NSIS options, `files: out/** + package.json`).
  - [x] 7.2 Add scripts: `build:win` = `electron-vite build && electron-builder --win`; ensure externalized runtime deps are included and dev-only sources excluded.
  - [x] 7.3 Add product name/icon metadata so the window, taskbar, and installer use the icon (Req 5.3, 5.5).
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 5.2, 5.3, 5.5_
  - _Design: H, I_

- [x] 8. Release hardening + safe logging + missing-config handling
  - [x] 8.1 Add a small `redact()` helper and ensure no `accessToken`/`refreshToken`/Provider_Secret value is ever logged (audit existing `console.log`s in gateway/appController/authManager).
  - [x] 8.2 In `appController`, if the resolved `dev` `backendBaseUrl`/`sessionGatewayUrl` are empty at launch, show an explicit "can't reach configured backend" state instead of falling through to another environment.
  - [x] 8.3 Verify no Provider_Secret is referenced in desktop code / bundled into `out/` (only `MAIN_VITE_*` public values).
  - _Requirements: 2.3, 9.1, 9.2, 9.3, 9.4_
  - _Design: J_

- [x] 9. Containerization + deploy config (code) 
  - [x] 9.1 Add `packages/backend/Dockerfile` (monorepo-aware multi-stage: root `npm ci`, include `packages/shared` + `packages/backend`, run `npm run start --workspace @interview-assistant/backend`).
  - [x] 9.2 Add `packages/backend/railway.json` (Dockerfile build, health check path, restart policy); Railway injects `PORT` and provides the stable `*.up.railway.app` domain with edge TLS/WSS.
  - [x] 9.3 Add a deploy README section documenting required Railway service variables (APP_ENVIRONMENT=dev, DATABASE_URL, SUPABASE_URL, provider keys, optional SUPERUSER_BOOTSTRAP_EMAILS) and the desktop build vars (MAIN_VITE_*).
  - _Requirements: 1.1, 1.2, 1.3, 2.1, 2.2_
  - _Design: A, B, Data Models_

- [ ] 10. **(manual)** Provision hosted infra (Railway + Supabase)
  - [~] 10.1 Create the Supabase dev project; enable Email/Password + Google providers; add the desktop PKCE loopback redirect URL; copy the project URL + anon key + the Postgres `DATABASE_URL`.
  - [~] 10.2 Create the Railway project from the repo/Dockerfile; set service variables (provider keys, DATABASE_URL, SUPABASE_URL, APP_ENVIRONMENT=dev, optional SUPERUSER_BOOTSTRAP_EMAILS incl. owner); deploy; confirm the startup migration ran (incl. `accounts.email`/`is_superuser` and the profile columns) and that `/credits/balance` responds over HTTPS and the gateway accepts WSS at `*.up.railway.app`.
  - [~] 10.3 Confirm the owner→superuser path: sign in once (provisions the account), then verify `is_superuser=true` (via bootstrap email or by toggling it in the Supabase Table Editor); this is also the **monitoring** surface (browse `accounts`/`profiles`/`usage_records`).
  - _Requirements: 1.1, 1.2, 1.3, 1.8, 2.1, 2.2, 7.6_
  - _Design: A, F, Hosting_

- [ ] 11. **(manual)** Build, install, and verify the dev release
  - [ ] 11.1 Build the Windows installer with the `MAIN_VITE_*` dev vars set; produce the `.exe`.
  - [~] 11.2 Install on a clean Windows machine/VM; confirm it launches, shows the dev indicator, and requires sign-in.
  - [~] 11.3 Verify: superuser starts a session with zero balance; a regular dev account is blocked; minimize works from every screen with content protection; no secrets in the bundle or logs.
  - _Requirements: 3.2, 4.2, 4.5, 6.2, 7.3, 7.5, 8.1, 9.1_
  - _Design: Testing Strategy_

## Task Dependency Graph

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1", "2", "5", "6"], "rationale": "Independent code changes with no prerequisites." },
    { "wave": 2, "tasks": ["3", "4", "7", "9"], "rationale": "3 and 4 depend on dev-enforcement (2); 7 depends on branding (6); 9 depends on bind/migration (1)." },
    { "wave": 3, "tasks": ["8"], "rationale": "Hardening + missing-config handling builds on desktop env resolution (4)." },
    { "wave": 4, "tasks": ["10"], "rationale": "Manual infra provisioning needs superuser config (3) and deploy artifacts (9)." },
    { "wave": 5, "tasks": ["11"], "rationale": "Manual build + verify needs minimize (5), packaging (7), hardening (8), and a live backend (10)." }
  ]
}
```

```mermaid
graph TD
  T1[1. Backend bind + migration]
  T2[2. Enforce auth/credits in dev]
  T3[3. Superuser allow-list]
  T4[4. Desktop env + config injection]
  T5[5. Minimize on every screen]
  T6[6. Branding assets + brand mark]
  T7[7. electron-builder packaging]
  T8[8. Hardening + safe logging]
  T9[9. Dockerfile + fly.toml + deploy docs]
  T10[10. (manual) Provision infra]
  T11[11. (manual) Build + verify]

  T2 --> T3
  T1 --> T9
  T2 --> T4
  T3 --> T10
  T4 --> T8
  T6 --> T7
  T5 --> T11
  T7 --> T11
  T8 --> T11
  T9 --> T10
  T10 --> T11
```

## Notes

- Tasks 1–9 are agent-implementable code/config changes and can proceed without external accounts. Each finishes with a build/typecheck + its listed tests green.
- Tasks 10–11 are **manual** and require your Railway and Supabase accounts; the agent provides exact commands/values but cannot create your hosted resources or sign the build.
- Superusers reuse the existing `bypassed` credit path (effective enforcement), so no new enforcement logic is introduced — keep regular dev accounts under normal enforcement.
- Code signing is out of scope for the dev release; testers may see a Windows SmartScreen prompt (document in the README).
- Rotate any provider keys before configuring host secrets; never commit `.env` or bake secrets into the client (only `MAIN_VITE_*` public values).
- After Task 10, confirm the migration applied the `company`/`background` profile columns on the hosted DB before testing onboarding.
