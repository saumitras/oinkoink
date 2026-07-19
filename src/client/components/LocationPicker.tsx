import { useState } from 'react'
import type { Game } from '@shared/schema'
import { HintTracker } from './HintTracker'

interface Props {
  game: Game
  collectedHintIds: string[]
  onSolved: () => void
}

export function LocationPicker({ game, collectedHintIds, onSolved }: Props) {
  const [nudge, setNudge] = useState('')
  const [selected, setSelected] = useState<string | null>(null)

  if (!game.bible) return null

  async function pick(locationId: string) {
    setSelected(locationId)
    setNudge('')
    const res = await fetch(`/api/game/${game.id}/solve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ locationId }),
    })
    const data = await res.json()
    if (data.correct) {
      onSolved()
    } else {
      setNudge(data.nudge ?? 'Hmm, think about all three hints!')
      setSelected(null)
    }
  }

  return (
    <div className="location-picker-overlay" style={styles.overlay}>
      <div className="location-picker-card" style={styles.card}>
        <h2 style={styles.title}>🔍 Where is Mama?</h2>
        <p style={styles.subtitle}>Review the clues, then choose the only place left.</p>
        <HintTracker
          game={game}
          collectedHintIds={collectedHintIds}
          embedded
          forceExpanded
        />
        <div className="location-picker-grid" style={styles.grid}>
          {game.bible.candidateLocations.map(loc => (
            (() => {
              const point = game.annotation?.doors.find(door => door.buildingId === loc.id)
              return (
                <button
                  key={loc.id}
                  style={{ ...styles.locBtn, ...(selected === loc.id ? styles.selected : {}) }}
                  onClick={() => pick(loc.id)}
                >
                  {game.assets.streetUrl && point && (
                    <span style={{
                      ...styles.locationCrop,
                      backgroundImage: `url(${game.assets.streetUrl})`,
                      backgroundPosition: `${(point.x / 1024) * 100}% ${(point.y / 1024) * 100}%`,
                    }} aria-hidden="true" />
                  )}
                  <span style={styles.locLabel}><span style={styles.emoji}>{loc.emoji}</span><span style={styles.locName}>{loc.name}</span></span>
                </button>
              )
            })()
          ))}
        </div>
        {nudge && <p style={styles.nudge}>{nudge}</p>}
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'absolute',
    zIndex: 30,
    inset: 0,
    background: 'rgba(0,0,0,0.5)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  card: {
    background: 'white',
    borderRadius: 24,
    padding: '36px 40px',
    maxWidth: 620,
    width: '90%',
    maxHeight: '94vh',
    overflowY: 'auto',
    textAlign: 'center',
    boxShadow: '0 8px 32px rgba(0,0,0,0.2)',
  },
  title: { fontSize: 26, fontWeight: 800, color: '#e07b54', margin: '0 0 8px' },
  subtitle: { color: '#888', margin: '0 0 24px' },
  grid: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 },
  locBtn: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: 8,
    borderRadius: 16,
    border: '3px solid #f0d0c0',
    background: '#fff9f5',
    cursor: 'pointer',
    fontSize: 14,
    fontWeight: 600,
    color: '#555',
    transition: 'transform 0.1s',
  },
  selected: { borderColor: '#e07b54', background: '#fff0e8' },
  locationCrop: {
    display: 'block', width: '100%', height: 78, borderRadius: 11,
    backgroundSize: '330% 330%', backgroundRepeat: 'no-repeat',
    boxShadow: 'inset 0 0 0 2px rgba(255,255,255,0.76)',
  },
  locLabel: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '8px 3px 3px' },
  emoji: { fontSize: 22 },
  locName: { lineHeight: 1.3 },
  nudge: { marginTop: 20, color: '#e07b54', fontWeight: 600, fontSize: 15 },
}
