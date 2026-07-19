import { useEffect, useRef, useState } from 'react'
import type { NPC, NPCChatResponse, PreloadedNPCReply, SuggestedNPCReply } from '@shared/schema'
import { playAudio, speakText, stopAudio } from '../game/audio'

interface Props {
  gameId: string
  npc: NPC
  sessionId: string
  preloadedOpener?: PreloadedNPCReply
  hintAlreadyCollected: boolean
  onClueGranted: (hintId: string) => void
  onClose: () => void
  onAskMama?: () => boolean
  generatedPigletVoice?: boolean
}

interface ChatLine {
  speaker: 'Piglet' | string
  text: string
}

const moodEmoji: Record<NPCChatResponse['mood'], string> = {
  cheerful: '😊',
  curious: '🤔',
  helpful: '💛',
  thoughtful: '💭',
  excited: '✨',
}

export function DialogueBubble({
  gameId,
  npc,
  sessionId,
  preloadedOpener,
  hintAlreadyCollected,
  onClueGranted,
  onClose,
  onAskMama,
  generatedPigletVoice = false,
}: Props) {
  const [history, setHistory] = useState<ChatLine[]>(preloadedOpener
    ? [{ speaker: npc.name, text: preloadedOpener.reply }]
    : [])
  const [suggestions, setSuggestions] = useState<SuggestedNPCReply[]>(preloadedOpener?.suggestedReplies ?? [])
  const [mood, setMood] = useState<NPCChatResponse['mood']>(preloadedOpener?.mood ?? 'cheerful')
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(!preloadedOpener)
  const [error, setError] = useState('')
  const [audioUrl, setAudioUrl] = useState<string | null>(preloadedOpener?.audioUrl ?? null)
  const [viewMode, setViewMode] = useState<'glass' | 'compact'>('glass')
  const [recording, setRecording] = useState(false)
  const [requestingMic, setRequestingMic] = useState(false)
  const [recordingSeconds, setRecordingSeconds] = useState(0)
  const [transcribing, setTranscribing] = useState(false)
  const started = useRef(false)
  const knowsHint = useRef(hintAlreadyCollected)
  const transcriptRef = useRef<HTMLDivElement>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const recordingWanted = useRef(false)
  const audioChunks = useRef<Blob[]>([])
  const discardRecording = useRef(false)
  const recordingTimer = useRef<number>(0)
  const recordingTimeout = useRef<number>(0)

  async function playPigletSpeech(text: string): Promise<void> {
    if (!generatedPigletVoice) return speakText(text)
    try {
      const response = await fetch(`/api/game/${gameId}/piglet/speech`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
      if (!response.ok) throw new Error(`Piglet speech failed (${response.status})`)
      const result: { audioUrl?: string } = await response.json()
      if (!result.audioUrl) throw new Error('Piglet speech was unavailable')
      await playAudio(result.audioUrl)
    } catch {
      await speakText(text)
    }
  }

  async function requestTurn(
    message: string,
    source: 'start' | 'suggestion' | 'typed',
    intent?: SuggestedNPCReply['intent'],
    waitForPlayerSpeech?: Promise<void>,
  ) {
    setLoading(true)
    setError('')
    setSuggestions([])
    if (message) setHistory(lines => [...lines, { speaker: 'Piglet', text: message }])

    try {
      const res = await fetch(`/api/game/${gameId}/npcs/${npc.id}/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessionId,
          message,
          source,
          intent,
          hintAlreadyCollected: knowsHint.current,
        }),
      })
      if (!res.ok) throw new Error(`Conversation failed (${res.status})`)
      const turn: NPCChatResponse = await res.json()
      setHistory(lines => [...lines, { speaker: npc.name, text: turn.reply }])
      setSuggestions(turn.suggestedReplies)
      setMood(turn.mood)
      setAudioUrl(turn.audioUrl ?? null)
      await waitForPlayerSpeech
      if (turn.audioUrl) playAudio(turn.audioUrl).catch(() => speakText(turn.reply))
      else speakText(turn.reply)
      if (turn.clueGranted && turn.hintId && !knowsHint.current) {
        knowsHint.current = true
        onClueGranted(turn.hintId)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'The conversation paused unexpectedly.')
      setSuggestions([
        { text: 'Try again', intent: 'small_talk' },
        { text: 'Leave for now', intent: 'goodbye' },
      ])
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (started.current) return
    started.current = true
    if (preloadedOpener) {
      if (preloadedOpener.audioUrl) {
        playAudio(preloadedOpener.audioUrl).catch(() => speakText(preloadedOpener.reply))
      } else {
        speakText(preloadedOpener.reply)
      }
      return
    }
    requestTurn('', 'start')
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight, behavior: 'smooth' })
  }, [history, loading])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  useEffect(() => () => {
    discardRecording.current = true
    recordingWanted.current = false
    window.clearInterval(recordingTimer.current)
    window.clearTimeout(recordingTimeout.current)
    const recorder = recorderRef.current
    if (recorder?.state === 'recording') recorder.stop()
    recorder?.stream.getTracks().forEach(track => track.stop())
  }, [])

  function stopRecording() {
    recordingWanted.current = false
    window.clearInterval(recordingTimer.current)
    window.clearTimeout(recordingTimeout.current)
    const recorder = recorderRef.current
    if (recorder?.state === 'recording') recorder.stop()
  }

  async function startRecording() {
    if (loading || transcribing || recording || requestingMic) return
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('Voice input is not available in this browser. You can still type below.')
      return
    }
    recordingWanted.current = true
    discardRecording.current = false
    setRequestingMic(true)
    setError('')
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (!recordingWanted.current) {
        stream.getTracks().forEach(track => track.stop())
        return
      }
      const preferredType = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',
      ].find(type => MediaRecorder.isTypeSupported(type)) ?? ''
      const recorder = new MediaRecorder(stream, preferredType ? { mimeType: preferredType } : undefined)
      recorderRef.current = recorder
      audioChunks.current = []
      recorder.ondataavailable = chunkEvent => {
        if (chunkEvent.data.size) audioChunks.current.push(chunkEvent.data)
      }
      recorder.onstop = async () => {
        window.clearInterval(recordingTimer.current)
        window.clearTimeout(recordingTimeout.current)
        setRecording(false)
        setRecordingSeconds(0)
        stream.getTracks().forEach(track => track.stop())
        if (discardRecording.current) return
        const blob = new Blob(audioChunks.current, { type: recorder.mimeType || 'audio/webm' })
        if (!blob.size) return
        setTranscribing(true)
        try {
          const response = await fetch('/api/transcribe', {
            method: 'POST',
            headers: { 'Content-Type': blob.type || 'audio/webm' },
            body: blob,
          })
          if (!response.ok) throw new Error('I could not hear that clearly.')
          const result: { text?: string } = await response.json()
          const transcript = result.text?.trim()
          if (!transcript) throw new Error('I could not hear any words. Try once more.')
          stopAudio()
          if (/\b(mama|mother|help.*find|seen her)\b/i.test(transcript) && onAskMama?.()) {
            onClose()
          } else {
            requestTurn(transcript, 'typed', undefined, playPigletSpeech(transcript))
          }
        } catch (voiceError) {
          setError(voiceError instanceof Error ? voiceError.message : 'Voice input paused unexpectedly.')
        } finally {
          setTranscribing(false)
          recorderRef.current = null
        }
      }
      recorder.onerror = () => {
        setError('Voice recording paused unexpectedly. Please try again.')
        stopRecording()
      }
      recorder.start(250)
      setRecording(true)
      setRecordingSeconds(0)
      const startedAt = Date.now()
      recordingTimer.current = window.setInterval(() => {
        setRecordingSeconds(Math.floor((Date.now() - startedAt) / 1000))
      }, 250)
      recordingTimeout.current = window.setTimeout(stopRecording, 30000)
    } catch {
      recordingWanted.current = false
      setError('Microphone access is needed for voice input. You can still type below.')
    } finally {
      setRequestingMic(false)
    }
  }

  function toggleRecording() {
    if (recording) stopRecording()
    else startRecording()
  }

  function choose(suggestion: SuggestedNPCReply) {
    if (suggestion.intent === 'goodbye') {
      stopAudio()
      onClose()
      return
    }
    if (suggestion.intent === 'ask_mama' && onAskMama) {
      stopAudio()
      const playerSpeech = playPigletSpeech(suggestion.text)
      playerSpeech.then(() => {
        if (onAskMama()) onClose()
        else requestTurn(suggestion.text, 'suggestion', suggestion.intent)
      })
      return
    }
    stopAudio()
    const playerSpeech = playPigletSpeech(suggestion.text)
    requestTurn(suggestion.text, 'suggestion', suggestion.intent, playerSpeech)
  }

  function submit(event: React.FormEvent) {
    event.preventDefault()
    const message = input.trim()
    if (!message || loading) return
    setInput('')
    if (/\b(mama|mother|help.*find|seen her)\b/i.test(message) && onAskMama?.()) {
      stopAudio()
      playPigletSpeech(message).finally(onClose)
      return
    }
    stopAudio()
    requestTurn(message, 'typed', undefined, playPigletSpeech(message))
  }

  function leave() {
    stopAudio()
    onClose()
  }

  const seenSuggestions = new Set<string>()
  const normalizedSuggestions = suggestions
    .map(suggestion => suggestion.intent === 'ask_mama'
      ? { ...suggestion, text: 'Have you seen my Mama?' }
      : suggestion)
    .filter(suggestion => {
      const key = `${suggestion.intent}:${suggestion.text}`
      if (seenSuggestions.has(key)) return false
      seenSuggestions.add(key)
      return true
    })
  const chatOptions = normalizedSuggestions.some(suggestion => suggestion.intent === 'goodbye')
    ? normalizedSuggestions
    : [...normalizedSuggestions, { text: 'Leave conversation', intent: 'goodbye' as const }]

  return (
    <div className="dialogue-overlay" style={styles.overlay} role="dialog" aria-label={`Talking to ${npc.name}`}>
      <div className={`dialogue-panel ${viewMode === 'compact' ? 'dialogue-panel-compact' : ''}`} style={{ ...styles.panel, ...(viewMode === 'compact' ? styles.panelCompact : {}) }}>
        <div className="dialogue-header" style={styles.header}>
          <div style={styles.identity}>
            <div style={styles.portrait} aria-hidden="true">{moodEmoji[mood]}</div>
            <div>
              <div style={styles.name}>{npc.name}</div>
              <div style={styles.personality}>{npc.personality} {npc.species}</div>
            </div>
          </div>
          <div className="dialogue-header-actions" style={styles.headerActions}>
            <button
              style={styles.viewBtn}
              onClick={() => setViewMode(mode => mode === 'glass' ? 'compact' : 'glass')}
              aria-label={viewMode === 'glass' ? 'Use compact dialogue view' : 'Use glass dialogue view'}
              title="Change dialogue panel size"
            >{viewMode === 'glass' ? '▱ Compact' : '◫ Glass'}</button>
            <button
              style={styles.iconBtn}
              onClick={() => audioUrl && playAudio(audioUrl).catch(() => {})}
              disabled={!audioUrl}
              aria-label="Replay NPC voice"
            >🔊</button>
            <button style={styles.leaveBtn} onClick={leave}>Esc · leave</button>
          </div>
        </div>

        <div className="dialogue-transcript" ref={transcriptRef} style={styles.transcript} aria-live="polite">
          {history.map((line, index) => (
            <div key={`${line.speaker}-${index}`} style={{
              ...styles.line,
              ...(line.speaker === 'Piglet' ? styles.playerLine : styles.npcLine),
            }}>
              <span style={styles.speaker}>{line.speaker}</span>
              <span>{line.text}</span>
            </div>
          ))}
          {loading && (
            <div style={{ ...styles.line, ...styles.npcLine }}>
              <span style={styles.thinkingDot}>●</span>
              <span>{npc.name} is thinking…</span>
            </div>
          )}
        </div>

        {error && <div style={styles.error}>{error}</div>}
        {(requestingMic || recording || transcribing) && (
          <div className="dialogue-voice-status" style={styles.voiceStatus} aria-live="polite">
            {requestingMic
              ? '🎙️ Opening the microphone…'
              : recording
                ? `🔴 Listening… ${recordingSeconds}s · tap the red button when done`
                : '✨ Turning your voice into words…'}
          </div>
        )}

        <div className="dialogue-suggestions" style={styles.suggestions}>
          {chatOptions.map((suggestion, index) => (
            <button
              key={`${suggestion.text}-${index}`}
              style={{
                ...styles.suggestionBtn,
                ...(suggestion.intent === 'ask_mama' ? styles.keySuggestionBtn : {}),
                ...(suggestion.intent === 'goodbye' ? styles.leaveSuggestionBtn : {}),
              }}
              onClick={() => choose(suggestion)}
              disabled={loading}
            >
              <span style={styles.choiceNumber}>{index + 1}.</span> {suggestion.text}
            </button>
          ))}
        </div>

        <form className="dialogue-input-row" style={styles.inputRow} onSubmit={submit}>
          <button
            className="dialogue-mic-button"
            style={{ ...styles.micBtn, ...(recording ? styles.micBtnRecording : {}) }}
            type="button"
            onClick={toggleRecording}
            disabled={loading || transcribing || requestingMic}
            aria-label={recording ? 'Stop recording' : 'Start voice input'}
            title={recording ? 'Tap to stop' : 'Tap to talk'}
          >{recording ? '●' : '🎙️'}</button>
          <input
            style={styles.input}
            value={input}
            onChange={event => setInput(event.target.value)}
            placeholder={`Say anything to ${npc.name}…`}
            maxLength={180}
            disabled={loading}
            aria-label={`Say something to ${npc.name}`}
          />
          <button style={styles.sendBtn} type="submit" disabled={loading || !input.trim()} aria-label="Send message">
            ➤
          </button>
        </form>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'absolute', inset: 0, zIndex: 22, display: 'flex', alignItems: 'flex-end',
    justifyContent: 'center', padding: '20px clamp(14px, 3vw, 30px) 22px', pointerEvents: 'none',
    background: 'linear-gradient(to top, rgba(35,24,18,0.16), transparent 48%)',
  },
  panel: {
    pointerEvents: 'auto', background: 'rgba(255,253,249,0.48)', borderRadius: 20,
    padding: '14px 18px 16px', maxWidth: 820, width: 'min(820px, 96vw)',
    boxShadow: '0 12px 40px rgba(32,20,12,0.34)', border: '2px solid rgba(240,208,192,0.9)',
    maxHeight: '56vh', display: 'flex', flexDirection: 'column', gap: 9,
    backdropFilter: 'blur(7px) saturate(1.08)',
  },
  panelCompact: { maxHeight: '42vh', padding: '10px 14px 12px', gap: 6, background: 'rgba(255,253,249,0.38)' },
  header: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 },
  identity: { display: 'flex', alignItems: 'center', gap: 11, minWidth: 0 },
  portrait: {
    display: 'flex', alignItems: 'center', justifyContent: 'center', width: 46, height: 46,
    flex: '0 0 46px', borderRadius: 99, background: '#fff0dd', fontSize: 24,
    animation: 'bounce 2.4s ease-in-out infinite',
  },
  name: { fontWeight: 950, color: '#513727', fontSize: 19 },
  personality: { color: '#9a7c6a', fontSize: 12, marginTop: 2, textTransform: 'capitalize' },
  headerActions: { display: 'flex', alignItems: 'center', gap: 8 },
  viewBtn: {
    border: '1px solid rgba(207,177,158,0.75)', borderRadius: 99, padding: '8px 10px',
    background: 'rgba(255,255,255,0.56)', color: '#745f52', cursor: 'pointer', fontSize: 11, fontWeight: 850,
  },
  iconBtn: {
    border: 0, borderRadius: 99, width: 38, height: 38, background: '#fff0e6', cursor: 'pointer', fontSize: 16,
  },
  leaveBtn: {
    border: 0, borderRadius: 99, padding: '10px 14px', background: '#f0ece7', color: '#745f52',
    fontSize: 12, fontWeight: 800, cursor: 'pointer', whiteSpace: 'nowrap',
  },
  transcript: {
    minHeight: 54, maxHeight: 125, overflowY: 'auto', display: 'flex', flexDirection: 'column',
    gap: 7, padding: '2px 3px', scrollBehavior: 'smooth',
  },
  line: { display: 'flex', flexDirection: 'column', gap: 2, padding: '10px 13px', lineHeight: 1.42, fontSize: 16 },
  npcLine: { alignSelf: 'flex-start', maxWidth: '88%', background: '#fff7ef', color: '#3f342c', borderRadius: '6px 16px 16px 16px' },
  playerLine: { alignSelf: 'flex-end', maxWidth: '82%', background: '#e07b54', color: 'white', borderRadius: '16px 6px 16px 16px' },
  speaker: { fontSize: 10, fontWeight: 900, textTransform: 'uppercase', letterSpacing: 0.7, opacity: 0.65 },
  thinkingDot: { color: '#e07b54', animation: 'bounce 0.8s ease-in-out infinite' },
  error: { color: '#b44d48', background: '#fff0ef', padding: '8px 10px', borderRadius: 10, fontSize: 13 },
  suggestions: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 },
  suggestionBtn: {
    border: '2px solid #efddd1', borderRadius: 12, background: 'white', color: '#5b4638',
    padding: '11px 12px', fontSize: 13, fontWeight: 750, cursor: 'pointer', textAlign: 'left', lineHeight: 1.25,
  },
  keySuggestionBtn: {
    background: '#fff2bd', borderColor: '#e6ad3c', color: '#68440d',
    boxShadow: '0 3px 10px rgba(196,132,25,0.18)', fontWeight: 900,
  },
  leaveSuggestionBtn: {
    background: '#f8e5e0', borderColor: '#d88b78', color: '#7f4438',
    boxShadow: 'none', fontWeight: 850,
  },
  choiceNumber: { color: '#d27754', fontWeight: 950, marginRight: 4 },
  inputRow: { display: 'flex', alignItems: 'center', gap: 8 },
  voiceStatus: {
    padding: '8px 11px', borderRadius: 11, background: 'rgba(255,240,201,0.92)',
    color: '#74500f', fontSize: 12, fontWeight: 850, textAlign: 'center',
  },
  micBtn: {
    border: 0, borderRadius: 99, width: 44, height: 44, flex: '0 0 44px',
    background: '#fff0d6', color: '#9a553a', fontSize: 17, cursor: 'pointer', touchAction: 'none',
  },
  micBtnRecording: {
    background: '#e4574e', color: 'white', boxShadow: '0 0 0 5px rgba(228,87,78,0.2)',
    animation: 'look-pulse 0.9s ease-in-out infinite',
  },
  input: {
    flex: 1, minWidth: 0, border: '2px solid #efddd1', borderRadius: 99, background: '#faf5ee',
    padding: '13px 17px', color: '#493b32', fontSize: 14, outline: 'none',
  },
  sendBtn: {
    border: 0, borderRadius: 99, width: 44, height: 44, flex: '0 0 44px', background: '#e07b54',
    color: 'white', fontSize: 18, fontWeight: 900, cursor: 'pointer',
  },
}
