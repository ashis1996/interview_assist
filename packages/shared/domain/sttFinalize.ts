// Pure STT finalization reducer. Relocated verbatim from v1 src/main/domain.
//
// The STT_Provider finalizes recognized speech as a Question only after a
// silence interval meeting the threshold (Req 13.5). Audio with no recognizable
// speech yields no text and no Question (Req 13.7). Timing is supplied as input
// so the reducer is pure and needs no timers.

/** Accumulated STT state pending finalization. */
export interface SttState {
  /** Recognized text accumulated since the last finalization, not yet finalized. */
  pendingText: string
}

/**
 * An input event to the finalization reducer.
 *
 * - `speech`: a recognized speech chunk to append to the pending text.
 * - `silence`: a detected silence interval, evaluated against the threshold.
 */
export type SttInput =
  | { type: 'speech'; text: string }
  | { type: 'silence'; durationSeconds: number; thresholdSeconds: number }

/** Result of a single reduce step: the next state and any finalized Question. */
export interface SttReduceResult {
  state: SttState
  finalizedQuestion?: string
}

/** Create the initial STT state with no pending text. */
export function initialSttState(): SttState {
  return { pendingText: '' }
}

/**
 * Pure finalization reducer for the STT_Provider (Req 13.5, 13.7). Has no side
 * effects and does not mutate the input `state`.
 *
 * @param state The current STT state.
 * @param input The speech or silence event to apply.
 * @returns The next state and any Question finalized this step.
 */
export function reduceStt(state: SttState, input: SttInput): SttReduceResult {
  switch (input.type) {
    case 'speech': {
      const chunk = input.text.trim()
      if (chunk.length === 0) {
        return { state: { pendingText: state.pendingText } }
      }
      const pendingText =
        state.pendingText.length === 0 ? chunk : `${state.pendingText} ${chunk}`
      return { state: { pendingText } }
    }
    case 'silence': {
      const meetsThreshold = input.durationSeconds >= input.thresholdSeconds
      const hasSpeech = state.pendingText.length > 0
      if (meetsThreshold && hasSpeech) {
        return { state: { pendingText: '' }, finalizedQuestion: state.pendingText }
      }
      return { state: { pendingText: state.pendingText } }
    }
  }
}
