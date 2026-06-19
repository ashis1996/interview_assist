# IT Interview Assistant — Requirements

## 1. Overview

A desktop application that provides real-time AI-powered assistance during IT industry interviews — covering Software Development, QA, DevOps, Cloud, Architecture, Management, Data Engineering, Security, and more. It listens to interview audio, transcribes questions in real time, and generates expert-level answers using a configurable LLM provider (Claude, OpenAI, or Gemini) — swappable via a single config file.

Before each interview, the candidate sets up their profile (roles, seniority, skills). The LLM always answers any question — selected skills bias the persona; out-of-scope questions are handled as a well-rounded IT professional.

---

## 2. Goals

- Help IT professionals confidently answer interview questions in real time
- Support all major IT roles and domains — not limited to any single discipline
- Let candidates define their profile once (saved as default) and optionally override per session
- Be LLM-agnostic — swap providers by changing 3 lines in config
- Run invisibly as a screen overlay (undetectable to interviewers)
- Always provide an answer — never fail silently on out-of-scope questions

---

## 3. Target Users

| Role Category | Examples |
|---|---|
| Software Development | Frontend, Backend, Full Stack, Mobile |
| QA & Testing | Manual QA, Automation, Performance, SDET |
| DevOps & SRE | DevOps Engineer, SRE, Platform Engineer |
| Cloud | Cloud Engineer, Solutions Architect, FinOps |
| Architecture | System Architect, Enterprise Architect, API Architect |
| Management & Leadership | Engineering Manager, Tech Lead, Scrum Master, Product Owner |
| Data Engineering | Data Engineer, ML Engineer, Analytics Engineer |
| Security | AppSec, Cloud Security, Pen Tester, SOC Analyst |

---

## 4. User Profile System

### 4.1 Default Profile
- Stored in `~/.it-interview-assistant/profile.json`
- Loaded automatically on every app launch
- Editable via the Profile Setup screen in the app
- Persists across sessions

### 4.2 Session Override
- Before starting any interview, the user can override the default profile for that session only
- Session override is not saved to default profile unless explicitly chosen
- If no override is made, default profile is used as-is

### 4.3 Profile Schema

```json
{
  "name": "Ashis",
  "experience_years": 5,
  "seniority": "Senior",
  "roles": ["Full Stack Developer", "DevOps Engineer"],
  "skills": ["React", "Node.js", "Kubernetes", "AWS", "GitHub Actions"],
  "company_type": "Product",
  "target_role": "Senior Full Stack Engineer"
}
```

---

## 5. Functional Requirements

### 5.1 Pre-Interview Setup Screen

| ID | Requirement |
|----|-------------|
| F-01 | Show setup screen on first launch and on-demand via menu |
| F-02 | Let user select one or more role categories (multi-select) |
| F-03 | Let user select seniority level: Junior / Mid / Senior / Staff / Principal |
| F-04 | Show skill chips per selected role — user picks relevant ones (multi-select) |
| F-05 | Let user input experience years, name, and target role as free text |
| F-06 | Let user select company type: Startup / Product / Service / FAANG |
| F-07 | Save profile as default with "Save as Default" button |
| F-08 | Allow one-time session override without overwriting default |
| F-09 | Show currently loaded profile summary before starting interview |
| F-10 | "Start Interview" button activates overlay and begins audio capture |

### 5.2 Audio Capture

| ID | Requirement |
|----|-------------|
| F-11 | Capture microphone audio in real time |
| F-12 | Capture system audio (interviewer voice via Zoom/Meet/Teams) |
| F-13 | Toggle audio capture ON/OFF with a hotkey |
| F-14 | Visual indicator showing when audio is being captured |

### 5.3 Speech-to-Text (STT)

| ID | Requirement |
|----|-------------|
| F-15 | Transcribe audio to text in real time with < 2 second latency |
| F-16 | Support Deepgram API as default STT provider |
| F-17 | Support OpenAI Whisper API as STT fallback |
| F-18 | Support local faster-whisper for fully offline mode |
| F-19 | Auto-detect end of question via silence detection (configurable threshold) |
| F-20 | Display live transcription in the overlay panel |

### 5.4 AI Answer Generation

| ID | Requirement |
|----|-------------|
| F-21 | Send transcribed question to configured LLM |
| F-22 | Support Claude (claude-sonnet-4) as LLM provider |
| F-23 | Support OpenAI (gpt-4.1, gpt-4o) as LLM provider |
| F-24 | Support Google Gemini (gemini-1.5-pro) as LLM provider |
| F-25 | Stream AI response token by token in the UI |
| F-26 | Build dynamic system prompt from active session profile |
| F-27 | Handle in-scope questions with expert-level persona and personal examples |
| F-28 | Handle out-of-scope questions as a well-rounded senior IT professional |
| F-29 | Handle adjacent-scope questions with confident exposure framing |
| F-30 | Allow manual question input (type instead of speak) |
| F-31 | Support regenerating an answer with a single click |

### 5.5 Configuration

| ID | Requirement |
|----|-------------|
| F-32 | Single `config.yaml` at project root for LLM and STT keys |
| F-33 | Set LLM provider by changing `llm.provider` in config |
| F-34 | Set API keys directly in config — no UI required |
| F-35 | Set STT provider in config |
| F-36 | Hot-reload config without restarting the app |

### 5.6 Overlay UI

| ID | Requirement |
|----|-------------|
| F-37 | Transparent always-on-top overlay window |
| F-38 | Overlay must NOT appear in screen share or recording |
| F-39 | Draggable and repositionable |
| F-40 | Resizable overlay panel |
| F-41 | Show live transcript in top section |
| F-42 | Show AI answer in bottom section with streaming text |
| F-43 | Copy answer to clipboard with one click |
| F-44 | Toggle overlay visibility with a global hotkey |
| F-45 | Opacity control slider (0–100%) |
| F-46 | Show active role + seniority badge in overlay header |

### 5.7 Topic Detection

| ID | Requirement |
|----|-------------|
| F-47 | Auto-detect topic domain from question text |
| F-48 | Detect topics across all IT domains (see Section 6) |
| F-49 | Display detected topic as a badge in the overlay |
| F-50 | Flag out-of-scope topics visually (different badge color) |

### 5.8 Session Management

| ID | Requirement |
|----|-------------|
| F-51 | Auto-save all Q&A pairs from a session to local JSON file |
| F-52 | Include active profile snapshot in session file |
| F-53 | Session history viewable after interview ends |
| F-54 | Export session as Markdown file |

---

## 6. IT Domain Coverage

### Skill Library (per role — used in setup screen chips)

| Role | Skills |
|------|--------|
| Frontend Dev | React, Vue, Angular, TypeScript, CSS, Next.js, Web Performance |
| Backend Dev | Node.js, Java, Python, Go, REST API, GraphQL, Microservices, SQL |
| Full Stack | React + Node, System Design, Auth, DB Design, Deployment |
| Mobile Dev | React Native, Flutter, iOS (Swift), Android (Kotlin) |
| QA / SDET | Selenium, Cypress, Playwright, Jest, API Testing, Performance Testing, Test Strategy |
| DevOps | Kubernetes, Docker, Terraform, CI/CD, Linux, Ansible, Helm |
| SRE | SLO/SLI/SLA, Incident Management, Observability, Chaos Engineering |
| Cloud (AWS) | EC2, S3, Lambda, IAM, VPC, RDS, EKS, CloudFormation |
| Cloud (GCP) | GKE, Cloud Run, BigQuery, Pub/Sub, GCS |
| Cloud (Azure) | AKS, Azure Functions, Cosmos DB, ARM Templates |
| Architect | System Design, Microservices, Event-Driven, CQRS, API Design, DDD |
| Engineering Manager | Agile, Scrum, Team Building, Roadmap, Stakeholder Management, OKRs |
| Tech Lead | Code Review, Architecture Decisions, Mentoring, Tech Debt |
| Data Engineer | Spark, Kafka, Airflow, dbt, Data Modeling, Lakehouse |
| ML Engineer | PyTorch, TensorFlow, MLOps, Feature Store, Model Serving |
| Security | OWASP, Pen Testing, IAM, Zero Trust, SAST/DAST, Cloud Security |

---

## 7. Out-of-Scope Handling

| Situation | LLM Behavior | Badge Color |
|-----------|-------------|-------------|
| Within selected skills | Answer as expert with personal examples from their stack | Green |
| Adjacent to selected role | Answer confidently, frame as exposure / cross-team collaboration | Yellow |
| Completely outside scope | Answer as a well-rounded senior IT professional | Orange |

The LLM **never refuses** a question. It always provides a useful answer.

---

## 8. Non-Functional Requirements

| ID | Requirement |
|----|-------------|
| NF-01 | First AI answer appears within 3 seconds of question ending |
| NF-02 | STT latency < 2 seconds (Deepgram mode) |
| NF-03 | App memory usage < 300MB at idle |
| NF-04 | Works on macOS 13+ and Windows 11 |
| NF-05 | API keys stored only in local config, never transmitted except to provider APIs |
| NF-06 | No telemetry or analytics collected |
| NF-07 | Overlay window excluded from OBS / Zoom screen capture |
| NF-08 | Profile data stored only locally in user home directory |

---

## 9. LLM Provider Config Contract

Switching LLMs requires only editing `config.yaml`:

```yaml
llm:
  provider: claude          # Options: claude | openai | gemini
  model: claude-sonnet-4    # Model name (auto-selected if blank)
  api_key: sk-ant-...

stt:
  provider: deepgram        # Options: deepgram | whisper-api | whisper-local
  api_key: dg-...
  language: en-US

audio:
  source: both              # microphone | system | both
  silence_threshold_ms: 1500

overlay:
  hotkey: CommandOrControl+Shift+Space
  default_opacity: 90
  position: top-right
```

User profile lives separately in `~/.it-interview-assistant/profile.json` — not in config.yaml.

---

## 10. Out of Scope (v1)

- Resume upload / parsing
- Multi-language STT support
- Mobile version
- Cloud sync of sessions or profiles
- Video / screen capture of interviewer
- Mock interview / practice mode (v2)

---

## 11. Milestones

| Phase | Deliverable | Est. Time |
|-------|-------------|-----------|
| 1 | Project scaffold + config system + profile storage | Day 1 |
| 2 | Pre-interview setup screen (roles, skills, seniority) | Day 2 |
| 3 | Audio capture + Deepgram STT | Day 3 |
| 4 | LLM integration (Claude + OpenAI + Gemini) + dynamic prompt builder | Day 4 |
| 5 | Electron overlay UI | Day 5–6 |
| 6 | Topic detection (all IT domains) + out-of-scope handling | Day 7 |
| 7 | Session save + export + profile default/override flow | Day 8 |
