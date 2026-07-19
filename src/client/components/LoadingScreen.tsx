import { useEffect, useState } from 'react'
import type { Game, SSEEvent } from '@shared/schema'

const STAGE_COPY: Record<string, string> = {
  bible: '✍️ Writing your story…',
  street: '🎨 Painting your world…',
  outline: '🖊️ Tracing the paths…',
  hotspots: '🗺️ Finding the walkways…',
  character: '🐷 Dressing up Piglet…',
  npc_openers: '💬 Rehearsing hellos…',
  rooms: '🏠 Decorating the houses…',
  tts: '🎙️ Warming up voices…',
}

interface Props {
  gameId: string
  onPlayable: (game: Game) => void
}

export function LoadingScreen({ gameId, onPlayable }: Props) {
  const [currentStage, setCurrentStage] = useState('Starting up…')
  const [streetUrl, setStreetUrl] = useState<string | null>(null)
  const [charUrl, setCharUrl] = useState<string | null>(null)
  const [title, setTitle] = useState<string | null>(null)

  useEffect(() => {
    const es = new EventSource(`/api/game/${gameId}/events`)

    es.addEventListener('stage', (e) => {
      const event: SSEEvent = JSON.parse(e.data)
      if (event.status === 'running') {
        const key = event.stage?.startsWith('room_') ? 'rooms' : event.stage ?? ''
        setCurrentStage(STAGE_COPY[key] ?? `Working on ${event.stage}…`)
      }
      if (event.stage === 'street' && event.status === 'done' && event.meta?.url) {
        setStreetUrl(event.meta.url as string)
      }
      if (event.stage === 'character' && event.status === 'done' && event.meta?.url) {
        setCharUrl(event.meta.url as string)
      }
      if (event.stage === 'bible' && event.status === 'done' && event.meta?.title) {
        setTitle(event.meta.title as string)
      }
    })

    es.addEventListener('playable', async () => {
      es.close()
      const res = await fetch(`/api/game/${gameId}`)
      const game: Game = await res.json()
      onPlayable(game)
    })

    es.addEventListener('failed', (e) => {
      const event: SSEEvent = JSON.parse(e.data)
      setCurrentStage(`❌ ${event.message ?? 'Something went wrong'}`)
      es.close()
    })

    return () => es.close()
  }, [gameId, onPlayable])

  return (
    <div style={styles.container}>
      {streetUrl && (
        <img src={streetUrl} alt="your world" style={styles.bgImage} />
      )}
      <div style={styles.overlay}>
        <div style={styles.card}>
          {title && <h2 style={styles.title}>{title}</h2>}
          <div style={styles.spinner}>🎨</div>
          <p style={styles.stage}>{currentStage}</p>
          {charUrl && (
            <img src={charUrl} alt="Piglet" style={styles.piglet} />
          )}
          <p style={styles.hint}>Your adventure is being painted just for you!</p>
        </div>
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: { position: 'relative', width: '100vw', height: '100vh', overflow: 'hidden', background: '#ffecd2' },
  bgImage: { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', filter: 'blur(4px)', opacity: 0.6 },
  overlay: { position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  card: {
    background: 'rgba(255,255,255,0.92)',
    borderRadius: 24,
    padding: '40px 48px',
    textAlign: 'center',
    maxWidth: 400,
    boxShadow: '0 8px 32px rgba(0,0,0,0.15)',
  },
  title: { fontSize: 22, fontWeight: 800, color: '#e07b54', margin: '0 0 16px' },
  spinner: { fontSize: 48, animation: 'spin 2s linear infinite', display: 'inline-block' },
  stage: { fontSize: 18, color: '#555', margin: '16px 0 8px', fontWeight: 600 },
  piglet: { width: 80, height: 80, objectFit: 'contain', margin: '8px 0', animation: 'bounce 1.2s ease-in-out infinite' },
  hint: { fontSize: 14, color: '#aaa', margin: 0 },
}
