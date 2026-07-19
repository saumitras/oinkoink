import type { Game } from '../shared/schema.js'
import { saveJson, loadJson } from './storage.js'

const store = new Map<string, Game>()

export function getGame(id: string): Game | undefined {
  return store.get(id)
}

export function setGame(game: Game): void {
  store.set(game.id, game)
}

export async function getOrLoadGame(id: string): Promise<Game | null> {
  if (store.has(id)) return store.get(id)!
  const loaded = await loadJson<Game>(`games/${id}/state.json`)
  if (loaded) store.set(id, loaded)
  return loaded
}

export async function snapshotGame(game: Game): Promise<void> {
  await saveJson(`games/${game.id}/state.json`, game)
}

export function allGames(): Game[] {
  return Array.from(store.values())
}
