# Implementation Plan: Interview Assistant SaaS (v2)

## Overview

This plan implements the v2 SaaS by **reusing, not rewriting** the v1 codebase. The guiding principle from the design's reuse map is honored throughout: v1's pure, fully property-tested domain modules are **relocated** verbatim into a shared package, the v1 boundary modules (`llmProvider`, `answerPipeline`, `windowManager`, `sidecarBridge`, `bridge`) are **modified/repurposed** in place, and only the genuinely new cloud surfaces (auth verification, credits/metering, the realtime session gateway, Postgres persistence, native audio capture) are written from scratch.

The work is ordered to minimize risk and orphaned code:

1. **Shared package first** — relocate the Tier-1 pure modules + their property tests, then add the new pure cores (`protocol.ts`, `credits.ts`, `resolveEnforcementMode`). Front-loading the property tests validates the reused + new pure logic before any I/O is layered on.
2. **Backend** — config/secrets, Postgres schema + repositories, auth verifier, credits service, STT relay, modified LLM provider, modified session orchestrator, and the WebSocket session gateway.
3. **Desktop client** — env config, token store, auth manager, the repurposed backend session client, native audio capture, reused window manager, extended IPC/preload, and the new renderer screens.
4. **End-to-end wiring, integration tests, smoke tests, and latency verification.**

Each task is annotated as **[RELOCATE]** (move existing v1 files + tests verbatim), **[MODIFY]** / **[REPURPOSE]** (keep v1 logic/shape, change a boundary), or **[NEW]** (write new code) so the implementer reuses rather than recreates.

The implementation language is **TypeScript** (matching v1). Property-based tests use **fast-check** with **Vitest**, run a minimum of 100 iterations each, and are tagged with a comment in the form `// Feature: interview-assistant-saas, Property {number}: {property_text}`.

## Tasks

- [x] 1. Establish the monorepo and shared package skeleton
  - [x] 1.1 Scaffold the monorepo workspace and package layout
    - **[NEW]** Create the workspace root (npm/pnpm workspaces) with `packages/shared`, `packages/backend`, `packages/desktop`
    - Configure TypeScript project references, a shared `tsconfig.base.json`, and Vitest + `fast-check` as dev dependencies at the workspace level
    - Ensure `packages/shared` builds as a pure library (no Electron, no Node-server, no SDK imports) importable by both `backend` and `desktop`
    - _Requirements: 18.6, 19.6_

  - [x] 1.2 Relocate and extend shared types and mappings
    - **[RELOCATE]** Move v1 `src/shared/types.ts` (`Profile`, `QnAEntry`, `SessionFile`, `SeniorityLevel`, `CompanyType`, `TopicDomain`, `ScopeClassification`, enums) and `src/shared/mappings.ts` (role adjacency + topic-role maps) into `packages/shared/types.ts` and `packages/shared/mappings.ts`
    - **[NEW]** Add SaaS types alongside: `Account`, `SttProviderName`, `UsageSummary`, `SessionEndReason`, `Environment`, `EnforcementMode`
    - _Requirements: 14.2, 17.1, 17.2_

- [x] 2. Relocate Tier-1 pure domain modules with their property tests
  - [x] 2.1 Relocate the scope/topic/prompt domain modules
    - **[RELOCATE]** Move `topicDetector.ts`, `scopeChecker.ts`, `scopeColor.ts`, `promptBuilder.ts` from `src/main/domain` into `packages/shared/domain` verbatim, updating only import paths to the relocated `types.ts`/`mappings.ts`
    - _Requirements: 6.7, 14.1, 14.2, 14.3, 14.4, 14.5, 14.6, 14.7_

  - [x]* 2.2 Relocate the scope classification property test
    - **[RELOCATE]** Move `scopeChecker.test.ts` into `packages/shared/__tests__` verbatim
    - **Property 10: Scope classification is total (reused)**
    - **Validates: Requirements 14.2, 14.3**

  - [x]* 2.3 Relocate the prompt/topic/scope-color property tests
    - **[RELOCATE]** Move `promptBuilder.contentInvariants.test.ts`, `promptBuilder.scopeFraming.test.ts`, `topicDetector.test.ts`, `scopeColor.test.ts` into `packages/shared/__tests__` verbatim
    - Re-tag each with `// Feature: interview-assistant-saas, Property {n}: {text}` while preserving the existing assertions
    - _Requirements: 14.1, 14.4, 14.5, 14.6, 14.7, 6.7_

  - [x] 2.4 Relocate the STT endpointing pure reducers
    - **[RELOCATE]** Move `sttFinalize.ts` and `sttThreshold.ts` from `src/main/domain` into `packages/shared/domain` verbatim
    - _Requirements: 13.5, 13.6, 13.7_

  - [x]* 2.5 Relocate the silence-threshold property test
    - **[RELOCATE]** Move `sttThreshold.test.ts` into `packages/shared/__tests__` verbatim
    - **Property 11: Silence-threshold clamping (reused)**
    - **Validates: Requirements 13.6**

  - [x]* 2.6 Relocate the STT finalization property test
    - **[RELOCATE]** Move `sttFinalize.test.ts` into `packages/shared/__tests__` verbatim
    - _Requirements: 13.5, 13.7_

  - [x] 2.7 Relocate session serialization and profile domain modules
    - **[RELOCATE]** Move `session.ts` (serialize/deserialize/markdown), `profileMerge.ts`, `profileValidation.ts`, `llmResolve.ts` from `src/main/domain` into `packages/shared/domain` verbatim
    - _Requirements: 7.5, 15.2, 15.3, 15.4, 17.2_

  - [x]* 2.8 Relocate session, profile, and LLM-resolve property tests
    - **[RELOCATE]** Move `session.roundTrip.test.ts`, `session.markdown.test.ts`, `profileMerge.test.ts`, `profileValidation.confirmationGate.test.ts`, `profileValidation.fieldRange.test.ts`, `llmResolve.providerResolution.test.ts`, `llmResolve.modelDefault.test.ts` into `packages/shared/__tests__` verbatim
    - _Requirements: 7.5, 15.2, 15.3, 15.4, 17.2_

  - [x] 2.9 Relocate client-side spatial/toggle pure modules
    - **[RELOCATE]** Move `geometry.ts` and `captureToggle.ts` from `src/main/domain` into `packages/shared/domain` verbatim (consumed by the desktop client)
    - _Requirements: 4.3, 6.1_

  - [x]* 2.10 Relocate geometry and capture-toggle property tests
    - **[RELOCATE]** Move `geometry.position.test.ts`, `geometry.size.test.ts`, `geometry.opacity.test.ts`, `captureToggle.test.ts` into `packages/shared/__tests__` verbatim
    - _Requirements: 4.3, 6.1_

- [x] 3. Implement the new pure protocol and credit cores
  - [x] 3.1 Implement the client<->backend session protocol
    - **[NEW/REPURPOSE]** Evolve v1 `shared/bridge.ts` into `packages/shared/protocol.ts`: define `ClientToServer` (`auth`, `start_session`, `capture_state`, `stop_session`) and `ServerToClient` (`auth_ok`, `auth_error`, `partial_transcript`, `final_question`, `topics`, `scope`, `answer_token`, `answer_complete`, `stt_error`, `answer_error`, `low_credit_warning`, `session_summary`, `session_ended`) unions, preserving the four reused v1 event names
    - Implement `encode`/`decode` for JSON text frames where malformed input decodes to a recognized "ignored" result rather than throwing
    - _Requirements: 5.4, 5.5, 5.6, 5.7, 10.1, 12.6_

  - [x]* 3.2 Write property test for protocol message round-trip
    - **[NEW]** `packages/shared/__tests__`
    - **Property 9: Session protocol message round-trip**
    - **Validates: Requirements 5.4, 5.5, 5.6, 5.7, 10.1, 12.6**

  - [x] 3.3 Implement the pure credits core
    - **[NEW]** Create `packages/shared/credits.ts` with `ConversionRate`, `Usage`, `LedgerEntry`, `LedgerEntryType` types and pure functions `usageToCredits(rate, u)` and `ledgerBalance(entries)` (sum of balance-affecting entries, excluding `non-enforced-debit`)
    - _Requirements: 9.3, 11.2, 11.4, 11.5_

  - [x]* 3.4 Write property test for credit balance summation
    - **[NEW]** `packages/shared/__tests__`
    - **Property 1: Credit balance equals the sum of ledger entries**
    - **Validates: Requirements 11.2**

  - [x]* 3.5 Write property test for Conversion_Rate monotonicity and non-negativity
    - **[NEW]** `packages/shared/__tests__`
    - **Property 3: Conversion_Rate is monotonic and non-negative**
    - **Validates: Requirements 9.3**

  - [x] 3.6 Implement the enforcement-mode and auth-mode resolution functions
    - **[NEW]** Create `packages/backend/config/environment.ts` exporting `EnforcementMode` + `resolveEnforcementMode(env)` and `AuthMode` + `resolveAuthMode(env)`: each `bypassed` only for `local`/`dev`, `enforced` for `pre-prod`/`prod` and every missing/unknown input (fail-safe)
    - _Requirements: 19.1, 19.2, 19.3, 19.4, 19.5, 19.8, 19.9, 19.10_

  - [x]* 3.7 Write property test for enforcement-mode resolution totality
    - **[NEW]** `packages/backend/__tests__` (pure functions under test)
    - **Property 6: Enforcement-mode resolution is total and fails safe to enforced**
    - **Validates: Requirements 19.1, 19.2, 19.3, 19.4, 19.5, 19.8, 19.9, 19.10**

- [x] 4. Checkpoint - shared package complete
  - Ensure all tests pass (relocated v1 PBT + new pure-core PBT), ask the user if questions arise.

- [x] 5. Implement backend configuration and secrets
  - [x] 5.1 Implement server-side secrets and environment resolution
    - **[NEW]** Create `packages/backend/config/secrets.ts` sourcing all provider API keys (Deepgram, OpenAI, Anthropic, Gemini) and the Supabase service-role key from server-side storage/env only; wire `environment.ts` to derive the per-instance `EnforcementMode` via `resolveEnforcementMode`
    - Ensure each provider key is exposed only to its own provider client and never serialized to any client-facing response
    - _Requirements: 18.1, 18.2, 18.4, 18.6, 19.4, 19.5_

- [x] 6. Implement Postgres schema, migrations, and repositories
  - [x] 6.1 Author the Postgres schema and migrations
    - **[NEW]** Create migrations for `accounts`, `profiles`, `sessions`, `qna_entries`, `credit_ledger`, `usage_records` per the design DDL
    - Include the `one_debit_per_session` partial unique index on `credit_ledger(session_id, type)`, `REVOKE UPDATE, DELETE ON credit_ledger`, the `ON DELETE SET NULL` on `credit_ledger.session_id`, and Row-Level Security policies scoping every user-owned table to the owning account
    - **[NEW]** Add a seed migration creating the fixed synthetic Dev_Account row (reserved `identity_ref`) used to attribute Sessions/usage/ledger in auth-bypassed environments
    - _Requirements: 11.1, 11.3, 11.4, 12.7, 17.1, 17.2, 17.4, 17.5, 17.6, 17.7, 19.6, 19.8, 20.4, 20.5_

  - [x] 6.2 Implement accounts and profiles repositories
    - **[NEW/MODIFY]** Create `accountsRepo.ts` (lookup by `identity_ref`, provision account) and `profilesRepo.ts` (replaces v1 `profileManager.ts` local `~/.it` file; reuse the pure `profileMerge`/`profileValidation` from shared, persist to Postgres)
    - _Requirements: 1.9, 17.1, 17.2_

  - [x] 6.3 Implement sessions, qna, ledger, and usage repositories
    - **[NEW/MODIFY]** Create `sessionsRepo.ts` (replaces v1 `sessionManager.ts` local atomic-file persistence; reuse pure `session.ts` transforms), `ledgerRepo.ts` (append-only insert; balance via `ledgerBalance`), `usageRepo.ts`, and qna persistence
    - _Requirements: 11.1, 11.2, 11.3, 17.3, 17.4, 17.5, 17.6_

  - [ ]* 6.4 Write integration tests for repository persistence invariants
    - **[NEW]** Verify append-only ledger rejecting UPDATE/DELETE (Req 11.3), RLS rejecting cross-account reads (Req 20.5), and `ON DELETE SET NULL` retaining ledger entries after session deletion (Req 20.4)
    - _Requirements: 11.3, 20.4, 20.5_

- [x] 7. Implement the auth verifier
  - [x] 7.1 Implement Supabase JWKS token verification and account provisioning
    - **[NEW]** Create `packages/backend/http/authVerifier.ts` that verifies the Supabase Access_Token signature against the environment's JWKS, checks `exp`/`aud`/`iss`, maps the verified `sub` to an Account, and provisions an Account + empty Credit_Ledger in one transaction on first sign-in; reject absent/expired/invalid tokens with an authorization error
    - **[NEW]** When `resolveAuthMode(env)` is `bypassed` (local/dev), skip verification and resolve the request to the environment's Dev_Account
    - _Requirements: 1.8, 1.9, 1.11, 1.12, 19.8_

  - [ ]* 7.2 Write integration test for JWKS verification and first-sign-in provisioning
    - **[NEW]** Verify signature validation against JWKS and that a verified identity with no account provisions an Account + ledger atomically
    - _Requirements: 1.8, 1.9_

- [x] 8. Implement the credits service
  - [x] 8.1 Implement pre-session check, live metering, and decrement
    - **[NEW]** Create `packages/backend/http/creditsService.ts` wrapping the pure `credits.ts` core with the ledger/usage repositories: pre-session check (enforced & balance > 0 authorize, enforced & balance <= 0 reject, bypassed always authorize), live STT-minute/LLM-token metering via the Conversion_Rate, and balance decrement while enforced; record a Usage_Record without decrement when bypassed
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 9.1, 9.2, 9.3, 9.4, 9.5_

  - [x]* 8.2 Write property test for the pre-session check
    - **[NEW]** `packages/backend/__tests__` (in-memory repository model)
    - **Property 5: Pre-session check authorizes correctly**
    - **Validates: Requirements 8.2, 8.3, 8.4**

  - [x] 8.3 Implement low-credit warning and exactly-once finalization
    - **[NEW]** Implement the low-credit warning trigger at/below the Low_Credit_Threshold and the idempotent `finalizeSession(sessionId)` (single transaction: `SELECT ... FOR UPDATE` finalized_at guard, compute usage via `usageToCredits`, INSERT one debit entry — `usage-debit` enforced / `non-enforced-debit` bypassed — persist transcript + Q&A + usage_record, set `finalized_at`/`end_reason`; duplicate INSERT swallowed by the unique constraint)
    - _Requirements: 10.1, 11.1, 11.5, 12.5, 12.7_

  - [x]* 8.4 Write property test for exactly-once finalization
    - **[NEW]** `packages/backend/__tests__` (in-memory repository model with the unique constraint)
    - **Property 2: Finalization is exactly-once (idempotent)**
    - **Validates: Requirements 11.1, 12.7**

  - [x]* 8.5 Write property test for bypassed-enforcement balance preservation
    - **[NEW]** `packages/backend/__tests__`
    - **Property 4: Bypassed enforcement never decrements the enforced balance**
    - **Validates: Requirements 9.5, 10.4, 11.5**

  - [x]* 8.6 Write property test for per-account data isolation
    - **[NEW]** `packages/backend/__tests__` (in-memory repository model honoring account scoping)
    - **Property 7: Per-account data isolation**
    - **Validates: Requirements 17.7, 20.5**

  - [x]* 8.7 Write property test for session-deletion ledger retention
    - **[NEW]** `packages/backend/__tests__`
    - **Property 8: Session deletion retains the ledger entry**
    - **Validates: Requirements 20.4**

- [x] 9. Implement the STT relay
  - [x] 9.1 Implement the Deepgram and Whisper streaming clients
    - **[NEW]** Create `packages/backend/session/sttRelay/deepgramClient.ts` (primary, streaming WebSocket) and `whisperClient.ts` (acceptable backend), relaying Audio_Frames as a streaming request and surfacing interim transcribed text
    - **[REUSE]** Drive endpointing with the relocated pure `sttFinalize`/`sttThreshold` modules; emit `stt_error` and keep the session open if the provider is unreachable or returns nothing within 2s; wait when no frames arrive
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7, 13.8, 13.9_

  - [ ]* 9.2 Write integration test for Deepgram/Whisper streaming relay
    - **[NEW]** Verify each backend produces interim + final results from relayed audio
    - _Requirements: 13.1, 13.2, 13.3, 13.4_

- [x] 10. Implement the modified LLM provider
  - [x] 10.1 Modify the LLM provider for server-side keys and usage metering
    - **[MODIFY]** Relocate v1 `llmProvider.ts` into `packages/backend/session/llmProvider.ts`, keeping the provider-agnostic streaming + 30s-timeout structure and the OpenAI/Anthropic/Gemini backends verbatim; source keys from `secrets.ts`; add the `onUsage?({ promptTokens, completionTokens })` metering hook reading each SDK's usage object; on error/timeout abort and emit `answer_error` naming the provider
    - _Requirements: 9.2, 15.1, 15.2, 15.3, 15.4, 15.5, 15.6, 18.1, 18.4_

  - [x]* 10.2 Write unit tests for LLM timeout and usage extraction
    - **[MODIFY]** Reuse the v1 mock-clock/fake-backend harness; test 30s-timeout abort + `answer_error` (Req 15.6) and `onUsage` token extraction per provider (Req 9.2)
    - _Requirements: 9.2, 15.6_

  - [ ]* 10.3 Write integration test for LLM streaming + usage extraction
    - **[NEW]** Verify streaming for OpenAI/Anthropic/Gemini including SDK usage extraction for metering
    - _Requirements: 15.2, 15.3, 15.4, 15.5, 9.2_

- [x] 11. Implement the modified session orchestrator
  - [x] 11.1 Modify the answer pipeline into the session orchestrator
    - **[MODIFY]** Relocate v1 `answerPipeline.ts` into `packages/backend/session/sessionOrchestrator.ts`, keeping the `topics -> scope -> prompt -> LLM -> persist -> relay` flow, the generation-seq guard, and regenerate; feed input from the STT relay (not SidecarBridge), emit over the client WebSocket (not IPC), persist to Postgres, and add the metering + credit-enforcement checkpoints (low-credit warning, hard stop at zero balance)
    - **[REUSE]** Invoke the relocated `detectTopics`/`classifyScope`/`buildSystemPrompt` from shared
    - _Requirements: 9.4, 10.1, 10.2, 10.3, 10.4, 12.1, 14.1, 14.2, 14.3, 14.4, 15.1, 15.5, 16.3_

  - [x]* 11.2 Write unit tests for orchestrator enforcement checkpoints and end reasons
    - **[NEW]** Test hard-stop at zero balance under enforcement (Req 10.2, 10.3), no hard-stop when bypassed (Req 10.4), and end-reason assignment for user-ended / credits-exhausted / disconnected (Req 12.2-12.4); `session_summary` only on user-ended (Req 12.6)
    - _Requirements: 10.2, 10.3, 10.4, 12.2, 12.3, 12.4, 12.6_

- [x] 12. Implement the session gateway WebSocket server
  - [x] 12.1 Implement the Fastify session gateway
    - **[NEW]** Create `packages/backend/session/sessionGateway.ts` terminating one persistent WebSocket per Session: enforce the auth handshake where `resolveAuthMode` is `enforced` (`auth` -> verify via `authVerifier` -> `auth_ok`/`auth_error`, reject bad tokens, Req 5.2), and where `bypassed` accept the connection without a token and attribute it to the Dev_Account (Req 5.2a); run the pre-session credit check, create the session record, relay binary Audio_Frames to the STT relay, drive the orchestrator, stream downbound messages, and own the three session-end paths (user-ended, credits-exhausted, disconnected) each routed through `finalizeSession`
    - **[NEW]** Wire the Fastify HTTP API for Credits_Service balance and session-history endpoints with auth-verifier middleware (auth-mode aware) and account-scoped reads; serve over HTTPS/WSS
    - _Requirements: 1.8, 1.12, 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 5.7, 5.8, 7.1, 7.3, 7.4, 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 17.7, 19.8, 20.3, 20.5_

  - [ ]* 12.2 Write integration test for WebSocket connect/auth/reject and end-to-end question->answer
    - **[NEW]** Verify connection accepted with a valid token, rejected (`auth_error`) with absent/expired/invalid token, and a full question->answer round-trip over the gateway
    - _Requirements: 5.1, 5.2, 5.4, 5.5, 5.6_

- [x] 13. Checkpoint - backend complete
  - Ensure all tests pass (backend PBT + integration tests), ask the user if questions arise.

- [x] 14. Implement desktop client configuration and authentication
  - [x] 14.1 Implement per-environment client config
    - **[NEW/REPLACE]** Create `packages/desktop/main/envConfig.ts` (replaces v1 `configLoader.ts`/`config.yaml` BYO-key model) exposing per-environment `backendBaseUrl`, `sessionGatewayUrl`, `supabaseUrl`, `supabasePublishableKey` for `local`/`dev`/`pre-prod`/`prod`; hold only the Supabase publishable key, never a provider key
    - _Requirements: 3.1, 3.2, 3.3, 18.3, 18.5, 18.6_

  - [x] 14.2 Implement the secure token store
    - **[NEW]** Create `packages/desktop/main/tokenStore.ts` persisting Access_Token + Refresh_Token only in the OS secure credential store via Electron `safeStorage`; expose `save`/`load`/`clear` keyed per environment
    - _Requirements: 2.1, 2.5_

  - [x] 14.3 Implement the auth manager (Supabase PKCE)
    - **[NEW]** Create `packages/desktop/main/authManager.ts` driving Supabase email/password sign-in and Google OAuth authorization-code-with-PKCE in the system browser (loopback `127.0.0.1` redirect, never an embedded webview); generic auth-failed error masking; session restoration from stored tokens (including when the IdP is unreachable); Access_Token refresh via Refresh_Token; fall back to the sign-in screen on refresh failure / unreadable token; sign-out clears tokens and ends the Supabase session
    - **[NEW]** When the selected Environment's auth mode is bypassed (local/dev), skip sign-in entirely: do not require, obtain, or store tokens, and proceed directly
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.10, 1.11, 1.12, 2.2, 2.3, 2.4, 2.6, 2.7_

  - [x]* 14.4 Write unit tests for auth error and restoration paths
    - **[NEW]** Test generic-error masking (Req 1.4), refresh-to-sign-in fallback (Req 1.7), unreadable-token path (Req 2.6), and restore-without-prompt with a valid refresh token (Req 2.2)
    - _Requirements: 1.4, 1.7, 2.2, 2.6_

- [x] 15. Implement the backend session client and native audio capture
  - [x] 15.1 Repurpose the sidecar bridge into the backend session client
    - **[REPURPOSE]** Relocate v1 `sidecarBridge.ts` into `packages/desktop/main/backendSessionClient.ts`, keeping the reconnect/backoff/command-queue and the four event names (`partial_transcript`, `final_question`, `stt_error`, `capture_state`); connect to the REMOTE Session_Gateway over WSS, send the Access_Token in the auth handshake on connect, and add binary Audio_Frame upload; surface a disconnected status and attempt bounded reconnection
    - **[REUSE]** Use `packages/shared/protocol.ts` `encode`/`decode` for control frames
    - _Requirements: 5.1, 5.2, 5.3, 5.8, 12.4_

  - [x] 15.2 Implement native audio capture
    - **[NEW]** Create the renderer audio-capture module: microphone via `getUserMedia`, Windows system-audio loopback via Electron 31 `setDisplayMediaRequestHandler({ audio: 'loopback' })`, an `AudioWorklet` downmixing to mono / resampling to 16 kHz / emitting Int16 PCM frames (~20-40 ms), mic+loopback mixed with clipping protection, handed to the backend session client; no subprocess launched
    - **[REUSE]** Toggle capture active/inactive with the relocated `captureToggle` reducer; on loopback unavailable continue mic-only, show "system-audio degraded", and report `capture_state{ systemAudioAvailable: false }`
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6_

- [x] 16. Implement the overlay window manager and IPC surface
  - [x] 16.1 Relocate the window manager
    - **[MODIFY/REUSE]** Relocate v1 `windowManager.ts` into `packages/desktop/main/windowManager.ts` mostly as-is: frameless, always-on-top, transparent overlay; `setContentProtection(true)` with the keep-rendered warning fallback; hotkeys; opacity; geometry constraints using the relocated `geometry.ts`
    - _Requirements: 4.3, 4.4, 6.1, 6.2, 6.3, 20.2_

  - [x] 16.2 Extend the IPC channels and preload
    - **[MODIFY]** Relocate v1 `shared/ipc.ts` and `preload.ts` into the desktop package and extend them with auth/env/credit channels exposed to the renderer
    - _Requirements: 1.1, 3.1, 3.2, 7.1_

- [x] 17. Implement the renderer screens
  - [x] 17.1 Implement the sign-in screen and environment selector
    - **[NEW]** Add the sign-in screen (email/password + Google OAuth controls, generic auth-failed indication) and the environment selector to the desktop renderer: select exactly one environment, show the environment indicator when selected and hide it when none, sign out of the previous environment on change (proceed to the new sign-in screen even if sign-out fails), default to `prod` on next launch when prod was selected
    - **[NEW]** When the selected environment's auth mode is bypassed (local/dev), skip the sign-in screen and go straight to the app
    - **[REUSE]** Build alongside the relocated `overlay/`, `setup/`, `overlayHeader.ts` renderer modules
    - _Requirements: 1.1, 1.2, 1.4, 1.12, 3.1, 3.4, 3.5, 3.6, 3.7_

  - [x] 17.2 Implement the credit-balance display and overlay live rendering
    - **[NEW/REUSE]** Add the credit-balance display (request + show balance on authenticated session, update on `session_summary`, show low-credit warning and "insufficient credits"); wire the reused Overlay_UI to render live `partial_transcript` (top), incremental `answer_token` (bottom), topic badge, and scope badge using the relocated `scopeColor`; copy-to-clipboard
    - **[REUSE]** Session history view + Markdown export using the relocated `exportSessionMarkdown`
    - _Requirements: 6.4, 6.5, 6.6, 6.7, 6.8, 7.1, 7.2, 7.3, 7.4, 7.5, 8.3, 10.1_

  - [ ]* 17.3 Write unit tests for environment-selector and credit-display behavior
    - **[NEW]** Test indicator show/hide (Req 3.4, 3.5), sign-out-on-change including sign-out failure (Req 3.6), prod-default-on-next-launch (Req 3.7), and balance update on `session_summary` (Req 7.2)
    - _Requirements: 3.4, 3.5, 3.6, 3.7, 7.2_

- [x] 18. Checkpoint - desktop client complete
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 19. End-to-end wiring, smoke tests, and latency verification
  - [x] 19.1 Wire the client end-to-end across main, preload, and renderer
    - **[NEW]** Connect env selection -> auth -> credit-balance fetch -> start interview (pre-session check) -> open WSS session -> capture+upload audio -> render transcripts/answers/badges -> stop/finalize -> update balance; route hotkeys and IPC across main and renderer with no orphaned modules
    - _Requirements: 3.2, 5.1, 7.1, 7.2, 8.1, 8.3, 12.1, 12.6_

  - [ ]* 19.2 Write smoke tests for capture exclusion, native capture, and key/transport safety
    - **[REUSE/NEW]** Reuse v1 `privacy.smoke` for `setContentProtection(true)` exclusion (Req 6.2, 20.2); verify native mic + Windows loopback init including the degraded-loopback path (Req 4.5); assert the client bundle contains no provider key (Req 18.3, 18.6); assert WSS/HTTPS transport configured (Req 20.3)
    - _Requirements: 4.5, 6.2, 18.3, 18.6, 20.2, 20.3_

  - [ ]* 19.3 Write latency verification with per-stage instrumentation
    - **[NEW]** Record per-stage latency (audio relay, end-of-question detection, prompt construction, first STT result, first answer token) with each Usage_Record and assert TTFT <= 2.5s and partial-transcript cadence <= 500ms
    - _Requirements: 16.1, 16.2, 16.3_

- [ ] 20. Final checkpoint - full integration
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP; they cover property, unit, integration, and smoke tests.
- **[RELOCATE]** tasks move existing v1 files (and their tests) verbatim — the implementer must reuse, not recreate. **[MODIFY]**/**[REPURPOSE]** keep v1 logic/shape while changing one boundary. **[NEW]** is genuinely new code.
- Each task references specific requirement clauses for traceability, and each property-test sub-task references its design property number (Properties 1-11).
- Property-based tests use fast-check with Vitest, run a minimum of 100 iterations, and are tagged `// Feature: interview-assistant-saas, Property {number}: {property_text}`.
- The reused Tier-1 property tests (Properties 10-11 plus the wider relocated suite) carry over their v1 guarantees unchanged; the new pure-core property tests (Properties 1-9) are front-loaded so credits, finalization, enforcement, isolation, and protocol logic are validated before any I/O is layered on.
- Checkpoints sit at the natural boundaries: after the shared package, after the backend, after the desktop client, and at full integration.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["2.1", "2.4", "2.7", "2.9", "3.1", "3.3", "3.6"] },
    { "id": 3, "tasks": ["2.2", "2.3", "2.5", "2.6", "2.8", "2.10", "3.2", "3.4", "3.5", "3.7"] },
    { "id": 4, "tasks": ["5.1", "6.1"] },
    { "id": 5, "tasks": ["6.2", "6.3", "7.1", "9.1", "10.1"] },
    { "id": 6, "tasks": ["6.4", "7.2", "8.1", "9.2", "10.2", "10.3"] },
    { "id": 7, "tasks": ["8.2", "8.3", "8.5", "8.6", "8.7", "11.1"] },
    { "id": 8, "tasks": ["8.4", "11.2", "12.1"] },
    { "id": 9, "tasks": ["12.2", "14.1", "14.2"] },
    { "id": 10, "tasks": ["14.3", "16.1", "16.2"] },
    { "id": 11, "tasks": ["14.4", "15.1"] },
    { "id": 12, "tasks": ["15.2", "17.1", "17.2"] },
    { "id": 13, "tasks": ["17.3", "19.1"] },
    { "id": 14, "tasks": ["19.2", "19.3"] }
  ]
}
```
