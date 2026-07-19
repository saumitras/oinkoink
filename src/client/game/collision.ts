import type { ScreenAnnotation } from '@shared/schema'

// World == image space: generated scenes are 1024x1024, using a 16x16 grid of 64px cells.
export const CELL_SIZE = 64
export const WORLD_W = 1024
export const WORLD_H = 1024
export const GRID_COLS = 16
export const GRID_ROWS = 16

// Walkable band used inside rooms (no vision-extracted grid there).
export const ROOM_BAND = { minX: 60, maxX: WORLD_W - 60, minY: 600, maxY: 985 }

export function isWalkable(annotation: ScreenAnnotation, x: number, y: number): boolean {
  const col = Math.floor(x / CELL_SIZE)
  const row = Math.floor(y / CELL_SIZE)
  if (col < 0 || col >= GRID_COLS || row < 0 || row >= GRID_ROWS) return false
  return annotation.grid[row]?.[col] === '1'
}

export function nearestDoor(
  annotation: ScreenAnnotation,
  x: number,
  y: number,
  threshold = 90,
): ScreenAnnotation['doors'][0] | null {
  let best: ScreenAnnotation['doors'][0] | null = null
  let bestDist = threshold
  for (const door of annotation.doors) {
    const d = Math.hypot(door.x - x, door.y - y)
    if (d < bestDist) {
      bestDist = d
      best = door
    }
  }
  return best
}
