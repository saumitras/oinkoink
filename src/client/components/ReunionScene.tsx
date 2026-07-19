import { useEffect, useState } from 'react'
import type { Game } from '@shared/schema'
import { playAudio } from '../game/audio'

interface Props {
  game: Game
  onNewAdventure: () => void
  accomplishments?: string[]
}

export function ReunionScene({ game, onNewAdventure, accomplishments = [] }: Props) {
  const [photoUrl, setPhotoUrl] = useState(game.assets.reunionPhotoUrl)
  const [shareStatus, setShareStatus] = useState('')

  // Poll for reunion photo if not ready yet
  useEffect(() => {
    if (photoUrl) return
    const interval = setInterval(async () => {
      const res = await fetch(`/api/game/${game.id}`)
      const updated: Game = await res.json()
      if (updated.assets.reunionPhotoUrl) {
        setPhotoUrl(updated.assets.reunionPhotoUrl)
        clearInterval(interval)
      }
    }, 2000)
    return () => clearInterval(interval)
  }, [game.id, photoUrl])

  // Play reunion audio
  useEffect(() => {
    const url = game.assets.audio['narrator.reunion']
    if (url) playAudio(url).catch(() => {})
  }, [game.assets.audio])

  async function shareOnWhatsApp() {
    const shareUrl = `${window.location.origin}/share/${encodeURIComponent(game.id)}`
    const text = `I helped Piglet find Mama in ${game.bible?.setting.name ?? 'a magical world'}! Play this Oink Oink Lost adventure: ${shareUrl}`

    // Mobile browsers can hand an actual image file to WhatsApp through the
    // native share sheet. Desktop wa.me links cannot attach a file, so their
    // fallback uses the same reunion image as the link's Open Graph preview.
    if (photoUrl && navigator.share && navigator.canShare) {
      try {
        const response = await fetch(photoUrl)
        if (!response.ok) throw new Error('Reunion photo unavailable')
        const blob = await response.blob()
        const photo = new File([blob], 'piglet-and-mama-reunion.png', { type: blob.type || 'image/png' })
        const shareData = {
          title: game.bible?.title ?? 'Oink Oink Lost',
          text,
          files: [photo],
        }
        if (navigator.canShare(shareData)) {
          await navigator.share(shareData)
          setShareStatus('Reunion photo shared!')
          return
        }
      } catch (error) {
        if (error instanceof DOMException && error.name === 'AbortError') return
      }
    }

    window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, '_blank', 'noopener,noreferrer')
    setShareStatus(photoUrl
      ? 'WhatsApp opened with a reunion-photo preview.'
      : 'WhatsApp opened with the adventure link.')
  }

  async function downloadPhoto() {
    if (!photoUrl) return
    const title = (game.bible?.setting.name ?? 'oink-oink-lost').toLowerCase()
      .replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '')
    try {
      const response = await fetch(photoUrl)
      if (!response.ok) throw new Error('Photo unavailable')
      const blobUrl = URL.createObjectURL(await response.blob())
      const anchor = document.createElement('a')
      anchor.href = blobUrl
      anchor.download = `${title || 'oink-oink-lost'}-reunion.png`
      anchor.click()
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000)
      setShareStatus('Reunion photo downloaded!')
    } catch {
      window.open(photoUrl, '_blank', 'noopener,noreferrer')
    }
  }

  return (
    <div className="reunion-overlay" style={styles.overlay}>
      <div style={styles.confetti} aria-hidden="true">
        {Array.from({ length: 28 }, (_, i) => (
          <span key={i} style={{
            ...styles.confettiPiece,
            left: `${(i * 37) % 100}%`,
            background: ['#ffb35c', '#ef7181', '#6ec5a8', '#79a7e8'][i % 4],
            animationDelay: `${(i % 9) * -0.31}s`,
            animationDuration: `${2.8 + (i % 5) * 0.35}s`,
          }} />
        ))}
      </div>
      <div className="reunion-card" style={styles.card}>
        <div style={styles.badge}>MYSTERY SOLVED · 3 CLUES FOUND</div>
        <div style={styles.emoji}>🐷💛🐷</div>
        <h2 style={styles.title}>You found Mama!</h2>
        {photoUrl ? (
          <div style={styles.photoFrame}>
            <img className="reunion-photo" src={photoUrl} alt="Reunion" style={styles.photo} />
            <div style={styles.photoGlow} aria-hidden="true">✨</div>
          </div>
        ) : (
          <div style={styles.photoPlaceholder}>📸 Developing your photo…</div>
        )}
        {game.bible && (
          <p style={styles.reunionLine}>{game.bible.reunionLine}</p>
        )}
        {accomplishments.length > 0 && (
          <div style={styles.memories}>
            <strong>Piglet's adventure memories</strong>
            <div style={styles.memoryBadges}>
              {accomplishments.map((memory, index) => (
                <span key={memory} style={styles.memoryBadge}>{['🌾', '🥧', '🍎'][index % 3]} {memory}</span>
              ))}
            </div>
          </div>
        )}
        <div style={styles.actions}>
          <button
            style={{ ...styles.iconBtn, ...styles.whatsappBtn }}
            onClick={shareOnWhatsApp}
            disabled={!photoUrl}
            aria-label="Share reunion photo on WhatsApp"
            title="Share reunion photo on WhatsApp"
          >
            <WhatsAppIcon />
          </button>
          <button
            style={{ ...styles.iconBtn, ...styles.downloadBtn }}
            onClick={downloadPhoto}
            disabled={!photoUrl}
            aria-label="Download reunion photo"
            title="Download reunion photo"
          >
            <DownloadIcon />
          </button>
          <button
            style={{ ...styles.newAdventureBtn, ...styles.btn }}
            onClick={onNewAdventure}
          >
            <span aria-hidden="true">🌟</span> New adventure
          </button>
        </div>
        {shareStatus && <div style={styles.shareStatus} role="status">{shareStatus}</div>}
      </div>
    </div>
  )
}

function WhatsAppIcon() {
  return (
    <svg aria-hidden="true" width="25" height="25" viewBox="0 0 24 24" fill="none">
      <path d="M20.5 11.7a8.5 8.5 0 0 1-12.6 7.4L3.5 20.3l1.2-4.2a8.5 8.5 0 1 1 15.8-4.4Z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
      <path d="M8.2 7.7c.2-.4.5-.4.8-.4h.4c.2 0 .4.1.5.4l.8 1.8c.1.3.1.5-.1.7l-.7.8c-.2.2-.1.4 0 .6.7 1.2 1.7 2.1 3 2.7.2.1.4.1.6-.1l.8-1c.2-.2.4-.3.7-.2l1.8.9c.3.1.4.3.4.5 0 .4-.2 1.3-.6 1.7-.4.5-1.2.8-2 .8-.7 0-1.7-.3-3.2-1-1.9-.9-3.5-2.5-4.5-4.3-.7-1.3-1-2.4-.9-3.1.1-.4.1-.5.2-.8Z" fill="currentColor" />
    </svg>
  )
}

function DownloadIcon() {
  return (
    <svg aria-hidden="true" width="25" height="25" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v12" />
      <path d="m7.5 11 4.5 4.5 4.5-4.5" />
      <path d="M5 20h14" />
    </svg>
  )
}

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'absolute',
    inset: 0,
    background: 'rgba(0,0,0,0.6)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center', zIndex: 25, padding: 16,
  },
  confetti: { position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none' },
  confettiPiece: {
    position: 'absolute', top: -18, width: 10, height: 18, borderRadius: 3,
    animation: 'confetti-fall 3.5s linear infinite',
  },
  card: {
    position: 'relative', zIndex: 1,
    background: 'white',
    borderRadius: 24,
    padding: 'clamp(24px, 5vw, 36px) clamp(20px, 6vw, 40px)',
    maxWidth: 560,
    width: '90%',
    maxHeight: '94vh', overflowY: 'auto',
    textAlign: 'center',
    boxShadow: '0 8px 32px rgba(0,0,0,0.25)',
  },
  badge: { fontSize: 11, letterSpacing: 1.2, fontWeight: 900, color: '#bb7658', marginBottom: 10 },
  emoji: { fontSize: 56, marginBottom: 8 },
  title: { fontSize: 28, fontWeight: 800, color: '#e07b54', margin: '0 0 20px' },
  photoFrame: { position: 'relative', overflow: 'hidden', borderRadius: 16, marginBottom: 20, background: '#f5e6d3' },
  photo: { display: 'block', width: '100%', borderRadius: 16, animation: 'reunion-zoom 10s ease-in-out infinite', transformOrigin: 'center center' },
  photoGlow: { position: 'absolute', right: 14, top: 10, fontSize: 34, animation: 'bounce 1.8s ease-in-out infinite' },
  photoPlaceholder: {
    width: '100%',
    height: 200,
    background: '#f5e6d3',
    borderRadius: 16,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 18,
    color: '#aaa',
    marginBottom: 20,
  },
  reunionLine: { fontSize: 18, color: '#555', lineHeight: 1.6, margin: '0 0 24px' },
  memories: {
    display: 'grid', gap: 9, margin: '-7px 0 22px', padding: 12, borderRadius: 15,
    background: '#fff6df', color: '#67472e', fontSize: 13,
  },
  memoryBadges: { display: 'flex', justifyContent: 'center', gap: 7, flexWrap: 'wrap' },
  memoryBadge: { padding: '7px 10px', borderRadius: 99, background: 'white', fontWeight: 800, boxShadow: '0 2px 6px rgba(80,50,20,0.1)' },
  btn: {
    background: '#e07b54',
    color: 'white',
  },
  actions: { display: 'flex', justifyContent: 'center', gap: 10, flexWrap: 'wrap' },
  iconBtn: {
    width: 50, height: 50, padding: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    fontSize: 24, border: 'none', borderRadius: 14, cursor: 'pointer',
    boxShadow: '0 4px 12px rgba(74,45,20,0.16)',
  },
  newAdventureBtn: {
    minHeight: 50, padding: '0 20px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    gap: 8, fontSize: 16, fontWeight: 850, border: 'none', borderRadius: 14, cursor: 'pointer',
    boxShadow: '0 4px 12px rgba(74,45,20,0.16)',
  },
  whatsappBtn: {
    background: '#25D366', color: 'white',
  },
  downloadBtn: {
    background: '#edf3ff', color: '#41618e',
  },
  shareStatus: { marginTop: 10, color: '#57825f', fontSize: 12, fontWeight: 850 },
}
