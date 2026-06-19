// New renderer screens (Req 1, 3, 7): sign-in, environment selector, credit
// badge. These are the SaaS additions that sit alongside the reused overlay and
// setup screens. They talk to the main process exclusively through the typed
// preload bridge (window.api), never touching providers or secrets directly.

import React, { useState } from 'react'
import type { Environment, Profile, SeniorityLevel, CompanyType } from '@interview-assistant/shared'
import { ENVIRONMENTS, SENIORITY_LEVELS, COMPANY_TYPES, TOPIC_DOMAINS } from '@interview-assistant/shared'
import type { EnvState, SignInResult } from '../shared/ipc'

/** The preload bridge surface the renderer relies on (typed for the screens). */
export interface DesktopApi {
  signInWithPassword(email: string, password: string): Promise<SignInResult>
  signInWithGoogle(): Promise<SignInResult>
  selectEnvironment(env: Environment): Promise<EnvState>
  getEnvironment(): Promise<EnvState>
  getCreditBalance(): Promise<number>
}

/** Sign-in screen: email/password + Google OAuth, generic error (Req 1.1, 1.2, 1.4). */
export function SignInScreen(props: {
  api: DesktopApi
  onSignedIn: () => void
}): React.JSX.Element {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function handle(result: Promise<SignInResult>): Promise<void> {
    setBusy(true)
    setError(null)
    const r = await result
    setBusy(false)
    if (r.ok) props.onSignedIn()
    else setError(r.message ?? 'Authentication failed.')
  }

  return (
    <div className="sign-in">
      <h1>Sign in</h1>
      {error && <div className="auth-error" role="alert">{error}</div>}
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void handle(props.api.signInWithPassword(email, password))
        }}
      >
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          aria-label="Email"
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          aria-label="Password"
        />
        <button type="submit" disabled={busy}>
          Sign in
        </button>
      </form>
      <button type="button" disabled={busy} onClick={() => void handle(props.api.signInWithGoogle())}>
        Continue with Google
      </button>
    </div>
  )
}

/** Environment selector with the show/hide indicator (Req 3.1, 3.4, 3.5). */
export function EnvironmentSelector(props: {
  api: DesktopApi
  selected: Environment | null
  onChange: (state: EnvState) => void
}): React.JSX.Element {
  return (
    <div className="env-selector">
      {props.selected && (
        <span className="env-indicator" data-testid="env-indicator">
          {props.selected}
        </span>
      )}
      <select
        value={props.selected ?? ''}
        aria-label="Environment"
        onChange={(e) => {
          const env = e.target.value as Environment
          void props.api.selectEnvironment(env).then(props.onChange)
        }}
      >
        <option value="" disabled>
          Select environment
        </option>
        {ENVIRONMENTS.map((env) => (
          <option key={env} value={env}>
            {env}
          </option>
        ))}
      </select>
    </div>
  )
}

/** Credit balance badge (Req 7.1, 7.2). */
export function CreditBadge(props: { balance: number; low?: boolean }): React.JSX.Element {
  return (
    <span className={`credit-badge${props.low ? ' low' : ''}`} data-testid="credit-badge">
      {props.balance} credits
    </span>
  )
}

function deriveSeniority(years: number): SeniorityLevel {
  if (years <= 2) return 'Junior'
  if (years <= 5) return 'Mid'
  if (years <= 9) return 'Senior'
  if (years <= 13) return 'Staff'
  return 'Principal'
}

/**
 * Pre-interview onboarding form. Collects company, role, experience, skills,
 * and a resume/background so the LLM can personalize and domain-disambiguate
 * answers. Submits a Profile to start the interview.
 */
export function OnboardingForm(props: {
  onStart: (profile: Profile) => void
  initial?: Profile | null
}): React.JSX.Element {
  const init = props.initial ?? null
  const [name, setName] = useState(init?.name && init.name !== 'Candidate' ? init.name : '')
  const [company, setCompany] = useState(init?.company ?? '')
  const [companyType, setCompanyType] = useState<CompanyType>(init?.companyType ?? 'Product')
  const [targetRole, setTargetRole] = useState(init?.targetRole ?? '')
  const [years, setYears] = useState(init?.experienceYears ?? 3)
  const [seniority, setSeniority] = useState<SeniorityLevel>(init?.seniority ?? 'Mid')
  const [seniorityTouched, setSeniorityTouched] = useState(Boolean(init?.seniority))
  const [roles, setRoles] = useState<string[]>(
    init?.roleCategories?.length ? init.roleCategories : ['software-development']
  )
  const [skills, setSkills] = useState(init?.skills?.length ? init.skills.join(', ') : '')
  const [background, setBackground] = useState(init?.background ?? '')
  const [parsing, setParsing] = useState(false)
  const [busy, setBusy] = useState(false)

  const effectiveSeniority = seniorityTouched ? seniority : deriveSeniority(years)

  const toggleRole = (r: string): void =>
    setRoles((prev) => (prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]))

  const onResumeFile = (file: File | undefined): void => {
    if (!file) return
    setParsing(true)
    void file
      .arrayBuffer()
      .then((buf) => window.api.parseResume(file.name, buf))
      .then((text) => {
        const t = (text as string) ?? ''
        if (t) setBackground((b) => (b ? `${b}\n\n${t}` : t))
      })
      .finally(() => setParsing(false))
  }

  const canStart = targetRole.trim().length > 0 && roles.length > 0

  const submit = (): void => {
    if (!canStart || busy) return
    setBusy(true)
    const skillList = skills
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
    const profile: Profile = {
      name: name.trim() || 'Candidate',
      targetRole: targetRole.trim(),
      experienceYears: Number.isFinite(years) ? years : 0,
      roleCategories: roles.length ? roles : ['software-development'],
      seniority: effectiveSeniority,
      skills: skillList.length ? skillList : ['general'],
      companyType,
      ...(company.trim() ? { company: company.trim() } : {}),
      ...(background.trim() ? { background: background.trim() } : {}),
    }
    props.onStart(profile)
  }

  return (
    <div className="onboarding">
      <h1>Set up your interview</h1>
      <p className="onboarding-sub">
        This context helps tailor answers to your role and resolve ambiguous questions to your
        domain.
      </p>

      <div className="ob-grid">
        <label className="ob-field">
          <span>Your name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Optional" />
        </label>
        <label className="ob-field">
          <span>Company</span>
          <input
            value={company}
            onChange={(e) => setCompany(e.target.value)}
            placeholder="e.g. Acme Corp"
          />
        </label>
        <label className="ob-field">
          <span>Company type</span>
          <select value={companyType} onChange={(e) => setCompanyType(e.target.value as CompanyType)}>
            {COMPANY_TYPES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <label className="ob-field">
          <span>Job role *</span>
          <input
            value={targetRole}
            onChange={(e) => setTargetRole(e.target.value)}
            placeholder="e.g. QA Engineer"
          />
        </label>
        <label className="ob-field">
          <span>Years of experience</span>
          <input
            type="number"
            min={0}
            max={60}
            value={years}
            onChange={(e) => setYears(Number(e.target.value))}
          />
        </label>
        <label className="ob-field">
          <span>Seniority</span>
          <select
            value={effectiveSeniority}
            onChange={(e) => {
              setSeniorityTouched(true)
              setSeniority(e.target.value as SeniorityLevel)
            }}
          >
            {SENIORITY_LEVELS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="ob-field">
        <span>Role areas * (drives domain disambiguation)</span>
        <div className="ob-chips">
          {TOPIC_DOMAINS.map((t) => (
            <button
              key={t}
              type="button"
              className={`ob-chip${roles.includes(t) ? ' on' : ''}`}
              onClick={() => toggleRole(t)}
            >
              {t}
            </button>
          ))}
        </div>
      </div>

      <label className="ob-field">
        <span>Key skills (comma-separated)</span>
        <input
          value={skills}
          onChange={(e) => setSkills(e.target.value)}
          placeholder="e.g. Selenium, API testing, Jira, SQL"
        />
      </label>

      <label className="ob-field">
        <span>Resume / background</span>
        <textarea
          rows={5}
          value={background}
          onChange={(e) => setBackground(e.target.value)}
          placeholder="Paste your resume or a short background summary here…"
        />
        <input
          type="file"
          accept=".txt,.md,.text,.pdf,.docx"
          className="ob-file"
          onChange={(e) => onResumeFile(e.target.files?.[0])}
        />
        <small className="ob-hint">
          {parsing ? 'Extracting text from file…' : 'Paste, or upload a .pdf / .docx / .txt resume.'}
        </small>
      </label>

      <button className="ob-start" disabled={!canStart || busy} onClick={submit}>
        Start interview
      </button>
    </div>
  )
}
