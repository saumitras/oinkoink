import { create } from 'zustand'
import type { Game } from '@shared/schema'

export type Screen = 'street' | `room_${string}`

// What the player is close enough to interact with right now.
export type Nearby =
  | { kind: 'door'; buildingId: string; label: string; enterable: boolean; isMama: boolean }
  | { kind: 'npc'; npcId: string; label: string }
  | { kind: 'quest'; objectId: string; label: string }
  | { kind: 'exit'; label: string }

interface GameState {
  game: Game | null
  screen: Screen
  playerPos: { x: number; y: number }
  playerFacing: 'front' | 'left' | 'right' | 'back'
  collectedHintIds: string[]
  nearby: Nearby | null
  solved: boolean
  showPicker: boolean
  showReunion: boolean
  audioUnlocked: boolean

  setGame: (g: Game) => void
  updateGame: (g: Partial<Game>) => void
  setScreen: (s: Screen) => void
  setPlayerPos: (pos: { x: number; y: number }) => void
  setPlayerFacing: (f: GameState['playerFacing']) => void
  collectHint: (hintId: string) => void
  setNearby: (n: Nearby | null) => void
  setSolved: (v: boolean) => void
  setShowPicker: (v: boolean) => void
  setShowReunion: (v: boolean) => void
  unlockAudio: () => void
}

export const useGameStore = create<GameState>((set, get) => ({
  game: null,
  screen: 'street',
  playerPos: { x: 512, y: 800 },
  playerFacing: 'front',
  collectedHintIds: [],
  nearby: null,
  solved: false,
  showPicker: false,
  showReunion: false,
  audioUnlocked: false,

  setGame: (game) => {
    // Restore progress from localStorage
    const saved = localStorage.getItem(`hints_${game.id}`)
    const collectedHintIds = saved ? JSON.parse(saved) : []
    const solved = localStorage.getItem(`solved_${game.id}`) === '1'
    set({ game, collectedHintIds, solved, screen: 'street', nearby: null, showPicker: false, showReunion: false })
  },
  updateGame: (partial) => set(s => ({ game: s.game ? { ...s.game, ...partial } : s.game })),
  setScreen: (screen) => set({ screen, nearby: null }),
  setPlayerPos: (playerPos) => set({ playerPos }),
  setPlayerFacing: (playerFacing) => set({ playerFacing }),
  collectHint: (hintId) => {
    const next = [...get().collectedHintIds, hintId].filter((v, i, a) => a.indexOf(v) === i)
    const gameId = get().game?.id
    if (gameId) localStorage.setItem(`hints_${gameId}`, JSON.stringify(next))
    set({ collectedHintIds: next })
  },
  setNearby: (nearby) => {
    const cur = get().nearby
    // Avoid re-render churn from the ticker: only set when it actually changed.
    const same =
      cur === nearby ||
      (cur !== null && nearby !== null && cur.kind === nearby.kind &&
        (cur.kind !== 'door' || (nearby.kind === 'door' && cur.buildingId === nearby.buildingId)) &&
        (cur.kind !== 'npc' || (nearby.kind === 'npc' && cur.npcId === nearby.npcId)) &&
        (cur.kind !== 'quest' || (nearby.kind === 'quest' && cur.objectId === nearby.objectId)))
    if (!same) set({ nearby })
  },
  setSolved: (v) => {
    const gameId = get().game?.id
    if (gameId) localStorage.setItem(`solved_${gameId}`, v ? '1' : '0')
    set({ solved: v })
  },
  setShowPicker: (v) => set({ showPicker: v }),
  setShowReunion: (v) => set({ showReunion: v }),
  unlockAudio: () => set({ audioUnlocked: true }),
}))
