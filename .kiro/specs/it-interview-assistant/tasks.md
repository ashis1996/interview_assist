# Implementation Plan: IT Interview Assistant

## Overview

This plan implements the IT Interview Assistant as an Electron application with a TypeScript/React frontend and a Python sidecar for audio capture and speech-to-text. The work front-loads the pure, deterministic TypeScript domain modules (profile merge/validation, prompt construction, topic detection, scope classification, configuration validation, geometry, and serialization) so the 20 correctness properties can be validated early with property-based tests. I/O, OS, network, and streaming concerns are layered on top and wired together incrementally so nothing is left orphaned.

Property-based tests use **fast-check** with **Vitest**. Each property test runs a minimum of 100 iterations and is tagged with a comment in the form `// Feature: it-interview-assistant, Property {number}: {property_text}`.

## Tasks

- [x] 1. Set up project structure, tooling, and shared types
  - [x] 1.1 Scaffold the Electron + TypeScript/React project with main, preload, and renderer directories
    - Initialize the Electron project with a `package.json`, TypeScript config, and a React renderer entry point
    - Create the directory layout: `src/main/`, `src/main/domain/`, `src/renderer/`, `src/shared/`, `sidecar/`
    - Configure Vitest as the test runner and add `fast-check` as a dev dependency
    - _Requirements: 15.4_

  - [x] 1.2 Define shared domain types and enums
    - Create `Profile`, `SeniorityLevel`, `CompanyType`, `TopicDomain`, `ScopeClassification`, `AppConfig`, `QnAEntry`, `SessionFile` type declarations in `src/shared/`
    - Define `RoleAdjacencyMap` and `TopicRoleMap` types plus the static adjacency and topic-role mapping data structures
    - Define the `SidecarEvent` and `SidecarCommand` message union types for the bridge protocol
    - _Requirements: 1.4, 1.7, 12.2, 13.1_

- [x] 2. Implement profile domain logic (pure)
  - [x] 2.1 Implement `mergeSession` profile merge function
    - Write the pure merge in `src/main/domain/profileMerge.ts`: for each field, the override value wins when present, otherwise the default value is retained; an empty override yields the default unchanged
    - _Requirements: 2.8, 2.9_

  - [x]* 2.2 Write property test for session profile merge
    - **Property 1: Session profile merge precedence and identity**
    - **Validates: Requirements 2.8, 2.9**

  - [x] 2.3 Implement `validateProfile` confirmation gate and field-range validation
    - Write the pure validator in `src/main/domain/profileValidation.ts` returning `valid`, `missingMandatory`, and `fieldErrors`
    - Enforce the confirmation gate (≥1 role category, exactly one Seniority_Level, exactly one Company_Type) and field ranges (name ≤ 100, target role ≤ 100, experience years ∈ [0, 60], role categories ∈ [1, 10], skills ∈ [1, 50] when roles selected)
    - _Requirements: 1.3, 1.5, 1.6, 1.10, 1.11_

  - [x]* 2.4 Write property test for the confirmation gate
    - **Property 2: Confirmation gate**
    - **Validates: Requirements 1.10, 1.11**

  - [x]* 2.5 Write property test for field-range validation
    - **Property 3: Field-range validation**
    - **Validates: Requirements 1.3, 1.5, 1.6**

- [x] 3. Implement prompt, topic, and scope domain logic (pure)
  - [x] 3.1 Implement `buildSystemPrompt`
    - Write the pure prompt builder in `src/main/domain/promptBuilder.ts` that includes profile name, seniority, every role, every skill, company type, and target role; the first-person instruction; a seniority depth-adaptation instruction; and an answer-every-question instruction
    - Inject scope-specific framing: in-scope (expert answer drawing on skills), adjacent (exposure / cross-team), out-of-scope (well-rounded senior IT professional persona)
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 7.3, 7.4, 7.5_

  - [x]* 3.2 Write property test for system prompt content invariants
    - **Property 7: System prompt content invariants**
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.4**

  - [x]* 3.3 Write property test for scope-dependent prompt framing
    - **Property 8: Scope-dependent prompt framing**
    - **Validates: Requirements 7.3, 7.4, 7.5**

  - [x] 3.4 Implement `detectTopics` topic detector
    - Write the deterministic keyword/lexicon classifier in `src/main/domain/topicDetector.ts` over a curated domain dictionary, returning a deduplicated set of matched `TopicDomain` values (possibly empty)
    - _Requirements: 12.1, 12.2_

  - [x]* 3.5 Write property test for topic detection soundness and domain closure
    - **Property 16: Topic detection soundness and domain closure**
    - **Validates: Requirements 12.1, 12.2**

  - [x] 3.6 Implement `classifyScope` scope checker
    - Write the pure classifier in `src/main/domain/scopeChecker.ts` applying the priority rules: empty topics → out-of-scope; topic maps to a profile role → in-scope; else topic maps to an adjacent role → adjacent; else → out-of-scope
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5_

  - [x]* 3.7 Write property test for scope classification totality and rules
    - **Property 17: Scope classification totality and rules**
    - **Validates: Requirements 13.1, 13.2, 13.3, 13.4, 13.5**

  - [x] 3.8 Implement deterministic scope-to-color mapping
    - Write the pure color mapping in `src/main/domain/scopeColor.ts` assigning a distinct, consistent color to each of in-scope, adjacent, and out-of-scope
    - _Requirements: 13.6_

  - [x]* 3.9 Write property test for scope color distinctness and determinism
    - **Property 18: Scope color distinctness and determinism**
    - **Validates: Requirements 13.6**

- [x] 4. Checkpoint - core domain logic
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Implement configuration management
  - [x] 5.1 Implement configuration validation
    - Write the pure validator in `src/main/domain/configValidation.ts` producing `ConfigValidationResult` with a `ConfigError` naming each missing required setting (no missing setting unreported, no present setting falsely reported)
    - _Requirements: 9.1, 9.4_

  - [x]* 5.2 Write property test for missing required configuration reporting
    - **Property 11: Missing required configuration is reported**
    - **Validates: Requirements 9.4**

  - [x] 5.3 Implement `Config_Loader` file read and hot-reload watcher
    - Read and parse `config.yaml` at the project root, expose a typed `AppConfig`, and watch the file to publish a re-validated immutable snapshot to subscribers without restart
    - Ensure API keys are passed only to their matching provider clients
    - _Requirements: 9.1, 9.2, 9.3, 16.1_

  - [x]* 5.4 Write integration tests for config hot reload and key routing
    - Verify reload on file change without restart and that API keys are routed only to their matching provider
    - _Requirements: 9.2, 9.3_

- [x] 6. Implement profile persistence
  - [x] 6.1 Implement `Profile_Manager` load with default and error fallbacks
    - Read `~/.it-interview-assistant/profile.json` on launch returning a `LoadOutcome` (`loaded`, `defaulted`, or `error-defaulted`)
    - Initialize system defaults in memory when the file is absent without creating or modifying any file; on unreadable/invalid JSON, load defaults, surface an error message, and leave the file unchanged
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 1.9_

  - [x] 6.2 Implement `Profile_Manager` save with atomic write
    - Write current values to the profile file via temp-file write and atomic rename so a failed save preserves the previous file contents byte-for-byte; return success/failure with a message
    - Store profile data only within the user home directory
    - _Requirements: 2.5, 2.6, 2.7, 2.10, 16.3_

  - [x]* 6.3 Write unit tests for profile load/save fallbacks
    - Test pre-fill on valid load, missing-file defaulting with no write, unreadable-file defaulting leaving the file unchanged, and save preserving prior contents on failure
    - _Requirements: 1.8, 1.9, 2.3, 2.4, 2.6_

- [x] 7. Implement LLM provider
  - [x] 7.1 Implement provider name recognition and `resolveModel`
    - Write pure functions in `src/main/domain/llmResolve.ts`: case-insensitive recognition of claude/openai/gemini producing a config error (naming the offending input and listing supported providers) for unrecognized non-empty names, and default model resolution (claude-sonnet-4 / gpt-4.1 / gemini-1.5-pro) when the model is empty/absent
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5_

  - [x]* 7.2 Write property test for LLM provider resolution
    - **Property 9: LLM provider resolution**
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.5**

  - [x]* 7.3 Write property test for LLM model default resolution
    - **Property 10: LLM model default resolution**
    - **Validates: Requirements 8.4**

  - [x] 7.4 Implement the `LlmProvider` backends with streaming and timeout
    - Implement Claude, OpenAI, and Gemini clients behind the `LlmProvider` interface, streaming tokens via `onToken`, enforcing a 30-second timeout, and returning a backend-invocation error naming the provider on error or timeout
    - Handle empty/absent provider by refraining from generation and reporting a "no provider configured" error
    - _Requirements: 7.1, 7.2, 8.6, 8.7_

  - [x]* 7.5 Write unit tests for LLM wiring and error paths
    - Test question-sent-with-prompt, empty/absent provider error, and backend error/timeout via a mock clock
    - _Requirements: 7.1, 8.6, 8.7_

- [x] 8. Implement window manager geometry (pure) and window setup
  - [x] 8.1 Implement geometry and opacity helpers
    - Write pure helpers in `src/main/domain/geometry.ts`: `constrainPosition` (keep the rectangle fully within display bounds on both axes), `constrainSize` (width ∈ [200, displayWidth], height ∈ [150, displayHeight]), and `clampOpacityPercent` (0..100, unchanged when already in range)
    - _Requirements: 10.4, 10.5, 10.8_

  - [x]* 8.2 Write property test for overlay position constraint
    - **Property 12: Overlay position stays within the active display**
    - **Validates: Requirements 10.4**

  - [x]* 8.3 Write property test for overlay size constraints
    - **Property 13: Overlay size constraints**
    - **Validates: Requirements 10.5**

  - [x]* 8.4 Write property test for opacity clamping
    - **Property 14: Opacity clamping**
    - **Validates: Requirements 10.8**

  - [x] 8.5 Implement the Window Manager overlay window and hotkeys
    - Create the frameless, always-on-top, transparent `BrowserWindow` with per-window opacity; call `setContentProtection(true)` and surface a warning while keeping the overlay rendered when exclusion is unsupported
    - Register global hotkeys for audio-capture toggle and overlay visibility (show/hide within 200 ms) and apply drag/resize geometry constraints and opacity
    - _Requirements: 10.1, 10.2, 10.3, 10.6, 10.7, 10.8, 4.3_

  - [x]* 8.6 Write integration tests for overlay window behavior
    - Test hide/show within 200 ms, content protection enabled, and the unsupported-exclusion warning path
    - _Requirements: 10.6, 10.7, 10.2, 10.3_

- [x] 9. Implement session recording and export
  - [x] 9.1 Implement session serialization and Markdown export (pure)
    - Write `serializeSession`, `deserializeSession`, and `exportSessionMarkdown` in `src/main/domain/session.ts`; the round-trip must preserve the profile snapshot and all entries, and the Markdown must contain every entry's question and answer text
    - _Requirements: 14.1, 14.2, 14.4_

  - [x]* 9.2 Write property test for session serialization round-trip
    - **Property 19: Session serialization round-trip**
    - **Validates: Requirements 14.1, 14.2**

  - [x]* 9.3 Write property test for Markdown export completeness
    - **Property 20: Markdown export completeness**
    - **Validates: Requirements 14.4**

  - [x] 9.4 Implement `Session_Manager` persistence and history
    - Save each generated Q&A pair (with topics, scope, timestamp) and the active Session_Profile snapshot to a local session JSON file, display recorded history when the interview ends, and export to Markdown on demand
    - _Requirements: 14.1, 14.2, 14.3, 14.4_

- [x] 10. Checkpoint - main-process modules
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Implement STT pure reducers and the Python sidecar
  - [x] 11.1 Implement `resolveSilenceThreshold` (pure)
    - Write the pure clamp-and-default in `src/main/domain/sttThreshold.ts`: result within [0.3, 5.0], 1.5 when absent, unchanged when already in range
    - _Requirements: 5.4_

  - [x]* 11.2 Write property test for silence threshold clamping and default
    - **Property 4: Silence threshold clamping and default**
    - **Validates: Requirements 5.4**

  - [x] 11.3 Implement the audio-capture toggle reducer (pure)
    - Write the pure toggle reducer in `src/main/domain/captureToggle.ts` that flips capture state per hotkey press
    - _Requirements: 4.3_

  - [x]* 11.4 Write property test for audio-capture toggle parity
    - **Property 5: Audio-capture toggle parity**
    - **Validates: Requirements 4.3**

  - [x] 11.5 Implement the STT finalization reducer (pure)
    - Write the pure finalization reducer in `src/main/domain/sttFinalize.ts` that finalizes a Question only after a silence interval meeting the threshold and produces no text and no Question for audio with no recognizable speech
    - _Requirements: 5.3, 5.9_

  - [x]* 11.6 Write property test for no-recognizable-speech behavior
    - **Property 6: No recognizable speech yields no question**
    - **Validates: Requirements 5.9**

  - [x] 11.7 Implement the Python sidecar audio capture
    - Capture microphone and system-audio loopback (WASAPI on Windows, aggregate/loopback device on macOS) as real-time PCM streams; report capture state and a degraded state when system loopback is unavailable
    - _Requirements: 4.1, 4.2, 4.4_

  - [x] 11.8 Implement the Python sidecar STT backends and finalization
    - Implement Deepgram, OpenAI Whisper API, and local faster-whisper backends; emit partial transcripts at least every 500 ms and finalize a Question on silence; report a transcription failure and retain audio without finalizing when a network backend cannot reach its API or returns nothing within 2 seconds; run faster-whisper locally with no network access
    - _Requirements: 5.2, 5.3, 5.5, 5.6, 5.7, 5.8_

  - [x]* 11.9 Write integration tests for sidecar capture and STT
    - Test PCM frame production for mic and system loopback, STT latency under 2s, live-transcript cadence ≤ 500 ms, faster-whisper local with no network, and the network-failure retention/error path
    - _Requirements: 4.1, 4.2, 5.1, 5.2, 5.7, 5.8, 15.2_

- [x] 12. Implement the sidecar bridge in the main process
  - [x] 12.1 Implement the WebSocket sidecar bridge
    - Implement the local `127.0.0.1` WebSocket client with newline-delimited JSON, handling `partial_transcript`, `final_question`, `stt_error`, and `capture_state` events and sending `start_capture`, `stop_capture`, and `configure` commands
    - Manage sidecar lifecycle: on crash/disconnect mark capture inactive, surface a status indication, and attempt a bounded reconnect/restart while preserving overlay and recorded session
    - _Requirements: 4.3, 5.8_

- [x] 13. Implement the renderer UI
  - [x] 13.1 Implement the overlay header badge content (pure helper)
    - Write the pure header-content helper in `src/renderer/overlayHeader.ts` that produces every active role and the Seniority_Level for a given Session_Profile
    - _Requirements: 11.4_

  - [x]* 13.2 Write property test for header badge content
    - **Property 15: Header badge content**
    - **Validates: Requirements 11.4**

  - [x] 13.3 Implement the Setup_Screen
    - Build the React Setup_Screen with role-category selection (1–10), single Seniority_Level, skill chips per selected role (1–50), name/target-role/experience inputs, single Company_Type, a Session_Profile summary, "Save as Default" and "Start Interview" controls, validation error indications for missing mandatory fields, and pre-fill from the loaded Default_Profile
    - Display the Setup_Screen on first launch (no profile) and via the application menu, and show an error indication when a saved profile could not be loaded
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.11, 3.1, 2.5_

  - [x] 13.4 Implement the Overlay_UI
    - Build the React Overlay_UI with the live transcript (top), AI answer (bottom, incremental token rendering), header role/seniority badge, topic badge, scope badge using the deterministic color mapping rendered within 1 second, audio-capture indicator, copy-to-clipboard, regenerate, text-question entry, opacity control, and drag/resize handles
    - _Requirements: 4.4, 5.2, 7.2, 7.6, 7.7, 11.1, 11.2, 11.3, 11.4, 12.3, 13.6_

  - [x]* 13.5 Write unit tests for renderer content and controls
    - Test overlay content placement, copy-to-clipboard, topic badge render, capture indicator, and the Setup summary
    - _Requirements: 11.1, 11.2, 11.3, 12.3, 4.4, 3.1_

- [x] 14. Wire the answer pipeline and application together
  - [x] 14.1 Implement the answer pipeline orchestration
    - Wire `final_question` events through Topic_Detector → Scope_Checker → Prompt_Builder → LLM_Provider, relaying topic/scope badges and streamed answer tokens to the Overlay_UI and persisting each Q&A pair via Session_Manager
    - Subscribe the pipeline, LLM provider, and sidecar bridge to Config_Loader snapshots; support text-entered questions and answer regeneration
    - _Requirements: 6.1, 7.1, 7.2, 7.6, 7.7, 12.1, 12.3, 13.1, 13.6, 14.1_

  - [x] 14.2 Wire setup, activation, and window lifecycle
    - Connect Setup_Screen confirmation to Profile_Manager save/session computation, activate the Overlay_UI and start Audio_Capture on "Start Interview", and connect global hotkeys and IPC across main and renderer
    - _Requirements: 1.10, 2.7, 2.8, 3.2_

  - [x]* 14.3 Write integration tests for end-to-end answer flow
    - Test Start Interview activating overlay and capture, incremental answer rendering from a streamed token source, and first answer content within 3s
    - _Requirements: 3.2, 7.2, 15.1_

  - [x]* 14.4 Write smoke tests for window, privacy, and platform constraints
    - Verify frameless/always-on-top/adjustable transparency window flags, profile stored as JSON under the home directory, API keys only in the local config file, no telemetry/analytics endpoints, launch on macOS 13+/Windows 11, and idle memory under 300MB
    - _Requirements: 10.1, 2.1, 2.10, 16.1, 16.2, 16.3, 15.3, 15.4_

- [x] 15. Final checkpoint - full integration
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP; they cover property, unit, integration, and smoke tests.
- Each task references specific requirements for traceability, and each property test sub-task references its design property number.
- Property-based tests use fast-check with Vitest, run a minimum of 100 iterations, and are tagged with `// Feature: it-interview-assistant, Property {number}: {property_text}`.
- Checkpoints ensure incremental validation at natural boundaries.
- Pure domain modules are implemented before the I/O, OS, and UI layers that consume them so the high-value correctness rules are validated early.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["2.1", "2.3", "3.1", "3.4", "3.6", "3.8", "5.1", "7.1", "8.1", "9.1", "11.1", "11.3", "11.5", "13.1"] },
    { "id": 3, "tasks": ["2.2", "2.4", "2.5", "3.2", "3.3", "3.5", "3.7", "3.9", "5.2", "7.2", "7.3", "8.2", "8.3", "8.4", "9.2", "9.3", "11.2", "11.4", "11.6", "13.2"] },
    { "id": 4, "tasks": ["5.3", "6.1", "6.2", "7.4", "8.5", "9.4", "11.7", "11.8"] },
    { "id": 5, "tasks": ["5.4", "6.3", "7.5", "8.6", "11.9", "12.1", "13.3", "13.4"] },
    { "id": 6, "tasks": ["13.5", "14.1", "14.2"] },
    { "id": 7, "tasks": ["14.3", "14.4"] }
  ]
}
```
