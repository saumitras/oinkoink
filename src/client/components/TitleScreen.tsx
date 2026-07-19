import { useEffect, useState } from 'react'
import { unlockAudio } from '../game/audio'
import { useGameStore } from '../game/store'
import { rememberAdventure } from '../game/adventureHistory'
import { AdventureBrowser } from './AdventureBrowser'

interface Props {
  onStart: (gameId: string, options: { microQuestsEnabled: boolean }) => void
}

interface PresetWorld {
  slug: string
  title: string
  subtitle: string
  emoji: string
  previewUrl: string
}

export function TitleScreen({ onStart }: Props) {
  const [idea, setIdea] = useState('')
  const [cozyVisuals, setCozyVisuals] = useState(false)
  const [microQuestsEnabled, setMicroQuestsEnabled] = useState(false)
  const [presets, setPresets] = useState<PresetWorld[]>([])
  const [loading, setLoading] = useState(false)
  const [loadingPreset, setLoadingPreset] = useState<string | null>(null)
  const [error, setError] = useState('')
  const [showBrowser, setShowBrowser] = useState(false)
  const unlockAudioFn = useGameStore(s => s.unlockAudio)

  useEffect(() => {
    fetch('/api/presets')
      .then(res => res.ok ? res.json() : Promise.reject())
      .then(setPresets)
      .catch(() => setError('Preset worlds are still waking up. You can create a custom one below.'))
  }, [])

  function prepareAudio() {
    unlockAudio()
    unlockAudioFn()
  }

  async function startCustom() {
    if (!idea.trim()) {
      setError('Choose a world above or describe your own adventure!')
      return
    }
    setLoading(true)
    setError('')
    prepareAudio()
    try {
      const res = await fetch('/api/game', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idea, cozyVisuals }),
      })
      const data = await res.json()
      if (!res.ok) {
        const detail = data.detail ?? data
        if (detail.error === 'idea_flagged') {
          setError("Let's pick a different adventure! Try: " + detail.suggestions.join(', '))
        } else {
          setError('Something went wrong. Try again!')
        }
        return
      }
      rememberAdventure(data.gameId)
      onStart(data.gameId, { microQuestsEnabled })
    } catch {
      setError('Could not connect to the server.')
    } finally {
      setLoading(false)
    }
  }

  async function startPreset(preset: PresetWorld) {
    setLoadingPreset(preset.slug)
    setError('')
    prepareAudio()
    try {
      const res = await fetch(`/api/presets/${preset.slug}`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error('Preset unavailable')
      rememberAdventure(data.sourceAdventureId ?? data.gameId)
      onStart(data.gameId, { microQuestsEnabled })
    } catch {
      setError(`${preset.title} is unavailable right now. Try another world!`)
    } finally {
      setLoadingPreset(null)
    }
  }

  function surpriseMe() {
    if (!presets.length) return
    startPreset(presets[Math.floor(Math.random() * presets.length)])
  }

  const busy = loading || loadingPreset !== null

  if (showBrowser) return (
    <AdventureBrowser
      microQuestsEnabled={microQuestsEnabled}
      onBack={() => setShowBrowser(false)}
      onStart={onStart}
    />
  )

  return (
    <div className="title-screen" style={styles.container}>
      <div className="title-card" style={styles.card}>
        <div className="title-brand-row" style={styles.brandRow}>
          <div style={styles.emoji}>🐷</div>
          <div>
            <h1 style={styles.title}>Oink Oink Lost</h1>
            <p className="title-subtitle" style={styles.subtitle}>A little lost piglet, three friendly clues, and one big Mama mystery.</p>
          </div>
        </div>

        <div style={styles.label}>Where should the adventure happen?</div>
        <label className="title-quest-option" style={{
          ...styles.questOption,
          ...(microQuestsEnabled ? styles.questOptionEnabled : {}),
        }}>
          <input
            type="checkbox"
            checked={microQuestsEnabled}
            onChange={event => setMicroQuestsEnabled(event.target.checked)}
            disabled={busy}
            style={styles.checkbox}
          />
          <span style={styles.questOptionCopy}>
            <strong>Little helper quests</strong>
            <small style={styles.optionHelp}>Help each neighbor with a tiny search before they share their clue</small>
          </span>
          <span style={{ ...styles.questStatus, ...(microQuestsEnabled ? styles.questStatusOn : {}) }}>
            {microQuestsEnabled ? 'On' : 'Off'}
          </span>
        </label>
        <div className="title-preset-grid" style={styles.presetGrid}>
          {presets.map(preset => (
            <button
              key={preset.slug}
              className="title-preset-card"
              style={styles.presetCard}
              onClick={() => startPreset(preset)}
              disabled={busy}
              aria-label={`Start ${preset.title} adventure`}
            >
              <img src={preset.previewUrl} alt="" style={styles.presetImage} />
              <span style={styles.presetShade} />
              <span style={styles.presetContent}>
                <span style={styles.presetTitle}>
                  {preset.emoji} {loadingPreset === preset.slug ? 'Opening…' : preset.title}
                </span>
                <span style={styles.presetSubtitle}>{preset.subtitle}</span>
              </span>
            </button>
          ))}
        </div>

        <div style={styles.divider}><span style={styles.dividerLine} /><span>or invent your own</span><span style={styles.dividerLine} /></div>

        <div className="title-custom-row" style={styles.customRow}>
          <input
            id="adventure-idea"
            style={styles.input}
            placeholder="A cloud castle, a moonlit bakery…"
            value={idea}
            onChange={event => setIdea(event.target.value)}
            onKeyDown={event => event.key === 'Enter' && startCustom()}
            maxLength={120}
            disabled={busy}
            aria-label="Describe a custom adventure world"
          />
          <button style={styles.btnPrimary} onClick={startCustom} disabled={busy || !idea.trim()}>
            {loading ? '🎨 Creating…' : '🌟 Create'}
          </button>
        </div>

        <label style={styles.visualOption}>
          <input
            type="checkbox"
            checked={cozyVisuals}
            onChange={event => setCozyVisuals(event.target.checked)}
            disabled={busy}
            style={styles.checkbox}
          />
          <span>
            <strong>Extra cozy &amp; bright visuals</strong>
            <small style={styles.optionHelp}>Soft pastels, warm sunlight, cheerful colors, and nothing dark or scary</small>
          </span>
        </label>

        <button style={styles.surpriseBtn} onClick={surpriseMe} disabled={busy || !presets.length}>
          🎲 Surprise me with a ready world
        </button>

        <button className="title-browse-button" style={styles.browseBtn} onClick={() => setShowBrowser(true)} disabled={busy}>
          <span style={styles.browseIcon}>🗺️</span>
          <span style={styles.browseCopy}>
            <strong>Browse all adventures</strong>
            <small>Search worlds made by everyone and revisit your past adventures</small>
          </span>
          <span aria-hidden="true" style={styles.browseArrow}>→</span>
        </button>

        {error && <p style={styles.error}>{error}</p>}
      </div>
    </div>
  )
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'linear-gradient(135deg, #ffecd2 0%, #fcb69f 100%)',
    fontFamily: '"Segoe UI", sans-serif', padding: 24,
  },
  card: {
    background: 'rgba(255,255,255,0.96)', borderRadius: 28, padding: '32px clamp(22px, 4vw, 38px)',
    maxWidth: 920, width: '100%', boxShadow: '0 12px 40px rgba(92,55,36,0.16)',
  },
  brandRow: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16, marginBottom: 24 },
  emoji: { fontSize: 62, lineHeight: 1 },
  title: { fontSize: 34, fontWeight: 900, color: '#e07b54', margin: 0 },
  subtitle: { fontSize: 12, lineHeight: 1.35, color: '#8a776c', margin: '4px 0 0', whiteSpace: 'nowrap' },
  label: { color: '#5e4335', fontSize: 16, fontWeight: 900, marginBottom: 12, textAlign: 'center' },
  questOption: {
    display: 'flex', alignItems: 'center', gap: 10, maxWidth: 440, margin: '0 auto 14px',
    padding: '10px 12px', border: '1.5px solid #ead8cc', borderRadius: 14,
    background: '#fffaf7', color: '#6f5748', fontSize: 12, lineHeight: 1.25,
    cursor: 'pointer', userSelect: 'none', transition: 'border-color 160ms ease, background 160ms ease',
  },
  questOptionEnabled: { borderColor: '#e2a24d', background: '#fff5df' },
  questOptionCopy: { display: 'block', flex: 1 },
  questStatus: {
    minWidth: 36, padding: '4px 7px', borderRadius: 999, background: '#eee7e2',
    color: '#88736a', fontSize: 10, fontWeight: 900, textAlign: 'center',
  },
  questStatusOn: { background: '#e2a24d', color: '#fff' },
  presetGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 13 },
  presetCard: {
    position: 'relative', height: 210, padding: 0, border: '3px solid white', borderRadius: 18,
    overflow: 'hidden', cursor: 'pointer', textAlign: 'left', boxShadow: '0 5px 18px rgba(70,43,28,0.18)',
    background: '#d8b99f',
  },
  presetImage: { position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' },
  presetShade: { position: 'absolute', inset: 0, background: 'linear-gradient(transparent 30%, rgba(42,27,18,0.9))' },
  presetContent: {
    position: 'absolute', inset: 'auto 14px 13px', display: 'flex', flexDirection: 'column', gap: 4, color: 'white',
  },
  presetTitle: { fontSize: 19, fontWeight: 950 },
  presetSubtitle: { fontSize: 12, opacity: 0.9, lineHeight: 1.25 },
  divider: { display: 'flex', alignItems: 'center', gap: 12, color: '#a58c7e', fontSize: 12, fontWeight: 800, margin: '20px 0 13px' },
  dividerLine: { height: 1, background: '#ead8cc', flex: 1 },
  customRow: { display: 'flex', gap: 10 },
  visualOption: {
    display: 'flex', alignItems: 'flex-start', gap: 9, width: 'fit-content', marginTop: 10,
    color: '#6f5748', fontSize: 12, lineHeight: 1.25, cursor: 'pointer', userSelect: 'none',
  },
  checkbox: { width: 16, height: 16, marginTop: 1, accentColor: '#e07b54', cursor: 'pointer' },
  optionHelp: { display: 'block', marginTop: 2, color: '#9d887c', fontSize: 10, fontWeight: 500 },
  input: {
    flex: 1, minWidth: 0, padding: '13px 15px', fontSize: 15, borderRadius: 12,
    border: '2px solid #f0d0c0', outline: 'none', background: 'white',
  },
  btnPrimary: {
    padding: '13px 22px', fontSize: 15, fontWeight: 850, background: '#e07b54', color: 'white',
    border: 0, borderRadius: 12, cursor: 'pointer', whiteSpace: 'nowrap',
  },
  surpriseBtn: {
    display: 'block', margin: '13px auto 0', padding: '8px 13px', fontSize: 12, fontWeight: 800,
    background: 'transparent', color: '#b36c4d', border: 0, cursor: 'pointer',
  },
  browseBtn: {
    display: 'flex', alignItems: 'center', gap: 12, width: '100%', margin: '11px 0 0',
    padding: '12px 15px', border: '2px solid #efd1c1', borderRadius: 16,
    background: 'linear-gradient(110deg, #fff8f3, #fff0e6)', color: '#6d4433',
    cursor: 'pointer', textAlign: 'left', boxShadow: '0 4px 12px rgba(92,55,36,0.08)',
  },
  browseIcon: { fontSize: 25 },
  browseCopy: { display: 'grid', gap: 2, flex: 1, fontSize: 13 },
  browseArrow: { fontSize: 20, color: '#d16f4b' },
  error: { color: '#c65f4d', margin: '12px 0 0', fontSize: 13, textAlign: 'center' },
}
