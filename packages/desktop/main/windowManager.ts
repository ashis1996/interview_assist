// Window Manager (main process) for the Overlay_UI. Relocated from v1
// `src/main/windowManager.ts` mostly as-is (Req 6.1-6.3, 20.2).
//
// Owns the frameless / always-on-top / transparent overlay BrowserWindow with
// per-window opacity, screen-capture exclusion via setContentProtection(true)
// with a warning-and-keep-rendered fallback, global hotkeys, and drag/resize
// geometry constraints (reusing the pure shared geometry helpers).

import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { EventEmitter } from 'node:events'
import { BrowserWindow, globalShortcut, screen } from 'electron'
import {
  clampOpacityPercent,
  constrainPosition,
  constrainSize,
  toggleCapture,
  type Rect,
  type Size,
} from '@interview-assistant/shared'
import { IPC_EVT_CAPTURE_STATE, IPC_EVT_EXCLUSION_WARNING } from '../shared/ipc'

export const DEFAULT_VISIBILITY_HOTKEY = 'CommandOrControl+Shift+O'
export const DEFAULT_CAPTURE_TOGGLE_HOTKEY = 'CommandOrControl+Shift+A'
export const DEFAULT_CLICKTHROUGH_HOTKEY = 'CommandOrControl+Shift+Space'
export const DEFAULT_ANSWER_HOTKEY = 'CommandOrControl+Shift+Enter'
export const DEFAULT_OPACITY_PERCENT = 100
export const DEFAULT_OVERLAY_WIDTH = 760
export const DEFAULT_OVERLAY_HEIGHT = 720
export const MIN_OVERLAY_WIDTH = 360
export const MIN_OVERLAY_HEIGHT = 120
/** Size (px) of the collapsed floating logo pill. */
export const COLLAPSED_SIZE = 60

export interface WindowManagerOptions {
  opacityPercent?: number
  visibilityHotkey?: string
  captureToggleHotkey?: string
  preloadPath?: string
}

export interface ExclusionWarning {
  unsupported: true
  platform: NodeJS.Platform
  message: string
}

export interface WindowManagerEvents {
  'exclusion-warning': [ExclusionWarning]
  'capture-toggle': [{ active: boolean }]
  'visibility-change': [{ visible: boolean }]
  'clickthrough-change': [{ enabled: boolean }]
  'answer-hotkey': []
}

export function isContentProtectionSupported(
  platform: NodeJS.Platform = process.platform
): boolean {
  return platform === 'darwin' || platform === 'win32'
}

/**
 * Resolve the product icon used for the overlay window / alt-tab / taskbar
 * identity at runtime (Req 5.5). The `.ico` (multi-size) is preferred on
 * Windows with the `.png` as a cross-platform fallback. Candidates cover the
 * dev/source layout (`main/` sibling to `build/`), the electron-vite build
 * layout (`out/main/`), and the packaged `resourcesPath`. Every probe is
 * guarded so a missing icon (or a stubbed `process` in tests) can never throw
 * and break window creation — we simply return `undefined` and the window is
 * created without an explicit icon.
 */
function resolveOverlayIconPath(): string | undefined {
  const names = ['icon.ico', 'icon.png']
  const roots = [
    join(__dirname, '../build'), // source/test layout: packages/desktop/main -> build
    join(__dirname, '../../build'), // electron-vite layout: out/main -> packages/desktop/build
  ]
  const resourcesPath = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  if (resourcesPath) roots.push(join(resourcesPath, 'build'))
  for (const root of roots) {
    for (const name of names) {
      const candidate = join(root, name)
      try {
        if (existsSync(candidate)) return candidate
      } catch {
        // Ignore unreadable/invalid paths and keep probing.
      }
    }
  }
  return undefined
}

function getActiveDisplaySize(win: BrowserWindow | null): Size {
  const display =
    win && !win.isDestroyed()
      ? screen.getDisplayMatching(win.getBounds())
      : screen.getPrimaryDisplay()
  return { width: display.workAreaSize.width, height: display.workAreaSize.height }
}

export class WindowManager extends EventEmitter {
  private win: BrowserWindow | null = null
  private opacityPercent: number
  private captureActive = false
  private hotkeysRegistered = false
  private collapsed = false
  private expandedBounds: Rect | null = null
  private clickThrough = false
  private readonly visibilityHotkey: string
  private readonly captureToggleHotkey: string
  private readonly preloadPath: string

  constructor(options: WindowManagerOptions = {}) {
    super()
    this.opacityPercent = clampOpacityPercent(options.opacityPercent ?? DEFAULT_OPACITY_PERCENT)
    this.visibilityHotkey = options.visibilityHotkey ?? DEFAULT_VISIBILITY_HOTKEY
    this.captureToggleHotkey = options.captureToggleHotkey ?? DEFAULT_CAPTURE_TOGGLE_HOTKEY
    this.preloadPath = options.preloadPath ?? join(__dirname, '../preload/index.mjs')
  }

  get window(): BrowserWindow | null {
    return this.win
  }
  isCaptureActive(): boolean {
    return this.captureActive
  }
  getOpacityPercent(): number {
    return this.opacityPercent
  }

  createOverlayWindow(): BrowserWindow {
    if (this.win && !this.win.isDestroyed()) return this.win
    const iconPath = resolveOverlayIconPath()
    const win = new BrowserWindow({
      width: DEFAULT_OVERLAY_WIDTH,
      height: DEFAULT_OVERLAY_HEIGHT,
      show: false,
      frame: false,
      transparent: true,
      alwaysOnTop: true,
      resizable: true,
      skipTaskbar: true,
      ...(iconPath ? { icon: iconPath } : {}),
      webPreferences: { preload: this.preloadPath, sandbox: false, contextIsolation: true },
    })
    this.win = win
    win.setAlwaysOnTop(true, 'screen-saver')
    win.setOpacity(this.opacityPercent / 100)
    this.enableContentProtection()
    win.on('closed', () => {
      this.win = null
    })
    win.on('ready-to-show', () => win.show())
    const rendererUrl = process.env['ELECTRON_RENDERER_URL']
    if (rendererUrl) void win.loadURL(rendererUrl)
    else void win.loadFile(join(__dirname, '../renderer/index.html'))
    return win
  }

  enableContentProtection(): void {
    const win = this.win
    if (!win || win.isDestroyed()) return
    win.setContentProtection(true)
    if (!isContentProtectionSupported()) {
      const warning: ExclusionWarning = {
        unsupported: true,
        platform: process.platform,
        message:
          'Screen-share invisibility is unavailable on this platform; the overlay remains visible in screen captures.',
      }
      console.warn('[window-manager] content-protection-unsupported', warning)
      if (!win.webContents.isDestroyed()) win.webContents.send(IPC_EVT_EXCLUSION_WARNING, warning)
      this.emit('exclusion-warning', warning)
    }
  }

  registerHotkeys(): void {
    if (this.hotkeysRegistered) return
    globalShortcut.register(this.visibilityHotkey, () => this.toggleVisibility())
    globalShortcut.register(this.captureToggleHotkey, () => this.toggleCaptureState())
    globalShortcut.register(DEFAULT_CLICKTHROUGH_HOTKEY, () => this.toggleClickThrough())
    globalShortcut.register(DEFAULT_ANSWER_HOTKEY, () => this.emit('answer-hotkey'))
    this.hotkeysRegistered = true
  }
  unregisterHotkeys(): void {
    if (!this.hotkeysRegistered) return
    globalShortcut.unregister(this.visibilityHotkey)
    globalShortcut.unregister(this.captureToggleHotkey)
    globalShortcut.unregister(DEFAULT_CLICKTHROUGH_HOTKEY)
    globalShortcut.unregister(DEFAULT_ANSWER_HOTKEY)
    this.hotkeysRegistered = false
  }

  /**
   * Click-through (stealth) mode: when on, the overlay ignores the mouse so the
   * cursor passes straight through to the app behind it — no hover/cursor tells
   * during a screen share. Interact via global hotkeys, or toggle it off to
   * click. `forward: true` still lets the renderer receive move events.
   */
  setClickThrough(enabled: boolean): boolean {
    this.clickThrough = enabled
    const win = this.win
    if (win && !win.isDestroyed()) win.setIgnoreMouseEvents(enabled, { forward: true })
    this.emit('clickthrough-change', { enabled })
    return this.clickThrough
  }
  toggleClickThrough(): boolean {
    return this.setClickThrough(!this.clickThrough)
  }
  isClickThrough(): boolean {
    return this.clickThrough
  }

  toggleVisibility(): void {
    const win = this.win
    if (!win || win.isDestroyed()) return
    if (win.isVisible()) this.hideOverlay()
    else this.showOverlay()
  }
  showOverlay(): void {
    const win = this.win
    if (!win || win.isDestroyed()) return
    win.setContentProtection(true)
    win.show()
    this.emit('visibility-change', { visible: true })
  }
  hideOverlay(): void {
    const win = this.win
    if (!win || win.isDestroyed()) return
    win.hide()
    this.emit('visibility-change', { visible: false })
  }

  toggleCaptureState(): boolean {
    this.captureActive = toggleCapture(this.captureActive)
    const win = this.win
    if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send(IPC_EVT_CAPTURE_STATE, { active: this.captureActive })
    }
    this.emit('capture-toggle', { active: this.captureActive })
    return this.captureActive
  }

  applyPosition(rect: Rect): void {
    const win = this.win
    if (!win || win.isDestroyed()) return
    const c = constrainPosition(rect, getActiveDisplaySize(win))
    win.setBounds({
      x: Math.round(c.x),
      y: Math.round(c.y),
      width: Math.round(c.width),
      height: Math.round(c.height),
    })
  }
  applySize(size: Size): void {
    const win = this.win
    if (!win || win.isDestroyed()) return
    const c = constrainSize(size, getActiveDisplaySize(win))
    const { x, y } = win.getBounds()
    win.setBounds({ x, y, width: Math.round(c.width), height: Math.round(c.height) })
  }
  setOverlayOpacityPercent(percent: number): number {
    this.opacityPercent = clampOpacityPercent(percent)
    const win = this.win
    if (win && !win.isDestroyed()) win.setOpacity(this.opacityPercent / 100)
    return this.opacityPercent
  }

  /**
   * Fit the overlay window height to the rendered content height (keeping the
   * current width and top-left anchor). Lets the window stay compact when only
   * the toolbar + transcript are shown and grow when an answer appears, so the
   * transparent window never captures clicks over empty space. Ignored while
   * collapsed to the pill.
   */
  setContentHeight(contentHeight: number): void {
    const win = this.win
    if (!win || win.isDestroyed() || this.collapsed) return
    const display = screen.getDisplayMatching(win.getBounds())
    const maxHeight = display.workAreaSize.height - 40
    const height = Math.max(MIN_OVERLAY_HEIGHT, Math.min(Math.round(contentHeight), maxHeight))
    const { x, y, width } = win.getBounds()
    if (Math.abs(height - win.getBounds().height) < 2) return
    win.setBounds({ x, y, width, height })
  }

  /**
   * Set Private mode: when on, the overlay is excluded from screen capture
   * (default). Turning it off makes the overlay visible in screen shares.
   */
  setPrivateMode(enabled: boolean): void {
    const win = this.win
    if (!win || win.isDestroyed()) return
    win.setContentProtection(enabled)
  }

  /**
   * Collapse the overlay to a small floating pill (the AI logo) or restore it.
   * Content protection is preserved across the transition so the pill stays
   * invisible to screen shares. The expanded geometry is remembered and
   * restored on expand.
   */
  setCollapsed(collapsed: boolean): boolean {
    const win = this.win
    if (!win || win.isDestroyed()) return collapsed
    if (collapsed) {
      if (!this.collapsed) this.expandedBounds = win.getBounds()
      const { x, y } = win.getBounds()
      win.setResizable(false)
      win.setMinimumSize(COLLAPSED_SIZE, COLLAPSED_SIZE)
      win.setBounds({ x, y, width: COLLAPSED_SIZE, height: COLLAPSED_SIZE })
      this.collapsed = true
    } else {
      win.setMinimumSize(MIN_OVERLAY_WIDTH, MIN_OVERLAY_HEIGHT)
      win.setResizable(true)
      const b = this.expandedBounds ?? {
        x: win.getBounds().x,
        y: win.getBounds().y,
        width: DEFAULT_OVERLAY_WIDTH,
        height: DEFAULT_OVERLAY_HEIGHT,
      }
      win.setBounds({
        x: Math.round(b.x),
        y: Math.round(b.y),
        width: Math.round(b.width),
        height: Math.round(b.height),
      })
      this.collapsed = false
    }
    return this.collapsed
  }

  destroy(): void {
    this.unregisterHotkeys()
    if (this.win && !this.win.isDestroyed()) this.win.destroy()
    this.win = null
  }

  override emit<K extends keyof WindowManagerEvents>(
    event: K,
    ...args: WindowManagerEvents[K]
  ): boolean {
    return super.emit(event as string, ...args)
  }
  override on<K extends keyof WindowManagerEvents>(
    event: K,
    listener: (...args: WindowManagerEvents[K]) => void
  ): this {
    return super.on(event as string, listener as (...args: unknown[]) => void)
  }
}
