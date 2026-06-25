// Session Orchestrator (Req 9, 10, 12, 14, 15).
//
// Modified from v1 `src/main/answerPipeline.ts`. Keeps the
// topics -> scope -> prompt -> LLM -> persist -> relay flow, the generation-seq
// guard, and regenerate; but is fed by the STT relay (via handleFinalQuestion),
// emits over injected client callbacks (the gateway forwards them on the
// WebSocket), persists to Postgres, and adds metering + credit-enforcement
// checkpoints (low-credit warning, hard stop at zero balance).

import {
  buildSystemPrompt,
  classifyScope,
  detectTopics,
  scopeColor,
  DEFAULT_ROLE_ADJACENCY,
  DEFAULT_TOPIC_ROLE_MAP,
  type EnforcementMode,
  type Profile,
  type RoleAdjacencyMap,
  type ScopeClassification,
  type TopicDomain,
  type TopicRoleMap,
} from '@interview-assistant/shared'
import type { CreditsService } from '../credits/creditsService'
import type { Repositories } from '../repos/types'
import type { LlmProvider, LlmTurn } from './llmProvider'

/** How many recent Q&A turns to keep as conversational context. */
const MAX_HISTORY_TURNS = 6
/** Truncate each remembered answer so history stays cheap (latency/tokens). */
const MAX_CONTEXT_ANSWER_CHARS = 700

/** Output sink to the Desktop_Client (wired to the WebSocket by the gateway). */
export interface OrchestratorEmitter {
  topics(topics: TopicDomain[]): void
  scope(scope: ScopeClassification, color: string): void
  answerToken(token: string): void
  answerComplete(answer: string): void
  answerError(provider: string, message: string): void
  lowCreditWarning(creditBalance: number, threshold: number): void
  /** Hard stop requested: credits exhausted mid-session (Req 10.2, 10.3). */
  creditsExhausted(): void
}

export interface OrchestratorDeps {
  profile: Profile
  accountId: string
  sessionId: string
  enforcement: EnforcementMode
  llmProvider: LlmProvider
  credits: CreditsService
  repos: Repositories
  emit: OrchestratorEmitter
  lowCreditThreshold: number
  roleAdjacency?: RoleAdjacencyMap
  topicToRole?: TopicRoleMap
}

/**
 * Orchestrates a single session's question->answer flow. One instance per
 * open session.
 */
export class SessionOrchestrator {
  private readonly d: OrchestratorDeps
  private readonly roleAdjacency: RoleAdjacencyMap
  private readonly topicToRole: TopicRoleMap

  private currentQuestion: string | null = null
  private currentTopics: TopicDomain[] = []
  private currentScope: ScopeClassification = 'out-of-scope'
  private generationSeq = 0
  private exhausted = false
  private autoGenerate = false
  private hasPending = false
  /** Rolling conversational memory: recent (question -> answer) turns. */
  private readonly history: LlmTurn[] = []

  constructor(deps: OrchestratorDeps) {
    this.d = deps
    this.roleAdjacency = deps.roleAdjacency ?? DEFAULT_ROLE_ADJACENCY
    this.topicToRole = deps.topicToRole ?? DEFAULT_TOPIC_ROLE_MAP
  }

  /** Enable/disable auto-answering of finalized questions (Req: Auto Generate). */
  setAutoGenerate(enabled: boolean): void {
    this.autoGenerate = enabled
    if (enabled && this.hasPending) void this.answerPending()
  }

  /**
   * A finalized SPOKEN question from the STT relay. We compute topics/scope and
   * relay the badges, mark it pending, and only generate immediately when
   * Auto Generate is on. Otherwise the user triggers it with the Answer button.
   */
  async handleFinalQuestion(question: string): Promise<void> {
    if (this.exhausted) return
    this.prepare(question)
    this.hasPending = true
    if (this.autoGenerate) {
      this.hasPending = false
      await this.generate(question, this.currentTopics, this.currentScope)
    }
  }

  /** Manually answer the latest pending finalized question (the Answer button). */
  async answerPending(): Promise<void> {
    if (this.exhausted || this.currentQuestion === null || !this.hasPending) return
    this.hasPending = false
    await this.generate(this.currentQuestion, this.currentTopics, this.currentScope)
  }

  /** A question typed/chatted by the user — answered immediately (Req 14, 7.6). */
  async handleQuestion(question: string): Promise<void> {
    if (this.exhausted) return
    this.prepare(question)
    this.hasPending = false
    await this.generate(question, this.currentTopics, this.currentScope)
  }

  /**
   * A screenshot of an on-screen interview question (Phase 2 vision). The
   * vision model reads the question from the image and answers it as the
   * candidate. Topics can't be detected from an image, so we treat it as
   * in-scope and skip topic badges. Routed through the same streaming/persist
   * path as a normal answer.
   */
  async handleScreenshot(imageBase64: string, mimeType: string): Promise<void> {
    if (this.exhausted) return
    const question = 'Screenshot question'
    const scope: ScopeClassification = 'in-scope'
    this.currentQuestion = question
    this.currentTopics = []
    this.currentScope = scope
    this.hasPending = false
    this.d.emit.topics([])
    this.d.emit.scope(scope, scopeColor(scope))
    await this.generate(question, [], scope, { imageBase64, mimeType })
  }

  /** Compute topics + scope for a question and relay the badges. */
  private prepare(question: string): void {
    const topics = detectTopics(question)
    const scope = classifyScope(
      topics,
      this.d.profile.roleCategories,
      this.roleAdjacency,
      this.topicToRole
    )
    this.currentQuestion = question
    this.currentTopics = topics
    this.currentScope = scope
    this.d.emit.topics(topics)
    this.d.emit.scope(scope, scopeColor(scope))
  }

  /** Regenerate the answer for the current question (Req 7.7 equivalent). */
  async regenerate(): Promise<void> {
    if (this.currentQuestion === null || this.exhausted) return
    await this.generate(this.currentQuestion, this.currentTopics, this.currentScope)
  }

  private async generate(
    question: string,
    topics: TopicDomain[],
    scope: ScopeClassification,
    image?: { imageBase64: string; mimeType: string }
  ): Promise<void> {
    // For a screenshot question, instruct the vision model to read the question
    // FROM the image (the `question` text is only a placeholder/label).
    const systemPrompt = image
      ? `${buildSystemPrompt(this.d.profile, scope)}\n\nThe user has shared a SCREENSHOT of an interview question (it may be a coding task, multiple-choice question, system-design prompt, or written question). Read the question directly from the image and answer it as the candidate. If it is multiple choice, state the correct option and briefly why.`
      : buildSystemPrompt(this.d.profile, scope)
    const seq = ++this.generationSeq

    // Pass prior turns as context. For a regenerate of the current question,
    // exclude its own (already-recorded) turn so it isn't fed back as history.
    const last = this.history[this.history.length - 1]
    const priorHistory =
      last && last.question === question ? this.history.slice(0, -1) : this.history.slice()

    // eslint-disable-next-line no-console
    console.log('[orchestrator] generating answer for:', image ? '[screenshot]' : question.slice(0, 80))

    let result
    try {
      result = await this.d.llmProvider.generate(
        {
          systemPrompt,
          question,
          history: priorHistory,
          ...(image ? { imageBase64: image.imageBase64, imageMimeType: image.mimeType } : {}),
        },
        (token) => {
          if (seq !== this.generationSeq) return
          this.d.emit.answerToken(token)
        },
        (usage) => {
          void this.d.credits.recordUsage(this.d.sessionId, this.d.accountId, {
            sttMinutes: 0,
            llmTokens: usage.promptTokens + usage.completionTokens,
          })
        }
      )
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[orchestrator] LLM threw:', err instanceof Error ? err.stack : err)
      this.d.emit.answerError('llm', err instanceof Error ? err.message : String(err))
      return
    }

    // eslint-disable-next-line no-console
    console.log(
      '[orchestrator] LLM result:',
      result.kind,
      result.kind === 'ok' ? `answerLen=${result.answer.length}` : `${result.reason}: ${result.message}`
    )

    if (seq !== this.generationSeq) return

    if (result.kind === 'error') {
      this.d.emit.answerError(result.provider, result.message)
      return
    }

    // Persist the Q&A pair (Req 17.5).
    await this.d.repos.qna.append(this.d.sessionId, this.d.accountId, {
      question,
      answer: result.answer,
      topics,
      scope,
      timestamp: new Date().toISOString(),
    })

    this.d.emit.answerComplete(result.answer)
    this.recordTurn(question, result.answer)

    await this.checkCredits()
  }

  /** Append (or, on regenerate, replace) a turn in the rolling memory buffer. */
  private recordTurn(question: string, answer: string): void {
    const trimmed =
      answer.length > MAX_CONTEXT_ANSWER_CHARS ? `${answer.slice(0, MAX_CONTEXT_ANSWER_CHARS)}…` : answer
    const last = this.history[this.history.length - 1]
    if (last && last.question === question) {
      last.answer = trimmed
      return
    }
    this.history.push({ question, answer: trimmed })
    while (this.history.length > MAX_HISTORY_TURNS) this.history.shift()
  }

  /** Record STT minutes metered by the relay. */
  async meterSttMinutes(delta: number): Promise<void> {
    await this.d.credits.recordUsage(this.d.sessionId, this.d.accountId, {
      sttMinutes: delta,
      llmTokens: 0,
    })
    await this.checkCredits()
  }

  /** Low-credit warning + hard stop checkpoints (Req 10). */
  private async checkCredits(): Promise<void> {
    if (this.d.enforcement !== 'enforced' || this.exhausted) return
    const live = await this.d.credits.liveBalance(
      this.d.accountId,
      this.d.sessionId,
      this.d.enforcement
    )
    if (this.d.credits.isExhausted(live, this.d.enforcement)) {
      this.exhausted = true
      this.d.emit.creditsExhausted()
      return
    }
    if (this.d.credits.isLowCredit(live, this.d.enforcement)) {
      this.d.emit.lowCreditWarning(live, this.d.lowCreditThreshold)
    }
  }
}
