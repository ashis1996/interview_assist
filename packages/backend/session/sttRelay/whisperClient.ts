// OpenAI Whisper STT relay (acceptable backend, Req 13.1, 13.3).
//
// The Whisper REST API is not streaming, so this relay buffers the current
// utterance, uses energy-based silence detection to decide end-of-question, and
// transcribes the accumulated audio on demand. Finalization reuses the SHARED
// reducers (reduceStt / resolveSilenceThreshold) so the semantics match the rest
// of the system. Interim "partials" are produced by transcribing the running
// utterance at a bounded cadence.

import OpenAI, { toFile } from 'openai'
import {
  initialSttState,
  reduceStt,
  resolveSilenceThreshold,
  type SttState,
} from '@interview-assistant/shared'
import type { SttRelay, SttRelayEvents } from './types'

const SAMPLE_RATE = 16_000
/** RMS amplitude (int16 scale) below which a frame is considered silence. */
const SILENCE_RMS = 500
/** Minimum gap between interim transcription calls. */
const PARTIAL_INTERVAL_MS = 1500

function rms(frame: Int16Array): number {
  if (frame.length === 0) return 0
  let sum = 0
  for (let i = 0; i < frame.length; i++) sum += frame[i]! * frame[i]!
  return Math.sqrt(sum / frame.length)
}

/** Wrap mono 16kHz Int16 PCM samples in a minimal WAV container. */
function pcmToWav(samples: Int16Array): Buffer {
  const dataLen = samples.length * 2
  const buffer = Buffer.alloc(44 + dataLen)
  buffer.write('RIFF', 0)
  buffer.writeUInt32LE(36 + dataLen, 4)
  buffer.write('WAVE', 8)
  buffer.write('fmt ', 12)
  buffer.writeUInt32LE(16, 16)
  buffer.writeUInt16LE(1, 20) // PCM
  buffer.writeUInt16LE(1, 22) // mono
  buffer.writeUInt32LE(SAMPLE_RATE, 24)
  buffer.writeUInt32LE(SAMPLE_RATE * 2, 28)
  buffer.writeUInt16LE(2, 32)
  buffer.writeUInt16LE(16, 34)
  buffer.write('data', 36)
  buffer.writeUInt32LE(dataLen, 40)
  Buffer.from(samples.buffer, samples.byteOffset, dataLen).copy(buffer, 44)
  return buffer
}

/** Create an OpenAI Whisper-backed {@link SttRelay} factory bound to an API key. */
export function createWhisperRelayFactory(apiKey: string) {
  return (events: SttRelayEvents, options: { silenceThresholdSeconds: number }): SttRelay => {
    const threshold = resolveSilenceThreshold(options.silenceThresholdSeconds)
    const client = new OpenAI({ apiKey })

    let utterance: number[] = []
    let state: SttState = initialSttState()
    let silenceMs = 0
    let lastPartialAt = 0
    let meteredSamples = 0
    let busy = false

    async function transcribe(samples: Int16Array): Promise<string> {
      const wav = pcmToWav(samples)
      const file = await toFile(wav, 'audio.wav', { type: 'audio/wav' })
      const res = await client.audio.transcriptions.create({ file, model: 'whisper-1' })
      return (res.text ?? '').trim()
    }

    async function maybePartial(): Promise<void> {
      const now = Date.now()
      if (busy || utterance.length < SAMPLE_RATE / 2 || now - lastPartialAt < PARTIAL_INTERVAL_MS) {
        return
      }
      lastPartialAt = now
      busy = true
      try {
        const text = await transcribe(Int16Array.from(utterance))
        if (text.length) events.onPartial(text)
      } catch (err) {
        events.onError(err instanceof Error ? err.message : 'Whisper transcription error')
      } finally {
        busy = false
      }
    }

    async function finalize(): Promise<void> {
      if (utterance.length === 0) return
      let text = ''
      try {
        text = await transcribe(Int16Array.from(utterance))
      } catch (err) {
        events.onError(err instanceof Error ? err.message : 'Whisper transcription error')
        return
      }
      utterance = []
      const afterSpeech = reduceStt(state, { type: 'speech', text })
      state = afterSpeech.state
      const afterSilence = reduceStt(state, {
        type: 'silence',
        durationSeconds: threshold,
        thresholdSeconds: threshold,
      })
      state = afterSilence.state
      if (afterSilence.finalizedQuestion) events.onFinal(afterSilence.finalizedQuestion)
    }

    return {
      pushAudio(frame: Int16Array): void {
        meteredSamples += frame.length
        if (meteredSamples >= SAMPLE_RATE * 60) {
          events.onMetered?.(meteredSamples / SAMPLE_RATE / 60)
          meteredSamples = 0
        }
        const frameMs = (frame.length / SAMPLE_RATE) * 1000
        if (rms(frame) < SILENCE_RMS) {
          silenceMs += frameMs
          if (utterance.length > 0 && silenceMs >= threshold * 1000) {
            silenceMs = 0
            void finalize()
          }
        } else {
          silenceMs = 0
          for (let i = 0; i < frame.length; i++) utterance.push(frame[i]!)
          void maybePartial()
        }
      },
      async close(): Promise<void> {
        if (meteredSamples > 0) {
          events.onMetered?.(meteredSamples / SAMPLE_RATE / 60)
          meteredSamples = 0
        }
        await finalize()
      },
    }
  }
}
