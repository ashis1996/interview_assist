# Requirements Document

## Introduction

The IT Interview Assistant is a cross-platform desktop application (macOS 13+ and Windows 11) that provides real-time, AI-powered assistance during IT industry interviews across Software Development, QA, DevOps, Cloud, Architecture, Management, Data Engineering, and Security domains. The application captures interview audio, transcribes spoken questions to text in real time, classifies each question by topic and scope relative to the candidate's profile, and generates expert-level, first-person answers using a configurable LLM provider (Claude, OpenAI, or Gemini).

Before each interview, the candidate configures a profile (roles, seniority, skills, company type) that is saved as a reusable default and may be overridden for a single session. The selected skills bias the answering persona; questions outside the candidate's selected skills are always answered as a well-rounded senior IT professional rather than refused. The overlay window is rendered transparently, stays on top of other windows, and is excluded from screen capture so it remains invisible to interviewers during screen sharing.

This document defines the requirements for version 1. Resume parsing, multi-language STT, mobile support, cloud sync, interviewer video capture, and mock interview mode are explicitly out of scope for version 1.

## Glossary

- **System**: The IT Interview Assistant desktop application as a whole.
- **Setup_Screen**: The pre-interview user interface for selecting roles, seniority, skills, company type, and personal details.
- **Profile_Manager**: The component that loads, saves, and merges the default profile and per-session overrides.
- **Default_Profile**: The persisted candidate profile stored in JSON at `~/.it-interview-assistant/profile.json`, loaded on every launch.
- **Session_Profile**: The active profile for a single interview, computed as the Default_Profile merged with any one-time session overrides.
- **Session_Override**: One-time profile changes applied to a single interview session that are not persisted to the Default_Profile unless explicitly saved.
- **Config_Loader**: The component that reads and watches `config.yaml` for LLM, STT, audio, and overlay settings.
- **Config_File**: The `config.yaml` file at the project root containing LLM provider, STT provider, API keys, audio, and overlay settings.
- **Audio_Capture**: The component that captures microphone audio and system audio as PCM streams.
- **STT_Provider**: The speech-to-text component with selectable backends: Deepgram, OpenAI Whisper API, or local faster-whisper.
- **LLM_Provider**: The large-language-model component with selectable backends: Claude, OpenAI, or Gemini.
- **Prompt_Builder**: The component that constructs the dynamic system prompt from the Session_Profile.
- **Topic_Detector**: The component that classifies a transcribed question into one or more IT topic domains.
- **Scope_Checker**: The component that classifies a question as in-scope, adjacent, or out-of-scope relative to the Session_Profile roles.
- **Overlay_UI**: The transparent, always-on-top window that displays the transcript, AI answer, topic badge, and controls.
- **Session_Manager**: The component that records, persists, displays, and exports interview question-and-answer sessions.
- **Question**: A finalized transcribed utterance, produced after silence detection, that is sent to the LLM_Provider.
- **Seniority_Level**: One of Junior, Mid, Senior, Staff, or Principal.
- **Company_Type**: One of Startup, Product, Service, or FAANG.
- **Scope_Classification**: One of in-scope, adjacent, or out-of-scope.

## Requirements

### Requirement 1: Pre-Interview Profile Setup

**User Story:** As an IT candidate, I want to configure my roles, seniority, and skills before an interview, so that the assistant tailors its answers to my background.

#### Acceptance Criteria

1. WHEN the System launches AND no Default_Profile file exists, THE System SHALL display the Setup_Screen.
2. WHEN the user opens the setup option from the application menu, THE System SHALL display the Setup_Screen.
3. WHEN the user selects role categories on the Setup_Screen, THE Setup_Screen SHALL accept selection of between 1 and 10 role categories.
4. WHEN the user selects a Seniority_Level on the Setup_Screen, THE Setup_Screen SHALL accept exactly one value from Junior, Mid, Senior, Staff, or Principal.
5. WHILE one or more role categories are selected, THE Setup_Screen SHALL display the skill chips associated with each selected role category and SHALL accept selection of between 1 and 50 skill chips.
6. THE Setup_Screen SHALL accept free-text entry of a candidate name up to 100 characters, a target role up to 100 characters, and a numeric experience years value from 0 to 60.
7. WHEN the user selects a Company_Type on the Setup_Screen, THE Setup_Screen SHALL accept exactly one value from Startup, Product, Service, or FAANG.
8. WHEN the System launches AND a readable, valid Default_Profile file exists, THE Setup_Screen SHALL pre-fill all fields with the Default_Profile values.
9. IF a Default_Profile file exists but cannot be read or parsed, THEN THE System SHALL display the Setup_Screen with empty fields and SHALL present an error indication that the saved profile could not be loaded.
10. WHEN the user confirms the profile on the Setup_Screen AND at least one role category, exactly one Seniority_Level, and exactly one Company_Type are provided, THE System SHALL save the configuration as the active Session_Profile and persist it as the Default_Profile.
11. IF the user attempts to confirm the profile while at least one role category, exactly one Seniority_Level, or exactly one Company_Type is not provided, THEN THE System SHALL reject the confirmation, retain all entered values, and present an error indication identifying each missing mandatory field.

### Requirement 2: Profile Persistence and Session Override

**User Story:** As an IT candidate, I want to save my profile as a default and optionally override it for a single session, so that I can reuse my setup while adapting to specific interviews.

#### Acceptance Criteria

1. THE Default_Profile SHALL be stored as JSON at `~/.it-interview-assistant/profile.json`.
2. WHEN the System launches AND the profile file exists AND the profile file contains valid JSON, THE Profile_Manager SHALL load the Default_Profile from the profile file within 2 seconds.
3. IF the System launches AND the profile file does not exist, THEN THE Profile_Manager SHALL initialize the Default_Profile with system-defined default values for all Setup_Screen fields without creating or modifying any file until a save is requested.
4. IF the profile file cannot be read or does not contain valid JSON when the System launches, THEN THE Profile_Manager SHALL load system-defined default values, SHALL display an error indication that the saved profile could not be read, AND SHALL leave the existing profile file unchanged.
5. WHEN the user activates the "Save as Default" control, THE Profile_Manager SHALL write the current Setup_Screen values to the Default_Profile file and SHALL display a confirmation indication that the save succeeded.
6. IF writing the Default_Profile file fails, THEN THE Profile_Manager SHALL display an error indication that the save failed AND SHALL preserve the previously stored profile file contents unchanged.
7. WHEN the user starts an interview after editing Setup_Screen fields without activating "Save as Default", THE Profile_Manager SHALL apply the edits as a Session_Override for the current session only AND SHALL leave the Default_Profile file unchanged.
8. WHEN the user starts an interview without making any Session_Override, THE Profile_Manager SHALL use the Default_Profile values as the Session_Profile.
9. WHEN computing the Session_Profile, THE Profile_Manager SHALL merge the Default_Profile with the Session_Override such that, for any field present in the Session_Override, the Session_Override value takes precedence over the Default_Profile value, and all other fields retain their Default_Profile values.
10. THE Profile_Manager SHALL store profile data only within the user home directory.

### Requirement 3: Interview Activation

**User Story:** As an IT candidate, I want to review my active profile and start the interview with one action, so that I can confirm my setup before going live.

#### Acceptance Criteria

1. WHILE the Setup_Screen is displayed, THE Setup_Screen SHALL display a summary of the Session_Profile that will be used.
2. WHEN the user activates the "Start Interview" control, THE System SHALL activate the Overlay_UI AND SHALL start Audio_Capture.

### Requirement 4: Audio Capture

**User Story:** As an IT candidate, I want the assistant to capture both my microphone and the interviewer's voice, so that all interview questions can be transcribed.

#### Acceptance Criteria

1. WHILE Audio_Capture is active, THE Audio_Capture SHALL capture microphone audio in real time.
2. WHILE Audio_Capture is active, THE Audio_Capture SHALL capture system audio in real time.
3. WHEN the user presses the audio-capture hotkey, THE System SHALL toggle Audio_Capture between active and inactive states.
4. WHILE Audio_Capture is active, THE Overlay_UI SHALL display a visual indicator showing that audio is being captured.

### Requirement 5: Real-Time Speech-to-Text

**User Story:** As an IT candidate, I want spoken questions transcribed quickly and accurately, so that the assistant can respond before the conversation moves on.

#### Acceptance Criteria

1. WHEN audio containing speech is captured, THE STT_Provider SHALL produce transcribed text within 2 seconds of the corresponding speech being captured.
2. WHILE transcription is in progress, THE Overlay_UI SHALL display the live transcription text and SHALL update the displayed text at least once every 500 milliseconds as new transcribed text becomes available.
3. WHEN a silence interval that meets or exceeds the configured silence threshold is detected following speech, THE STT_Provider SHALL finalize the preceding speech as a Question.
4. THE STT_Provider SHALL accept a configurable silence threshold within the range of 0.3 to 5.0 seconds, and WHERE no value is configured, THE STT_Provider SHALL apply a default silence threshold of 1.5 seconds.
5. WHERE the STT provider is configured as Deepgram, THE STT_Provider SHALL transcribe audio using the Deepgram API.
6. WHERE the STT provider is configured as OpenAI Whisper, THE STT_Provider SHALL transcribe audio using the OpenAI Whisper API.
7. WHERE the STT provider is configured as local faster-whisper, THE STT_Provider SHALL transcribe audio using the local faster-whisper engine without network access.
8. IF a network-dependent STT_Provider (Deepgram or OpenAI Whisper) cannot reach its API or returns no transcription within 2 seconds of speech being captured, THEN THE STT_Provider SHALL report a transcription failure, THE Overlay_UI SHALL display an error indication identifying the failed transcription, and THE STT_Provider SHALL retain the captured audio for the affected speech without finalizing it as a Question.
9. IF captured audio contains no recognizable speech, THEN THE STT_Provider SHALL produce no transcribed text and SHALL NOT finalize a Question for that audio.

### Requirement 6: Dynamic Prompt Construction

**User Story:** As an IT candidate, I want the AI to answer as me with my background, so that the answers sound authentic and match my seniority.

#### Acceptance Criteria

1. WHEN a Question is ready for answering, THE Prompt_Builder SHALL construct a system prompt that includes the Session_Profile name, seniority, roles, skills, company type, and target role.
2. THE Prompt_Builder SHALL construct the system prompt to instruct the LLM_Provider to answer in first person.
3. THE Prompt_Builder SHALL construct the system prompt to instruct the LLM_Provider to adapt answer depth to the Session_Profile Seniority_Level.
4. THE Prompt_Builder SHALL construct the system prompt to instruct the LLM_Provider to provide an answer for every Question.

### Requirement 7: AI Answer Generation

**User Story:** As an IT candidate, I want the assistant to generate and stream expert answers to interview questions, so that I can respond confidently in real time.

#### Acceptance Criteria

1. WHEN a Question is finalized, THE System SHALL send the Question and the constructed system prompt to the configured LLM_Provider.
2. WHILE the LLM_Provider generates an answer, THE Overlay_UI SHALL display the answer text incrementally as tokens are received.
3. WHERE the Scope_Classification of a Question is in-scope, THE LLM_Provider SHALL generate an expert-level answer that includes personal examples from the Session_Profile skills.
4. WHERE the Scope_Classification of a Question is adjacent, THE LLM_Provider SHALL generate an answer framed as exposure or cross-team collaboration.
5. WHERE the Scope_Classification of a Question is out-of-scope, THE LLM_Provider SHALL generate an answer in the persona of a well-rounded senior IT professional.
6. WHEN the user enters a question as text instead of speaking, THE System SHALL send the entered text to the LLM_Provider as a Question.
7. WHEN the user activates the regenerate control for the current Question, THE System SHALL request a new answer for that Question from the LLM_Provider.

### Requirement 8: LLM Provider Selection

**User Story:** As an IT candidate, I want to switch between AI providers by editing configuration, so that I am not locked into a single vendor.

#### Acceptance Criteria

1. WHERE the LLM provider in the Config_File is configured as Claude, THE LLM_Provider SHALL generate answers using the Claude backend.
2. WHERE the LLM provider in the Config_File is configured as OpenAI, THE LLM_Provider SHALL generate answers using the OpenAI backend.
3. WHERE the LLM provider in the Config_File is configured as Gemini, THE LLM_Provider SHALL generate answers using the Gemini backend.
4. WHERE the configured LLM model name is empty or absent, THE LLM_Provider SHALL use the default model for the configured provider (claude-sonnet-4 for Claude, gpt-4.1 for OpenAI, gemini-1.5-pro for Gemini).
5. IF the configured LLM provider name, compared case-insensitively, does not match one of the supported providers (Claude, OpenAI, Gemini), THEN THE System SHALL refrain from generating answers and report a configuration error that identifies the unrecognized provider name and lists the supported providers.
6. IF the configured LLM provider name is empty or absent, THEN THE System SHALL refrain from generating answers and report a configuration error indicating that no provider is configured.
7. IF the selected backend returns an error or does not respond within 30 seconds, THEN THE LLM_Provider SHALL abort the request, return no answer, and report an error indicating the backend invocation failed while identifying the configured provider.

### Requirement 9: Configuration Management

**User Story:** As an IT candidate, I want all keys and provider settings in one config file that reloads without restart, so that I can change providers quickly.

#### Acceptance Criteria

1. THE Config_Loader SHALL read LLM provider, STT provider, API keys, audio settings, and overlay settings from the Config_File at the project root.
2. WHEN the Config_File is modified while the System is running, THE Config_Loader SHALL reload the configuration without requiring an application restart.
3. THE System SHALL transmit API keys only to the corresponding provider APIs.
4. IF the Config_File is missing a required setting, THEN THE System SHALL report a configuration error identifying the missing setting.

### Requirement 10: Overlay Display and Screen-Share Invisibility

**User Story:** As an IT candidate, I want the assistant overlay to stay on top yet remain invisible during screen sharing, so that I can read answers without the interviewer detecting the tool.

#### Acceptance Criteria

1. THE Overlay_UI SHALL render as a frameless, always-on-top window that remains visually above all other application windows, with adjustable background transparency.
2. WHEN the display containing the Overlay_UI is captured, recorded, or shared by any screen-capture method, THE resulting captured or shared output SHALL NOT contain any pixels of the Overlay_UI, on both macOS and Windows 11.
3. IF the operating system or its current configuration does not support screen-capture exclusion for the Overlay_UI, THEN THE System SHALL display a warning indicating that screen-share invisibility is unavailable and SHALL keep the Overlay_UI rendered.
4. WHEN the user drags the Overlay_UI, THE Overlay_UI SHALL reposition to the new location while remaining fully within the bounds of the active display.
5. WHEN the user resizes the Overlay_UI, THE Overlay_UI SHALL adjust to the new dimensions, constrained to a minimum of 200 × 150 pixels and a maximum equal to the active display dimensions.
6. WHEN the user presses the overlay-visibility hotkey while the Overlay_UI is visible, THE System SHALL hide the Overlay_UI within 200 milliseconds.
7. WHEN the user presses the overlay-visibility hotkey while the Overlay_UI is hidden, THE System SHALL show the Overlay_UI within 200 milliseconds while preserving its exclusion from screen capture.
8. WHEN the user adjusts the opacity control, THE Overlay_UI SHALL set its window opacity to the selected value within the range 0 to 100 percent.

### Requirement 11: Overlay Content

**User Story:** As an IT candidate, I want the overlay to clearly show the transcript, answer, my active profile, and quick controls, so that I can act on the information at a glance.

#### Acceptance Criteria

1. THE Overlay_UI SHALL display the live transcript in its top section.
2. THE Overlay_UI SHALL display the AI answer in its bottom section.
3. WHEN the user activates the copy control, THE System SHALL copy the current AI answer to the system clipboard.
4. THE Overlay_UI SHALL display a badge showing the active Session_Profile roles and Seniority_Level in its header.

### Requirement 12: Topic Detection

**User Story:** As an IT candidate, I want each question classified by topic, so that I can see at a glance what domain is being discussed.

#### Acceptance Criteria

1. WHEN a Question is finalized, THE Topic_Detector SHALL classify the Question into one or more IT topic domains.
2. THE Topic_Detector SHALL support topic domains spanning software development, databases, system design, DevOps, cloud, Linux, monitoring, QA testing, architecture, management, data engineering, and security.
3. WHEN one or more topic domains are detected for a Question, THE Overlay_UI SHALL display the detected topic as a badge.

### Requirement 13: Scope Classification

**User Story:** As an IT candidate, I want the assistant to indicate whether a question matches my skills, so that I understand how the answer is being framed.

#### Acceptance Criteria

1. WHEN a Question is classified by topic, THE Scope_Checker SHALL assign exactly one Scope_Classification (in-scope, adjacent, or out-of-scope) to the Question relative to the Session_Profile roles.
2. WHEN a Question is classified by topic, IF at least one detected topic maps to a role in the Session_Profile, THEN THE Scope_Checker SHALL classify the Question as in-scope.
3. WHEN a Question is classified by topic, IF no detected topic maps to a Session_Profile role and at least one detected topic maps to a role listed as adjacent to a Session_Profile role in the role-adjacency mapping, THEN THE Scope_Checker SHALL classify the Question as adjacent.
4. WHEN a Question is classified by topic, IF no detected topic maps to a Session_Profile role and no detected topic maps to a role listed as adjacent in the role-adjacency mapping, THEN THE Scope_Checker SHALL classify the Question as out-of-scope.
5. IF the Topic_Detector detects no topic for a Question, THEN THE Scope_Checker SHALL classify the Question as out-of-scope.
6. WHEN a Scope_Classification is assigned, THE Overlay_UI SHALL display the Scope_Classification within 1 second using a distinct and consistent badge color for each of in-scope, adjacent, and out-of-scope, such that the three classifications are visually distinguishable from one another.

### Requirement 14: Session Recording and Export

**User Story:** As an IT candidate, I want my interview questions and answers saved and exportable, so that I can review my performance afterward.

#### Acceptance Criteria

1. WHEN an answer is generated for a Question, THE Session_Manager SHALL save the question-and-answer pair to a local JSON file.
2. THE Session_Manager SHALL include a snapshot of the active Session_Profile in the session file.
3. WHEN an interview ends, THE Session_Manager SHALL display the recorded session history.
4. WHEN the user activates the export control, THE Session_Manager SHALL write the session content to a Markdown file.

### Requirement 15: Performance and Resource Constraints

**User Story:** As an IT candidate, I want fast responses and a lightweight footprint, so that the assistant keeps pace with a live interview without slowing my machine.

#### Acceptance Criteria

1. WHEN a Question is finalized, THE System SHALL display the first AI answer content within 3 seconds.
2. WHILE the STT provider is configured as Deepgram, THE STT_Provider SHALL produce transcription output with latency under 2 seconds.
3. WHILE the System is idle, THE System SHALL consume less than 300 megabytes of memory.
4. THE System SHALL operate on macOS version 13 or later and on Windows 11.

### Requirement 16: Privacy

**User Story:** As an IT candidate, I want my data kept local and private, so that my interview activity is not tracked or leaked.

#### Acceptance Criteria

1. THE System SHALL store API keys only in the local Config_File.
2. THE System SHALL operate without collecting telemetry or analytics.
3. THE System SHALL store profile data only in the user home directory.
