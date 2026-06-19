# Requirements Document

## Introduction

The Interview Assistant SaaS is the version 2 architecture that evolves the existing Electron desktop "IT interview assistant" into a cloud-hosted service. In version 1 the entire pipeline ran on the candidate's machine: a Python sidecar captured audio and ran speech-to-text, and provider API keys were stored locally in `config.yaml` under a bring-your-own-key model. Version 2 splits the product into a thin desktop client and a cloud backend.

The Desktop_Client runs on the candidate's Windows PC and is responsible for authentication, environment selection, native audio capture (microphone plus Windows system-audio loopback), a screen-capture-excluded overlay, and rendering of live transcripts and streamed answers. Authentication is delegated to Supabase Auth as a third-party Identity_Provider, supporting both email/password and Google OAuth sign-in; the Backend verifies the provider-issued tokens and maps each verified identity to an Account. The Backend holds all provider API keys (Deepgram for speech-to-text; OpenAI, Anthropic, and Gemini for the LLM), so the candidate never enters any API key and the product works out of the box once signed in. Usage is gated by an account credit balance: the Backend meters speech-to-text minutes and LLM tokens, decrements credits, and enforces a hard stop when the balance reaches zero.

During an interview the Desktop_Client streams captured audio to the Backend over a single persistent session WebSocket. The Backend relays audio to the streaming speech-to-text provider, detects end-of-question via silence/endpointing, builds the prompt from the candidate's stored profile, calls the LLM, and streams partial transcripts and answer tokens back to the client. Several pure, well-tested domain modules from version 1 (topic detection, scope checking, prompt building, silence finalization and threshold resolution, session serialization and Markdown export, profile merge and validation) are reused but relocated to the Backend.

The product runs across three deployed environments — dev, pre-prod, and prod — plus a local environment for development. Credit enforcement is bypassed in dev and enforced in pre-prod and prod. Authentication is likewise bypassed in the local and dev environments — which exist solely for integration and performance testing, so no sign-in is required there — and enforced in pre-prod and prod. The Desktop_Client can target a selected environment.

This document defines the requirements for version 2. The billing and payment purchase flow (for example Stripe checkout) is explicitly out of scope for version 2; however, the credit ledger SHALL be designed so that credit-adding (purchase) entries can be recorded later. The version 1 Python sidecar and local faster-whisper engine are removed in version 2: there is no offline mode and all speech-to-text is performed through cloud providers.

## Glossary

- **System**: The Interview Assistant SaaS product as a whole, comprising the Desktop_Client and the Backend.
- **Desktop_Client**: The Electron desktop application that runs on the candidate's Windows PC.
- **Backend**: The cloud service that holds provider keys, performs metering and enforcement, relays audio, builds prompts, calls the LLM, and persists data.
- **User**: The authenticated candidate who signs in to the Desktop_Client and owns an Account.
- **Account**: The persisted record of a User, including the verified identity reference from the Identity_Provider and the associated Credit_Balance.
- **Identity_Provider**: The external third-party identity service (Supabase Auth) that authenticates Users and issues the Access_Token and Refresh_Token to the Desktop_Client. The Identity_Provider supports the Email_Password_Sign_In and Google_OAuth_Sign_In methods, and its token lifetimes are governed by its own configuration.
- **Email_Password_Sign_In**: The sign-in method in which the User authenticates to the Identity_Provider with an email address and a password.
- **Google_OAuth_Sign_In**: The sign-in method in which the User authenticates to the Identity_Provider through Google using an authorization-code-with-PKCE flow conducted in the system browser.
- **Token_Verification**: The Backend responsibility of verifying an Identity_Provider-issued Access_Token (for example against the Identity_Provider's public keys / JWKS) and mapping the verified identity to an Account.
- **Access_Token**: A short-lived token issued by the Identity_Provider and used by the Desktop_Client to authorize Backend requests; its lifetime is managed by the Identity_Provider, not by the Backend.
- **Refresh_Token**: A longer-lived token issued by the Identity_Provider and used by the Desktop_Client to obtain a new Access_Token without re-entering credentials; its lifetime is managed by the Identity_Provider, not by the Backend.
- **Token_Store**: The Desktop_Client component that stores authentication tokens in the operating-system secure credential store.
- **Credits_Service**: The Backend component that maintains the Credit_Balance, records Credit_Ledger entries, meters usage, and enforces credit limits.
- **Credit_Balance**: The current number of credits available on an Account, derived from the Credit_Ledger.
- **Credit_Ledger**: The append-only record of credit-changing entries (debits from usage and, in a later version, credits from purchases) for an Account.
- **Credit**: The unit of metered usage. Speech-to-text minutes and LLM tokens are converted to credits using a defined Conversion_Rate.
- **Conversion_Rate**: The defined mapping from metered speech-to-text minutes and LLM tokens to credits.
- **Usage_Record**: A persisted record of metered speech-to-text minutes and LLM tokens for a Session.
- **Session**: One interview, represented by a single persistent WebSocket connection between the Desktop_Client and the Session_Gateway, from start to finalization.
- **Session_Gateway**: The Backend component that terminates the Session WebSocket, relays audio to the STT_Provider, runs endpoint detection, builds prompts, calls the LLM_Provider, streams results back, and meters usage.
- **Session_Summary**: The record returned at the end of a Session containing final usage, credits consumed, and a reference to the persisted transcript and Q&A history.
- **STT_Provider**: The cloud speech-to-text provider invoked by the Backend, with Deepgram as the primary backend and OpenAI Whisper as an acceptable backend.
- **LLM_Provider**: The cloud large-language-model provider invoked by the Backend, selectable among OpenAI, Anthropic, and Gemini.
- **Profile**: The candidate's stored configuration (roles, seniority, skills, company type, name, target role, experience) used to build prompts.
- **Prompt_Builder**: The relocated Backend component that constructs the system prompt from the Profile and Scope_Classification.
- **Topic_Detector**: The relocated Backend component that classifies a Question into one or more IT topic domains.
- **Scope_Checker**: The relocated Backend component that classifies a Question as in-scope, adjacent, or out-of-scope.
- **Overlay_UI**: The frameless, always-on-top, screen-capture-excluded window of the Desktop_Client that displays the live transcript and streamed answer.
- **Audio_Capture**: The Desktop_Client component that natively captures microphone audio and Windows system-audio loopback.
- **Audio_Frame**: A chunk of captured PCM audio uploaded to the Session_Gateway over the Session WebSocket.
- **Partial_Transcript**: Interim, non-final transcribed text streamed from the Backend to the Desktop_Client during speech.
- **Question**: A finalized transcribed utterance produced after endpoint/silence detection that is sent to the LLM_Provider.
- **Environment**: One of the deployment targets the Desktop_Client can connect to: local, dev, pre-prod, or prod.
- **Credit_Enforcement_Mode**: The per-Environment setting determining whether credit limits are enforced; bypassed in local and dev, enforced in pre-prod and prod.
- **Auth_Enforcement_Mode**: The per-Environment setting determining whether authentication is enforced; bypassed in local and dev (no sign-in and no Token_Verification), enforced in pre-prod and prod (Identity_Provider sign-in plus Backend Token_Verification required). On a missing or unreadable Environment configuration the Backend applies it as enforced (fail-safe).
- **Dev_Account**: A fixed synthetic Account the Backend uses to attribute Sessions, Usage_Records, and Credit_Ledger entries when the Auth_Enforcement_Mode is bypassed, so persistence and metering still function without a verified identity. Each Environment with bypassed auth uses its own Dev_Account within that Environment's Supabase project.
- **Low_Credit_Threshold**: The Credit_Balance level at or below which the System warns the User during a Session.
- **Time_To_First_Answer_Token**: The elapsed time from end-of-question detection to delivery of the first answer token to the Desktop_Client.
- **Seniority_Level**: One of Junior, Mid, Senior, Staff, or Principal.
- **Company_Type**: One of Startup, Product, Service, or FAANG.
- **Scope_Classification**: One of in-scope, adjacent, or out-of-scope.

## Requirements

### Requirement 1: User Authentication and Sign-In

**User Story:** As a candidate, I want to sign in to my account from the desktop app, so that the app connects to my account and works without entering any API keys.

#### Acceptance Criteria

1. WHEN the User chooses to sign in from the Desktop_Client, THE Desktop_Client SHALL authenticate the User through the Identity_Provider using either Email_Password_Sign_In or Google_OAuth_Sign_In.
2. WHERE the User selects Google_OAuth_Sign_In or any other social sign-in method, THE Desktop_Client SHALL conduct the authentication using an authorization-code-with-PKCE flow in the system browser and SHALL NOT use an embedded webview.
3. WHEN the Identity_Provider successfully authenticates the User, THE Identity_Provider SHALL issue an Access_Token and a Refresh_Token to the Desktop_Client.
4. IF the User submits credentials that the Identity_Provider does not accept, THEN THE Desktop_Client SHALL display an authentication-failed error that does not disclose which credential field was incorrect.
5. THE Identity_Provider SHALL be configured to issue a short-lived Access_Token and a longer-lived Refresh_Token, and THE Desktop_Client SHALL treat the Access_Token as expiring and refresh it according to the Identity_Provider configuration.
6. WHEN the Desktop_Client holds an expired Access_Token AND holds a valid Refresh_Token, THE Desktop_Client SHALL obtain a new Access_Token from the Identity_Provider using the Refresh_Token.
7. IF a refresh request fails OR the Refresh_Token is invalid or expired, THEN THE Desktop_Client SHALL return the User to the sign-in screen.
8. WHEN the Backend receives a request, THE Backend SHALL verify the Access_Token against the Identity_Provider through Token_Verification, and IF the Access_Token is absent, expired, or invalid, THEN THE Backend SHALL reject the request with an authorization error and SHALL NOT perform the requested operation.
9. WHEN the Backend verifies an identity through Token_Verification for which no Account yet exists, THE Backend SHALL provision an Account and its associated Credit_Ledger for that verified identity.
10. WHEN the User activates the sign-out control, THE Desktop_Client SHALL delete the stored Access_Token and Refresh_Token from the Token_Store and SHALL sign the User out of the Identity_Provider session.
11. WHERE the Auth_Enforcement_Mode is enforced, acceptance criteria 1 through 10 of this requirement SHALL apply.
12. WHERE the Auth_Enforcement_Mode is bypassed, THE Desktop_Client SHALL skip the sign-in screen and connect without obtaining or sending an Access_Token, and THE Backend SHALL NOT perform Token_Verification and SHALL attribute the request to the Environment's Dev_Account.

### Requirement 2: Secure Token Storage on the Client

**User Story:** As a candidate, I want my sign-in to persist securely between launches, so that I do not have to re-enter credentials every time while keeping my tokens protected.

#### Acceptance Criteria

1. WHEN the Identity_Provider issues tokens to the Desktop_Client, THE Token_Store SHALL persist the Access_Token and Refresh_Token in the operating-system secure credential store.
2. WHEN the Desktop_Client launches AND an unexpired Refresh_Token exists in the Token_Store, THE Desktop_Client SHALL restore the authenticated session without prompting for credentials.
3. IF the Desktop_Client cannot reach the Identity_Provider to validate an existing token at launch, THEN THE Desktop_Client SHALL attempt session restoration using the stored tokens rather than prompting for credentials.
4. WHEN the Desktop_Client launches AND no unexpired token exists in the Token_Store, THE Desktop_Client SHALL display the sign-in screen.
5. THE Desktop_Client SHALL store authentication tokens only in the operating-system secure credential store.
6. IF a stored token cannot be read or decrypted from the Token_Store, THEN THE Desktop_Client SHALL display the sign-in screen and SHALL simultaneously present an error indication that the saved session could not be restored.
7. WHERE the Auth_Enforcement_Mode is bypassed, THE Desktop_Client SHALL NOT require or store authentication tokens and SHALL proceed directly without prompting for credentials; acceptance criteria 1 through 6 of this requirement apply only WHERE the Auth_Enforcement_Mode is enforced.

### Requirement 3: Environment Selection

**User Story:** As a candidate or developer, I want to choose which environment the app connects to, so that I can use local, dev, pre-prod, or prod backends with the correct behavior.

#### Acceptance Criteria

1. THE Desktop_Client SHALL allow the User to select exactly one Environment from local, dev, pre-prod, and prod.
2. WHEN the User selects an Environment, THE Desktop_Client SHALL direct all subsequent Credits_Service and Session_Gateway requests to the Backend base URL configured for the selected Environment and SHALL use the Identity_Provider configuration for the selected Environment.
3. WHERE an Environment is selected, THE Desktop_Client SHALL authenticate against the separate Identity_Provider (Supabase) project configured for that Environment, such that identity is isolated per Environment.
4. WHILE an Environment is selected, THE Desktop_Client SHALL display an indication of the currently selected Environment.
5. WHERE no Environment is selected, THE Desktop_Client SHALL hide the Environment indication.
6. WHEN the User changes the selected Environment while signed in, THE Desktop_Client SHALL sign the User out of the previous Environment and display the sign-in screen for the newly selected Environment, and IF the sign-out fails, THEN THE Desktop_Client SHALL still proceed to the newly selected Environment's sign-in screen.
7. WHERE the selected Environment is prod, THE Desktop_Client SHALL default the selected Environment to prod on the next launch.

### Requirement 4: Native Audio Capture

**User Story:** As a candidate, I want the app to capture my microphone and the interviewer's system audio natively, so that all interview questions can be transcribed without a separate sidecar process.

#### Acceptance Criteria

1. WHILE Audio_Capture is active, THE Desktop_Client SHALL capture microphone audio in real time as PCM Audio_Frames.
2. WHILE Audio_Capture is active, THE Desktop_Client SHALL capture Windows system-audio loopback in real time as PCM Audio_Frames.
3. WHEN the User presses the audio-capture hotkey, THE Desktop_Client SHALL toggle Audio_Capture between active and inactive states.
4. WHILE Audio_Capture is active, THE Overlay_UI SHALL display a visual indicator showing that audio is being captured.
5. IF Windows system-audio loopback capture is unavailable, THEN THE Desktop_Client SHALL continue capturing microphone audio, SHALL display an indication that system-audio capture is degraded, and SHALL report the degraded capture state.
6. THE Desktop_Client SHALL perform all audio capture natively within the Electron process without launching a separate audio-capture or speech-to-text subprocess.

### Requirement 5: Session WebSocket Protocol

**User Story:** As a candidate, I want a single live connection per interview that streams my audio up and brings transcripts and answers back, so that the assistant responds in real time.

#### Acceptance Criteria

1. WHEN the User starts an interview, THE Desktop_Client SHALL open exactly one persistent WebSocket Session to the Session_Gateway for the selected Environment.
2. WHERE the Auth_Enforcement_Mode is enforced, WHEN the Desktop_Client opens the Session WebSocket, THE Desktop_Client SHALL include the Access_Token in the connection request and THE Session_Gateway SHALL reject the connection with an authorization error WHEN the Access_Token is absent, expired, or invalid.
2a. WHERE the Auth_Enforcement_Mode is bypassed, THE Session_Gateway SHALL accept the Session WebSocket connection without an Access_Token and SHALL attribute the Session to the Environment's Dev_Account.
3. WHILE a Session is open AND Audio_Capture is active, THE Desktop_Client SHALL upload captured Audio_Frames to the Session_Gateway over the Session WebSocket.
4. WHILE a Session is open, THE Session_Gateway SHALL stream Partial_Transcript messages to the Desktop_Client as interim transcribed text becomes available.
5. WHILE a Session is open, THE Session_Gateway SHALL stream answer tokens to the Desktop_Client incrementally as the LLM_Provider produces them.
6. WHEN the Session_Gateway finalizes a Question, THE Session_Gateway SHALL send a final-question message identifying the finalized Question text to the Desktop_Client.
7. WHEN the Session_Gateway detects a speech-to-text failure, THE Session_Gateway SHALL send an error message identifying the failure to the Desktop_Client and SHALL keep the Session open.
8. WHEN the User stops the interview, THE Desktop_Client SHALL send a stop-session message to the Session_Gateway over the Session WebSocket.

### Requirement 6: Overlay UI and Screen-Capture Exclusion

**User Story:** As a candidate, I want the answer overlay to stay on top yet remain invisible during screen sharing, so that I can read answers without the interviewer detecting the tool.

#### Acceptance Criteria

1. THE Overlay_UI SHALL render as a frameless, always-on-top window with adjustable background transparency.
2. WHEN the display containing the Overlay_UI is captured, recorded, or shared by any screen-capture method on Windows, THE resulting captured or shared output SHALL NOT contain any pixels of the Overlay_UI.
3. IF the operating system or its current configuration does not support screen-capture exclusion for the Overlay_UI, THEN THE Desktop_Client SHALL display a warning that screen-share invisibility is unavailable and SHALL keep the Overlay_UI rendered.
4. THE Overlay_UI SHALL display the live transcript in its top section, updating as Partial_Transcript messages arrive.
5. THE Overlay_UI SHALL display the AI answer in its bottom section, rendering answer tokens incrementally as they arrive.
6. WHEN the Backend sends a topic classification for a Question, THE Overlay_UI SHALL display the detected topic as a badge.
7. WHEN the Backend sends a Scope_Classification for a Question, THE Overlay_UI SHALL display the Scope_Classification using a distinct and consistent badge color for each of in-scope, adjacent, and out-of-scope.
8. WHEN the User activates the copy control, THE Desktop_Client SHALL copy the current AI answer to the system clipboard.

### Requirement 7: Credit Balance Display and Session History

**User Story:** As a candidate, I want to see my credit balance and review past interviews from the app, so that I can manage my usage and study afterward.

#### Acceptance Criteria

1. WHEN the Desktop_Client restores or establishes an authenticated session, THE Desktop_Client SHALL request and display the current Credit_Balance from the Credits_Service.
2. WHEN a Session ends and returns a Session_Summary, THE Desktop_Client SHALL update the displayed Credit_Balance to reflect the credits consumed by the Session.
3. WHEN the User opens the session history view, THE Desktop_Client SHALL request and display the list of the User's persisted past Sessions from the Backend.
4. WHEN the User selects a past Session, THE Desktop_Client SHALL display the persisted transcript and Q&A history for that Session.
5. WHEN the User activates the export control for a Session, THE Desktop_Client SHALL produce a Markdown export containing every Question and answer of that Session.

### Requirement 8: Credit Pre-Session Check

**User Story:** As a candidate, I want the app to confirm I have credits before an interview starts, so that I do not begin an interview that immediately stops.

#### Acceptance Criteria

1. WHEN the User requests to start an interview, THE Credits_Service SHALL evaluate the Account Credit_Balance before the Session_Gateway begins relaying audio.
2. WHERE the Credit_Enforcement_Mode is enforced AND the Credit_Balance is greater than zero, THE Credits_Service SHALL authorize the Session to start and SHALL NOT reject the Session start for insufficient credits.
3. IF the Credit_Enforcement_Mode is enforced AND the Credit_Balance is zero or less, THEN THE Credits_Service SHALL reject the Session start and THE Desktop_Client SHALL display an indication that the Credit_Balance is insufficient to start an interview.
4. WHERE the Credit_Enforcement_Mode is bypassed, THE Credits_Service SHALL authorize the Session to start regardless of the Credit_Balance.

### Requirement 9: Live Usage Metering

**User Story:** As a candidate, I want my usage measured accurately during the interview, so that my credits reflect the speech-to-text and AI usage I actually consume.

#### Acceptance Criteria

1. WHILE a Session is open, THE Credits_Service SHALL meter the speech-to-text minutes relayed to the STT_Provider for that Session.
2. WHILE a Session is open, THE Credits_Service SHALL meter the LLM tokens consumed by the LLM_Provider for that Session.
3. THE Credits_Service SHALL convert metered speech-to-text minutes and LLM tokens into credits using the defined Conversion_Rate.
4. WHILE a Session is open AND the Credit_Enforcement_Mode is enforced, THE Credits_Service SHALL decrement the Credit_Balance as metered usage accrues during the Session.
5. WHERE the Credit_Enforcement_Mode is bypassed, THE Credits_Service SHALL record metered usage as a Usage_Record without decrementing the Credit_Balance.

### Requirement 10: Low-Credit Warning and Hard Stop

**User Story:** As a candidate, I want to be warned when my credits run low and have the session stop cleanly at zero, so that I am not surprised and the session ends in a known state.

#### Acceptance Criteria

1. WHILE a Session is open AND the Credit_Enforcement_Mode is enforced, WHEN the Credit_Balance falls to or below the Low_Credit_Threshold, THE Session_Gateway SHALL send a low-credit warning to the Desktop_Client and THE Overlay_UI SHALL display a low-credit warning.
2. WHILE a Session is open AND the Credit_Enforcement_Mode is enforced, WHEN the Credit_Balance reaches zero, THE Session_Gateway SHALL stop relaying audio to the STT_Provider and stop requesting answers from the LLM_Provider for that Session.
3. WHEN the Session_Gateway performs a credit-exhaustion hard stop, THE Session_Gateway SHALL finalize the Session with an end reason of credits-exhausted and SHALL notify the Desktop_Client that the Session ended because credits were exhausted.
4. WHERE the Credit_Enforcement_Mode is bypassed, THE Session_Gateway SHALL NOT perform a credit-exhaustion hard stop.

### Requirement 11: Credit Ledger

**User Story:** As a candidate, I want an accurate, auditable record of how my credits change, so that my balance is trustworthy and future purchases can be added.

#### Acceptance Criteria

1. WHEN a Session is finalized, THE Credits_Service SHALL append exactly one debit Credit_Ledger entry recording the credits consumed by that Session.
2. THE Credit_Balance SHALL equal the sum of all Credit_Ledger entries for the Account.
3. THE Credit_Ledger SHALL be append-only such that recorded entries are not modified or deleted after they are written.
4. THE Credit_Ledger SHALL represent each entry with an entry type that distinguishes usage debits from credit additions, so that purchase-based credit additions can be recorded in a later version.
5. WHERE the Credit_Enforcement_Mode is bypassed, THE Credits_Service SHALL append a debit Credit_Ledger entry with a marker indicating the entry is non-enforced, so that dev usage is recorded without reducing an enforced Credit_Balance.

### Requirement 12: Session Lifecycle and Finalization

**User Story:** As a candidate, I want each interview to start, run, and end in a well-defined way regardless of how it ends, so that my usage and history are always recorded correctly.

#### Acceptance Criteria

1. WHEN the Credits_Service authorizes a Session to start, THE Session_Gateway SHALL create a Session record and begin relaying audio.
2. WHEN the User ends the interview, THE Session_Gateway SHALL finalize the Session with an end reason of user-ended.
3. WHEN the Credit_Balance reaches zero during an enforced Session, THE Session_Gateway SHALL finalize the Session with an end reason of credits-exhausted.
4. IF the Session WebSocket disconnects or the Desktop_Client crashes during a Session, THEN THE Session_Gateway SHALL finalize the Session with an end reason of disconnected.
5. WHEN the Session_Gateway finalizes a Session, THE Session_Gateway SHALL compute the final usage, write the debit Credit_Ledger entry, and persist the Session transcript and Q&A history.
6. WHEN the Session_Gateway finalizes a Session that ended with reason user-ended, THE Session_Gateway SHALL return a Session_Summary to the Desktop_Client containing the final usage, the credits consumed, and a reference to the persisted transcript and Q&A history.
7. THE Session_Gateway SHALL finalize each Session exactly once such that repeated finalization triggers for the same Session do not produce more than one debit Credit_Ledger entry.

### Requirement 13: Cloud Speech-to-Text Relay and Endpoint Detection

**User Story:** As a candidate, I want my audio transcribed in the cloud with accurate end-of-question detection, so that I see live transcripts and questions are finalized at the right moment.

#### Acceptance Criteria

1. WHILE a Session is open, THE Session_Gateway SHALL relay uploaded Audio_Frames to the STT_Provider as a streaming request.
2. WHERE the STT_Provider is configured as Deepgram, THE Session_Gateway SHALL transcribe relayed audio using the Deepgram streaming API.
3. WHERE the STT_Provider is configured as OpenAI Whisper, THE Session_Gateway SHALL transcribe relayed audio using the OpenAI Whisper API.
4. WHEN the STT_Provider returns interim transcribed text, THE Session_Gateway SHALL stream a Partial_Transcript message to the Desktop_Client.
5. WHEN a silence interval that meets or exceeds the configured silence threshold is detected following speech, THE Session_Gateway SHALL finalize the preceding speech as a Question.
6. THE Session_Gateway SHALL accept a configurable silence threshold within the range of 0.3 to 5.0 seconds, and WHERE no value is configured, THE Session_Gateway SHALL apply a default silence threshold of 1.5 seconds.
7. IF captured audio relayed to the STT_Provider contains no recognizable speech, THEN THE Session_Gateway SHALL produce no transcribed text and SHALL NOT finalize a Question for that audio.
8. IF the STT_Provider cannot be reached or returns no transcription within 2 seconds of audio being relayed, THEN THE Session_Gateway SHALL report a speech-to-text failure to the Desktop_Client and SHALL keep the Session open.
9. WHILE a Session is open AND no Audio_Frames are currently being uploaded, THE Session_Gateway SHALL wait for Audio_Frames to become available without producing transcribed text.

### Requirement 14: Prompt Construction, Topic Detection, and Scope Classification

**User Story:** As a candidate, I want the AI to answer as me with my background and framed by how the question relates to my skills, so that answers sound authentic.

#### Acceptance Criteria

1. WHEN a Question is finalized, THE Topic_Detector SHALL classify the Question into one or more IT topic domains, producing a possibly empty deduplicated set.
2. WHEN a Question is classified by topic, THE Scope_Checker SHALL assign exactly one Scope_Classification of in-scope, adjacent, or out-of-scope to the Question relative to the Profile roles.
3. IF the Topic_Detector produces no detected topic OR produces an empty topic set for a Question, THEN THE Scope_Checker SHALL classify the Question as out-of-scope.
4. WHEN a Question is ready for answering, THE Prompt_Builder SHALL construct a system prompt that includes the Profile name, seniority, roles, skills, company type, and target role, and instructs the LLM_Provider to answer in first person, to adapt depth to the Seniority_Level, and to provide an answer for every Question.
5. WHERE the Scope_Classification is in-scope, THE Prompt_Builder SHALL frame the prompt to produce an expert-level answer drawing on the Profile skills.
6. WHERE the Scope_Classification is adjacent, THE Prompt_Builder SHALL frame the prompt as exposure or cross-team collaboration.
7. WHERE the Scope_Classification is out-of-scope, THE Prompt_Builder SHALL frame the prompt in the persona of a well-rounded senior IT professional.

### Requirement 15: LLM Answer Generation and Streaming

**User Story:** As a candidate, I want the backend to call the configured AI provider and stream the answer back token by token, so that I can start reading the answer immediately.

#### Acceptance Criteria

1. WHEN a Question is finalized, THE Session_Gateway SHALL send the Question and the constructed system prompt to the configured LLM_Provider.
2. WHERE the LLM_Provider is configured as OpenAI, THE Session_Gateway SHALL generate answers using the OpenAI backend.
3. WHERE the LLM_Provider is configured as Anthropic, THE Session_Gateway SHALL generate answers using the Anthropic backend.
4. WHERE the LLM_Provider is configured as Gemini, THE Session_Gateway SHALL generate answers using the Gemini backend.
5. WHILE the LLM_Provider generates an answer, THE Session_Gateway SHALL stream answer tokens to the Desktop_Client incrementally as the tokens are produced.
6. IF the LLM_Provider returns an error or does not respond within 30 seconds, THEN THE Session_Gateway SHALL abort the request, return no answer for that Question, and report a backend-invocation error identifying the configured provider to the Desktop_Client.

### Requirement 16: Latency

**User Story:** As a candidate, I want answers to begin almost immediately after I stop speaking, so that the conversation does not stall.

#### Acceptance Criteria

1. WHEN the Session_Gateway detects end-of-question, THE Session_Gateway SHALL deliver the first answer token to the Desktop_Client within a Time_To_First_Answer_Token of 2.5 seconds.
2. WHILE the STT_Provider produces interim transcribed text, THE Session_Gateway SHALL stream Partial_Transcript messages to the Desktop_Client at least once every 500 milliseconds as new transcribed text becomes available.
3. THE Session_Gateway SHALL record per-stage latency measurements for audio relay, end-of-question detection, prompt construction, first STT result, and first answer token for each Question.

### Requirement 17: Persistence

**User Story:** As a candidate, I want my account, profile, credits, and interview history reliably stored on the backend, so that my data is consistent across devices and sessions.

#### Acceptance Criteria

1. THE Backend SHALL persist each Account, including identity, credential references, and Credit_Balance derivation data.
2. THE Backend SHALL persist each User's Profile.
3. THE Backend SHALL persist each Credit_Ledger entry.
4. THE Backend SHALL persist each Session, including its end reason, start time, and end time.
5. THE Backend SHALL persist the transcript and Q&A history for each finalized Session.
6. THE Backend SHALL persist each Usage_Record associating metered speech-to-text minutes and LLM tokens with a Session.
7. WHEN the Session_Gateway persists a transcript and Q&A history, THE Backend SHALL associate the persisted data with the owning Account such that a User can retrieve only that User's own Sessions.

### Requirement 18: Server-Side Provider Key Management

**User Story:** As a candidate, I want the service to manage all provider keys for me, so that I never enter an API key and my client never holds any secret.

#### Acceptance Criteria

1. THE Backend SHALL store all provider API keys for the STT_Provider and the LLM_Provider server-side.
2. THE Backend SHALL transmit each provider API key only to its corresponding provider API.
3. THE Desktop_Client SHALL NOT store, request, or receive any provider API key.
4. WHEN the Session_Gateway invokes the STT_Provider or the LLM_Provider, THE Backend SHALL supply from server-side storage only the provider API key for the specific provider being invoked.
5. THE Desktop_Client SHALL operate without any User-entered provider API key.
6. THE Desktop_Client SHALL hold only the Identity_Provider publishable client key required for authentication, which is not a provider API key, and THE Backend SHALL hold the Identity_Provider service-role key server-side only.

### Requirement 19: Multi-Environment Behavior

**User Story:** As a developer, I want dev, pre-prod, and prod to behave consistently with their purpose, so that I can test freely in dev while pre-prod mirrors prod.

#### Acceptance Criteria

1. WHERE the Environment is local or dev, THE Credits_Service SHALL apply Credit_Enforcement_Mode bypassed such that credit limits are not enforced.
2. WHERE the Environment is pre-prod, THE Credits_Service SHALL apply Credit_Enforcement_Mode enforced such that credit limits are enforced identically to prod.
3. WHERE the Environment is prod, THE Credits_Service SHALL apply Credit_Enforcement_Mode enforced such that credit limits are enforced.
4. THE Backend SHALL determine the Credit_Enforcement_Mode from the Environment configuration of the Backend instance handling the request.
5. IF the Environment configuration that determines the Credit_Enforcement_Mode is missing or cannot be read, THEN THE Backend SHALL fail safe by applying Credit_Enforcement_Mode enforced.
6. THE Backend SHALL isolate Account, Profile, Credit_Ledger, Session, and Usage_Record data per Environment such that data created in one Environment is not visible from another Environment.
7. THE System SHALL use a separate Identity_Provider (Supabase) project for each Environment of local, dev, pre-prod, and prod, such that identity and data are isolated per Environment.
8. WHERE the Environment is local or dev, THE Backend SHALL apply Auth_Enforcement_Mode bypassed such that authentication is not enforced and the Session is attributed to the Environment's Dev_Account.
9. WHERE the Environment is pre-prod or prod, THE Backend SHALL apply Auth_Enforcement_Mode enforced such that Identity_Provider sign-in and Backend Token_Verification are required.
10. IF the Environment configuration that determines the Auth_Enforcement_Mode is missing or cannot be read, THEN THE Backend SHALL fail safe by applying Auth_Enforcement_Mode enforced.

### Requirement 20: Privacy and Security

**User Story:** As a candidate, I want my keys protected and my overlay hidden, so that the tool is private and undetectable during interviews.

#### Acceptance Criteria

1. THE System SHALL keep all provider API keys server-side and SHALL NOT expose any provider API key to the Desktop_Client.
2. WHEN the display containing the Overlay_UI is shared by any screen-capture method on Windows, THE resulting shared output SHALL NOT contain any pixels of the Overlay_UI.
3. THE Backend SHALL transmit Session audio, transcripts, Access_Tokens, and Refresh_Tokens only over encrypted transport.
4. WHEN a User requests deletion of a persisted Session, THE Backend SHALL delete that Session's transcript and Q&A history and SHALL retain the corresponding Credit_Ledger entry.
5. THE Backend SHALL associate every persisted transcript and Q&A history with exactly one owning Account and SHALL reject any request by a User to read another User's transcript or Q&A history.
6. IF a Session deletion fails after deleting part of the transcript and Q&A history, THEN THE Backend SHALL retain the corresponding Credit_Ledger entry and SHALL report the deletion as incomplete to the requesting User.

## Out of Scope for Version 2

- **Billing and payment purchase flow**: The purchase of credits through a payment provider such as Stripe is out of scope for version 2. The Credit_Ledger is required to support a credit-addition entry type (Requirement 11.4) so that purchase-based credit additions can be recorded in a later version.
- **Offline mode**: There is no offline mode. The version 1 Python sidecar and local faster-whisper engine are removed; all speech-to-text is performed through cloud providers.
- **Non-Windows desktop clients**: Native system-audio loopback capture targets Windows for version 2.
- **Multi-language speech-to-text, resume parsing, interviewer video capture, and mock interview mode**: These remain out of scope as in version 1.
