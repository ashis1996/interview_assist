// Core shared domain types and enums for the Interview Assistant SaaS.
//
// Relocated verbatim from v1 `src/shared/types.ts` (the pure profile/topic/scope
// vocabulary) and extended with the new SaaS types (Account, environment,
// enforcement, usage). Enum-like unions are derived from readonly constant
// arrays via `(typeof ARRAY)[number]` so the canonical value sets are also
// available at runtime for validation and iteration.

/**
 * The five seniority levels. Exactly one must be selected on a confirmed
 * profile.
 */
export const SENIORITY_LEVELS = ['Junior', 'Mid', 'Senior', 'Staff', 'Principal'] as const

export type SeniorityLevel = (typeof SENIORITY_LEVELS)[number]

/**
 * The four company types. Exactly one must be selected on a confirmed profile.
 */
export const COMPANY_TYPES = ['Startup', 'Product', 'Service', 'FAANG'] as const

export type CompanyType = (typeof COMPANY_TYPES)[number]

/**
 * The twelve IT topic domains recognized by the topic detector.
 */
export const TOPIC_DOMAINS = [
  'software-development',
  'databases',
  'system-design',
  'devops',
  'cloud',
  'linux',
  'monitoring',
  'qa-testing',
  'architecture',
  'management',
  'data-engineering',
  'security',
] as const

export type TopicDomain = (typeof TOPIC_DOMAINS)[number]

/**
 * How a detected question relates to the candidate's declared profile.
 */
export const SCOPE_CLASSIFICATIONS = ['in-scope', 'adjacent', 'out-of-scope'] as const

export type ScopeClassification = (typeof SCOPE_CLASSIFICATIONS)[number]

/**
 * Candidate profile used to tailor generated answers.
 *
 * Field constraints (enforced by validation):
 * - `name`: up to 100 characters
 * - `targetRole`: up to 100 characters
 * - `experienceYears`: 0..60 inclusive
 * - `roleCategories`: 1..10 entries on a confirmed profile
 * - `skills`: 1..50 entries when one or more roles are selected
 */
export interface Profile {
  name: string
  targetRole: string
  experienceYears: number
  roleCategories: string[]
  seniority: SeniorityLevel
  skills: string[]
  companyType: CompanyType
  /** Optional: the specific company the candidate is interviewing with. */
  company?: string
  /** Optional free-text background (resume summary / pasted resume) used to
   *  ground and disambiguate answers to the candidate's real domain. */
  background?: string
}

/**
 * A single recorded question/answer pair with its classification metadata.
 * `timestamp` is an ISO-8601 string.
 */
export interface QnAEntry {
  question: string
  answer: string
  topics: TopicDomain[]
  scope: ScopeClassification
  timestamp: string
}

/**
 * The persisted form of an interview session: a snapshot of the profile in
 * effect plus every recorded entry. `startedAt` is an ISO-8601 string.
 */
export interface SessionFile {
  profileSnapshot: Profile
  entries: QnAEntry[]
  startedAt: string
}

// --- SaaS (v2) types ------------------------------------------------------

/** The deployment targets the Desktop_Client can connect to. */
export const ENVIRONMENTS = ['local', 'dev', 'pre-prod', 'prod'] as const

export type Environment = (typeof ENVIRONMENTS)[number]

/** Per-environment credit/auth enforcement modes. */
export type EnforcementMode = 'enforced' | 'bypassed'
export type AuthMode = 'enforced' | 'bypassed'

/** Cloud speech-to-text providers the Backend can relay to. */
export const STT_PROVIDERS = ['deepgram', 'whisper'] as const

export type SttProviderName = (typeof STT_PROVIDERS)[number]

/** How a Session ended; drives finalization and the returned summary. */
export const SESSION_END_REASONS = ['user-ended', 'credits-exhausted', 'disconnected'] as const

export type SessionEndReason = (typeof SESSION_END_REASONS)[number]

/**
 * The persisted record of a User, mapping a verified Identity_Provider identity
 * to an internal account. In auth-bypassed environments a fixed synthetic
 * Dev_Account is used (reserved `identityRef`).
 */
export interface Account {
  /** Internal account id (uuid). */
  id: string
  /** Supabase auth user id (`sub`), or a reserved value for the Dev_Account. */
  identityRef: string
  /** ISO-8601 creation timestamp. */
  createdAt: string
  /** Verified email captured from the Identity_Provider on sign-in, for
   *  human-readable monitoring in the Account_Directory (Req 7.2). */
  email?: string
  /** Owner-toggled grant flag; when true the account gets unlimited (bypassed)
   *  usage via the effective-enforcement path (Req 7.1, 7.3, 7.4). */
  isSuperuser?: boolean
}

/** Metered usage for a Session, plus the credits it converted to. */
export interface UsageSummary {
  sttMinutes: number
  llmTokens: number
  creditsConsumed: number
}
