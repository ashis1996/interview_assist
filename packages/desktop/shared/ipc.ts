// IPC contract between the Electron main process, preload bridge, and renderer.
//
// Relocated from v1 `src/shared/ipc.ts` and extended with the SaaS auth /
// environment / credit channels. Dependency-free so it imports cleanly in any
// process.

import type {
  Environment,
  ScopeClassification,
  SessionEndReason,
  TopicDomain,
  UsageSummary,
} from '@interview-assistant/shared'

// --- Auth + environment (NEW) ---------------------------------------------
export const IPC_AUTH_SIGN_IN_PASSWORD = 'auth:signInPassword'
export const IPC_AUTH_SIGN_IN_GOOGLE = 'auth:signInGoogle'
export const IPC_AUTH_SIGN_OUT = 'auth:signOut'
export const IPC_AUTH_RESTORE = 'auth:restore'
export const IPC_ENV_GET = 'env:get'
export const IPC_ENV_SELECT = 'env:select'
export const IPC_CREDITS_BALANCE = 'credits:balance'
export const IPC_PROFILE_GET = 'profile:get'
export const IPC_RESUME_PARSE = 'interview:parseResume'

// --- Interview lifecycle ---------------------------------------------------
export const IPC_INTERVIEW_START = 'interview:start'
export const IPC_INTERVIEW_STOP = 'interview:stop'
export const IPC_AUDIO_FRAME = 'interview:audioFrame'
export const IPC_PIPELINE_SUBMIT_TEXT = 'pipeline:submitTextQuestion'
export const IPC_PIPELINE_ANSWER = 'pipeline:answer'
export const IPC_SET_AUTO_GENERATE = 'pipeline:setAutoGenerate'
export const IPC_PIPELINE_REGENERATE = 'pipeline:regenerate'
export const IPC_PIPELINE_COPY = 'pipeline:copyAnswer'
export const IPC_OVERLAY_SET_OPACITY = 'overlay:setOpacityPercent'
export const IPC_PRIVATE_MODE_SET = 'overlay:setPrivateMode'
export const IPC_OVERLAY_SET_COLLAPSED = 'overlay:setCollapsed'
export const IPC_OVERLAY_SET_CONTENT_HEIGHT = 'overlay:setContentHeight'
export const IPC_OVERLAY_SET_CLICKTHROUGH = 'overlay:setClickThrough'
export const IPC_OVERLAY_MOVE_BY = 'overlay:moveBy'
export const IPC_APP_QUIT = 'app:quit'
export const IPC_SCREENSHOT = 'interview:screenshot'

// --- Pushed events (gateway -> renderer) -----------------------------------
export const IPC_EVT_TRANSCRIPT = 'pipeline:transcript'
export const IPC_EVT_FINAL_QUESTION = 'pipeline:finalQuestion'
export const IPC_EVT_TOPICS = 'pipeline:topics'
export const IPC_EVT_SCOPE = 'pipeline:scope'
export const IPC_EVT_ANSWER_TOKEN = 'pipeline:answerToken'
export const IPC_EVT_ANSWER_COMPLETE = 'pipeline:answerComplete'
export const IPC_EVT_ANSWER_ERROR = 'pipeline:answerError'
export const IPC_EVT_STT_ERROR = 'pipeline:sttError'
export const IPC_EVT_CAPTURE_STATE = 'overlay:capture-state'
export const IPC_EVT_EXCLUSION_WARNING = 'overlay:exclusion-warning'
export const IPC_EVT_LOW_CREDIT = 'credits:lowWarning'
export const IPC_EVT_SESSION_SUMMARY = 'session:summary'
export const IPC_EVT_SESSION_ENDED = 'session:ended'
export const IPC_EVT_SHOW_SETUP = 'app:showSetup'
export const IPC_EVT_HOTKEY_ANSWER = 'hotkey:answer'
export const IPC_EVT_CLICKTHROUGH = 'overlay:clickThroughState'

// --- Payload types ---------------------------------------------------------
export interface ScopePayload {
  scope: ScopeClassification
  color: string
}
export type TopicsPayload = TopicDomain[]
export interface CaptureStatePayload {
  active: boolean
  systemAudioAvailable?: boolean
}
export interface SignInResult {
  ok: boolean
  message?: string
}
export interface EnvState {
  selected: Environment | null
  indicator: string | null
  /**
   * Set when the resolved environment's required backend endpoints are missing
   * at launch (e.g. a packaged `dev` build whose `MAIN_VITE_DEV_*` config was
   * not baked). When present, the renderer shows an explicit
   * unreachable-backend message instead of proceeding to sign-in/ready, and the
   * client does NOT silently fall through to another environment (Req 9.3).
   */
  configError?: string | null
}
export interface SessionSummaryPayload {
  usage: UsageSummary
  creditsConsumed: number
  sessionId: string
}
export interface SessionEndedPayload {
  reason: SessionEndReason
}
