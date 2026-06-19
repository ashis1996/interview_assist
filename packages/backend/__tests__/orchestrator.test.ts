import { describe, it, expect } from 'vitest'
import { SessionOrchestrator, type OrchestratorEmitter } from '../session/sessionOrchestrator'
import { CreditsService } from '../credits/creditsService'
import { createMemoryRepositories } from '../repos/memory'
import type { LlmProvider } from '../session/llmProvider'
import type { EnforcementMode, Profile } from '@interview-assistant/shared'

const PROFILE: Profile = {
  name: 'Dev',
  targetRole: 'Engineer',
  experienceYears: 5,
  roleCategories: ['software-development'],
  seniority: 'Senior',
  skills: ['typescript', 'node'],
  companyType: 'Product',
}

function recordingEmitter() {
  const events: Record<string, unknown[]> = {
    topics: [],
    scope: [],
    answerToken: [],
    answerComplete: [],
    answerError: [],
    lowCreditWarning: [],
    creditsExhausted: [],
  }
  const emit: OrchestratorEmitter = {
    topics: (t) => events.topics!.push(t),
    scope: (s, c) => events.scope!.push([s, c]),
    answerToken: (t) => events.answerToken!.push(t),
    answerComplete: (a) => events.answerComplete!.push(a),
    answerError: (p, m) => events.answerError!.push([p, m]),
    lowCreditWarning: (b, t) => events.lowCreditWarning!.push([b, t]),
    creditsExhausted: () => events.creditsExhausted!.push(true),
  }
  return { events, emit }
}

const okLlm: LlmProvider = {
  async generate(_req, onToken, onUsage) {
    onToken('I ')
    onToken('would scale it.')
    onUsage?.({ promptTokens: 10, completionTokens: 20 })
    return { kind: 'ok', answer: 'I would scale it.', usage: { promptTokens: 10, completionTokens: 20 } }
  },
}

async function setup(enforcement: EnforcementMode, startBalance: number, llm: LlmProvider = okLlm) {
  const repos = createMemoryRepositories()
  const acct = await repos.accounts.provision('user')
  if (startBalance > 0) {
    await repos.ledger.append({
      id: 'seed',
      accountId: acct.id,
      type: 'purchase-credit',
      amount: startBalance,
      createdAt: new Date().toISOString(),
    })
  }
  const credits = new CreditsService({
    repos,
    conversionRate: { creditsPerSttMinute: 1, creditsPerLlmToken: 1 },
    lowCreditThreshold: 5,
  })
  const session = await repos.sessions.create({
    accountId: acct.id,
    profileSnapshot: PROFILE,
    enforcement,
  })
  const { events, emit } = recordingEmitter()
  const orch = new SessionOrchestrator({
    profile: PROFILE,
    accountId: acct.id,
    sessionId: session.id,
    enforcement,
    llmProvider: llm,
    credits,
    repos,
    lowCreditThreshold: 5,
    emit,
  })
  return { repos, acct, credits, session, events, orch }
}

describe('SessionOrchestrator (Req 10, 14, 15)', () => {
  it('runs topics -> scope -> answer -> persist for a question', async () => {
    const { events, repos, session, orch } = await setup('enforced', 1000)
    await orch.handleQuestion('How would you scale a Node API with a database?')
    expect(events.topics.length).toBe(1)
    expect(events.scope.length).toBe(1)
    expect((events.answerToken as string[]).join('')).toBe('I would scale it.')
    expect(events.answerComplete).toEqual(['I would scale it.'])
    const persisted = await repos.qna.listBySession(session.id)
    expect(persisted.length).toBe(1)
    expect(persisted[0]!.answer).toBe('I would scale it.')
  })

  it('emits an answer_error and persists nothing when the LLM errors (Req 15.6)', async () => {
    const errLlm: LlmProvider = {
      async generate() {
        return { kind: 'error', provider: 'claude', reason: 'timeout', message: 'slow' }
      },
    }
    const { events, repos, session, orch } = await setup('enforced', 1000, errLlm)
    await orch.handleQuestion('Tell me about kubernetes.')
    expect(events.answerError).toEqual([['claude', 'slow']])
    expect(await repos.qna.listBySession(session.id)).toEqual([])
  })

  it('hard-stops when enforced credits are exhausted (Req 10.2)', async () => {
    // Start balance 5; one answer consumes 30 LLM-token credits -> exhausted.
    const { events, orch } = await setup('enforced', 5)
    await orch.handleQuestion('How would you scale a service?')
    expect(events.creditsExhausted).toEqual([true])
  })

  it('never hard-stops when enforcement is bypassed (Req 10.4)', async () => {
    const { events, orch } = await setup('bypassed', 0)
    await orch.handleQuestion('How would you scale a service?')
    expect(events.creditsExhausted).toEqual([])
  })
})
