// Deepgram streaming STT relay (primary backend, Req 13.1, 13.2).
//
// Streams PCM frames to Deepgram's live transcription WebSocket. Interim results
// become partial transcripts; final results accumulate into the pending
// utterance. End-of-question is decided by the SHARED endpointing reducer
// (reduceStt) driven by Deepgram's UtteranceEnd/silence against the configured
// threshold (resolveSilenceThreshold), so behavior matches v1 (Req 13.4-13.7).
//
// Resilience: Deepgram occasionally drops the live socket (idle timeout, network
// blip, server-side error). The relay AUTO-RECONNECTS — it transparently opens a
// fresh socket and keeps streaming, preserving the endpointing state, so the
// transcript never gets permanently stuck. Only repeated failures surface an
// error to the client.

import { createClient, LiveTranscriptionEvents, type ListenLiveClient } from '@deepgram/sdk'
import {
  initialSttState,
  reduceStt,
  resolveSilenceThreshold,
  type SttState,
} from '@interview-assistant/shared'
import type { SttRelay, SttRelayEvents } from './types'

const SAMPLE_RATE = 16_000
const MAX_RECONNECT_ATTEMPTS = 8
const RECONNECT_BASE_MS = 500
const RECONNECT_MAX_MS = 5_000
const PREOPEN_BUFFER_CAP = 1_000

/** Create a Deepgram-backed {@link SttRelay} factory bound to an API key. */
export function createDeepgramRelayFactory(apiKey: string) {
  return (events: SttRelayEvents, options: { silenceThresholdSeconds: number }): SttRelay => {
    const threshold = resolveSilenceThreshold(options.silenceThresholdSeconds)
    if (!apiKey) {
      // eslint-disable-next-line no-console
      console.error('[deepgram] no API key configured — transcription disabled')
    }
    const deepgram = createClient(apiKey)

    // Endpointing state + metering persist ACROSS reconnects (closure scope).
    let state: SttState = initialSttState()
    let lastSpeechAt = Date.now()
    let meteredSamples = 0

    let connection: ListenLiveClient | null = null
    let open = false
    let disposed = false
    let reconnectAttempts = 0
    let keepAlive: ReturnType<typeof setInterval> | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    // Frames that arrive while the socket is (re)connecting, replayed on open.
    const preOpen: ArrayBuffer[] = []

    function clearKeepAlive(): void {
      if (keepAlive) {
        clearInterval(keepAlive)
        keepAlive = null
      }
    }

    function scheduleReconnect(): void {
      if (disposed || reconnectTimer) return
      if (reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
        // eslint-disable-next-line no-console
        console.error(`[deepgram] giving up after ${reconnectAttempts} reconnect attempts`)
        events.onError('Transcription connection lost')
        return
      }
      const delay = Math.min(RECONNECT_BASE_MS * 2 ** reconnectAttempts, RECONNECT_MAX_MS)
      reconnectAttempts += 1
      reconnectTimer = setTimeout(() => {
        reconnectTimer = null
        // eslint-disable-next-line no-console
        console.log(`[deepgram] reconnecting (attempt ${reconnectAttempts})`)
        connect()
      }, delay)
      reconnectTimer.unref?.()
    }

    function connect(): void {
      if (disposed) return
      open = false
      const conn = deepgram.listen.live({
        model: 'nova-2',
        encoding: 'linear16',
        sample_rate: SAMPLE_RATE,
        channels: 1,
        interim_results: true,
        punctuate: true,
        utterance_end_ms: Math.max(1000, Math.round(threshold * 1000)),
        vad_events: true,
      })
      connection = conn

      conn.on(LiveTranscriptionEvents.Open, () => {
        open = true
        reconnectAttempts = 0
        // eslint-disable-next-line no-console
        console.log(`[deepgram] connection open; draining ${preOpen.length} buffered frame(s)`)
        for (const ab of preOpen) {
          try {
            conn.send(ab)
          } catch {
            /* will reconnect */
          }
        }
        preOpen.length = 0
        clearKeepAlive()
        keepAlive = setInterval(() => {
          try {
            conn.keepAlive()
          } catch {
            /* socket gone */
          }
        }, 8_000)
        keepAlive.unref?.()
      })

      conn.on(LiveTranscriptionEvents.Transcript, (data: unknown) => {
        const d = data as {
          is_final?: boolean
          channel?: { alternatives?: Array<{ transcript?: string }> }
        }
        const transcript = d.channel?.alternatives?.[0]?.transcript ?? ''
        if (transcript.length === 0) return
        lastSpeechAt = Date.now()
        if (d.is_final) {
          const r = reduceStt(state, { type: 'speech', text: transcript })
          state = r.state
          events.onPartial(state.pendingText)
        } else {
          events.onPartial(`${state.pendingText} ${transcript}`.trim())
        }
      })

      conn.on(LiveTranscriptionEvents.UtteranceEnd, () => {
        const silenceSeconds = (Date.now() - lastSpeechAt) / 1000
        const r = reduceStt(state, {
          type: 'silence',
          durationSeconds: Math.max(silenceSeconds, threshold),
          thresholdSeconds: threshold,
        })
        state = r.state
        if (r.finalizedQuestion) events.onFinal(r.finalizedQuestion)
      })

      conn.on(LiveTranscriptionEvents.Close, () => {
        open = false
        clearKeepAlive()
        if (disposed) {
          // eslint-disable-next-line no-console
          console.log('[deepgram] connection closed')
          return
        }
        // eslint-disable-next-line no-console
        console.log('[deepgram] connection dropped — reconnecting')
        scheduleReconnect()
      })

      conn.on(LiveTranscriptionEvents.Error, (err: unknown) => {
        // eslint-disable-next-line no-console
        console.error('[deepgram] error:', err instanceof Error ? err.message : JSON.stringify(err))
        // A Close event normally follows and drives the reconnect; no banner for
        // transient errors we can recover from.
      })
    }

    connect()

    return {
      pushAudio(frame: Int16Array): void {
        meteredSamples += frame.length
        if (meteredSamples >= SAMPLE_RATE * 60) {
          events.onMetered?.(meteredSamples / SAMPLE_RATE / 60)
          meteredSamples = 0
        }
        const ab = frame.buffer.slice(
          frame.byteOffset,
          frame.byteOffset + frame.byteLength
        ) as ArrayBuffer
        if (open && connection) {
          try {
            connection.send(ab)
          } catch {
            if (preOpen.length < PREOPEN_BUFFER_CAP) preOpen.push(ab)
          }
        } else if (preOpen.length < PREOPEN_BUFFER_CAP) {
          // Buffer while (re)connecting; replayed on the next Open.
          preOpen.push(ab)
        }
      },
      async close(): Promise<void> {
        disposed = true
        if (reconnectTimer) {
          clearTimeout(reconnectTimer)
          reconnectTimer = null
        }
        if (meteredSamples > 0) {
          events.onMetered?.(meteredSamples / SAMPLE_RATE / 60)
          meteredSamples = 0
        }
        clearKeepAlive()
        try {
          connection?.requestClose()
        } catch {
          /* already closed */
        }
      },
    }
  }
}
