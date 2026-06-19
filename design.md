# IT Interview Assistant — Design

## 1. Architecture Overview

```
┌────────────────────────────────────────────────────────────────┐
│                        Electron App                             │
│                                                                 │
│  ┌─────────────────┐    ┌──────────────────────────────────┐  │
│  │   Setup Screen  │    │          Main Process             │  │
│  │   (Renderer)    │    │                                   │  │
│  │                 │    │  ┌───────────┐  ┌─────────────┐  │  │
│  │ - Role picker   │    │  │  Config   │  │   Profile   │  │  │
│  │ - Skill chips   │    │  │  Loader   │  │   Manager   │  │  │
│  │ - Seniority     │    │  └───────────┘  └─────────────┘  │  │
│  │ - Save default  │    │        │               │           │  │
│  └────────┬────────┘    │  ┌─────▼───────────────▼──────┐  │  │
│           │             │  │      Prompt Builder          │  │  │
│  ┌────────▼────────┐    │  │  (dynamic per session)       │  │  │
│  │  Overlay UI     │    │  └─────────────┬────────────────┘  │  │
│  │  (Renderer)     │◄──►│               │                    │  │
│  │                 │    │  ┌─────────────▼────────────────┐  │  │
│  │ - Transcript    │    │  │        Audio Capture          │  │  │
│  │ - AI Answer     │    │  └─────────────┬────────────────┘  │  │
│  │ - Topic badge   │    │               │                    │  │
│  │ - Scope badge   │    │  ┌─────────────▼────────────────┐  │  │
│  │ - Controls      │    │  │        STT Provider           │  │  │
│  └─────────────────┘    │  └─────────────┬────────────────┘  │  │
│                          │               │                    │  │
│                          │  ┌─────────────▼────────────────┐  │  │
│                          │  │        LLM Provider           │  │  │
│                          │  │   (claude | openai | gemini)  │  │  │
│                          │  └──────────────────────────────┘  │  │
│                          │                                     │  │
│                          │  ┌──────────────────────────────┐  │  │
│                          │  │  Topic Detector + Scope Check │  │  │
│                          │  └──────────────────────────────┘  │  │
│                          │                                     │  │
│                          │  ┌──────────────────────────────┐  │  │
│                          │  │       Session Manager         │  │  │
│                          │  └──────────────────────────────┘  │  │
│                          └──────────────────────────────────┘  │  │
└────────────────────────────────────────────────────────────────┘
         │                    │                    │
    Deepgram API         Claude API           OpenAI API
    Whisper API          Gemini API
```

---

## 2. Tech Stack

| Layer | Technology | Reason |
|-------|-----------|--------|
| App shell | Electron 30 | Cross-platform desktop, overlay + screen protection support |
| Frontend | React 18 + Tailwind | Fast UI, good component model |
| Backend logic | Node.js (main process) | Same runtime, no separate server |
| STT (default) | Deepgram WebSocket API | Lowest latency real-time STT |
| STT (fallback) | OpenAI Whisper API | Good accuracy, easy setup |
| STT (offline) | faster-whisper (Python subprocess) | No API needed |
| LLM | Claude / OpenAI / Gemini | Configurable via config.yaml |
| Config | js-yaml | Simple YAML parsing |
| Profile storage | JSON file in user home dir | Simple, local, no DB needed |
| Audio capture | node-record-lpcm16 | Mic capture on Node |
| System audio | BlackHole (mac) / VB-Cable (win) | Route system audio to mic |
| Hotkeys | electron-globalShortcut | Global hotkeys work even when window unfocused |

---

## 3. Project Structure

```
it-interview-assistant/
├── config.yaml                        # LLM + STT keys only — user edits this
├── config.example.yaml                # Template to copy
├── package.json
├── electron/
│   ├── main.js                        # Electron entry point
│   ├── preload.js                     # IPC bridge (context isolation)
│   └── ipc-handlers.js                # All IPC event handlers
├── src/
│   ├── App.jsx                        # Router: Setup Screen ↔ Overlay
│   ├── screens/
│   │   └── SetupScreen.jsx            # Pre-interview profile setup UI
│   ├── components/
│   │   ├── Overlay.jsx                # Main interview overlay panel
│   │   ├── Transcript.jsx             # Live transcription display
│   │   ├── Answer.jsx                 # Streaming AI answer display
│   │   ├── TopicBadge.jsx             # Detected topic pill (green/yellow/orange)
│   │   ├── ProfileBadge.jsx           # Active role + seniority in overlay header
│   │   ├── SkillChips.jsx             # Multi-select skill picker in setup
│   │   └── Controls.jsx               # Hotkey toggle, opacity, copy, regenerate
│   └── styles/
│       └── overlay.css
├── services/
│   ├── config.js                      # config.yaml loader + file watcher
│   ├── profile.js                     # Default profile load/save + session override
│   ├── audio.js                       # Mic + system audio capture
│   ├── stt/
│   │   ├── index.js                   # STT provider factory
│   │   ├── deepgram.js                # Deepgram WebSocket real-time client
│   │   ├── whisper-api.js             # OpenAI Whisper REST client
│   │   └── whisper-local.js           # faster-whisper Python subprocess
│   ├── llm/
│   │   ├── index.js                   # LLM provider factory ← KEY FILE
│   │   ├── claude.js                  # Anthropic SDK streaming wrapper
│   │   ├── openai.js                  # OpenAI SDK streaming wrapper
│   │   └── gemini.js                  # Google GenAI streaming wrapper
│   ├── prompt-builder.js              # Dynamic system prompt from session profile
│   ├── topic-detector.js              # IT-wide keyword topic classifier
│   ├── scope-checker.js               # Is question in/adjacent/out of scope?
│   └── session.js                     # Q&A session save + Markdown export
├── data/
│   └── skill-library.js               # All roles → skills mapping
└── sessions/                          # Auto-saved session JSON files
```

---

## 4. User Flow

```
App Launch
    │
    ▼
Load default profile (~/.it-interview-assistant/profile.json)
    │
    ├─ Profile exists? ──No──► Setup Screen (first-time onboarding)
    │
    ▼
Setup Screen (always available, pre-filled with default)
    │
    ├── Select roles (multi)     e.g. [Full Stack, DevOps]
    ├── Select seniority          e.g. Senior
    ├── Pick skills (per role)    e.g. [React, Node.js, K8s, AWS]
    ├── Company type              e.g. Product
    ├── [Save as Default] ──────► saves to profile.json
    └── [Start Interview] ──────► activates overlay with session profile
            │
            ▼
    Overlay active — interview begins
            │
    Question detected (STT)
            │
    Topic detected + Scope checked
            │
    LLM streams answer
            │
    Session auto-saved
            │
    [End Interview] ──► Session summary screen ──► Export Markdown
```

---

## 5. Profile Manager

```javascript
// services/profile.js
const path = require('path');
const fs   = require('fs');
const os   = require('os');

const PROFILE_DIR  = path.join(os.homedir(), '.it-interview-assistant');
const PROFILE_FILE = path.join(PROFILE_DIR, 'profile.json');

const DEFAULT_PROFILE = {
  name: '',
  experience_years: 0,
  seniority: 'Mid',
  roles: [],
  skills: [],
  company_type: 'Product',
  target_role: '',
};

function loadDefault() {
  if (!fs.existsSync(PROFILE_FILE)) return { ...DEFAULT_PROFILE };
  return JSON.parse(fs.readFileSync(PROFILE_FILE, 'utf8'));
}

function saveDefault(profile) {
  fs.mkdirSync(PROFILE_DIR, { recursive: true });
  fs.writeFileSync(PROFILE_FILE, JSON.stringify(profile, null, 2));
}

// Session profile = default + any one-time overrides
function buildSessionProfile(overrides = {}) {
  return { ...loadDefault(), ...overrides };
}

module.exports = { loadDefault, saveDefault, buildSessionProfile };
```

---

## 6. Skill Library

```javascript
// data/skill-library.js
module.exports = {
  'Frontend Developer':     ['React', 'Vue', 'Angular', 'TypeScript', 'Next.js', 'CSS', 'Web Performance', 'Webpack'],
  'Backend Developer':      ['Node.js', 'Java', 'Python', 'Go', 'REST API', 'GraphQL', 'Microservices', 'SQL', 'PostgreSQL', 'Redis'],
  'Full Stack Developer':   ['React', 'Node.js', 'System Design', 'Auth/JWT', 'DB Design', 'Docker', 'CI/CD'],
  'Mobile Developer':       ['React Native', 'Flutter', 'Swift', 'Kotlin', 'Expo', 'App Store Deployment'],
  'QA Engineer / SDET':     ['Selenium', 'Cypress', 'Playwright', 'Jest', 'API Testing', 'Performance Testing', 'Test Strategy', 'BDD'],
  'DevOps Engineer':        ['Kubernetes', 'Docker', 'Terraform', 'CI/CD', 'Linux', 'Ansible', 'Helm', 'ArgoCD'],
  'SRE':                    ['SLO/SLI/SLA', 'Incident Management', 'Observability', 'Chaos Engineering', 'Prometheus', 'PagerDuty'],
  'Cloud Engineer (AWS)':   ['EC2', 'S3', 'Lambda', 'IAM', 'VPC', 'RDS', 'EKS', 'CloudFormation', 'CloudWatch'],
  'Cloud Engineer (GCP)':   ['GKE', 'Cloud Run', 'BigQuery', 'Pub/Sub', 'GCS', 'Cloud Functions'],
  'Cloud Engineer (Azure)': ['AKS', 'Azure Functions', 'Cosmos DB', 'ARM Templates', 'Azure DevOps'],
  'Solutions Architect':    ['System Design', 'Microservices', 'Event-Driven', 'CQRS', 'API Design', 'DDD', 'Cloud Cost'],
  'Engineering Manager':    ['Agile', 'Scrum', 'Team Building', 'Roadmap Planning', 'Stakeholder Management', 'OKRs', 'Hiring'],
  'Tech Lead':              ['Code Review', 'Architecture Decisions', 'Mentoring', 'Tech Debt', 'RFC Process'],
  'Data Engineer':          ['Spark', 'Kafka', 'Airflow', 'dbt', 'Data Modeling', 'Lakehouse', 'Snowflake', 'BigQuery'],
  'ML Engineer':            ['PyTorch', 'TensorFlow', 'MLOps', 'Feature Store', 'Model Serving', 'LLM Fine-tuning'],
  'Security Engineer':      ['OWASP', 'Pen Testing', 'IAM', 'Zero Trust', 'SAST/DAST', 'Cloud Security', 'SOC'],
};
```

---

## 7. Dynamic Prompt Builder

This is the core intelligence — builds a tailored system prompt per session:

```javascript
// services/prompt-builder.js
function buildSystemPrompt(sessionProfile) {
  const {
    name, experience_years, seniority,
    roles, skills, company_type, target_role
  } = sessionProfile;

  const rolesStr  = roles.join(', ') || 'IT professional';
  const skillsStr = skills.join(', ') || 'general software engineering';

  return `You are ${name || 'a candidate'}, a ${seniority} ${rolesStr} with ${experience_years} years of experience, interviewing for a ${target_role || rolesStr} role at a ${company_type} company.

Your strong areas are: ${skillsStr}.

ANSWER RULES:
1. Always answer in first person — "I would...", "In my experience...", "I've worked with..."
2. For topics within your strong areas: answer as a confident expert with specific examples from your stack
3. For topics adjacent to your roles: answer confidently, mentioning exposure through cross-team work or self-learning
4. For topics completely outside your background: answer as a well-rounded senior IT professional with solid foundational knowledge — NEVER say "I don't know" or "that's outside my area"
5. Keep answers concise: 3–5 bullet points + 1 real-world example
6. Include code snippets, commands, config examples, or architecture notes where relevant
7. End with one sentence the interviewer would find impressive
8. NEVER reveal you are an AI or that you are using any tool
9. Adapt your answer depth to the seniority level: ${seniority}

Your secondary awareness covers all of: software development, cloud infrastructure, QA, architecture, data engineering, security, and engineering management — answer anything asked.`;
}

module.exports = { buildSystemPrompt };
```

---

## 8. LLM Provider Factory

Single interface — all three providers plug in identically:

```javascript
// services/llm/index.js
const providers = {
  claude: require('./claude'),
  openai: require('./openai'),
  gemini: require('./gemini'),
};

async function* streamAnswer(question, config, sessionProfile) {
  const provider = providers[config.llm.provider];
  if (!provider) throw new Error(`Unknown LLM provider: ${config.llm.provider}`);
  yield* provider.stream(question, config, sessionProfile);
}

module.exports = { streamAnswer };
```

```javascript
// services/llm/claude.js
const Anthropic = require('@anthropic-ai/sdk');
const { buildSystemPrompt } = require('../prompt-builder');

async function* stream(question, config, sessionProfile) {
  const client = new Anthropic({ apiKey: config.llm.api_key });
  const stream = client.messages.stream({
    model: config.llm.model || 'claude-sonnet-4-20250514',
    max_tokens: 1024,
    system: buildSystemPrompt(sessionProfile),
    messages: [{ role: 'user', content: question }],
  });
  for await (const chunk of stream) {
    if (chunk.type === 'content_block_delta') yield chunk.delta.text;
  }
}
module.exports = { stream };
```

```javascript
// services/llm/openai.js
const OpenAI = require('openai');
const { buildSystemPrompt } = require('../prompt-builder');

async function* stream(question, config, sessionProfile) {
  const client = new OpenAI({ apiKey: config.llm.api_key });
  const stream = await client.chat.completions.create({
    model: config.llm.model || 'gpt-4.1',
    stream: true,
    messages: [
      { role: 'system', content: buildSystemPrompt(sessionProfile) },
      { role: 'user', content: question },
    ],
  });
  for await (const chunk of stream) {
    yield chunk.choices[0]?.delta?.content || '';
  }
}
module.exports = { stream };
```

```javascript
// services/llm/gemini.js
const { GoogleGenerativeAI } = require('@google/generative-ai');
const { buildSystemPrompt } = require('../prompt-builder');

async function* stream(question, config, sessionProfile) {
  const genAI = new GoogleGenerativeAI(config.llm.api_key);
  const model = genAI.getGenerativeModel({
    model: config.llm.model || 'gemini-1.5-pro',
    systemInstruction: buildSystemPrompt(sessionProfile),
  });
  const result = await model.generateContentStream(question);
  for await (const chunk of result.stream) yield chunk.text();
}
module.exports = { stream };
```

---

## 9. Topic Detector + Scope Checker

```javascript
// services/topic-detector.js
const TOPIC_KEYWORDS = {
  // Software Dev
  react:          ['react', 'jsx', 'hooks', 'redux', 'context api', 'next.js'],
  backend:        ['rest api', 'graphql', 'node.js', 'express', 'spring', 'django', 'fastapi'],
  databases:      ['sql', 'postgres', 'mysql', 'mongodb', 'redis', 'orm', 'migration', 'indexing'],
  system_design:  ['system design', 'scalability', 'load balancer', 'caching', 'sharding', 'cap theorem'],
  // DevOps / Cloud
  kubernetes:     ['pod', 'deployment', 'kubectl', 'helm', 'namespace', 'ingress', 'eks', 'gke', 'argocd'],
  docker:         ['container', 'dockerfile', 'image', 'compose', 'registry', 'layer'],
  terraform:      ['terraform', 'hcl', 'state', 'module', 'provider', 'plan', 'apply'],
  cicd:           ['pipeline', 'jenkins', 'github actions', 'ci', 'cd', 'workflow', 'artifact'],
  aws:            ['ec2', 's3', 'lambda', 'iam', 'vpc', 'rds', 'cloudwatch', 'cloudformation'],
  linux:          ['bash', 'shell', 'cron', 'systemd', 'grep', 'awk', 'chmod', 'kernel'],
  monitoring:     ['prometheus', 'grafana', 'alert', 'metric', 'elk', 'datadog', 'tracing', 'slo'],
  // QA
  testing:        ['selenium', 'cypress', 'playwright', 'unit test', 'integration test', 'e2e', 'test coverage', 'bdd'],
  // Architecture
  architecture:   ['microservices', 'event-driven', 'cqrs', 'saga', 'domain driven', 'api gateway', 'service mesh'],
  // Management
  management:     ['agile', 'scrum', 'sprint', 'roadmap', 'stakeholder', 'okr', 'hiring', 'performance review'],
  // Data
  data_eng:       ['spark', 'kafka', 'airflow', 'dbt', 'data pipeline', 'lakehouse', 'etl', 'snowflake'],
  // Security
  security:       ['owasp', 'pen test', 'iam', 'zero trust', 'sast', 'dast', 'xss', 'sql injection', 'ssl', 'tls'],
};

function detectTopics(question) {
  const q = question.toLowerCase();
  return Object.entries(TOPIC_KEYWORDS)
    .filter(([_, kws]) => kws.some(kw => q.includes(kw)))
    .map(([topic]) => topic);
}

module.exports = { detectTopics };
```

```javascript
// services/scope-checker.js
// Maps topic keys → role categories for scope comparison
const TOPIC_TO_ROLES = {
  react:         ['Frontend Developer', 'Full Stack Developer'],
  backend:       ['Backend Developer', 'Full Stack Developer'],
  databases:     ['Backend Developer', 'Full Stack Developer', 'Data Engineer'],
  system_design: ['Solutions Architect', 'Tech Lead', 'Full Stack Developer'],
  kubernetes:    ['DevOps Engineer', 'SRE', 'Cloud Engineer (AWS)', 'Cloud Engineer (GCP)', 'Cloud Engineer (Azure)'],
  docker:        ['DevOps Engineer', 'Full Stack Developer', 'SRE'],
  terraform:     ['DevOps Engineer', 'Cloud Engineer (AWS)', 'Solutions Architect'],
  cicd:          ['DevOps Engineer', 'Full Stack Developer', 'Tech Lead'],
  aws:           ['Cloud Engineer (AWS)', 'DevOps Engineer', 'Solutions Architect'],
  linux:         ['DevOps Engineer', 'SRE', 'Backend Developer'],
  monitoring:    ['SRE', 'DevOps Engineer'],
  testing:       ['QA Engineer / SDET', 'Full Stack Developer', 'Mobile Developer'],
  architecture:  ['Solutions Architect', 'Tech Lead', 'Engineering Manager'],
  management:    ['Engineering Manager', 'Tech Lead'],
  data_eng:      ['Data Engineer', 'ML Engineer'],
  security:      ['Security Engineer', 'Solutions Architect'],
};

// Returns: 'in-scope' | 'adjacent' | 'out-of-scope'
function checkScope(detectedTopics, sessionProfile) {
  const userRoles = sessionProfile.roles;
  for (const topic of detectedTopics) {
    const relatedRoles = TOPIC_TO_ROLES[topic] || [];
    if (relatedRoles.some(r => userRoles.includes(r))) return 'in-scope';
  }
  // Check adjacency — roles that overlap with the user's general domain
  const adjacentRoles = getAdjacentRoles(userRoles);
  for (const topic of detectedTopics) {
    const relatedRoles = TOPIC_TO_ROLES[topic] || [];
    if (relatedRoles.some(r => adjacentRoles.includes(r))) return 'adjacent';
  }
  return 'out-of-scope';
}

module.exports = { checkScope };
```

---

## 10. Setup Screen UI

```
┌─────────────────────────────────────────────────────────┐
│           IT Interview Assistant — Setup                 │
├─────────────────────────────────────────────────────────┤
│  Your Name: [Ashis____________]  Experience: [5] years   │
│                                                         │
│  Seniority:  ○ Junior  ○ Mid  ● Senior  ○ Staff         │
│                                                         │
│  Target Role: [Senior Full Stack Engineer_____________]  │
│                                                         │
│  Company Type: ○ Startup  ● Product  ○ Service  ○ FAANG │
│                                                         │
├─────────────────────────────────────────────────────────┤
│  Select Your Roles (multi-select):                      │
│                                                         │
│  [✓ Full Stack Dev] [✓ DevOps Engineer] [ QA Engineer ] │
│  [ Solutions Architect ] [ Engineering Manager ]        │
│  [ Data Engineer ] [ Security Engineer ] [ SRE ]        │
│                                                         │
├─────────────────────────────────────────────────────────┤
│  Your Skills (auto-populated, toggle off what you don't │
│  know well):                                            │
│                                                         │
│  Full Stack: [✓React] [✓Node.js] [✓TypeScript] [✓SQL]  │
│              [✓System Design] [ Vue ] [ GraphQL ]       │
│                                                         │
│  DevOps:     [✓Kubernetes] [✓Docker] [✓Terraform]      │
│              [✓GitHub Actions] [✓AWS] [ Ansible ]       │
│                                                         │
├─────────────────────────────────────────────────────────┤
│  [Save as Default]              [Start Interview →]     │
└─────────────────────────────────────────────────────────┘
```

---

## 11. Overlay UI Design

```
┌────────────────────────────────────────────────────────┐
│  🎙 LIVE  [Senior Full Stack · DevOps]   ⚙ ✕  ≡     │
├────────────────────────────────────────────────────────┤
│  QUESTION                          [system-design] 🟢  │
│  "How would you design a URL shortener that handles    │
│   100 million requests per day?"                       │
├────────────────────────────────────────────────────────┤
│  ANSWER                                       [Copy]   │
│                                                        │
│  • Use a distributed key-value store (Redis) for       │
│    short→long URL mapping with TTL support             │
│                                                        │
│  • Hash generation: Base62 encode a UUID or use        │
│    Snowflake IDs for uniqueness at scale               │
│                                                        │
│  • Separate read/write paths — reads are ~99% of       │
│    traffic, cache aggressively at CDN layer            │
│                                                        │
│  • In my last role I built a similar service on AWS    │
│    using ElastiCache + DynamoDB, handling 80M req/day  │
│    with p99 latency under 20ms...          ▌           │
│                                                        │
│  [🔄 Regenerate]    Opacity: ████░   90%              │
└────────────────────────────────────────────────────────┘

Badge colors:
  🟢 in-scope   (within selected skills)
  🟡 adjacent   (related to your roles)
  🟠 out-of-scope (answered as senior IT professional)
```

**Overlay Technical Notes:**
- `BrowserWindow`: `transparent: true`, `alwaysOnTop: true`, `frame: false`
- `setContentProtection(true)` — excludes window from screen capture (macOS)
- `setIgnoreMouseEvents(false)` interactive / `true` locked mode toggle
- Window state persisted to `~/.it-interview-assistant/window.json`

---

## 12. STT Flow

```
Mic / System Audio (PCM 16kHz mono)
            │
            ▼
    Audio Capture (node-record-lpcm16)
            │
            ▼
    STT Provider (Deepgram WebSocket)
            │ streams partial transcripts
            ▼
    Silence Detector (configurable ms gap)
            │
            ▼
    Final Transcript
            │
    ┌───────┴────────┐
    │                │
    ▼                ▼
Topic Detector   Scope Checker
    │                │
    └───────┬────────┘
            │
            ▼
    LLM Provider (streams answer)
            │
            ▼
    Overlay UI (token by token)
            │
            ▼
    Session auto-saved
```

---

## 13. Session Storage

Each session saves to `sessions/YYYY-MM-DD_HH-MM.json`:

```json
{
  "session_id": "2026-06-12_14-30",
  "llm_provider": "claude",
  "model": "claude-sonnet-4",
  "profile_snapshot": {
    "name": "Ashis",
    "seniority": "Senior",
    "roles": ["Full Stack Developer", "DevOps Engineer"],
    "skills": ["React", "Node.js", "Kubernetes", "AWS"],
    "company_type": "Product"
  },
  "qa_pairs": [
    {
      "timestamp": "14:31:05",
      "question": "How would you design a URL shortener for 100M requests/day?",
      "topics": ["system_design"],
      "scope": "in-scope",
      "answer": "• Use a distributed key-value store...",
      "latency_ms": 1823
    },
    {
      "timestamp": "14:38:22",
      "question": "What is your experience with Kafka?",
      "topics": ["data_eng"],
      "scope": "out-of-scope",
      "answer": "• While my primary background is Full Stack and DevOps...",
      "latency_ms": 2105
    }
  ]
}
```

---

## 14. Config File (LLM + STT only)

```yaml
# config.yaml — only API keys and provider settings live here
# User profile lives in ~/.it-interview-assistant/profile.json

llm:
  provider: claude          # claude | openai | gemini
  model: claude-sonnet-4    # leave blank for auto-default
  api_key: sk-ant-...

stt:
  provider: deepgram        # deepgram | whisper-api | whisper-local
  api_key: dg-...
  language: en-US

audio:
  source: both              # microphone | system | both
  silence_threshold_ms: 1500

overlay:
  hotkey: CommandOrControl+Shift+Space
  default_opacity: 90
  position: top-right       # top-right | top-left | bottom-right | bottom-left
```

**To switch from Claude to OpenAI** — change 3 lines, restart:
```yaml
llm:
  provider: openai
  model: gpt-4.1
  api_key: sk-...
```

---

## 15. Dependencies

```json
{
  "dependencies": {
    "@anthropic-ai/sdk": "^0.24.0",
    "openai": "^4.47.0",
    "@google/generative-ai": "^0.14.0",
    "@deepgram/sdk": "^3.3.0",
    "electron": "^30.0.0",
    "react": "^18.3.0",
    "tailwindcss": "^3.4.0",
    "js-yaml": "^4.1.0",
    "node-record-lpcm16": "^1.0.1",
    "chokidar": "^3.6.0"
  }
}
```

---

## 16. Quick Start

```bash
# 1. Clone and install
git clone https://github.com/you/it-interview-assistant
cd it-interview-assistant
npm install

# 2. Set API keys
cp config.example.yaml config.yaml
# Edit config.yaml — set llm.provider, llm.api_key, stt.api_key

# 3. Run
npm start
# → Setup screen appears
# → Fill in your profile, click Start Interview
# → Overlay activates, start your interview
```
