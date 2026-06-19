// STT relay interface (Req 13).
//
// The Session_Gateway feeds binary PCM Audio_Frames to an SttRelay, which
// streams interim transcripts and finalizes Questions on silence. Endpointing
// reuses the pure shared reducers (reduceStt / resolveSilenceThreshold) so the
// finalization semantics match v1 exactly. Implementations (Deepgram, Whisper)
// are injected so the gateway is provider-agnostic and testable.

/** Events emitted by an SttRelay toward the Session_Gateway. */
export interface SttRelayEvents {
  /** Interim transcript text (cadence <= 500ms, Req 13.4, 16.2). */
  onPartial(text: string): void
  /** A finalized Question after silence >= threshold (Req 13.5). */
  onFinal(text: string): void
  /** A transcription failure; the session stays open (Req 13.8). */
  onError(message: string): void
  /** Approximate audio minutes relayed, for metering (Req 9.1). */
  onMetered?(sttMinutesDelta: number): void
}

/** A streaming speech-to-text relay for one session. */
export interface SttRelay {
  /** Push a chunk of 16kHz mono Int16 PCM audio. */
  pushAudio(frame: Int16Array): void
  /** Stop and release the upstream connection. */
  close(): Promise<void>
}

/** Factory that opens a relay for a session with the configured threshold. */
export type SttRelayFactory = (
  events: SttRelayEvents,
  options: { silenceThresholdSeconds: number }
) => SttRelay
