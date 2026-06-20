// Renderer App shell. The active environment is fixed by the build/runtime
// (main process), NOT chosen by the user. Flow: resolve auth -> ready ->
// interview overlay (Req 1, 3.2). The auth-bypassed environment (local only)
// skips the sign-in screen entirely; `dev` now enforces sign-in (Req 6.1, 6.2).

import React, { useCallback, useEffect, useState } from 'react'
import type { Environment, Profile } from '@interview-assistant/shared'
import { SignInScreen, CreditBadge, OnboardingForm, StartSession, type DesktopApi } from './screens'
import { Overlay } from './Overlay'
import { CollapsedPill } from './components/CollapsedPill'
import { Logo } from './components/Logo'
import { CollapseIcon, CloseIcon } from './icons'
import { collapseView, type Phase } from './collapseView'

function isBypassed(env: Environment | null): boolean {
  // Only `local` skips the sign-in screen. `dev` now requires sign-in before
  // Ready (Req 6.2); pre-prod/prod were already enforced.
  return env === 'local'
}

export function App(): React.JSX.Element {
  const api = window.api as unknown as DesktopApi & {
    restore: () => Promise<{ kind: string }>
    startInterview: (profile?: Profile) => Promise<{ ok: boolean }>
  }
  const [phase, setPhase] = useState<Phase>('loading')
  const [env, setEnv] = useState<Environment | null>(null)
  // Set when the main process reports the resolved environment is missing its
  // backend config (empty endpoints). When present we show an explicit
  // unreachable-backend screen instead of proceeding to sign-in/ready, and we
  // never silently connect to another environment (Req 9.3).
  const [configError, setConfigError] = useState<string | null>(null)
  const [balance, setBalance] = useState(0)
  const [savedProfile, setSavedProfile] = useState<Profile | null>(null)
  // Minimize-to-pill state lifted to the app shell so collapse works on every
  // screen (sign-in, onboarding, ready, interview), not just the overlay (Req
  // 8.1, 8.2). `phase` is intentionally NOT touched on collapse/expand, so the
  // previously active screen reappears on expand (Req 8.3, 8.6).
  const [collapsed, setCollapsed] = useState(false)
  // Within the authenticated "ready" phase the user first sees the Start
  // Session screen (pick session type), then the onboarding form. Kept as a
  // sub-step rather than a top-level phase so the collapse/pill logic and its
  // unit tests stay unchanged. Reset to 'start' whenever we return to ready.
  const [readyStep, setReadyStep] = useState<'start' | 'onboarding'>('start')

  // Collapse/expand handlers. The window resize side-effect lives in the main
  // process via `setCollapsed`; content protection is a window property that is
  // already applied on every screen, so the pill stays screen-share invisible
  // without extra code (Req 8.4, 8.5). The interview overlay's in-toolbar
  // collapse button routes to this same lifted `collapse` handler via the
  // `onCollapse` prop, so there is a single source of truth (Req 8.1, 8.2).
  const collapse = useCallback(() => {
    setCollapsed(true)
    void window.api.setCollapsed(true)
  }, [])
  const expand = useCallback(() => {
    setCollapsed(false)
    void window.api.setCollapsed(false)
  }, [])

  const afterAuthed = useCallback(async () => {
    setBalance(await api.getCreditBalance().catch(() => 0))
    setSavedProfile(await (window.api.getProfile() as Promise<Profile | null>).catch(() => null))
    setPhase('ready')
  }, [api])

  useEffect(() => {
    void (async () => {
      // The environment is decided by the main process; we just read it.
      const state = await api.getEnvironment()
      setEnv(state.selected)
      // If the resolved env is missing its backend config, stop here and show
      // the unreachable-backend screen — never fall through to sign-in/ready or
      // a different environment (Req 9.3).
      if (state.configError) {
        setConfigError(state.configError)
        return
      }
      if (isBypassed(state.selected)) {
        await afterAuthed()
        return
      }
      const auth = await api.restore()
      if (auth.kind === 'authenticated') await afterAuthed()
      else setPhase('auth')
    })()
  }, [api, afterAuthed])

  // Give the non-interview screens (sign-in / onboarding) a comfortable window
  // height; the interview overlay auto-fits its own content height. While
  // collapsed, skip this entirely — the pill window size is controlled by
  // `setCollapsed` in the main process (Req 8.2).
  useEffect(() => {
    if (collapsed) return
    if (phase === 'interview') return
    // The compact Start Session screen needs far less height than the tall
    // onboarding form / sign-in; size the window to the active step.
    const compact = phase === 'ready' && readyStep === 'start'
    window.api.setContentHeight(compact ? 300 : 720)
  }, [phase, collapsed, readyStep])

  // Collapsed: render ONLY the floating pill at the app level, regardless of
  // phase, so minimize works on every screen. The decision is delegated to the
  // pure `collapseView` helper (the single source of truth, unit-tested in
  // collapseView.test.ts). Returning early keeps the rest of the chrome/screens
  // unmounted while collapsed; phase state is preserved so expand restores the
  // prior screen (Req 8.1, 8.2, 8.3, 8.6).
  if (collapseView(collapsed, phase) === 'pill') {
    return (
      <div className="app app--pill">
        <CollapsedPill onExpand={expand} />
      </div>
    )
  }

  // Explicit unreachable-backend screen. Shown when the main process reports
  // the resolved environment is missing its baked backend config; we render a
  // clear message instead of proceeding to sign-in/ready and never connect to
  // an unintended environment (Req 9.3). The env indicator may still show.
  if (configError) {
    return (
      <div className="app app--page">
        <PageHeader env={env} onCollapse={collapse} />
        <div className="page-body">
          <div className="config-error" data-testid="config-error" role="alert">
            <h2>Can't reach the configured backend</h2>
            <p>{configError}</p>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={`app${phase === 'interview' ? ' app--overlay' : ' app--page'}`}>
      {phase !== 'interview' && (
        <PageHeader
          env={env}
          balance={phase === 'ready' ? balance : undefined}
          onCollapse={collapse}
        />
      )}

      {phase !== 'interview' && (
        <div className="page-body">
          {phase === 'loading' && <p className="page-loading">Loading…</p>}
          {phase === 'auth' && <SignInScreen api={api} onSignedIn={() => void afterAuthed()} />}
          {phase === 'ready' && readyStep === 'start' && (
            <StartSession balance={balance} onCreateFree={() => setReadyStep('onboarding')} />
          )}
          {phase === 'ready' && readyStep === 'onboarding' && (
            <div className="ready">
              <OnboardingForm
                initial={savedProfile}
                onBack={() => setReadyStep('start')}
                onStart={(profile) =>
                  void api.startInterview(profile).then((r) => {
                    if (r.ok) setPhase('interview')
                  })
                }
              />
            </div>
          )}
        </div>
      )}

      {phase === 'interview' && (
        <Overlay
          onEnded={() => {
            setReadyStep('start')
            setPhase('ready')
          }}
          onCollapse={collapse}
        />
      )}
    </div>
  )
}

/**
 * Polished SaaS header for the non-interview (solid, light-themed) screens:
 * the product brand on the left, and the window controls (credit badge,
 * dev-only environment indicator, collapse-to-peach, and close) on the right.
 * The header doubles as a drag handle to reposition the frameless window; the
 * control buttons opt out of the drag region so they stay clickable.
 */
function PageHeader(props: {
  env: Environment | null
  balance?: number
  onCollapse: () => void
}): React.JSX.Element {
  return (
    <div className="page-header">
      <div className="page-brand">
        <Logo size={22} />
        <span className="page-brand-name">AI Assist</span>
      </div>
      <div className="page-header-controls">
        {props.env && props.env !== 'prod' && (
          <span className="env-indicator" data-testid="env-indicator">
            {props.env}
          </span>
        )}
        {typeof props.balance === 'number' && <CreditBadge balance={props.balance} />}
        <button
          className="hdr-btn"
          data-testid="minimize-pill"
          onClick={props.onCollapse}
          title="Minimize to peach"
          aria-label="Minimize to peach"
        >
          <CollapseIcon size={15} />
        </button>
        <button
          className="hdr-btn hdr-btn--close"
          onClick={() => window.api.quitApp()}
          title="Close"
          aria-label="Close"
        >
          <CloseIcon size={15} />
        </button>
      </div>
    </div>
  )
}
