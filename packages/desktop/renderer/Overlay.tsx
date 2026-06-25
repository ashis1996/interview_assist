// Overlay_UI — the Parakeet-style interview surface (Req 4, 6, 7, 10).
//
// A thin, draggable glassmorphic top toolbar (Answer / Screenshot / Chat / mic
// + system toggles / timer / settings / collapse / end) over a flowing
// right-to-left transcript stream of sentence capsules. The answer card is only
// mounted once an answer is requested/streaming, so the overlay stays compact
// while listening. The window auto-fits its content height. Audio is captured
// natively with INDEPENDENT mic + system toggles. Collapse shrinks everything
// into a floating brain-logo pill that stays screen-share invisible.

import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { ScopeClassification, TopicDomain } from '@interview-assistant/shared'
import { AudioCapture, type CaptureState } from './audioCapture'
import {
  MicIcon,
  SpeakerIcon,
  SparkIcon,
  CameraIcon,
  ChatIcon,
  SettingsIcon,
  CollapseIcon,
  CloseIcon,
  CopyIcon,
  RegenIcon,
  SendIcon,
} from './icons'
import { Logo } from './components/Logo'
import {
  IPC_EVT_TRANSCRIPT,
  IPC_EVT_FINAL_QUESTION,
  IPC_EVT_TOPICS,
  IPC_EVT_SCOPE,
  IPC_EVT_ANSWER_TOKEN,
  IPC_EVT_ANSWER_COMPLETE,
  IPC_EVT_ANSWER_ERROR,
  IPC_EVT_STT_ERROR,
  IPC_EVT_LOW_CREDIT,
  IPC_EVT_SESSION_ENDED,
  IPC_EVT_HOTKEY_ANSWER,
  IPC_EVT_CLICKTHROUGH,
  type ScopePayload,
} from '../shared/ipc'

const MAX_STREAM_SENTENCES = 50

function formatElapsed(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function Overlay(props: { onEnded: () => void; onCollapse: () => void }): React.JSX.Element {
  const [sentences, setSentences] = useState<string[]>([]) // finalized question stream
  const [latestQuestion, setLatestQuestion] = useState('') // latest finalized question
  const [answeredQuestion, setAnsweredQuestion] = useState('') // the Q the answer is for
  const [liveTranscript, setLiveTranscript] = useState('') // streaming partial
  const [answer, setAnswer] = useState('')
  const [generating, setGenerating] = useState(false)
  const [topics, setTopics] = useState<TopicDomain[]>([])
  const [scope, setScope] = useState<{ scope: ScopeClassification; color: string } | null>(null)
  const [capture, setCaptureState] = useState<CaptureState>({
    micActive: false,
    systemActive: false,
    systemAudioAvailable: false,
  })
  const [banner, setBanner] = useState<string | null>(null)
  const [chatText, setChatText] = useState('')
  const [chatOpen, setChatOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [autoGen, setAutoGen] = useState(false)
  const [privateMode, setPrivateMode] = useState(true)
  const [opacity, setOpacity] = useState(95)
  const [elapsed, setElapsed] = useState(0)
  const [stealth, setStealth] = useState(false)
  // The transcript capsule the user explicitly selected to answer (click to
  // select). When set, the Answer button targets THIS question instead of the
  // latest finalized one. Stored by text value.
  const [selectedQuestion, setSelectedQuestion] = useState<string | null>(null)
  const captureRef = useRef<AudioCapture | null>(null)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const streamEndRef = useRef<HTMLDivElement | null>(null)
  const streamTrackRef = useRef<HTMLDivElement | null>(null)
  // Only auto-scroll the transcript to the newest capsule when the user is
  // already at the right edge; if they've scrolled left to read history, leave
  // their position alone.
  const followRef = useRef(true)
  const answerEndRef = useRef<HTMLDivElement | null>(null)
  const pendingTokensRef = useRef('')
  const rafRef = useRef<number | null>(null)
  const onAnswerRef = useRef<() => void>(() => {})

  useEffect(() => {
    const offs = [
      window.api.on(IPC_EVT_TRANSCRIPT, (p) => setLiveTranscript(p as string)),
      window.api.on(IPC_EVT_FINAL_QUESTION, (p) => {
        const text = (p as string).trim()
        if (!text) return
        setSentences((prev) => [...prev, text].slice(-MAX_STREAM_SENTENCES))
        setLatestQuestion(text)
        setLiveTranscript('')
      }),
      window.api.on(IPC_EVT_ANSWER_TOKEN, (p) => {
        setGenerating(true)
        // Batch tokens to one state update per animation frame: streaming
        // emits many small tokens, and re-rendering on every one (re-parsing
        // markdown each time) makes the answer visibly stutter and lag.
        pendingTokensRef.current += p as string
        if (rafRef.current == null) {
          rafRef.current = requestAnimationFrame(() => {
            rafRef.current = null
            const chunk = pendingTokensRef.current
            pendingTokensRef.current = ''
            if (chunk) setAnswer((a) => a + chunk)
          })
        }
      }),
      window.api.on(IPC_EVT_ANSWER_COMPLETE, (p) => {
        if (rafRef.current != null) {
          cancelAnimationFrame(rafRef.current)
          rafRef.current = null
        }
        pendingTokensRef.current = ''
        setGenerating(false)
        setAnswer(p as string)
      }),
      window.api.on(IPC_EVT_TOPICS, (p) => setTopics(p as TopicDomain[])),
      window.api.on(IPC_EVT_SCOPE, (p) => setScope(p as ScopePayload)),
      window.api.on(IPC_EVT_ANSWER_ERROR, (p) => {
        setGenerating(false)
        setBanner(`Answer error: ${(p as { message: string }).message}`)
      }),
      window.api.on(IPC_EVT_STT_ERROR, (p) => setBanner(`Transcription issue: ${p as string}`)),
      window.api.on(IPC_EVT_LOW_CREDIT, () => setBanner('Low credit balance.')),
      window.api.on(IPC_EVT_SESSION_ENDED, (p) => {
        setBanner(`Session ended (${(p as { reason: string }).reason}).`)
        props.onEnded()
      }),
      window.api.on(IPC_EVT_HOTKEY_ANSWER, () => onAnswerRef.current()),
      window.api.on(IPC_EVT_CLICKTHROUGH, (p) => setStealth(Boolean(p))),
    ]

    const cap = new AudioCapture({
      onFrame: (frame) => window.api.sendAudioFrame(frame.buffer as ArrayBuffer),
      onState: (s) => setCaptureState(s),
    })
    captureRef.current = cap
    void cap.start({ mic: true, system: true }).catch(() => setBanner('Audio capture failed.'))

    void window.api.setPrivateMode(true)
    const timer = setInterval(() => setElapsed((e) => e + 1), 1000)

    return () => {
      for (const off of offs) off()
      void cap.stop()
      clearInterval(timer)
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current)
    }
  }, [props])

  // Keep the newest transcript capsule scrolled into view (right edge) — but
  // only while the user is following the live edge (not scrolled back reading).
  useEffect(() => {
    if (followRef.current) {
      streamEndRef.current?.scrollIntoView({ behavior: 'smooth', inline: 'end', block: 'nearest' })
    }
  }, [sentences, liveTranscript])

  // Auto-scroll the answer card as tokens stream in.
  useEffect(() => {
    answerEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [answer])

  // Fit the window to the rendered content height (compact while listening,
  // taller when an answer appears). Observed so it tracks every layout change.
  // The overlay is never rendered while collapsed (the app-level CollapsedPill
  // handles that view), so no collapsed guard is needed here.
  useLayoutEffect(() => {
    const el = rootRef.current
    if (!el) return
    const report = (): void => window.api.setContentHeight(Math.ceil(el.scrollHeight) + 8)
    report()
    const ro = new ResizeObserver(report)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const hasAnswerPanel = Boolean(answer || generating || answeredQuestion)

  const answerQuestion = (raw: string): void => {
    const q = (raw || '').trim()
    if (!q) return
    setAnsweredQuestion(q)
    setAnswer('')
    setGenerating(true)
    void window.api.submitTextQuestion(q)
  }
  const onAnswer = (): void => {
    // Prefer an explicitly selected transcript chunk; else the latest finalized
    // question; else whatever is being spoken right now.
    answerQuestion(selectedQuestion || latestQuestion || liveTranscript)
  }
  onAnswerRef.current = onAnswer
  const onSelectChunk = (text: string): void =>
    setSelectedQuestion((prev) => (prev === text ? null : text))
  const scrollStream = (dir: -1 | 1): void => {
    streamTrackRef.current?.scrollBy({ left: dir * 260, behavior: 'smooth' })
  }
  const onStreamScroll = (): void => {
    const el = streamTrackRef.current
    if (!el) return
    followRef.current = el.scrollWidth - el.scrollLeft - el.clientWidth < 48
  }
  const onStreamWheel = (e: React.WheelEvent<HTMLDivElement>): void => {
    const el = streamTrackRef.current
    if (!el) return
    // Translate vertical wheel into horizontal scroll over the transcript lane.
    el.scrollLeft += e.deltaY + e.deltaX
  }
  const toggleStealth = (): void => {
    const v = !stealth
    setStealth(v)
    void window.api.setClickThrough(v)
  }
  const onChatSend = (): void => {
    const t = chatText.trim()
    if (!t) return
    setAnsweredQuestion(t)
    setAnswer('')
    setGenerating(true)
    void window.api.submitTextQuestion(t)
    setChatText('')
  }
  const onClearStream = (): void => {
    setSentences([])
    setLatestQuestion('')
    setLiveTranscript('')
    setSelectedQuestion(null)
  }
  const onRegenerate = (): void => {
    setAnswer('')
    setGenerating(true)
    void window.api.regenerate()
  }
  const onScreenshot = (): void => {
    setAnsweredQuestion('Screenshot question')
    setAnswer('')
    setGenerating(true)
    void window.api.captureScreenshot().then((r) => {
      if (!r?.ok) {
        setGenerating(false)
        setBanner('Screenshot capture failed.')
      }
    })
  }
  const toggleMic = (): void => void captureRef.current?.setMicEnabled(!capture.micActive)
  const toggleSystem = (): void => void captureRef.current?.setSystemEnabled(!capture.systemActive)
  const toggleAuto = (): void => {
    const v = !autoGen
    setAutoGen(v)
    void window.api.setAutoGenerate(v)
  }
  const togglePrivate = (): void => {
    const v = !privateMode
    setPrivateMode(v)
    void window.api.setPrivateMode(v)
  }
  const changeOpacity = (v: number): void => {
    setOpacity(v)
    void window.api.setOpacityPercent(v)
  }

  const listening = capture.micActive || capture.systemActive

  return (
    <div className="pk" ref={rootRef}>
      {/* Top toolbar (drag handle). */}
      <div className="pk-toolbar">
        <span className="pk-brand" title="Interview Assistant">
          <Logo size={20} />
        </span>
        <span className={`pk-led${listening ? ' live' : ''}`} title={listening ? 'Listening' : 'Idle'}>
          <i />
          <i />
          <i />
        </span>
        <button
          className={`pk-src${capture.systemActive ? ' on' : ''}`}
          title="System audio"
          onClick={toggleSystem}
        >
          <SpeakerIcon size={16} />
        </button>
        <button
          className={`pk-src${capture.micActive ? ' on' : ''}`}
          title="Microphone"
          onClick={toggleMic}
        >
          <MicIcon size={16} />
        </button>
        <button className="pk-primary" onClick={onAnswer}>
          <SparkIcon size={15} /> Answer <kbd>Ctrl ↵</kbd>
        </button>
        <button className="pk-ghost" onClick={onScreenshot} title="Capture an on-screen question and answer it">
          <CameraIcon size={15} /> Screenshot
        </button>
        <button className={`pk-ghost${chatOpen ? ' active' : ''}`} onClick={() => setChatOpen((v) => !v)}>
          <ChatIcon size={15} /> Chat
        </button>
        <span className="pk-timer">{formatElapsed(elapsed)}</span>
        {stealth && (
          <span className="pk-stealth" title="Click-through is ON — toggle with Ctrl+Shift+Space">
            stealth
          </span>
        )}
        <button className="pk-icon" onClick={() => setSettingsOpen((v) => !v)} title="Settings">
          <SettingsIcon size={16} />
        </button>
        <button className="pk-icon" onClick={props.onCollapse} title="Collapse to pill">
          <CollapseIcon size={16} />
        </button>
        <button className="pk-icon pk-end" onClick={() => void window.api.stopInterview()} title="End session">
          <CloseIcon size={16} />
        </button>
      </div>

      {/* Chat input row. */}
      {chatOpen && (
        <div className="pk-input">
          <input
            value={chatText}
            placeholder="Ask anything…"
            autoFocus
            onChange={(e) => setChatText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onChatSend()
            }}
          />
          <button className="pk-primary" onClick={onChatSend}>
            <SendIcon size={15} /> Send
          </button>
          <button className="pk-icon" onClick={() => setChatOpen(false)} title="Close">
            <CloseIcon size={15} />
          </button>
        </div>
      )}

      {/* Flowing transcript stream: newest sentence enters at the right and
          older sentences flow left. Scroll back with the ‹ › buttons, the
          draggable scrollbar, or the mouse wheel. Click a capsule to select it
          (the Answer button then answers it); double-click to answer instantly. */}
      <div className="pk-stream">
        <button className="pk-stream-nav" onClick={() => scrollStream(-1)} title="Older transcripts">
          ‹
        </button>
        <div
          className="pk-stream-track"
          ref={streamTrackRef}
          onScroll={onStreamScroll}
          onWheel={onStreamWheel}
        >
          {sentences.length === 0 && !liveTranscript && (
            <span className="pk-sentence idle">
              {listening ? 'Listening…' : 'Waiting for audio…'}
            </span>
          )}
          {sentences.map((s, i) => (
            <span
              key={`${i}-${s.slice(0, 12)}`}
              className={`pk-sentence selectable${selectedQuestion === s ? ' selected' : ''}`}
              title="Click to select · double-click to answer"
              onClick={() => onSelectChunk(s)}
              onDoubleClick={() => answerQuestion(s)}
            >
              {s}
              {selectedQuestion === s && (
                <button
                  className="pk-answer-this"
                  title="Answer this question"
                  onClick={(e) => {
                    e.stopPropagation()
                    answerQuestion(s)
                  }}
                >
                  <SparkIcon size={12} /> Answer this
                </button>
              )}
            </span>
          ))}
          {liveTranscript && (
            <span className="pk-sentence live">
              <span className="pk-dot" />
              {liveTranscript}
            </span>
          )}
          {scope && (
            <span className="pk-scope" style={{ backgroundColor: scope.color }}>
              {scope.scope}
            </span>
          )}
          <div ref={streamEndRef} />
        </div>
        <button className="pk-stream-nav" onClick={() => scrollStream(1)} title="Newer transcripts">
          ›
        </button>
        <button className="pk-clear" onClick={onClearStream} title="Clear transcript">
          <CloseIcon size={13} />
        </button>
      </div>

      {/* Settings popover. */}
      {settingsOpen && (
        <div className="pk-settings">
          <label className="pk-row">
            <span>Auto Generate</span>
            <input type="checkbox" checked={autoGen} onChange={toggleAuto} />
          </label>
          <label className="pk-row">
            <span>Private (hidden in screen share)</span>
            <input type="checkbox" checked={privateMode} onChange={togglePrivate} />
          </label>
          <label className="pk-row">
            <span>Stealth click-through (toggle: Ctrl+Shift+Space)</span>
            <input type="checkbox" checked={stealth} onChange={toggleStealth} />
          </label>
          <label className="pk-row">
            <span>Opacity</span>
            <input
              type="range"
              min={30}
              max={100}
              value={opacity}
              onChange={(e) => changeOpacity(Number(e.target.value))}
            />
          </label>
          <button className="pk-ghost" onClick={() => void window.api.stopInterview()}>
            End Session
          </button>
        </div>
      )}

      {banner && <div className="pk-banner">{banner}</div>}

      {/* Question / Answer card — only mounted once an answer is requested. */}
      {hasAnswerPanel && (
        <div className="pk-answer">
          <div className="pk-answer-head">
            {topics.map((t) => (
              <span key={t} className="pk-topic">
                {t}
              </span>
            ))}
            <span className="pk-spacer" />
            <button className="pk-icon" onClick={() => void window.api.copyAnswer()} title="Copy">
              <CopyIcon size={15} />
            </button>
            <button className="pk-icon" onClick={onRegenerate} title="Regenerate">
              <RegenIcon size={15} />
            </button>
          </div>
          <div className="pk-answer-body">
            {answeredQuestion && (
              <div className="pk-qa-question">
                <ChatIcon size={15} className="pk-qa-ico" />
                <span>
                  <span className="pk-qa-qlabel">Question: </span>
                  {answeredQuestion}
                </span>
              </div>
            )}
            {answer ? (
              <div className="pk-qa-answer">
                <SparkIcon size={15} className="pk-qa-ico" />
                <div className="pk-md">
                  {generating ? (
                    // Plain-text while streaming (cheap), full markdown on
                    // completion — avoids re-parsing markdown on every token.
                    <div className="pk-stream-text">{answer}</div>
                  ) : (
                    <ReactMarkdown remarkPlugins={[remarkGfm]}>{answer}</ReactMarkdown>
                  )}
                </div>
              </div>
            ) : (
              <span className="pk-hint">
                <span className="pk-typing">
                  <i />
                  <i />
                  <i />
                </span>
                Generating answer…
              </span>
            )}
            <div ref={answerEndRef} />
          </div>
        </div>
      )}
    </div>
  )
}
