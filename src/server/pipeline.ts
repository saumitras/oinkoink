import { nanoid } from 'nanoid'
import type { Game, StageStatus } from '../shared/schema.js'
import { setGame, snapshotGame } from './gamestore.js'
import { emit } from './events.js'
import { saveAsset } from './storage.js'
import { postProcessAnnotation, verifyBibleHints } from './postprocess.js'
import { npcVoice, NARRATOR_VOICE, CANNED_IDEAS } from './prompts.js'
import {
  withRetry,
  generateBible,
  generateStreetScene,
  generateOutlinePass,
  extractHotspots,
  generateCharacterSprites,
  generateRoomImage,
  extractRoomAnnotation,
  generateTTS,
} from './openai.js'

function makeGame(idea: string): Game {
  return {
    id: nanoid(),
    idea,
    createdAt: new Date().toISOString(),
    status: 'generating',
    stages: {
      bible: 'pending', street: 'pending', outline: 'pending',
      hotspots: 'pending', character: 'pending', tts: 'pending',
    },
    assets: { rooms: {}, audio: {} },
    fromWarmPool: false,
  }
}

async function setStage(game: Game, stage: string, status: StageStatus, meta?: Record<string, unknown>) {
  game.stages[stage] = status
  emit(game.id, { type: 'stage', stage, status, meta })
  setGame(game)
}

export async function runPipeline(idea: string): Promise<Game> {
  const game = makeGame(idea)
  setGame(game)

  // Fire and forget — caller gets the game id immediately
  executePipeline(game).catch(err => {
    console.error(`[pipeline:${game.id}] fatal:`, err)
    game.status = 'failed'
    emit(game.id, { type: 'failed', message: String(err) })
    setGame(game)
  })

  return game
}

async function executePipeline(game: Game) {
  // ── Stage 1: Bible ──────────────────────────────────────────────────────────
  await setStage(game, 'bible', 'running')
  let bible = await withRetry(() => generateBible(game.idea))

  if (!verifyBibleHints(bible)) {
    console.warn(`[pipeline:${game.id}] hint verification failed, retrying bible`)
    bible = await withRetry(() =>
      generateBible(game.idea, 'The previous hint triangulation was invalid — more than one location survived all three hints. Please redesign the hints so exactly one location survives.')
    )
  }

  game.bible = bible
  // Assign TTS voices to NPCs
  bible.npcs.forEach((npc, i) => { npc.ttsVoice = npcVoice(i) })
  // Init room stage keys
  for (const b of bible.buildings.filter(b => b.isEnterable)) {
    game.stages[`room_${b.id}`] = 'pending'
    game.assets.rooms[b.id] = {}
  }
  await setStage(game, 'bible', 'done', { title: bible.title })
  await snapshotGame(game)

  // ── Stages 2–4 (critical path) + 5 (parallel) + 6–8 (background) ──────────
  const [, characterResult] = await Promise.allSettled([
    runStreetChain(game),
    runCharacter(game),
  ])

  if (characterResult.status === 'rejected') {
    console.error(`[pipeline:${game.id}] character failed:`, characterResult.reason)
  }

  // Game is playable once street chain + character are done
  if (game.assets.streetUrl && game.annotation && game.assets.characterFrontUrl) {
    game.status = 'playable'
    emit(game.id, { type: 'playable' })
    setGame(game)
    await snapshotGame(game)
  }

  // Background: rooms + TTS (don't block playable)
  await Promise.allSettled([
    runRooms(game),
    runTTS(game),
  ])

  game.status = 'playable' // ensure it's set even if rooms/tts had issues
  emit(game.id, { type: 'done' })
  setGame(game)
  await snapshotGame(game)
}

async function runStreetChain(game: Game) {
  const bible = game.bible!

  // Stage 2: Street scene
  await setStage(game, 'street', 'running')
  const streetBuf = await withRetry(() => generateStreetScene(bible))
  const streetUrl = await saveAsset(`games/${game.id}/street.png`, streetBuf)
  game.assets.streetUrl = streetUrl
  await setStage(game, 'street', 'done', { url: streetUrl })

  // Stage 3: Outline pass
  await setStage(game, 'outline', 'running')
  const streetB64 = streetBuf.toString('base64')
  let outlineBuf: Buffer
  let outlineB64: string
  try {
    outlineBuf = await withRetry(() => generateOutlinePass(streetB64))
    outlineB64 = outlineBuf.toString('base64')
    const outlineUrl = await saveAsset(`games/${game.id}/outline.png`, outlineBuf)
    game.assets.outlineUrl = outlineUrl
    await setStage(game, 'outline', 'done')
  } catch (err) {
    // Plan A: skip outline, use street image for hotspot extraction
    console.warn(`[pipeline:${game.id}] outline failed, using street image only:`, err)
    outlineB64 = streetB64
    await setStage(game, 'outline', 'failed')
  }

  // Stage 4: Hotspot extraction
  await setStage(game, 'hotspots', 'running')
  let annotation = await withRetry(() => extractHotspots(bible, streetB64, outlineB64))
  annotation = postProcessAnnotation(annotation)
  game.annotation = annotation
  await setStage(game, 'hotspots', 'done')
  await snapshotGame(game)
}

async function runCharacter(game: Game) {
  const bible = game.bible!
  await setStage(game, 'character', 'running')
  const { front, side } = await withRetry(() => generateCharacterSprites(bible))
  const [frontUrl, sideUrl] = await Promise.all([
    saveAsset(`games/${game.id}/char_front.png`, front),
    saveAsset(`games/${game.id}/char_side.png`, side),
  ])
  game.assets.characterFrontUrl = frontUrl
  game.assets.characterSideUrl = sideUrl
  await setStage(game, 'character', 'done')
}

async function runRooms(game: Game) {
  const bible = game.bible!
  const enterableBuildings = bible.buildings.filter(b => b.isEnterable)

  await Promise.allSettled(enterableBuildings.map(async (building) => {
    const stageKey = `room_${building.id}`
    await setStage(game, stageKey, 'running')
    try {
      const roomBuf = await withRetry(() => generateRoomImage(bible, building.id))
      const roomUrl = await saveAsset(`games/${game.id}/room_${building.id}.png`, roomBuf)
      const roomB64 = roomBuf.toString('base64')
      const annotation = await withRetry(() => extractRoomAnnotation(roomB64))
        .catch(() => ({
          npcBox: { x: 600, y: 300, w: 200, h: 400 },
          exit: { x: 768, y: 950 },
        }))
      game.assets.rooms[building.id] = { imageUrl: roomUrl, annotation }
      await setStage(game, stageKey, 'done', { url: roomUrl })
    } catch (err) {
      console.error(`[pipeline:${game.id}] room ${building.id} failed:`, err)
      await setStage(game, stageKey, 'failed')
    }
    await snapshotGame(game)
  }))
}

async function runTTS(game: Game) {
  const bible = game.bible!
  await setStage(game, 'tts', 'running')

  const lines: Array<{ key: string; text: string; voice: string }> = [
    { key: 'narrator.intro', text: bible.narratorIntro, voice: NARRATOR_VOICE },
    { key: 'narrator.allHints', text: "You have all the hints! Where do you think Mama went?", voice: NARRATOR_VOICE },
    { key: 'narrator.reunion', text: bible.reunionLine, voice: NARRATOR_VOICE },
  ]

  for (let i = 0; i < bible.npcs.length; i++) {
    const npc = bible.npcs[i]
    const voice = npc.ttsVoice ?? npcVoice(i)
    lines.push(
      { key: `npc_${npc.id}.greeting`, text: npc.lines.greeting, voice },
      { key: `npc_${npc.id}.hint`, text: npc.lines.hint, voice },
      { key: `npc_${npc.id}.idle`, text: npc.lines.idle, voice },
    )
  }

  await Promise.allSettled(lines.map(async ({ key, text, voice }) => {
    try {
      const buf = await withRetry(() => generateTTS(text, voice))
      const url = await saveAsset(`games/${game.id}/audio/${key}.mp3`, buf)
      game.assets.audio[key] = url
      setGame(game)
    } catch (err) {
      console.error(`[pipeline:${game.id}] TTS ${key} failed:`, err)
    }
  }))

  await setStage(game, 'tts', 'done')
  await snapshotGame(game)
}

export function pickRandomIdea(): string {
  return CANNED_IDEAS[Math.floor(Math.random() * CANNED_IDEAS.length)]
}
