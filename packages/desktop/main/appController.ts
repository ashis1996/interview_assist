// Application Controller (composition root) — Task 19.1 (Req 3.2, 5, 7).
//
// Wires the desktop modules into a running app and owns the IPC surface the
// preload calls: environment selection, Supabase auth, the credit balance, the
// interview lifecycle, and the relay of gateway events to the renderer. Audio
// frames captured in the renderer arrive over IPC and are forwarded to the
// Session_Gateway via the BackendSessionClient.

import { app, BrowserWindow, clipboard, desktopCapturer, ipcMain, screen, session as electronSession, shell } from 'electron'
import { createServer } from 'node:http'
import { URL } from 'node:url'
import type { Environment, Profile } from '@interview-assistant/shared'
import { ENVIRONMENTS } from '@interview-assistant/shared'
import { resolveAuthMode } from './envAuth'
import { defaultEnvConfig, environmentIndicator, backendConfigError, type EnvConfig } from './envConfig'
import { createTokenStore } from './tokenStore'
import { createElectronSecureStore } from './electronSecureStore'
import { AuthManager } from './authManager'
import { createSupabaseAuthAdapter } from './supabaseAuthAdapter'
import { BackendSessionClient } from './backendSessionClient'
import { WindowManager } from './windowManager'
import { parseResumeBytes } from './resumeParser'
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
  IPC_SET_CODING_MODE,
  IPC_PIPELINE_REGENERATE,
  IPC_PIPELINE_COPY,
  IPC_OVERLAY_SET_OPACITY,
  IPC_PRIVATE_MODE_SET,
  IPC_OVERLAY_SET_COLLAPSED,
  IPC_OVERLAY_SET_CONTENT_HEIGHT,
  IPC_OVERLAY_SET_CLICKTHROUGH,
  IPC_OVERLAY_MOVE_BY,
  IPC_APP_QUIT,
  IPC_SCREENSHOT,
  IPC_EVT_TRANSCRIPT,
  IPC_EVT_FINAL_QUESTION,
  IPC_EVT_TOPICS,
  IPC_EVT_SCOPE,
  IPC_EVT_ANSWER_TOKEN,
  IPC_EVT_ANSWER_COMPLETE,
  IPC_EVT_ANSWER_ERROR,
  IPC_EVT_STT_ERROR,
  IPC_EVT_LOW_CREDIT,
  IPC_EVT_SESSION_SUMMARY,
  IPC_EVT_SESSION_ENDED,
  IPC_EVT_HOTKEY_ANSWER,
  IPC_EVT_CLICKTHROUGH,
  type EnvState,
  type SignInResult,
} from '../shared/ipc'
import WebSocket from 'ws'

/**
 * Type guard: is `value` a known Environment? Used to validate both env sources
 * before they can drive the resolved environment, so a malformed override or
 * baked build var can never silently mis-target (design §C).
 */
function isEnvironment(value: string | undefined): value is Environment {
  return value !== undefined && (ENVIRONMENTS as readonly string[]).includes(value)
}

/**
 * Pure precedence resolver for the active environment (design §C, Req 4.1–4.4).
 *
 * Order:
 *   1. `process.env.APP_ENV` — explicit runtime override (developer escape hatch),
 *   2. baked `import.meta.env.MAIN_VITE_APP_ENV` — set at build time for a dev installer,
 *   3. `app.isPackaged ? 'prod' : 'local'` — the unchanged fallback.
 *
 * Both env sources are validated against `ENVIRONMENTS`; invalid values are
 * skipped. Because a packaged `dev` installer bakes `MAIN_VITE_APP_ENV=dev`, it
 * resolves to `dev` here and never falls through to `prod` (Req 4.2, 4.4 —
 * correctness property 1). Pure so the precedence can be unit-tested directly.
 */
export function resolveEnvironment(
  explicitAppEnv: string | undefined,
  bakedAppEnv: string | undefined,
  isPackaged: boolean
): Environment {
  if (isEnvironment(explicitAppEnv)) return explicitAppEnv
  if (isEnvironment(bakedAppEnv)) return bakedAppEnv
  return isPackaged ? 'prod' : 'local'
}

/**
 * Read the build-time baked `MAIN_VITE_APP_ENV` (electron-vite inlines it into
 * the main bundle). MUST use DIRECT static `import.meta.env.MAIN_VITE_APP_ENV`
 * access — that is the only form Vite/electron-vite replaces with the literal
 * value at build time, so a packaged `dev` installer actually resolves to `dev`
 * (Req 4.2, 4.4). Wrapped so non-built runtimes (bare tsx/Node) never throw;
 * under vitest it resolves to `undefined`.
 */
function bakedAppEnv(): string | undefined {
  try {
    return import.meta.env.MAIN_VITE_APP_ENV
  } catch {
    return undefined
  }
}

const REQUEST_CHANNELS = [
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
  IPC_PIPELINE_SUBMIT_TEXT,
  IPC_PIPELINE_ANSWER,
  IPC_SET_AUTO_GENERATE,
  IPC_SET_CODING_MODE,
  IPC_PIPELINE_REGENERATE,
  IPC_PIPELINE_COPY,
  IPC_OVERLAY_SET_OPACITY,
  IPC_PRIVATE_MODE_SET,
  IPC_OVERLAY_SET_COLLAPSED,
  IPC_OVERLAY_SET_CLICKTHROUGH,
  IPC_SCREENSHOT,
]

export class AppController {
  private readonly envConfig: EnvConfig
  private readonly tokenStore = createTokenStore(createElectronSecureStore())
  private readonly windowManager: WindowManager
  private selectedEnv: Environment | null = null
  private configError: string | null = null
  private authManager: AuthManager | null = null
  private sessionClient: BackendSessionClient | null = null
  private currentAnswer = ''

  constructor(preloadPath: string) {
    this.envConfig = defaultEnvConfig()
    this.windowManager = new WindowManager({ preloadPath })
  }

  initialize(): void {
    // Grant media (microphone) + display-capture permissions to our own
    // renderer; without this Electron blocks getUserMedia and the mic fails.
    const allow = (_wc: unknown, _permission: string, callback: (granted: boolean) => void): void =>
      callback(true)
    electronSession.defaultSession.setPermissionRequestHandler(allow as never)
    electronSession.defaultSession.setPermissionCheckHandler(() => true)

    // Enable Windows loopback audio capture for getDisplayMedia (Req 4.2).
    // getDisplayMedia always requires a VIDEO source, so we supply a screen
    // source alongside `audio: 'loopback'`; the renderer immediately drops the
    // video track and keeps only the system-audio track.
    electronSession.defaultSession.setDisplayMediaRequestHandler((_request, callback) => {
      desktopCapturer
        .getSources({ types: ['screen'] })
        .then((sources) => {
          if (sources.length === 0) {
            // No screen available: fall back to mic-only (degraded) by failing
            // the loopback request gracefully.
            callback({} as never)
            return
          }
          callback({ video: sources[0], audio: 'loopback' as never })
        })
        .catch(() => callback({} as never))
    })

    this.windowManager.createOverlayWindow()
    this.registerIpcHandlers()
    this.windowManager.registerHotkeys()

    // The environment is determined by the build/runtime, NOT chosen by the
    // user: packaged builds are `prod`, dev runs are `local`, and an APP_ENV
    // override is available for developers. End users never select it.
    this.buildEnvironment(this.activeEnvironment())

    this.windowManager.on('capture-toggle', ({ active }) => {
      this.sessionClient?.sendCaptureState(active, true)
    })
    this.windowManager.on('answer-hotkey', () => this.toRenderer(IPC_EVT_HOTKEY_ANSWER, null))
    this.windowManager.on('clickthrough-change', ({ enabled }) =>
      this.toRenderer(IPC_EVT_CLICKTHROUGH, enabled)
    )
  }

  /**
   * Resolve the active environment from build/runtime (design §C, Req 4.1–4.4).
   * Precedence: `process.env.APP_ENV` → baked `MAIN_VITE_APP_ENV` →
   * `app.isPackaged ? 'prod' : 'local'`. A packaged dev installer (which bakes
   * `MAIN_VITE_APP_ENV=dev`) therefore resolves to `dev`, never `prod`.
   */
  private activeEnvironment(): Environment {
    return resolveEnvironment(process.env['APP_ENV'], bakedAppEnv(), app.isPackaged)
  }

  private buildEnvironment(env: Environment): void {
    this.sessionClient?.dispose()
    const entry = this.envConfig[env]

    // Validate the resolved env's required endpoints at launch. If a packaged
    // build is missing its baked backend config (empty backendBaseUrl/
    // sessionGatewayUrl), record an explicit error and DO NOT fall through to
    // another environment — `selected` stays the resolved env so the renderer
    // shows a clear "can't reach the configured backend" state (Req 9.3).
    this.configError = backendConfigError(env, entry)

    // Only wire Supabase auth where auth is ENFORCED and configured (Req 1.11).
    // In local/dev (bypassed) no Supabase client is created at all (Req 1.12).
    if (resolveAuthMode(env) === 'enforced' && entry.supabaseUrl) {
      const adapter = createSupabaseAuthAdapter({
        supabaseUrl: entry.supabaseUrl,
        publishableKey: entry.supabasePublishableKey,
        openBrowser: (url) => shell.openExternal(url),
        waitForRedirect: (port, expectedState) => this.waitForOAuthRedirect(port, expectedState),
      })
      this.authManager = new AuthManager({
        environment: env,
        tokenStore: this.tokenStore,
        adapter,
      })
    } else {
      this.authManager = null
    }

    this.sessionClient = new BackendSessionClient({
      gatewayUrl: entry.sessionGatewayUrl,
      environment: env,
      getAccessToken: () => this.authManager?.getValidAccessToken(),
      socketFactory: (url) => new WebSocket(url) as never,
    })
    this.wireSessionEvents(this.sessionClient)
    this.selectedEnv = env
  }

  private wireSessionEvents(client: BackendSessionClient): void {
    client.on('partial_transcript', ({ text }) => this.toRenderer(IPC_EVT_TRANSCRIPT, text))
    client.on('final_question', ({ text }) => this.toRenderer(IPC_EVT_FINAL_QUESTION, text))
    client.on('topics', ({ topics }) => this.toRenderer(IPC_EVT_TOPICS, topics))
    client.on('scope', (payload) => this.toRenderer(IPC_EVT_SCOPE, payload))
    client.on('answer_token', ({ token }) => this.toRenderer(IPC_EVT_ANSWER_TOKEN, token))
    client.on('answer_complete', ({ answer }) => {
      this.currentAnswer = answer
      this.toRenderer(IPC_EVT_ANSWER_COMPLETE, answer)
    })
    client.on('answer_error', (payload) => this.toRenderer(IPC_EVT_ANSWER_ERROR, payload))
    client.on('stt_error', ({ message }) => this.toRenderer(IPC_EVT_STT_ERROR, message))
    client.on('low_credit_warning', (payload) => this.toRenderer(IPC_EVT_LOW_CREDIT, payload))
    client.on('session_summary', (payload) => this.toRenderer(IPC_EVT_SESSION_SUMMARY, payload))
    client.on('session_ended', (payload) => this.toRenderer(IPC_EVT_SESSION_ENDED, payload))
  }

  private registerIpcHandlers(): void {
    ipcMain.handle(IPC_ENV_GET, (): EnvState => this.envState())
    ipcMain.handle(IPC_ENV_SELECT, (_e, env: Environment): EnvState => {
      this.buildEnvironment(env)
      return this.envState()
    })

    ipcMain.handle(
      IPC_AUTH_SIGN_IN_PASSWORD,
      async (_e, email: string, password: string): Promise<SignInResult> =>
        this.authManager
          ? this.authManager.signInWithPassword(email, password)
          : { ok: false, message: 'Select an environment first.' }
    )
    ipcMain.handle(IPC_AUTH_SIGN_IN_GOOGLE, async (): Promise<SignInResult> =>
      this.authManager ? this.authManager.signInWithGoogle() : { ok: false, message: 'Select an environment first.' }
    )
    ipcMain.handle(IPC_AUTH_SIGN_OUT, async () => {
      await this.authManager?.signOut()
    })
    ipcMain.handle(IPC_AUTH_RESTORE, async () => {
      if (!this.selectedEnv) return { kind: 'signed-out' }
      // In bypassed environments no sign-in is required (Req 1.12).
      if (resolveAuthMode(this.selectedEnv) === 'bypassed') {
        return { kind: 'authenticated', tokens: { accessToken: '', refreshToken: '' } }
      }
      return (await this.authManager?.restore()) ?? { kind: 'signed-out' }
    })

    ipcMain.handle(IPC_CREDITS_BALANCE, async (): Promise<number> => this.fetchBalance())

    ipcMain.handle(IPC_PROFILE_GET, async (): Promise<Profile | null> => this.fetchProfile())
    ipcMain.handle(
      IPC_RESUME_PARSE,
      async (_e, fileName: string, bytes: ArrayBuffer): Promise<string> => {
        try {
          return await parseResumeBytes(fileName, bytes)
        } catch (err) {
          // eslint-disable-next-line no-console
          console.error('[resume] parse failed:', err instanceof Error ? err.message : err)
          return ''
        }
      }
    )

    ipcMain.handle(IPC_INTERVIEW_START, (_e, profile?: Profile) => {
      this.currentAnswer = ''
      this.sessionClient?.start()
      this.sessionClient?.sendStartSession('deepgram', undefined, profile)
      this.windowManager.showOverlay()
      return { ok: true }
    })
    ipcMain.handle(IPC_INTERVIEW_STOP, () => {
      this.sessionClient?.sendStopSession()
    })
    ipcMain.on(IPC_AUDIO_FRAME, (_e, buf: ArrayBuffer) => {
      this.sessionClient?.uploadAudio(new Int16Array(buf))
    })

    ipcMain.handle(IPC_PIPELINE_SUBMIT_TEXT, (_e, text: string) =>
      this.sessionClient?.sendTextQuestion(text)
    )
    ipcMain.handle(IPC_PIPELINE_ANSWER, () => this.sessionClient?.sendAnswer())
    ipcMain.handle(IPC_SET_AUTO_GENERATE, (_e, enabled: boolean) =>
      this.sessionClient?.sendAutoGenerate(enabled)
    )
    ipcMain.handle(IPC_SET_CODING_MODE, (_e, enabled: boolean) =>
      this.sessionClient?.sendCodingMode(enabled)
    )
    ipcMain.handle(IPC_PIPELINE_REGENERATE, () => this.sessionClient?.sendRegenerate())
    ipcMain.handle(IPC_PIPELINE_COPY, (): string => {
      clipboard.writeText(this.currentAnswer)
      return this.currentAnswer
    })
    ipcMain.handle(IPC_SCREENSHOT, async (): Promise<{ ok: boolean }> => {
      try {
        // Capture the display the overlay is on (multi-monitor aware). The
        // overlay window has setContentProtection(true) -> WDA_EXCLUDEFROMCAPTURE
        // on Windows, so it is excluded from the capture and the question
        // BEHIND it is what gets photographed.
        const win = this.windowManager.window
        const display =
          win && !win.isDestroyed()
            ? screen.getDisplayMatching(win.getBounds())
            : screen.getPrimaryDisplay()
        const { width, height } = display.size
        const sources = await desktopCapturer.getSources({
          types: ['screen'],
          thumbnailSize: { width, height },
        })
        const source =
          sources.find((s) => String(s.display_id) === String(display.id)) ?? sources[0]
        const image = source?.thumbnail
        if (!image || image.isEmpty()) return { ok: false }
        const base64 = image.toPNG().toString('base64')
        this.sessionClient?.sendScreenshotQuestion(base64, 'image/png')
        return { ok: true }
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error('[screenshot] capture failed:', err instanceof Error ? err.message : err)
        return { ok: false }
      }
    })
    ipcMain.handle(IPC_OVERLAY_SET_OPACITY, (_e, percent: number): number =>
      this.windowManager.setOverlayOpacityPercent(percent)
    )
    ipcMain.handle(IPC_PRIVATE_MODE_SET, (_e, enabled: boolean) =>
      this.windowManager.setPrivateMode(enabled)
    )
    ipcMain.handle(IPC_OVERLAY_SET_COLLAPSED, (_e, collapsed: boolean) =>
      this.windowManager.setCollapsed(collapsed)
    )
    ipcMain.handle(IPC_OVERLAY_SET_CLICKTHROUGH, (_e, enabled: boolean) =>
      this.windowManager.setClickThrough(enabled)
    )
    ipcMain.on(IPC_OVERLAY_SET_CONTENT_HEIGHT, (_e, height: number) =>
      this.windowManager.setContentHeight(height)
    )
    ipcMain.on(IPC_OVERLAY_MOVE_BY, (_e, delta: { dx: number; dy: number }) =>
      this.windowManager.moveBy(delta?.dx ?? 0, delta?.dy ?? 0)
    )
    ipcMain.on(IPC_APP_QUIT, () => app.quit())
  }

  private envState(): EnvState {
    return {
      selected: this.selectedEnv,
      indicator: environmentIndicator(this.selectedEnv),
      configError: this.configError,
    }
  }

  private async fetchBalance(): Promise<number> {
    if (!this.selectedEnv) return 0
    const entry = this.envConfig[this.selectedEnv]
    const token = await this.authManager?.getValidAccessToken()
    try {
      const res = await fetch(`${entry.backendBaseUrl}/credits/balance`, {
        headers: token ? { authorization: `Bearer ${token}` } : {},
      })
      const data = (await res.json()) as { balance?: number }
      return data.balance ?? 0
    } catch {
      return 0
    }
  }

  /** Fetch the saved profile to prefill the onboarding form (null if none). */
  private async fetchProfile(): Promise<Profile | null> {
    if (!this.selectedEnv) return null
    const entry = this.envConfig[this.selectedEnv]
    const token = await this.authManager?.getValidAccessToken()
    try {
      const res = await fetch(`${entry.backendBaseUrl}/profile`, {
        headers: token ? { authorization: `Bearer ${token}` } : {},
      })
      const data = (await res.json()) as { profile?: Profile | null }
      return data.profile ?? null
    } catch {
      return null
    }
  }

  /** Run a one-shot loopback HTTP listener to capture the OAuth redirect. */
  private waitForOAuthRedirect(port: number, expectedState: string): Promise<{ code: string }> {
    return new Promise((resolve, reject) => {
      const server = createServer((req, res) => {
        const url = new URL(req.url ?? '', `http://127.0.0.1:${port}`)
        const code = url.searchParams.get('code')
        const state = url.searchParams.get('state')
        res.end('You can close this window and return to the app.')
        server.close()
        if (!code || (state && state !== expectedState)) {
          reject(new Error('OAuth redirect missing code or state mismatch'))
        } else {
          resolve({ code })
        }
      })
      server.listen(port)
      server.on('error', reject)
    })
  }

  private toRenderer(channel: string, payload: unknown): void {
    const win = this.windowManager.window
    if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send(channel, payload)
    }
  }

  dispose(): void {
    this.sessionClient?.dispose()
    this.windowManager.destroy()
    for (const channel of REQUEST_CHANNELS) ipcMain.removeHandler(channel)
    ipcMain.removeAllListeners(IPC_AUDIO_FRAME)
    ipcMain.removeAllListeners(IPC_OVERLAY_SET_CONTENT_HEIGHT)
    ipcMain.removeAllListeners(IPC_OVERLAY_MOVE_BY)
    ipcMain.removeAllListeners(IPC_APP_QUIT)
  }

  recreateWindowIfNeeded(): void {
    if (BrowserWindow.getAllWindows().length === 0) this.windowManager.createOverlayWindow()
  }
}
