const HISTORY_KEY = 'oink_adventure_history_v1'
const MAX_HISTORY = 30

export function getAdventureHistory(): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? '[]')
    return Array.isArray(value) ? value.filter(item => typeof item === 'string').slice(0, MAX_HISTORY) : []
  } catch {
    return []
  }
}

export function rememberAdventure(adventureId: string): void {
  const next = [adventureId, ...getAdventureHistory().filter(id => id !== adventureId)].slice(0, MAX_HISTORY)
  localStorage.setItem(HISTORY_KEY, JSON.stringify(next))
}
