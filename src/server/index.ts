import './config.js'
import express from 'express'
import path from 'path'
import { fileURLToPath } from 'url'
import { config } from './config.js'
import { runPipeline, pickRandomIdea } from './pipeline.js'
import { getOrLoadGame, setGame, snapshotGame } from './gamestore.js'
import { subscribe } from './events.js'
import { moderateIdea } from './openai.js'
import { generateReunionPhoto } from './openai.js'
import { saveAsset } from './storage.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const app = express()
app.use(express.json())

// Serve generated assets
app.use('/assets', express.static(path.resolve(config.ASSETS_DIR)))

// Serve Vite build in production
if (process.env.NODE_ENV === 'production') {
  const distPath = path.resolve(__dirname, '../../dist/client')
  app.use(express.static(distPath))
}

// ── POST /api/game ────────────────────────────────────────────────────────────
app.post('/api/game', async (req, res) => {
  const idea: string = req.body.idea?.trim() || pickRandomIdea()

  const modResult = await moderateIdea(idea).catch(() => ({ flagged: false }))
  if (modResult.flagged) {
    return res.status(403).json({
      error: 'idea_flagged',
      suggestions: ['a pumpkin farm in autumn', 'a cozy space station on the moon'],
    })
  }

  const game = await runPipeline(idea)
  res.status(201).json({ gameId: game.id })
})

// ── GET /api/game/:id/events (SSE) ────────────────────────────────────────────
app.get('/api/game/:id/events', async (req, res) => {
  const game = await getOrLoadGame(req.params.id)
  if (!game) return res.status(404).json({ error: 'not_found' })

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.flushHeaders()

  // Replay completed stages for reconnect
  for (const [stage, status] of Object.entries(game.stages)) {
    if (status === 'done' || status === 'failed') {
      res.write(`event: stage\ndata: ${JSON.stringify({ type: 'stage', stage, status })}\n\n`)
    }
  }
  if (game.status === 'playable') {
    res.write(`event: playable\ndata: ${JSON.stringify({ type: 'playable' })}\n\n`)
  }

  subscribe(game.id, res)
})

// ── GET /api/game/:id ─────────────────────────────────────────────────────────
app.get('/api/game/:id', async (req, res) => {
  const game = await getOrLoadGame(req.params.id)
  if (!game) return res.status(404).json({ error: 'not_found' })
  res.json(game)
})

// ── POST /api/game/:id/solve ──────────────────────────────────────────────────
app.post('/api/game/:id/solve', async (req, res) => {
  const game = await getOrLoadGame(req.params.id)
  if (!game) return res.status(404).json({ error: 'not_found' })
  if (!game.bible) return res.status(409).json({ error: 'not_ready' })

  const { locationId } = req.body as { locationId: string }
  const correct = locationId === game.bible.finalLocationId

  if (correct && !game.assets.reunionPhotoUrl) {
    // Generate reunion photo in background
    generateReunionPhoto(game.bible)
      .then(buf => saveAsset(`games/${game.id}/reunion.png`, buf))
      .then(url => {
        game.assets.reunionPhotoUrl = url
        setGame(game)
        return snapshotGame(game)
      })
      .catch(err => console.error(`[reunion:${game.id}]`, err))
  }

  if (!correct) {
    // Find which hint contradicts the chosen location
    const chosen = game.bible.candidateLocations.find(l => l.id === locationId)
    const contradictingHint = game.bible.hints.find(h =>
      h.eliminatesLocationIds.includes(locationId)
    )
    const nudge = contradictingHint
      ? `Hmm, remember: "${contradictingHint.text}" — does that fit ${chosen?.name ?? 'that place'}?`
      : "Hmm, think about all three hints together!"
    return res.json({ correct: false, nudge })
  }

  res.json({ correct: true })
})

// ── GET /healthz ──────────────────────────────────────────────────────────────
app.get('/healthz', (_req, res) => res.send('ok'))

app.listen(config.PORT, () => {
  console.log(`🐷 Server running on http://localhost:${config.PORT}`)
})
