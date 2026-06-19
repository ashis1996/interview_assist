// WindowManager collapse / content-height interplay tests (dev-release Task 5.4).
//
// Covers design §G: `windowManager.setCollapsed()` resizes to the pill while
// `setContentHeight` is skipped while collapsed, and **content protection is a
// window-level property applied on every screen** — so collapsing to the pill
// never turns it off. These assertions back correctness Property 6 ("the
// collapsed pill preserves content protection on every screen").
//
// **Validates: Requirements 8.2, 8.4, 8.5**

import { describe, it, expect, beforeEach, vi } from 'vitest'

// A minimal fake BrowserWindow that records the state WindowManager mutates:
// bounds, content-protection flag, resizable flag, and minimum size. This lets
// us assert the collapse/expand bounds round-trip and that content protection
// is never disabled by the collapse transition.
class FakeBrowserWindow {
  bounds = { x: 100, y: 80, width: 760, height: 720 }
  contentProtection = false
  // History of every setContentProtection(value) call, to prove it is never
  // set to `false` during collapse.
  protectionCalls: boolean[] = []
  resizable = true
  minimumSize: [number, number] = [360, 120]
  opacity = 1
  visible = false
  private listeners: Record<string, Array<(...a: unknown[]) => void>> = {}
  webContents = { isDestroyed: () => false, send: () => {} }

  constructor(opts: { width: number; height: number }) {
    this.bounds = { x: 100, y: 80, width: opts.width, height: opts.height }
  }
  isDestroyed(): boolean {
    return false
  }
  getBounds(): { x: number; y: number; width: number; height: number } {
    return { ...this.bounds }
  }
  setBounds(b: { x: number; y: number; width: number; height: number }): void {
    this.bounds = { ...b }
  }
  setContentProtection(v: boolean): void {
    this.contentProtection = v
    this.protectionCalls.push(v)
  }
  setResizable(v: boolean): void {
    this.resizable = v
  }
  setMinimumSize(w: number, h: number): void {
    this.minimumSize = [w, h]
  }
  setAlwaysOnTop(): void {}
  setOpacity(v: number): void {
    this.opacity = v
  }
  setIgnoreMouseEvents(): void {}
  show(): void {
    this.visible = true
  }
  hide(): void {
    this.visible = false
  }
  isVisible(): boolean {
    return this.visible
  }
  on(event: string, cb: (...a: unknown[]) => void): this {
    ;(this.listeners[event] ??= []).push(cb)
    return this
  }
  loadURL(): Promise<void> {
    return Promise.resolve()
  }
  loadFile(): Promise<void> {
    return Promise.resolve()
  }
}

let lastWindow: FakeBrowserWindow | null = null

vi.mock('electron', () => ({
  BrowserWindow: class {
    constructor(opts: { width: number; height: number }) {
      lastWindow = new FakeBrowserWindow(opts)
      return lastWindow as unknown as object
    }
  },
  globalShortcut: { register: () => {}, unregister: () => {} },
  screen: {
    getDisplayMatching: () => ({ workAreaSize: { width: 1920, height: 1080 } }),
    getPrimaryDisplay: () => ({ workAreaSize: { width: 1920, height: 1080 } }),
  },
}))

// Force a platform where content protection is supported so createOverlayWindow
// does not emit the unsupported-platform warning path.
vi.stubGlobal('process', { ...process, platform: 'win32' })

import { WindowManager, COLLAPSED_SIZE } from '../main/windowManager'

function freshManager(): { wm: WindowManager; win: FakeBrowserWindow } {
  const wm = new WindowManager()
  wm.createOverlayWindow()
  return { wm, win: lastWindow as unknown as FakeBrowserWindow }
}

describe('WindowManager content protection (design §G, Req 8.4, 8.5)', () => {
  beforeEach(() => {
    lastWindow = null
  })

  it('enables content protection on the single overlay window at creation', () => {
    const { win } = freshManager()
    expect(win.contentProtection).toBe(true)
    expect(win.protectionCalls).toContain(true)
  })

  it('never disables content protection when collapsing to the pill', () => {
    const { wm, win } = freshManager()
    wm.setCollapsed(true)
    // Content protection stays on; no setContentProtection(false) ever issued.
    expect(win.contentProtection).toBe(true)
    expect(win.protectionCalls).not.toContain(false)
  })

  it('never disables content protection across a collapse/expand round-trip', () => {
    const { wm, win } = freshManager()
    wm.setCollapsed(true)
    wm.setCollapsed(false)
    expect(win.contentProtection).toBe(true)
    expect(win.protectionCalls).not.toContain(false)
  })
})

describe('WindowManager collapse bounds round-trip (design §G, Req 8.2, 8.3)', () => {
  beforeEach(() => {
    lastWindow = null
  })

  it('collapses to the pill size and remembers the expanded geometry', () => {
    const { wm, win } = freshManager()
    win.setBounds({ x: 200, y: 150, width: 800, height: 600 })

    const collapsed = wm.setCollapsed(true)

    expect(collapsed).toBe(true)
    expect(win.bounds.width).toBe(COLLAPSED_SIZE)
    expect(win.bounds.height).toBe(COLLAPSED_SIZE)
    // Pill keeps its top-left anchor.
    expect(win.bounds.x).toBe(200)
    expect(win.bounds.y).toBe(150)
    expect(win.resizable).toBe(false)
  })

  it('restores the prior expanded bounds on expand', () => {
    const { wm, win } = freshManager()
    win.setBounds({ x: 200, y: 150, width: 800, height: 600 })

    wm.setCollapsed(true)
    const collapsed = wm.setCollapsed(false)

    expect(collapsed).toBe(false)
    expect(win.bounds).toEqual({ x: 200, y: 150, width: 800, height: 600 })
    expect(win.resizable).toBe(true)
  })
})

describe('WindowManager setContentHeight is ignored while collapsed (design §G, Req 8.2)', () => {
  beforeEach(() => {
    lastWindow = null
  })

  it('resizes height to content when expanded', () => {
    const { wm, win } = freshManager()
    win.setBounds({ x: 10, y: 10, width: 760, height: 720 })
    wm.setContentHeight(400)
    expect(win.bounds.height).toBe(400)
    expect(win.bounds.width).toBe(760) // width + anchor preserved
    expect(win.bounds.x).toBe(10)
  })

  it('does not change bounds while collapsed', () => {
    const { wm, win } = freshManager()
    wm.setCollapsed(true)
    const collapsedBounds = win.getBounds()
    wm.setContentHeight(400)
    expect(win.getBounds()).toEqual(collapsedBounds)
    expect(win.bounds.height).toBe(COLLAPSED_SIZE)
  })
})
