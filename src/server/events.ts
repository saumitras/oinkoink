import type { Response } from 'express'
import type { SSEEvent } from '../shared/schema.js'

const subscribers = new Map<string, Response[]>()

export function subscribe(gameId: string, res: Response): void {
  if (!subscribers.has(gameId)) subscribers.set(gameId, [])
  subscribers.get(gameId)!.push(res)
  res.on('close', () => unsubscribe(gameId, res))
}

export function unsubscribe(gameId: string, res: Response): void {
  const subs = subscribers.get(gameId)
  if (!subs) return
  const idx = subs.indexOf(res)
  if (idx !== -1) subs.splice(idx, 1)
}

export function emit(gameId: string, event: SSEEvent): void {
  const subs = subscribers.get(gameId) ?? []
  const data = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`
  for (const res of subs) {
    try { res.write(data) } catch { /* client disconnected */ }
  }
}
