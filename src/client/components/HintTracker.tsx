import { useEffect, useRef, useState } from 'react'
import { playAudio, speakText } from '../game/audio'
import type { Game } from '@shared/schema'
import { questForNpc } from '../game/adventureQuests'

interface Props {
  game: Game
  collectedHintIds: string[]
  embedded?: boolean
  forceExpanded?: boolean
}

export function HintTracker({ game, collectedHintIds, embedded = false, forceExpanded = false }: Props) {
  const [expanded, setExpanded] = useState(false)
  const previousCount = useRef(collectedHintIds.length)
  const autoCollapseTimer = useRef<number>(0)

  useEffect(() => {
    if (collectedHintIds.length > previousCount.current) {
      setExpanded(true)
      window.clearTimeout(autoCollapseTimer.current)
      autoCollapseTimer.current = window.setTimeout(() => setExpanded(false), 2800)
    }
    previousCount.current = collectedHintIds.length
    return () => window.clearTimeout(autoCollapseTimer.current)
  }, [collectedHintIds.length])

  if (!game.bible) return null
  const isExpanded = forceExpanded || expanded

  function replayHint(hintId: string) {
    const npc = game.bible!.npcs.find(n =>
      game.bible!.hints.find(h => h.id === hintId && h.npcId === n.id)
    )
    if (!npc) return
    const url = game.assets.audio[`npc_${npc.id}.hint`]
    if (url) playAudio(url).catch(() => speakText(game.bible!.hints.find(hint => hint.id === hintId)?.text ?? ''))
    else speakText(game.bible!.hints.find(hint => hint.id === hintId)?.text ?? '')
  }

  function toggleExpanded() {
    if (forceExpanded) return
    window.clearTimeout(autoCollapseTimer.current)
    setExpanded(v => !v)
  }

  return (
    <div className={`hint-tracker${embedded ? ' hint-tracker-embedded' : ''}`} style={{ ...styles.container, ...(embedded ? styles.embeddedContainer : {}) }}>
      <button
        style={styles.header}
        onClick={toggleExpanded}
        aria-expanded={isExpanded}
        aria-label={`${collectedHintIds.length} of 3 clues found`}
      >
        <span>🔎 Clues</span>
        <span style={styles.progress}>{collectedHintIds.length} / {game.bible.hints.length}</span>
        {!forceExpanded && <span aria-hidden="true">{isExpanded ? '▲' : '▼'}</span>}
      </button>
      <div style={styles.pips} aria-hidden="true">
        {game.bible.hints.map(hint => (
          <span key={hint.id} style={{ ...styles.pip, ...(collectedHintIds.includes(hint.id) ? styles.pipFound : {}) }} />
        ))}
      </div>
      {isExpanded && (
        <div style={styles.list}>
          {game.bible.hints.map((hint, i) => {
            const collected = collectedHintIds.includes(hint.id)
            const quest = questForNpc(game, hint.npcId)
            const clueObject = quest?.objects.find(object => object.correct)
            const roomImage = quest ? game.assets.rooms[quest.roomId]?.imageUrl : undefined
            return (
              <button
                key={hint.id}
                style={{ ...styles.clue, ...(collected ? styles.clueFound : {}) }}
                onClick={() => collected && replayHint(hint.id)}
                disabled={!collected}
                aria-label={collected ? `Clue ${i + 1}: ${hint.text}. Replay audio` : `Clue ${i + 1} not found`}
              >
                {collected && roomImage && clueObject ? (
                  <span
                    aria-hidden="true"
                    style={{
                      ...styles.clueCrop,
                      backgroundImage: `url(${roomImage})`,
                      backgroundPosition: `${(clueObject.x / 1024) * 100}% ${(clueObject.y / 1024) * 100}%`,
                    }}
                  />
                ) : (
                  <span style={styles.clueNumber}>{collected ? '✓' : i + 1}</span>
                )}
                <span>{collected ? hint.text : `Find marker ${i + 1} on the map`}</span>
                {collected && <span aria-hidden="true">🔊</span>}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    position: 'absolute',
    top: 16,
    right: 16,
    zIndex: 12,
    width: 'min(360px, calc(100vw - 90px))',
    background: 'rgba(255,255,255,0.85)',
    borderRadius: 16,
    padding: 10,
    boxShadow: '0 4px 18px rgba(0,0,0,0.18)',
    backdropFilter: 'blur(8px)',
  },
  embeddedContainer: {
    position: 'relative', top: 'auto', right: 'auto', zIndex: 'auto', width: '100%',
    marginBottom: 20, background: '#fff6e8', border: '2px solid #f0d4b4',
    boxShadow: 'none', textAlign: 'left',
  },
  header: {
    width: '100%', display: 'grid', gridTemplateColumns: '1fr auto auto', alignItems: 'center', gap: 10,
    border: 0, background: 'transparent', color: '#5b3a1e', fontSize: 16, fontWeight: 900,
    textAlign: 'left', cursor: 'pointer', padding: '2px 4px 7px',
  },
  progress: { color: '#d96f49', fontVariantNumeric: 'tabular-nums' },
  pips: { display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 },
  pip: { height: 5, borderRadius: 9, background: '#eadfd4' },
  pipFound: { background: '#f2a24b' },
  list: { display: 'grid', gap: 8, marginTop: 10 },
  clue: {
    display: 'grid', gridTemplateColumns: '44px 1fr auto', alignItems: 'center', gap: 9,
    width: '100%', border: 0, borderRadius: 12, padding: '10px 11px', textAlign: 'left',
    background: '#f5f0ea', color: '#9c8d81', fontSize: 13, lineHeight: 1.35,
  },
  clueFound: { background: '#fff0d3', color: '#5b3a1e', cursor: 'pointer' },
  clueNumber: {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 25, height: 25,
    borderRadius: 99, background: '#e9ddd1', color: '#8e7967', fontWeight: 900,
  },
  clueCrop: {
    display: 'block', width: 42, height: 42, borderRadius: 11,
    backgroundSize: '410% 410%', backgroundRepeat: 'no-repeat',
    border: '2px solid rgba(255,255,255,0.92)', boxShadow: '0 2px 7px rgba(91,58,30,0.18)',
  },
}
