import { useEffect, useRef, useState } from 'react'
import type { Game } from '@shared/schema'
import { TitleScreen } from './components/TitleScreen'
import { LoadingScreen } from './components/LoadingScreen'
import { GameCanvas } from './components/GameCanvas'
import { rememberAdventure } from './game/adventureHistory'

type AppScreen = 'title' | 'loading' | 'game'

export function App() {
  const [screen, setScreen] = useState<AppScreen>('title')
  const [gameId, setGameId] = useState<string | null>(null)
  const [game, setGame] = useState<Game | null>(null)
  const [microQuestsEnabled, setMicroQuestsEnabled] = useState(false)
  const sharedAdventureHandled = useRef(false)

  useEffect(() => {
    if (sharedAdventureHandled.current) return
    sharedAdventureHandled.current = true
    const adventureId = new URLSearchParams(window.location.search).get('adventure')
    if (!adventureId) return
    fetch(`/api/adventures/${encodeURIComponent(adventureId)}/play`, { method: 'POST' })
      .then(async response => {
        const data = await response.json()
        if (!response.ok) throw new Error('Shared adventure unavailable')
        rememberAdventure(data.sourceAdventureId ?? adventureId)
        setGameId(data.gameId)
        setScreen('loading')
      })
      .catch(() => {
        window.history.replaceState({}, '', window.location.pathname)
        setScreen('title')
      })
  }, [])

  function onStart(id: string, options: { microQuestsEnabled: boolean }) {
    setGameId(id)
    setMicroQuestsEnabled(options.microQuestsEnabled)
    setScreen('loading')
  }

  function onPlayable(g: Game) {
    setGame(g)
    setScreen('game')
  }

  function onNewAdventure() {
    if (window.location.search) window.history.replaceState({}, '', window.location.pathname)
    setGame(null)
    setGameId(null)
    setScreen('title')
  }

  if (screen === 'title') return <TitleScreen onStart={onStart} />
  if (screen === 'loading' && gameId) return <LoadingScreen gameId={gameId} onPlayable={onPlayable} />
  if (screen === 'game' && game) return (
    <GameCanvas
      game={game}
      microQuestsEnabled={microQuestsEnabled}
      onNewAdventure={onNewAdventure}
    />
  )
  return null
}
