import { useEffect, useRef } from 'react'
import type { Game } from '@shared/schema'
import { playAudio, stopAudio } from '../game/audio'

interface Props {
  game: Game
  microQuestsEnabled: boolean
  onBegin: () => void
}

export function IntroOverlay({ game, microQuestsEnabled, onBegin }: Props) {
  const playedIntroUrl = useRef<string | null>(null)
  const introUrl = game.assets.audio['narrator.intro']

  useEffect(() => {
    if (!introUrl || playedIntroUrl.current === introUrl) return
    playedIntroUrl.current = introUrl
    playAudio(introUrl).catch(() => {})
  }, [introUrl])

  function begin() {
    stopAudio()
    onBegin()
  }

  return (
    <div className="intro-overlay" style={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="adventure-title">
      <div className="intro-card" style={styles.card}>
        <div style={styles.eyebrow}>A NEW ADVENTURE</div>
        <h1 id="adventure-title" style={styles.title}>{game.bible?.title ?? 'Find Mama Pig!'}</h1>
        <div style={{ ...styles.modeBadge, ...(microQuestsEnabled ? styles.modeBadgeQuests : {}) }}>
          {microQuestsEnabled ? '✨ Helper quests on' : '💬 Story mode · direct clues'}
        </div>
        <p style={styles.story}>{game.bible?.narratorIntro}</p>
        <div style={styles.mission}>
          <div><span style={styles.step}>1</span> Visit the three marked homes</div>
          <div><span style={styles.step}>2</span> {microQuestsEnabled ? 'Help each neighbor, then hear their clue' : "Ask each neighbor if they've seen Mama"}</div>
          <div><span style={styles.step}>3</span> Work out where Mama went</div>
        </div>
        <button style={styles.button} onClick={begin}>🐷 Let's find Mama!</button>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'absolute', inset: 0, zIndex: 30,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 20, background: 'rgba(43,33,23,0.64)', backdropFilter: 'blur(5px)',
  },
  card: {
    width: 'min(540px, 94vw)', maxHeight: '92vh', overflowY: 'auto',
    padding: 'clamp(24px, 6vw, 42px)', borderRadius: 28, textAlign: 'center',
    background: 'rgba(255,253,247,0.97)', border: '3px solid rgba(255,255,255,0.8)',
    boxShadow: '0 20px 70px rgba(0,0,0,0.35)', color: '#5b3a1e',
  },
  eyebrow: { fontSize: 12, letterSpacing: 2, fontWeight: 900, color: '#d9875c', marginBottom: 10 },
  title: { fontSize: 'clamp(25px, 7vw, 36px)', lineHeight: 1.12, color: '#d96f49', margin: '0 0 16px' },
  modeBadge: {
    display: 'inline-flex', padding: '6px 11px', margin: '0 auto 14px', borderRadius: 999,
    background: '#eee8e3', color: '#725f55', fontSize: 11, fontWeight: 900,
  },
  modeBadgeQuests: { background: '#fff0c9', color: '#9a6418' },
  story: { fontSize: 'clamp(16px, 4vw, 19px)', lineHeight: 1.55, margin: '0 auto 22px', maxWidth: 450 },
  mission: {
    display: 'grid', gap: 10, textAlign: 'left', margin: '0 auto 24px', maxWidth: 390,
    padding: 16, borderRadius: 18, background: '#fff1dc', fontSize: 15, fontWeight: 700,
  },
  step: {
    display: 'inline-flex', width: 26, height: 26, alignItems: 'center', justifyContent: 'center',
    marginRight: 9, borderRadius: 99, background: '#ffb35c', color: '#5b3a1e', fontWeight: 900,
  },
  button: {
    border: 0, borderRadius: 16, padding: '15px 28px', background: '#df7851', color: 'white',
    fontSize: 18, fontWeight: 900, cursor: 'pointer', boxShadow: '0 6px 18px rgba(180,82,44,0.28)',
  },
}
