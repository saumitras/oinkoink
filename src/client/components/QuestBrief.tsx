import { useEffect } from 'react'
import { speakText, stopAudio } from '../game/audio'
import type { AdventureQuest } from '../game/adventureQuests'

interface Props {
  quest: AdventureQuest
  onStart: () => void
  onLater: () => void
}

export function QuestBrief({ quest, onStart, onLater }: Props) {
  useEffect(() => {
    speakText(quest.request)
    return () => stopAudio()
  }, [quest.id, quest.request])

  return (
    <div className="quest-brief-overlay" style={styles.overlay} role="dialog" aria-modal="true" aria-labelledby="quest-title">
      <div className="quest-brief-card" style={styles.card}>
        <div style={styles.badge}>A FRIEND NEEDS HELP</div>
        <div style={styles.icon}>🔎</div>
        <h2 id="quest-title" style={styles.title}>{quest.title}</h2>
        <p style={styles.request}>{quest.request}</p>
        <div style={styles.prompt}><span aria-hidden="true">✨</span> {quest.searchPrompt}</div>
        <div style={styles.actions}>
          <button style={styles.later} onClick={onLater}>Maybe later</button>
          <button style={styles.start} onClick={onStart}>Start searching!</button>
        </div>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'absolute', inset: 0, zIndex: 31, display: 'flex', alignItems: 'center', justifyContent: 'center',
    padding: 16, background: 'rgba(35,24,18,0.52)', backdropFilter: 'blur(5px)',
  },
  card: {
    width: 'min(480px, 94vw)', maxHeight: '90dvh', overflowY: 'auto', padding: '28px clamp(20px, 5vw, 34px)',
    borderRadius: 25, background: 'rgba(255,253,247,0.97)', color: '#503729', textAlign: 'center',
    border: '3px solid rgba(255,255,255,0.86)', boxShadow: '0 18px 60px rgba(0,0,0,0.36)',
  },
  badge: { color: '#c57943', fontSize: 11, fontWeight: 950, letterSpacing: 1.5 },
  icon: { fontSize: 48, margin: '8px 0 2px' },
  title: { color: '#d96f49', fontSize: 27, lineHeight: 1.15, marginBottom: 12 },
  request: { fontSize: 16, lineHeight: 1.55, marginBottom: 15 },
  prompt: {
    padding: 13, borderRadius: 15, background: '#fff0c9', color: '#67430d',
    fontSize: 14, lineHeight: 1.4, fontWeight: 850, textAlign: 'left',
  },
  actions: { display: 'flex', justifyContent: 'center', gap: 9, marginTop: 18, flexWrap: 'wrap' },
  later: {
    minHeight: 46, padding: '11px 16px', border: 0, borderRadius: 13,
    background: '#eee7e1', color: '#725d50', fontWeight: 800, cursor: 'pointer',
  },
  start: {
    minHeight: 46, padding: '11px 20px', border: 0, borderRadius: 13,
    background: '#df7851', color: 'white', fontWeight: 900, cursor: 'pointer',
    boxShadow: '0 5px 15px rgba(180,82,44,0.25)',
  },
}
