import type { ScreenAnnotation } from '../shared/schema.js'

const COLS = 24
const ROWS = 16

function gridToArray(grid: string[]): number[][] {
  return grid.map(row => row.split('').map(Number))
}

function arrayToGrid(arr: number[][]): string[] {
  return arr.map(row => row.join(''))
}

function floodFill(arr: number[][], startCol: number, startRow: number): Set<string> {
  const reachable = new Set<string>()
  const queue: [number, number][] = [[startCol, startRow]]
  while (queue.length) {
    const [c, r] = queue.pop()!
    const key = `${c},${r}`
    if (reachable.has(key)) continue
    if (c < 0 || c >= COLS || r < 0 || r >= ROWS) continue
    if (arr[r][c] !== 1) continue
    reachable.add(key)
    queue.push([c + 1, r], [c - 1, r], [c, r + 1], [c, r - 1])
  }
  return reachable
}

export function postProcessAnnotation(raw: ScreenAnnotation): ScreenAnnotation {
  const arr = gridToArray(raw.grid)

  // Ensure spawn is walkable
  arr[raw.spawn.row][raw.spawn.col] = 1

  // Ensure door cells and one cell below are walkable
  for (const door of raw.doors) {
    const { col, row } = door.cell
    arr[row][col] = 1
    if (row + 1 < ROWS) arr[row + 1][col] = 1
  }

  // Flood fill from spawn — disconnect unreachable walkable cells
  const reachable = floodFill(arr, raw.spawn.col, raw.spawn.row)

  // Check all doors are reachable; if not, carve a path
  for (const door of raw.doors) {
    const key = `${door.cell.col},${door.cell.row}`
    if (!reachable.has(key)) {
      // Simple: carve a horizontal then vertical corridor from spawn to door
      const sc = raw.spawn.col
      const sr = raw.spawn.row
      const dc = door.cell.col
      const dr = door.cell.row
      const minC = Math.min(sc, dc)
      const maxC = Math.max(sc, dc)
      for (let c = minC; c <= maxC; c++) arr[sr][c] = 1
      const minR = Math.min(sr, dr)
      const maxR = Math.max(sr, dr)
      for (let r = minR; r <= maxR; r++) arr[r][dc] = 1
    }
  }

  // Re-flood from spawn; isolate unreachable cells
  const reachable2 = floodFill(arr, raw.spawn.col, raw.spawn.row)
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      if (arr[r][c] === 1 && !reachable2.has(`${c},${r}`)) {
        arr[r][c] = 0
      }
    }
  }

  const walkableCount = arr.flat().filter(v => v === 1).length
  const totalCells = COLS * ROWS

  // Fallback: if < 20% walkable, open the bottom half
  if (walkableCount / totalCells < 0.2) {
    for (let r = Math.floor(ROWS * 0.6); r < ROWS; r++) {
      for (let c = 0; c < COLS; c++) arr[r][c] = 1
    }
  }

  return { ...raw, grid: arrayToGrid(arr) }
}

export function verifyBibleHints(bible: import('../shared/schema.js').GameBible): boolean {
  const locationIds = bible.candidateLocations.map(l => l.id)
  let survivors = new Set(locationIds)
  for (const hint of bible.hints) {
    for (const eliminated of hint.eliminatesLocationIds) {
      survivors.delete(eliminated)
    }
  }
  return survivors.size === 1 && survivors.has(bible.finalLocationId)
}
