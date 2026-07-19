import { useCallback, useEffect, useRef, useState } from 'react'
import type { Game } from '@shared/schema'
import { useGameStore } from '../game/store'
import {
  initEngine, destroyEngine, loadStreetScene, loadRoomScene,
  setRoomQuestObjects, showRoomQuestCompletion,
} from '../game/engine'
import { HintTracker } from './HintTracker'
import { DialogueBubble } from './DialogueBubble'
import { LocationPicker } from './LocationPicker'
import { ReunionScene } from './ReunionScene'
import { IntroOverlay } from './IntroOverlay'
import { QuestBrief } from './QuestBrief'
import {
  curatedAdventure,
  isCuratedAdventure,
  questForNpc,
  questForRoom,
  type AdventureQuest,
} from '../game/adventureQuests'
import {
  getBackgroundMusicLevel,
  isBackgroundMusicMuted,
  isMuted,
  playAudio,
  playChime,
  setBackgroundMusicLevel,
  setBackgroundMusicMuted,
  setMuted,
  speakText,
  startBackgroundMusic,
  stopAudio,
  stopBackgroundMusic,
} from '../game/audio'

interface Props {
  game: Game
  microQuestsEnabled: boolean
  onNewAdventure: () => void
}

export function GameCanvas({ game, microQuestsEnabled, onNewAdventure }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const store = useGameStore()
  const [dialogue, setDialogue] = useState<{ npcId: string; sessionId: string } | null>(null)
  const conversationSessions = useRef<Record<string, string>>({})
  const pendingPickerAfterDialogue = useRef(false)
  const pickerTimer = useRef<number>(0)
  const [toast, setToast] = useState('')
  const toastTimer = useRef<number>(0)
  const toastVersion = useRef(0)
  const [showIntro, setShowIntro] = useState(true)
  const [muted, setMutedState] = useState(isMuted())
  const [musicMuted, setMusicMutedState] = useState(isBackgroundMusicMuted())
  const [musicLevel, setMusicLevelState] = useState(Math.round(getBackgroundMusicLevel() * 100))
  const [showAudioPanel, setShowAudioPanel] = useState(false)
  const [questProgress, setQuestProgress] = useState<Record<string, 'searching' | 'completed'>>({})
  const [questBrief, setQuestBrief] = useState<AdventureQuest | null>(null)
  const [questMistakes, setQuestMistakes] = useState<Record<string, number>>({})
  const loadedStreetUrl = useRef(game.assets.streetUrl)
  const isTouch = useRef(
    typeof window !== 'undefined' && (
      window.matchMedia('(pointer: coarse)').matches
      || navigator.maxTouchPoints > 0
      || window.innerWidth <= 700
    )
  ).current

  function showToast(msg: string, ms = 2600) {
    const version = ++toastVersion.current
    setToast(msg)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => {
      if (version === toastVersion.current) setToast('')
    }, ms)
    return version
  }

  function hideToast(version: number) {
    if (version !== toastVersion.current) return
    window.clearTimeout(toastTimer.current)
    setToast('')
  }

  // Init engine once
  useEffect(() => {
    if (!containerRef.current) return
    let cancelled = false
    initEngine(containerRef.current).then(() => {
      if (cancelled) return
      store.setGame(game)
      loadStreetScene(useGameStore.getState().game ?? game)
    }).catch(console.error)
    return () => {
      cancelled = true
      destroyEngine()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    startBackgroundMusic('/theme3.mp3').catch(console.error)
    return () => {
      window.clearTimeout(pickerTimer.current)
      stopBackgroundMusic()
    }
  }, [])

  // Poll for background-completed assets (rooms, TTS)
  useEffect(() => {
    const interval = setInterval(async () => {
      const res = await fetch(`/api/game/${game.id}`)
      const updated: Game = await res.json()
      useGameStore.getState().updateGame(updated)
      const allDone = Object.values(updated.stages).every(s => s === 'done' || s === 'failed')
      if (allDone) clearInterval(interval)
    }, 4000)
    return () => clearInterval(interval)
  }, [game.id])

  // A small deterministic story director: if a search stalls, Piglet gently
  // restates the visual goal without spending another model call.
  useEffect(() => {
    if (!microQuestsEnabled) return
    if (!store.screen.startsWith('room_')) return
    const activeRoomId = store.screen.slice(5)
    const current = useGameStore.getState().game ?? game
    const quest = questForRoom(current, activeRoomId)
    if (!quest || questProgress[quest.npcId] !== 'searching') return
    const timer = window.setTimeout(() => {
      if (useGameStore.getState().screen !== `room_${activeRoomId}`) return
      const reminder = `Piglet wonders: ${quest.searchPrompt}`
      showToast(`💭 ${reminder}`, 7000)
      speakText(reminder)
    }, 11000)
    return () => window.clearTimeout(timer)
  }, [store.screen, questProgress, game, microQuestsEnabled]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleInteract = useCallback(() => {
    const s = useGameStore.getState()
    const currentGame = s.game ?? game
    const nearby = s.nearby
    if (!nearby || dialogue || s.showPicker || s.showReunion) return

    if (nearby.kind === 'quest') {
      const activeRoomId = s.screen.startsWith('room_') ? s.screen.slice(5) : ''
      const quest = questForRoom(currentGame, activeRoomId)
      const object = quest?.objects.find(candidate => candidate.id === nearby.objectId)
      if (!quest || !object || questProgress[quest.npcId] !== 'searching') return
      stopAudio()
      if (object.correct) {
        setQuestProgress(progress => ({ ...progress, [quest.npcId]: 'completed' }))
        showRoomQuestCompletion(object)
        playChime()
        showToast(`🌟 ${quest.success}`, 9000)
        speakText(quest.success)
      } else {
        const mistakes = (questMistakes[quest.npcId] ?? 0) + 1
        setQuestMistakes(current => ({ ...current, [quest.npcId]: mistakes }))
        const correctObject = quest.objects.find(candidate => candidate.correct)!
        const strongerHint = mistakes >= 2
          ? `${object.response} The right object is glowing near the ${correctObject.x < 512 ? 'left' : 'right'} side of the room.`
          : object.response
        showToast(`🤔 ${strongerHint}`, 7000)
        speakText(strongerHint)
      }
      return
    }

    function openNpcDialogue(npcId: string) {
      const npc = currentGame.bible?.npcs.find(n => n.id === npcId)
      if (!npc || !currentGame.bible) return
      const sessionId = conversationSessions.current[npc.id]
        ?? (conversationSessions.current[npc.id] = crypto.randomUUID())
      setDialogue({ npcId: npc.id, sessionId })
    }

    if (nearby.kind === 'door') {
      const building = currentGame.bible?.buildings.find(b => b.id === nearby.buildingId)
      if (!building || !currentGame.bible) return

      // The endgame: Mama's door, after the mystery is solved
      if (nearby.isMama && s.solved) {
        playChime()
        s.setShowReunion(true)
        return
      }

      if (building.isEnterable) {
        const room = currentGame.assets.rooms[building.id]
        if (!room?.imageUrl || !room.annotation) {
          // A delayed/failed generated room must never block a required clue.
          // Let its neighbor step outside and deliver the same dialogue.
          if (building.npcId) {
            openNpcDialogue(building.npcId)
            return
          }
          showToast('🎨 Still painting inside! Try again in a moment…')
          return
        }
        s.setScreen(`room_${building.id}`)
        loadRoomScene(currentGame, building.id).then(() => {
          const quest = microQuestsEnabled ? questForRoom(currentGame, building.id) : undefined
          if (quest && questProgress[quest.npcId] === 'searching') {
            setRoomQuestObjects(quest.objects)
          } else if (quest && questProgress[quest.npcId] === 'completed') {
            showRoomQuestCompletion(quest.objects.find(object => object.correct))
          } else {
            setRoomQuestObjects(null)
          }
        })
      } else {
        const description = building.exteriorDescription
          || `${building.name} is part of this curious little world.`
        const lookResult = `${building.name}. ${description} Mama is not here.`
        const toastId = showToast(`👀 ${building.name}: ${description} Mama is not here.`, 20000)
        const lookAudio = currentGame.assets.audio[`building_${building.id}.look`]
        const narration = lookAudio
          ? playAudio(lookAudio).catch(() => speakText(lookResult))
          : speakText(lookResult)
        narration.finally(() => hideToast(toastId))
      }
      return
    }

    if (nearby.kind === 'npc') {
      openNpcDialogue(nearby.npcId)
      return
    }

    if (nearby.kind === 'exit') {
      returnToStreet()
    }
  }, [dialogue, game, questProgress, questMistakes, microQuestsEnabled]) // eslint-disable-line react-hooks/exhaustive-deps

  // Keyboard: E/Space/Enter to interact, Escape to leave room
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const s = useGameStore.getState()
      if (e.key === 'Escape' && dialogue) return // Conversation panel owns Escape
      if (e.key === 'Escape' && s.screen !== 'street') {
        returnToStreet()
      }
      if (e.key === 'e' || e.key === 'E' || e.key === ' ' || e.key === 'Enter') {
        if (dialogue) return // DialogueBubble handles its own advance clicks
        e.preventDefault()
        handleInteract()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [handleInteract, dialogue])

  function showFinalQuestionAfterClues() {
    const s = useGameStore.getState()
    const currentGame = s.game ?? game
    const requiredHints = currentGame.bible?.hints.length ?? 0
    if (!requiredHints || s.collectedHintIds.length < requiredHints || s.solved || s.showReunion) return

    pendingPickerAfterDialogue.current = false
    window.clearTimeout(pickerTimer.current)
    const narratorUrl = currentGame.assets.audio['narrator.allHints']
    if (narratorUrl) playAudio(narratorUrl).catch(() => {})
    pickerTimer.current = window.setTimeout(() => {
      const latest = useGameStore.getState()
      if (!latest.solved && !latest.showReunion) latest.setShowPicker(true)
    }, 1600)
  }

  function onDialogueClose() {
    setDialogue(null)
    if (pendingPickerAfterDialogue.current) showFinalQuestionAfterClues()
  }

  function onConversationClue(hintId: string) {
    const s = useGameStore.getState()
    const currentGame = s.game ?? game
    if (!currentGame.bible || s.collectedHintIds.includes(hintId)) return
    const newCount = s.collectedHintIds.length + 1
    s.collectHint(hintId)
    playChime()
    if (newCount >= currentGame.bible.hints.length) {
      pendingPickerAfterDialogue.current = true
    }
  }

  function returnToStreet() {
    const s = useGameStore.getState()
    const currentGame = s.game ?? game
    const requiredHints = currentGame.bible?.hints.length ?? 0
    const shouldShowFinalQuestion = !s.solved
      && requiredHints > 0
      && s.collectedHintIds.length >= requiredHints
    stopAudio()
    setDialogue(null)
    setQuestBrief(null)
    setRoomQuestObjects(null)
    s.setScreen('street')
    loadStreetScene(currentGame)
    if (shouldShowFinalQuestion) showFinalQuestionAfterClues()
  }

  function onSolved() {
    const s = useGameStore.getState()
    s.setShowPicker(false)
    s.setSolved(true)
    playChime()
    stopAudio()
    setDialogue(null)
    s.setScreen('street')
    loadStreetScene(s.game ?? game)
    showToast('💛 Correct! Follow the glowing MAMA marker!', 5200)
  }

  const currentGame = store.game ?? game

  // Dev-time hub regeneration keeps the same game alive. Reload the Pixi
  // scene when its cache-busted street URL changes instead of requiring the
  // player to abandon the adventure.
  useEffect(() => {
    const nextUrl = currentGame.assets.streetUrl
    if (!nextUrl || nextUrl === loadedStreetUrl.current || store.screen !== 'street') return
    loadedStreetUrl.current = nextUrl
    loadStreetScene(currentGame)
  }, [currentGame, store.screen])

  const allHintsCollected = currentGame.bible
    ? store.collectedHintIds.length >= currentGame.bible.hints.length
    : false
  const roomId = store.screen.startsWith('room_') ? store.screen.slice(5) : null
  const ambientUrl = roomId
    ? currentGame.assets.rooms[roomId]?.imageUrl
    : currentGame.assets.streetUrl
  const activeNpc = dialogue
    ? currentGame.bible?.npcs.find(npc => npc.id === dialogue.npcId)
    : undefined
  const activeHint = dialogue
    ? currentGame.bible?.hints.find(hint => hint.npcId === dialogue.npcId)
    : undefined

  function toggleGameSound() {
    const next = !muted
    setMuted(next)
    setMutedState(next)
  }

  function toggleBackgroundMusic() {
    const next = !musicMuted
    setBackgroundMusicMuted(next)
    setMusicMutedState(next)
  }

  function changeMusicLevel(event: React.FormEvent<HTMLInputElement>) {
    const next = Number(event.currentTarget.value)
    setMusicLevelState(next)
    setBackgroundMusicLevel(next / 100)
  }

  function goHome() {
    stopAudio()
    onNewAdventure()
  }

  const isLookAction = store.nearby?.kind === 'door' && !store.nearby.enterable
  const curatedWorld = isCuratedAdventure(currentGame)
  const adventureTheme = curatedAdventure(currentGame)

  function beginQuest(quest: AdventureQuest) {
    setQuestBrief(null)
    setQuestProgress(progress => ({ ...progress, [quest.npcId]: 'searching' }))
    setRoomQuestObjects(quest.objects)
    showToast(`🔎 ${quest.searchPrompt}`, 7000)
    speakText(quest.searchPrompt)
  }

  function interceptMamaQuestion(npcId: string, hintId: string): boolean {
    if (!microQuestsEnabled) return false
    if (store.collectedHintIds.includes(hintId)) return false
    const quest = questForNpc(currentGame, npcId)
    if (!quest || questProgress[npcId] === 'completed') return false
    setQuestBrief(quest)
    return true
  }

  return (
    <div className={`game-shell${isTouch ? ' touch-mode' : ''}`} style={styles.wrapper}>
      {ambientUrl && <img src={ambientUrl} alt="" aria-hidden="true" style={styles.ambientBg} />}
      <div ref={containerRef} style={styles.canvas} />
      {adventureTheme && !showIntro && <WorldEffects theme={adventureTheme} />}

      <div className="game-top-controls" style={styles.topControls}>
        <button
          style={styles.iconBtn}
          onClick={goHome}
          aria-label="Return to the adventure library"
          title="Home"
        >
          <span aria-hidden="true">🏠</span>
        </button>
        <button
          style={{ ...styles.iconBtn, ...(showAudioPanel ? styles.iconBtnActive : {}) }}
          onClick={() => setShowAudioPanel(show => !show)}
          aria-label="Open audio controls"
          aria-expanded={showAudioPanel}
          title="Audio controls"
        >
          <SoundIcon muted={muted && musicMuted} />
        </button>
      </div>

      {showAudioPanel && (
        <div className="game-audio-panel" style={styles.audioPanel} role="dialog" aria-label="Audio controls">
          <div style={styles.audioPanelHeader}>
            <span>Audio</span>
            <button
              style={styles.audioCloseBtn}
              onClick={() => setShowAudioPanel(false)}
              aria-label="Close audio controls"
            >×</button>
          </div>

          <button style={styles.audioToggleRow} onClick={toggleGameSound} aria-pressed={!muted}>
            <span style={styles.audioRowLabel}>
              <SoundIcon muted={muted} />
              <span style={styles.audioRowText}><strong>Game sound</strong><small>Voices &amp; effects</small></span>
            </span>
            <span style={{ ...styles.togglePill, ...(!muted ? styles.togglePillOn : {}) }}>
              {!muted ? 'On' : 'Muted'}
            </span>
          </button>

          <button style={styles.audioToggleRow} onClick={toggleBackgroundMusic} aria-pressed={!musicMuted}>
            <span style={styles.audioRowLabel}>
              <span style={styles.musicNote} aria-hidden="true">♪</span>
              <span style={styles.audioRowText}><strong>Background music</strong><small>Adventure theme</small></span>
            </span>
            <span style={{ ...styles.togglePill, ...(!musicMuted ? styles.togglePillOn : {}) }}>
              {!musicMuted ? 'On' : 'Muted'}
            </span>
          </button>

          <label style={{ ...styles.volumeControl, ...(musicMuted ? styles.volumeControlDisabled : {}) }}>
            <span style={styles.volumeLabel}>
              <span>Music level</span><output>{musicLevel}%</output>
            </span>
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              value={musicLevel}
              onInput={changeMusicLevel}
              disabled={musicMuted}
              aria-label="Background music volume"
              style={styles.volumeSlider}
            />
          </label>
        </div>
      )}

      {store.screen !== 'street' && !showIntro && !store.showPicker && !store.showReunion && (
        <button
          className="game-exit-button"
          style={{ ...styles.exitBtn, top: showAudioPanel ? 286 : 68 }}
          onClick={returnToStreet}
        >← Leave house</button>
      )}

      {!showIntro && !store.showPicker && (
        <HintTracker game={currentGame} collectedHintIds={store.collectedHintIds} />
      )}

      {/* Persistent controls legend */}
      {!showIntro && !store.showPicker && !store.showReunion && (
        <div className="game-controls-legend" style={{
          ...styles.controlsLegend,
          ...(isTouch ? styles.controlsLegendTouch : {}),
          ...(isTouch && showAudioPanel ? { top: 334 } : {}),
        }} aria-label="Game controls">
          <div style={styles.controlsTitle}>CONTROLS</div>
          {isTouch ? (
            <>
              <div style={styles.controlRow}><span style={styles.controlKey}>Tap ground</span><span>Move</span></div>
              <div style={styles.controlRow}><span style={styles.controlKey}>Tap</span><span>Look · Go Inside · Talk</span></div>
            </>
          ) : (
            <>
              <div style={styles.controlRow}><span style={styles.controlKey}>WASD / Arrows</span><span>Move</span></div>
              <div style={styles.controlRow}><span style={styles.controlKey}>E / Space</span><span>Look · Go Inside · Talk</span></div>
              <div style={styles.controlRow}><span style={styles.controlKey}>Esc</span><span>Leave</span></div>
            </>
          )}
        </div>
      )}

      {/* Contextual action button — the single interact affordance */}
      {store.nearby && !dialogue && !store.showPicker && !store.showReunion && !showIntro && (
        <button className="game-action-button" style={{ ...styles.actionBtn, ...(isLookAction ? styles.lookActionBtn : {}) }} onClick={handleInteract}>
          {store.nearby.label}
        </button>
      )}

      {toast && <div className="game-toast" style={styles.toast}>{toast}</div>}

      {store.solved && !store.showReunion && !store.showPicker && (
        <div className="game-mama-mission" style={styles.mamaMission}>💛 Follow the glowing MAMA marker and choose Find Mama!</div>
      )}

      {dialogue && activeNpc && activeHint && (
        <DialogueBubble
          gameId={currentGame.id}
          npc={activeNpc}
          sessionId={dialogue.sessionId}
          preloadedOpener={currentGame.assets.npcOpeners?.[activeNpc.id]}
          hintAlreadyCollected={store.collectedHintIds.includes(activeHint.id)}
          onClueGranted={onConversationClue}
          onClose={onDialogueClose}
          onAskMama={() => interceptMamaQuestion(activeNpc.id, activeHint.id)}
          generatedPigletVoice={curatedWorld}
        />
      )}

      {questBrief && (
        <QuestBrief
          quest={questBrief}
          onStart={() => beginQuest(questBrief)}
          onLater={() => setQuestBrief(null)}
        />
      )}

      {store.showPicker && (
        <LocationPicker
          game={currentGame}
          collectedHintIds={store.collectedHintIds}
          onSolved={onSolved}
        />
      )}

      {store.showReunion && (
        <ReunionScene
          game={currentGame}
          onNewAdventure={onNewAdventure}
          accomplishments={Object.entries(questProgress)
            .filter(([, status]) => status === 'completed')
            .map(([npcId]) => questForNpc(currentGame, npcId)?.title)
            .filter((title): title is string => Boolean(title))}
        />
      )}

      {showIntro && <IntroOverlay game={currentGame} microQuestsEnabled={microQuestsEnabled} onBegin={() => {
        setShowIntro(false)
        if (isTouch) showToast('👆 Tap anywhere to walk. Tap the action button when it appears!', 7200)
      }} />}

      {/* Re-open picker if dismissed */}
      {allHintsCollected && !store.solved && !store.showPicker && !store.showReunion && !dialogue && (
        <button className="game-picker-button" style={styles.pickerBtn} onClick={() => store.setShowPicker(true)}>
          🔍 Where is Mama?
        </button>
      )}
    </div>
  )
}

function WorldEffects({ theme }: { theme: 'pumpkin' | 'moon' | 'cloud' }) {
  return (
    <div className={`world-effects world-effects-${theme}`} aria-hidden="true">
      {Array.from({ length: 14 }, (_, index) => (
        <span className={theme === 'pumpkin'
          ? (index % 3 === 0 ? 'world-leaf' : 'world-speck')
          : (index % 3 === 0 ? 'world-star' : 'world-orb')} key={index} style={{
          left: `${(index * 29) % 96}%`,
          animationDelay: `${-index * 0.63}s`,
          animationDuration: `${6 + (index % 5)}s`,
        }} />
      ))}
    </div>
  )
}

function SoundIcon({ muted }: { muted: boolean }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      <path d="M11 5 6.5 8.5H3.8v7h2.7L11 19V5Z" />
      {muted ? (
        <>
          <path d="m16 9 5 5" />
          <path d="m21 9-5 5" />
        </>
      ) : (
        <>
          <path d="M15 9.5a4 4 0 0 1 0 5" />
          <path d="M18 6.5a8 8 0 0 1 0 11" />
        </>
      )}
    </svg>
  )
}

const styles: Record<string, React.CSSProperties> = {
  wrapper: { position: 'relative', width: '100vw', height: '100dvh', minHeight: '-webkit-fill-available', overflow: 'hidden', background: '#2b2117', touchAction: 'none' },
  ambientBg: {
    position: 'absolute', inset: -24, width: 'calc(100% + 48px)', height: 'calc(100% + 48px)',
    objectFit: 'cover', filter: 'blur(22px) saturate(0.8) brightness(0.48)', opacity: 0.9,
  },
  canvas: { position: 'relative', zIndex: 1, width: '100%', height: '100%', display: 'block', objectFit: 'contain' },
  exitBtn: {
    position: 'absolute', zIndex: 24, top: 68, left: 16,
    background: 'rgba(255,255,255,0.85)', border: 'none', borderRadius: 12,
    padding: '8px 16px', fontSize: 14, fontWeight: 700, cursor: 'pointer', color: '#555',
  },
  topControls: {
    position: 'absolute', zIndex: 60, top: 16, left: 16, display: 'flex', gap: 8,
  },
  iconBtn: {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 42, height: 42,
    padding: 0, background: 'rgba(255,255,255,0.88)', color: '#5b3a1e',
    border: '2px solid rgba(255,255,255,0.72)', borderRadius: 12, fontSize: 18,
    cursor: 'pointer', backdropFilter: 'blur(8px)', boxShadow: '0 3px 14px rgba(0,0,0,0.2)',
  },
  iconBtnActive: { background: '#fff7ed', borderColor: '#e8a46f', color: '#a85431' },
  audioPanel: {
    position: 'absolute', zIndex: 59, top: 68, left: 16, width: 280, maxWidth: 'calc(100vw - 32px)',
    display: 'grid', gap: 9, padding: 14, borderRadius: 18,
    background: 'rgba(255,253,249,0.94)', color: '#513727',
    border: '2px solid rgba(255,255,255,0.82)', boxShadow: '0 12px 36px rgba(22,14,10,0.3)',
    backdropFilter: 'blur(14px) saturate(1.12)',
  },
  audioPanelHeader: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '0 2px 2px', fontSize: 14, fontWeight: 950, letterSpacing: 0.3,
  },
  audioCloseBtn: {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 28, height: 28,
    padding: 0, border: 0, borderRadius: 9, background: 'rgba(107,76,58,0.08)',
    color: '#705445', fontSize: 20, lineHeight: 1, cursor: 'pointer',
  },
  audioToggleRow: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10,
    width: '100%', padding: '10px 11px', border: '1px solid rgba(215,190,173,0.72)',
    borderRadius: 13, background: 'rgba(255,255,255,0.68)', color: '#513727',
    cursor: 'pointer', textAlign: 'left',
  },
  audioRowLabel: { display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 },
  audioRowText: { display: 'grid', gap: 2, fontSize: 12, lineHeight: 1.15 },
  musicNote: {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 22,
    color: '#a85431', fontSize: 24, fontWeight: 800,
  },
  togglePill: {
    minWidth: 52, padding: '5px 8px', borderRadius: 99, background: '#eadfd8',
    color: '#80695d', fontSize: 10, fontWeight: 900, textAlign: 'center',
  },
  togglePillOn: { background: '#dcefe4', color: '#34704c' },
  volumeControl: {
    display: 'grid', gap: 8, padding: '8px 11px 5px', color: '#62483a',
    fontSize: 12, fontWeight: 850,
  },
  volumeControlDisabled: { opacity: 0.48 },
  volumeLabel: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  volumeSlider: { width: '100%', accentColor: '#d96f49', cursor: 'pointer' },
  controlsLegend: {
    position: 'absolute', zIndex: 12, bottom: 18, left: 18, width: 246,
    display: 'grid', gap: 7, padding: '12px 14px', borderRadius: 15,
    background: 'rgba(35,25,17,0.56)', color: 'white', border: '2px solid rgba(255,255,255,0.62)',
    boxShadow: '0 5px 20px rgba(0,0,0,0.32)', backdropFilter: 'blur(8px)',
  },
  controlsLegendTouch: { top: 116, bottom: 'auto', width: 218 },
  controlsTitle: { fontSize: 10, fontWeight: 950, letterSpacing: 1.4, color: '#ffd66b' },
  controlRow: { display: 'grid', gridTemplateColumns: 'auto 1fr', gap: 9, alignItems: 'center', fontSize: 11, lineHeight: 1.2 },
  controlKey: {
    display: 'inline-flex', justifyContent: 'center', minWidth: 68, padding: '4px 7px',
    borderRadius: 7, background: 'white', color: '#382618', fontWeight: 900, boxShadow: '0 2px 0 #bda995',
  },
  actionBtn: {
    position: 'absolute', zIndex: 14, bottom: 26, right: 26,
    background: '#ffb35c', color: '#5b3a1e', border: '3px solid #fff',
    borderRadius: 999, padding: '16px 26px', fontSize: 18, fontWeight: 800,
    cursor: 'pointer', boxShadow: '0 6px 20px rgba(0,0,0,0.3)',
    animation: 'pop 0.18s ease',
  },
  lookActionBtn: {
    background: '#ffe34f', color: '#2d1d00', border: '4px solid white',
    padding: '17px 28px', fontSize: 20, fontWeight: 950,
    boxShadow: '0 0 0 5px rgba(45,29,0,0.75), 0 0 34px 13px rgba(255,227,79,0.82), 0 8px 24px rgba(0,0,0,0.42)',
    animation: 'look-pulse 1.05s ease-in-out infinite',
  },
  toast: {
    position: 'absolute', zIndex: 18, bottom: 96, left: '50%', transform: 'translateX(-50%)',
    background: 'rgba(255,255,255,0.95)', color: '#5b3a1e', padding: '12px 22px',
    borderRadius: 18, fontSize: 16, fontWeight: 700, maxWidth: '80%',
    boxShadow: '0 4px 16px rgba(0,0,0,0.25)', pointerEvents: 'none', textAlign: 'center',
  },
  mamaMission: {
    position: 'absolute', zIndex: 28, top: 18, left: '50%', transform: 'translateX(-50%)',
    padding: '11px 18px', borderRadius: 99, background: 'rgba(255,244,177,0.94)',
    border: '3px solid #f2b92f', color: '#614109', fontSize: 14, fontWeight: 950,
    boxShadow: '0 6px 22px rgba(96,62,0,0.3)', whiteSpace: 'nowrap',
  },
  pickerBtn: {
    position: 'absolute', bottom: 24, left: '50%', transform: 'translateX(-50%)',
    background: '#e07b54', color: 'white', border: 'none', borderRadius: 16,
    padding: '14px 28px', fontSize: 16, fontWeight: 700, cursor: 'pointer',
    boxShadow: '0 4px 16px rgba(0,0,0,0.2)',
  },
}
