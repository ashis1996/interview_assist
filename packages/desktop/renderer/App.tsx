// Renderer App shell. The active environment is fixed by the build/runtime
// (main process), NOT chosen by the user. Flow: resolve auth -> ready ->
// interview overlay (Req 1, 3.2). The auth-bypassed environment (local only)
// skips the sign-in screen entirely; `dev` now enforces sign-in (Req 6.1, 6.2).

import React, { useCallback, useEffect, useState } from 'react'
import type { Environment, Profile } from '@interview-assistant/shared'
import { SignInScreen, CreditBadge, OnboardingForm, type DesktopApi } from './screens'
import { Overlay } from './Overlay'
import { CollapsedPill } from './components/CollapsedPill'
import { CollapseIcon } from './icons'
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
    if (phase !== 'interview') window.api.setContentHeight(720)
  }, [phase, collapsed])

  // Collapsed: render ONLY the floating pill at the app level, regardless of
  // phase, so minimize works on every screen. The decision is delegated to the
  // pure `collapseView` helper (the single source of truth, unit-tested in
  // collapseView.test.ts). Returning early keeps the rest of the chrome/screens
  // unmounted while collapsed; phase state is preserved so expand restores the
  // prior screen (Req 8.1, 8.2, 8.3, 8.6).
  if (collapseView(collapsed, phase) === 'pill') {
    return (
      <div className="app">
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
      <div className="app">
        <div className="topbar">
          {env && env !== 'prod' && (
            <span className="env-indicator" data-testid="env-indicator">
              {env}
            </span>
          )}
        </div>
        <div className="config-error" data-testid="config-error" role="alert">
          <h2>Can't reach the configured backend</h2>
          <p>{configError}</p>
        </div>
      </div>
    )
  }

  return (
    <div className={`app${phase === 'interview' ? ' app--overlay' : ''}`}>
      {phase !== 'interview' && (
        <div className="topbar">
          {/* Dev-only indicator; prod users see nothing. */}
          {env && env !== 'prod' && (
            <span className="env-indicator" data-testid="env-indicator">
              {env}
            </span>
          )}
          {phase === 'ready' && <CreditBadge balance={balance} />}
          {/* Always-present minimize-to-pill control for the non-interview
              screens (sign-in / onboarding / ready). The interview overlay keeps
              its own in-toolbar collapse button, routed to this same handler via
              the `onCollapse` prop. (Req 8.1, 8.2) */}
          <button
            className="topbar-collapse"
            data-testid="minimize-pill"
            onClick={collapse}
            title="Collapse to pill"
            aria-label="Collapse to pill"
          >
            <CollapseIcon size={16} />
          </button>
        </div>
      )}

      {phase === 'loading' && <p>Loading…</p>}
      {phase === 'auth' && <SignInScreen api={api} onSignedIn={() => void afterAuthed()} />}
      {phase === 'ready' && (
        <div className="ready">
          <OnboardingForm
            initial={savedProfile}
            onStart={(profile) =>
              void api.startInterview(profile).then((r) => {
                if (r.ok) setPhase('interview')
              })
            }
          />
        </div>
      )}
      {phase === 'interview' && <Overlay onEnded={() => setPhase('ready')} onCollapse={collapse} />}
    </div>
  )
}
