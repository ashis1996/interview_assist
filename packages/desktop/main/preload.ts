// Preload bridge: exposes a typed, minimal `window.api` to the renderer over
// contextBridge (Req 16.2). The renderer never accesses Node/Electron or any
// secret directly — only these IPC-backed methods. Channel names come from the
// shared IPC contract so main and renderer stay in lock-step.

import { contextBridge, ipcRenderer } from 'electron'
import type { Environment, Profile } from '@interview-assistant/shared'
import {
  IPC_AUTH_SIGN_IN_PASSWORD,
  IPC_AUTH_SIGN_IN_GOOGLE,
  IPC_AUTH_SIGN_OUT,
  IPC_AUTH_RESTORE,
  IPC_ENV_GET,
  IPC_ENV_SELECT,
  IPC_CREDITS_BALANCE,
  IPC_PROFILE_GET,
  IPC_RESUME_PARSE,
  IPC_INTERVIEW_START,
  IPC_INTERVIEW_STOP,
  IPC_AUDIO_FRAME,
  IPC_PIPELINE_SUBMIT_TEXT,
  IPC_PIPELINE_ANSWER,
  IPC_SET_AUTO_GENERATE,
  IPC_PIPELINE_REGENERATE,
  IPC_PIPELINE_COPY,
  IPC_OVERLAY_SET_OPACITY,
  IPC_PRIVATE_MODE_SET,
  IPC_OVERLAY_SET_COLLAPSED,
  IPC_OVERLAY_SET_CONTENT_HEIGHT,
  IPC_OVERLAY_SET_CLICKTHROUGH,
  IPC_EVT_TRANSCRIPT,
  IPC_EVT_FINAL_QUESTION,
  IPC_EVT_TOPICS,
  IPC_EVT_SCOPE,
  IPC_EVT_ANSWER_TOKEN,
  IPC_EVT_ANSWER_COMPLETE,
  IPC_EVT_ANSWER_ERROR,
  IPC_EVT_STT_ERROR,
  IPC_EVT_CAPTURE_STATE,
  IPC_EVT_EXCLUSION_WARNING,
  IPC_EVT_LOW_CREDIT,
  IPC_EVT_SESSION_SUMMARY,
  IPC_EVT_SESSION_ENDED,
  IPC_EVT_SHOW_SETUP,
  IPC_EVT_HOTKEY_ANSWER,
  IPC_EVT_CLICKTHROUGH,
} from '../shared/ipc'

const EVENT_CHANNELS = [
  IPC_EVT_TRANSCRIPT,
  IPC_EVT_FINAL_QUESTION,
  IPC_EVT_TOPICS,
  IPC_EVT_SCOPE,
  IPC_EVT_ANSWER_TOKEN,
  IPC_EVT_ANSWER_COMPLETE,
  IPC_EVT_ANSWER_ERROR,
  IPC_EVT_STT_ERROR,
  IPC_EVT_CAPTURE_STATE,
  IPC_EVT_EXCLUSION_WARNING,
  IPC_EVT_LOW_CREDIT,
  IPC_EVT_SESSION_SUMMARY,
  IPC_EVT_SESSION_ENDED,
  IPC_EVT_SHOW_SETUP,
  IPC_EVT_HOTKEY_ANSWER,
  IPC_EVT_CLICKTHROUGH,
] as const

const api = {
  // Auth + environment.
  signInWithPassword: (email: string, password: string) =>
    ipcRenderer.invoke(IPC_AUTH_SIGN_IN_PASSWORD, email, password),
  signInWithGoogle: () => ipcRenderer.invoke(IPC_AUTH_SIGN_IN_GOOGLE),
  signOut: () => ipcRenderer.invoke(IPC_AUTH_SIGN_OUT),
  restore: () => ipcRenderer.invoke(IPC_AUTH_RESTORE),
  getEnvironment: () => ipcRenderer.invoke(IPC_ENV_GET),
  selectEnvironment: (env: Environment) => ipcRenderer.invoke(IPC_ENV_SELECT, env),
  getCreditBalance: () => ipcRenderer.invoke(IPC_CREDITS_BALANCE),
  getProfile: () => ipcRenderer.invoke(IPC_PROFILE_GET),
  parseResume: (fileName: string, bytes: ArrayBuffer) =>
    ipcRenderer.invoke(IPC_RESUME_PARSE, fileName, bytes),

  // Interview lifecycle.
  startInterview: (profile?: Profile) => ipcRenderer.invoke(IPC_INTERVIEW_START, profile),
  stopInterview: () => ipcRenderer.invoke(IPC_INTERVIEW_STOP),
  sendAudioFrame: (buf: ArrayBuffer) => ipcRenderer.send(IPC_AUDIO_FRAME, buf),
  submitTextQuestion: (text: string) => ipcRenderer.invoke(IPC_PIPELINE_SUBMIT_TEXT, text),
  answer: () => ipcRenderer.invoke(IPC_PIPELINE_ANSWER),
  setAutoGenerate: (enabled: boolean) => ipcRenderer.invoke(IPC_SET_AUTO_GENERATE, enabled),
  regenerate: () => ipcRenderer.invoke(IPC_PIPELINE_REGENERATE),
  copyAnswer: () => ipcRenderer.invoke(IPC_PIPELINE_COPY),
  setOpacityPercent: (percent: number) => ipcRenderer.invoke(IPC_OVERLAY_SET_OPACITY, percent),
  setPrivateMode: (enabled: boolean) => ipcRenderer.invoke(IPC_PRIVATE_MODE_SET, enabled),
  setCollapsed: (collapsed: boolean) => ipcRenderer.invoke(IPC_OVERLAY_SET_COLLAPSED, collapsed),
  setContentHeight: (height: number) => ipcRenderer.send(IPC_OVERLAY_SET_CONTENT_HEIGHT, height),
  setClickThrough: (enabled: boolean) => ipcRenderer.invoke(IPC_OVERLAY_SET_CLICKTHROUGH, enabled),

  // Pushed events: subscribe with an unsubscribe function.
  on(channel: (typeof EVENT_CHANNELS)[number], listener: (payload: unknown) => void): () => void {
    const handler = (_e: unknown, payload: unknown): void => listener(payload)
    ipcRenderer.on(channel, handler)
    return () => ipcRenderer.removeListener(channel, handler)
  },
}

export type PreloadApi = typeof api

contextBridge.exposeInMainWorld('api', api)
