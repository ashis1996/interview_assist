// Native audio capture (Req 4) with INDEPENDENT mic + system-audio toggles.
// Runs in the renderer; no subprocess (Req 4.6).
//
// Captures the microphone (getUserMedia) and Windows system-audio loopback
// (Electron getDisplayMedia + setDisplayMediaRequestHandler) as two independent,
// individually toggleable sources. Active sources are mixed, downmixed to mono,
// resampled to 16 kHz, and emitted as Int16 PCM frames to the sink.

const TARGET_SAMPLE_RATE = 16_000

// --- Voice-activity gating (cost optimization) ----------------------------
// Only stream audio when someone is actually speaking, so long silences (the
// candidate thinking, reading, dead air) aren't sent to the STT provider —
// which bills per audio-minute. Both the mic and system sources are mixed
// BEFORE gating, so a voice on either channel keeps the stream flowing.
//
// - VAD_RMS_THRESHOLD: loudness (0..1 RMS) above which a frame counts as speech.
// - VAD_HANGOVER_MS: keep streaming this long after the last detected speech so
//   trailing silence still reaches Deepgram for end-of-utterance detection
//   (must exceed the relay's utterance_end_ms, ~1000ms).
// - VAD_PREROLL_FRAMES: frames of lead-in replayed on speech onset so the first
//   word/syllable isn't clipped.
const VAD_RMS_THRESHOLD = 0.012
const VAD_HANGOVER_MS = 2_000
const VAD_PREROLL_FRAMES = 4

function frameRms(input: Float32Array): number {
  let sum = 0
  for (let i = 0; i < input.length; i++) sum += input[i]! * input[i]!
  return Math.sqrt(sum / Math.max(1, input.length))
}

export interface CaptureState {
  micActive: boolean
  systemActive: boolean
  systemAudioAvailable: boolean
}

export interface AudioCaptureSink {
  /** Receive a 16 kHz mono Int16 PCM frame from the active source mix. */
  onFrame(frame: Int16Array): void
  /** Report per-source capture state for the toolbar indicators. */
  onState(state: CaptureState): void
}

function downmixToMono(channels: Float32Array[]): Float32Array {
  if (channels.length === 1) return channels[0]!
  const length = channels[0]!.length
  const out = new Float32Array(length)
  for (let i = 0; i < length; i++) {
    let sum = 0
    for (const ch of channels) sum += ch[i]!
    out[i] = sum / channels.length
  }
  return out
}

function resampleTo16k(input: Float32Array, inRate: number): Float32Array {
  if (inRate === TARGET_SAMPLE_RATE) return input
  const ratio = TARGET_SAMPLE_RATE / inRate
  const outLength = Math.floor(input.length * ratio)
  const out = new Float32Array(outLength)
  for (let i = 0; i < outLength; i++) {
    const srcPos = i / ratio
    const i0 = Math.floor(srcPos)
    const i1 = Math.min(i0 + 1, input.length - 1)
    const frac = srcPos - i0
    out[i] = input[i0]! * (1 - frac) + input[i1]! * frac
  }
  return out
}

function floatToInt16(input: Float32Array): Int16Array {
  const out = new Int16Array(input.length)
  for (let i = 0; i < input.length; i++) {
    const s = Math.max(-1, Math.min(1, input[i]!))
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff
  }
  return out
}

export class AudioCapture {
  private context: AudioContext | null = null
  private merger: GainNode | null = null
  private processor: ScriptProcessorNode | null = null
  private micStream: MediaStream | null = null
  private systemStream: MediaStream | null = null
  private micNode: MediaStreamAudioSourceNode | null = null
  private systemNode: MediaStreamAudioSourceNode | null = null
  private micActive = false
  private systemActive = false
  private systemAudioAvailable = false
  private started = false
  // VAD gating state.
  private lastVoiceAt = 0
  private gateOpen = false
  private readonly preroll: Int16Array[] = []

  constructor(private readonly sink: AudioCaptureSink) {}

  isMicActive(): boolean {
    return this.micActive
  }
  isSystemActive(): boolean {
    return this.systemActive
  }

  /** Initialise the audio graph and enable the requested sources. */
  async start(opts?: { mic?: boolean; system?: boolean }): Promise<void> {
    if (this.started) return
    const ctx = new AudioContext()
    this.context = ctx
    this.merger = ctx.createGain()
    const processor = ctx.createScriptProcessor(4096, 1, 1)
    this.processor = processor
    this.merger.connect(processor)
    processor.connect(ctx.destination)

    processor.onaudioprocess = (e: AudioProcessingEvent) => {
      if (!this.micActive && !this.systemActive) return
      const channelData: Float32Array[] = []
      for (let c = 0; c < e.inputBuffer.numberOfChannels; c++) {
        channelData.push(e.inputBuffer.getChannelData(c))
      }
      const mono = downmixToMono(channelData)
      const resampled = resampleTo16k(mono, ctx.sampleRate)
      const frame = floatToInt16(resampled)

      // Voice-activity gating: stream only around detected speech.
      const now = performance.now()
      if (frameRms(resampled) >= VAD_RMS_THRESHOLD) this.lastVoiceAt = now
      const active = now - this.lastVoiceAt < VAD_HANGOVER_MS

      if (active) {
        if (!this.gateOpen) {
          // Speech onset: replay the buffered lead-in so the first word isn't clipped.
          for (const f of this.preroll) this.sink.onFrame(f)
          this.preroll.length = 0
          this.gateOpen = true
        }
        this.sink.onFrame(frame)
      } else {
        // Silence: don't stream, but keep a short rolling pre-roll for the next onset.
        this.gateOpen = false
        this.preroll.push(frame)
        if (this.preroll.length > VAD_PREROLL_FRAMES) this.preroll.shift()
      }
    }

    this.started = true
    if (opts?.mic ?? true) await this.setMicEnabled(true)
    if (opts?.system ?? true) await this.setSystemEnabled(true)
    this.emitState()
  }

  /** Toggle the microphone source (Req 4.1, dual-toggle). Resilient: a mic
   * failure (no device / denied) never aborts the rest of capture. */
  async setMicEnabled(enabled: boolean): Promise<void> {
    if (!this.started || enabled === this.micActive) return
    if (enabled) {
      try {
        this.micStream = await navigator.mediaDevices.getUserMedia({ audio: true })
        this.micNode = this.context!.createMediaStreamSource(this.micStream)
        this.micNode.connect(this.merger!)
        this.micActive = true
      } catch {
        this.micActive = false
      }
    } else {
      this.micNode?.disconnect()
      this.micNode = null
      this.micStream?.getTracks().forEach((t) => t.stop())
      this.micStream = null
      this.micActive = false
    }
    this.emitState()
  }

  /** Toggle the system/computer-audio loopback source (Req 4.2, 4.5, dual-toggle). */
  async setSystemEnabled(enabled: boolean): Promise<void> {
    if (!this.started || enabled === this.systemActive) return
    if (enabled) {
      try {
        this.systemStream = await navigator.mediaDevices.getDisplayMedia({ audio: true, video: true })
        this.systemStream.getVideoTracks().forEach((t) => t.stop())
        this.systemAudioAvailable = this.systemStream.getAudioTracks().length > 0
        if (this.systemAudioAvailable) {
          this.systemNode = this.context!.createMediaStreamSource(this.systemStream)
          this.systemNode.connect(this.merger!)
          this.systemActive = true
        }
      } catch {
        this.systemAudioAvailable = false
        this.systemActive = false
      }
    } else {
      this.systemNode?.disconnect()
      this.systemNode = null
      this.systemStream?.getTracks().forEach((t) => t.stop())
      this.systemStream = null
      this.systemActive = false
    }
    this.emitState()
  }

  /** Stop all capture and release devices. */
  async stop(): Promise<void> {
    await this.setMicEnabled(false)
    await this.setSystemEnabled(false)
    this.processor?.disconnect()
    this.processor = null
    this.merger?.disconnect()
    this.merger = null
    await this.context?.close().catch(() => {})
    this.context = null
    this.started = false
    this.lastVoiceAt = 0
    this.gateOpen = false
    this.preroll.length = 0
    this.emitState()
  }

  private emitState(): void {
    this.sink.onState({
      micActive: this.micActive,
      systemActive: this.systemActive,
      systemAudioAvailable: this.systemAudioAvailable,
    })
  }
}

export const audioCaptureInternals = {
  downmixToMono,
  resampleTo16k,
  floatToInt16,
  TARGET_SAMPLE_RATE,
}
