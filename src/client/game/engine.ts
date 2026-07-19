import { Application, Sprite, Assets, Container, Graphics, Text, Texture } from 'pixi.js'
import { useGameStore, type Nearby } from './store'
import { nearestDoor, WORLD_W, WORLD_H, ROOM_BAND, CELL_SIZE } from './collision'
import { attachKeyboard, detachKeyboard, getAxis } from './input'
import { footstep } from './audio'
import type { Game } from '@shared/schema'
import type { QuestObject } from './adventureQuests'

const SPEED = 220
const PLAYER_HEIGHT = 96
const DOOR_RADIUS = 90
const NPC_RADIUS = 150
const EXIT_RADIUS = 90

let app: Application | null = null
let initPromise: Promise<void> | null = null
// Async scene loads can overlap (notably during React StrictMode remounts or
// when a freshly generated hub URL arrives). Only the newest load may render.
let sceneLoadVersion = 0

// Player state lives here; the sprite is a pure render of it (bob never feeds back).
const player = { x: WORLD_W / 2, y: WORLD_H - 200, facing: 'front' as 'front' | 'left' | 'right' | 'back' }
let playerSprite: Sprite | null = null
let frontTex: Texture | null = null
let sideTex: Texture | null = null
let bobT = 0
let animT = 0
let moving = false
let stepT = 0
let moveTarget: { x: number; y: number } | null = null
let engineCanvas: HTMLCanvasElement | null = null

type SceneKind = { kind: 'street' } | { kind: 'room'; buildingId: string }
let scene: SceneKind = { kind: 'street' }

// Collision-grid debug overlay, toggled with G
let gridOverlay: Graphics | null = null
function onDebugKey(e: KeyboardEvent) {
  if (e.key === 'g' || e.key === 'G') {
    if (gridOverlay) gridOverlay.visible = !gridOverlay.visible
  }
}

// Affordances (bouncing emoji markers)
const doorMarkers = new Map<string, Container>()
const lookMarkerIds = new Set<string>()
let mamaGlow: Container | null = null
let npcMarker: Container | null = null
let exitMarker: Container | null = null
let npcCenter = { x: WORLD_W / 2, y: WORLD_H / 2 }
let exitPos = { x: WORLD_W / 2, y: WORLD_H - 60 }
let activeQuestObjects: QuestObject[] = []
const questMarkers = new Map<string, Container>()

export async function initEngine(container: HTMLDivElement): Promise<void> {
  if (initPromise) await initPromise.catch(() => {})
  destroyEngine()

  const newApp = new Application()
  // Pixi creates its own canvas (a canvas element can't survive a second
  // WebGL context after destroy, which hangs HMR remounts). Fixed logical
  // buffer; CSS (object-fit: contain) scales it, so ALL game math stays in
  // 1024x1024 image space.
  initPromise = newApp.init({
    width: WORLD_W,
    height: WORLD_H,
    backgroundColor: 0x87ceeb,
  })

  await initPromise
  app = newApp
  const canvas = newApp.canvas
  engineCanvas = canvas
  canvas.style.width = '100%'
  canvas.style.height = '100%'
  canvas.style.display = 'block'
  canvas.style.objectFit = 'contain'
  canvas.style.touchAction = 'none'
  canvas.addEventListener('pointerdown', onCanvasPointerDown)
  container.replaceChildren(canvas)
  attachKeyboard()
  window.addEventListener('keydown', onDebugKey)
  app.ticker.add(tick)
}

export function destroyEngine() {
  sceneLoadVersion += 1
  detachKeyboard()
  window.removeEventListener('keydown', onDebugKey)
  gridOverlay = null
  if (app) {
    try { app.destroy(true, { children: true }) } catch { /* ignore */ }
    app = null
  }
  playerSprite = null
  frontTex = null
  sideTex = null
  doorMarkers.clear()
  lookMarkerIds.clear()
  mamaGlow = null
  npcMarker = null
  exitMarker = null
  activeQuestObjects = []
  questMarkers.clear()
  initPromise = null
  if (engineCanvas) engineCanvas.removeEventListener('pointerdown', onCanvasPointerDown)
  engineCanvas = null
  moveTarget = null
}

function onCanvasPointerDown(event: PointerEvent) {
  if (!engineCanvas) return
  const rect = engineCanvas.getBoundingClientRect()
  const scale = Math.min(rect.width / WORLD_W, rect.height / WORLD_H)
  const renderedWidth = WORLD_W * scale
  const renderedHeight = WORLD_H * scale
  const offsetX = (rect.width - renderedWidth) / 2
  const offsetY = (rect.height - renderedHeight) / 2
  const x = (event.clientX - rect.left - offsetX) / scale
  const y = (event.clientY - rect.top - offsetY) / scale
  if (x < 0 || x > WORLD_W || y < 0 || y > WORLD_H) return
  moveTarget = { x, y }
}

async function loadPlayerTextures(game: Game) {
  if (!frontTex && game.assets.characterFrontUrl) {
    frontTex = await Assets.load(game.assets.characterFrontUrl)
  }
  if (!sideTex && game.assets.characterSideUrl) {
    try { sideTex = await Assets.load(game.assets.characterSideUrl) } catch { sideTex = null }
  }
}

function makePlayerSprite(): Sprite {
  const sprite = new Sprite(frontTex ?? Texture.WHITE)
  sprite.anchor.set(0.5, 1)
  applyHeight(sprite)
  return sprite
}

function applyHeight(sprite: Sprite) {
  const tex = sprite.texture
  const scale = PLAYER_HEIGHT / tex.height
  sprite.scale.set(Math.sign(sprite.scale.x || 1) * scale, scale)
}

function makeMarker(emoji: string, size = 40, prominentLook = false, prominentClue = false): Container {
  const marker = new Container()
  marker.visible = false

  if (prominentLook) {
    const halo = new Graphics()
      .circle(0, -30, 34)
      .fill({ color: 0xffdf55, alpha: 0.25 })
      .stroke({ color: 0xffffff, alpha: 0.78, width: 3 })
    const label = new Text({
      text: '✨',
      style: { fontSize: 56 },
    })
    label.anchor.set(0.5, 1)
    marker.addChild(halo, label)
  } else if (prominentClue) {
    const glow = new Graphics()
      .circle(0, -25, 36)
      .fill({ color: 0xffcf33, alpha: 0.18 })
      .stroke({ color: 0xffcf33, alpha: 0.38, width: 12 })
      .circle(0, -25, 29)
      .fill({ color: 0x573c16, alpha: 0.9 })
      .stroke({ color: 0xffe45e, alpha: 1, width: 6 })
      .circle(0, -25, 23)
      .stroke({ color: 0xffffd0, alpha: 0.95, width: 2 })
    const label = new Text({
      text: emoji,
      style: {
        fontSize: size,
        fontWeight: '900',
        fill: 0xffffff,
        stroke: { color: 0x4a2d00, width: 4 },
        dropShadow: { color: 0x000000, alpha: 0.55, blur: 3, distance: 2 },
      },
    })
    label.anchor.set(0.5)
    label.position.set(0, -25)
    marker.addChild(glow, label)
  } else {
    const label = new Text({ text: emoji, style: { fontSize: size } })
    label.anchor.set(0.5, 1)
    marker.addChild(label)
  }

  return marker
}

// ── Street scene ──────────────────────────────────────────────────────────────
export async function loadStreetScene(game: Game) {
  if (!app || !game.assets.streetUrl || !game.annotation) return
  const targetApp = app
  const loadVersion = ++sceneLoadVersion

  const bgTex = await Assets.load(game.assets.streetUrl)
  await loadPlayerTextures(game)
  if (app !== targetApp || loadVersion !== sceneLoadVersion) return

  scene = { kind: 'street' }
  targetApp.stage.removeChildren()
  doorMarkers.clear()
  lookMarkerIds.clear()
  npcMarker = null
  exitMarker = null
  activeQuestObjects = []
  questMarkers.clear()

  const bg = new Sprite(bgTex)
  bg.width = WORLD_W
  bg.height = WORLD_H
  targetApp.stage.addChild(bg)

  playerSprite = makePlayerSprite()
  const spawn = game.annotation.spawn
  player.x = (spawn.col + 0.5) * CELL_SIZE
  // Feet near the bottom of the spawn cell but strictly inside it
  player.y = (spawn.row + 0.9) * CELL_SIZE
  playerSprite.position.set(player.x, player.y)
  targetApp.stage.addChild(playerSprite)

  // Collision debug overlay (press G): blocked cells red, doors/spawn dots
  gridOverlay = new Graphics()
  for (let r = 0; r < 16; r++) {
    for (let c = 0; c < 16; c++) {
      if (game.annotation.grid[r]?.[c] !== '1') {
        gridOverlay.rect(c * CELL_SIZE, r * CELL_SIZE, CELL_SIZE, CELL_SIZE).fill({ color: 0xff2222, alpha: 0.28 })
      }
    }
  }
  for (const d of game.annotation.doors) {
    gridOverlay.circle(d.x, d.y, 10).fill({ color: 0x2266ff, alpha: 0.8 })
  }
  gridOverlay.visible = false
  targetApp.stage.addChild(gridOverlay)

  // Mama's glowing beacon (revealed once the mystery is solved)
  mamaGlow = new Container()
  const mamaRings = new Graphics()
    .circle(0, 0, 62)
    .fill({ color: 0xffd43b, alpha: 0.28 })
    .stroke({ color: 0xffffff, alpha: 0.95, width: 6 })
    .circle(0, 0, 46)
    .stroke({ color: 0xffd43b, alpha: 0.95, width: 5 })
  const mamaHeart = new Text({
    text: '💛',
    style: { fontSize: 66, dropShadow: { color: 0x5b3100, alpha: 0.7, blur: 5, distance: 3 } },
  })
  mamaHeart.anchor.set(0.5)
  const mamaLabel = new Text({
    text: 'MAMA!',
    style: {
      fontSize: 22, fontWeight: '900', fill: 0x4d2d00,
      stroke: { color: 0xffffff, width: 6 },
      dropShadow: { color: 0x000000, alpha: 0.45, blur: 3, distance: 2 },
    },
  })
  mamaLabel.anchor.set(0.5)
  mamaLabel.y = 66
  mamaGlow.addChild(mamaRings, mamaHeart, mamaLabel)
  mamaGlow.visible = false
  targetApp.stage.addChild(mamaGlow)

  // One marker per door, shown on proximity (or always, for Mama's door after solve)
  for (const door of game.annotation.doors) {
    const isMama = door.buildingId === game.bible?.finalLocationBuildingId
    const building = game.bible?.buildings.find(b => b.id === door.buildingId)
    const hintIndex = game.bible?.hints.findIndex(h => h.npcId === building?.npcId) ?? -1
    const isLookable = !!building && !building.isEnterable
    const marker = makeMarker(
      hintIndex >= 0 ? String(hintIndex + 1) : '✨',
      hintIndex >= 0 ? 28 : 40,
      isLookable,
      hintIndex >= 0,
    )
    marker.position.set(door.x, door.y - 14)
    doorMarkers.set(door.buildingId, marker)
    if (isLookable) lookMarkerIds.add(door.buildingId)
    targetApp.stage.addChild(marker)
    if (isMama && mamaGlow) mamaGlow.position.set(door.x, door.y)
  }

  useGameStore.getState().setPlayerPos({ x: player.x, y: player.y })
}

// ── Room scene ────────────────────────────────────────────────────────────────
export async function loadRoomScene(game: Game, buildingId: string) {
  const room = game.assets.rooms[buildingId]
  if (!app || !room?.imageUrl || !room.annotation) return
  const targetApp = app
  const loadVersion = ++sceneLoadVersion

  const bgTex = await Assets.load(room.imageUrl)
  await loadPlayerTextures(game)
  if (app !== targetApp || loadVersion !== sceneLoadVersion) return

  scene = { kind: 'room', buildingId }
  targetApp.stage.removeChildren()
  doorMarkers.clear()
  lookMarkerIds.clear()
  mamaGlow = null
  activeQuestObjects = []
  questMarkers.clear()

  const bg = new Sprite(bgTex)
  bg.width = WORLD_W
  bg.height = WORLD_H
  targetApp.stage.addChild(bg)

  const box = room.annotation.npcBox
  npcCenter = { x: box.x + box.w / 2, y: Math.min(box.y + box.h, ROOM_BAND.maxY) }
  npcMarker = makeMarker('💬')
  npcMarker.position.set(npcCenter.x, box.y - 6)
  targetApp.stage.addChild(npcMarker)

  exitPos = {
    x: Math.max(ROOM_BAND.minX, Math.min(ROOM_BAND.maxX, room.annotation.exit.x)),
    y: Math.max(ROOM_BAND.minY + 40, Math.min(ROOM_BAND.maxY, room.annotation.exit.y)),
  }
  exitMarker = makeMarker('🚪', 34)
  exitMarker.position.set(exitPos.x, exitPos.y - 10)
  targetApp.stage.addChild(exitMarker)

  playerSprite = makePlayerSprite()
  // Enter through the door: spawn at the exit position
  player.x = exitPos.x
  player.y = exitPos.y - 8
  playerSprite.position.set(player.x, player.y)
  targetApp.stage.addChild(playerSprite)

  useGameStore.getState().setPlayerPos({ x: player.x, y: player.y })
}

export function setRoomQuestObjects(objects: QuestObject[] | null) {
  activeQuestObjects = objects ?? []
  for (const marker of questMarkers.values()) {
    marker.removeFromParent()
    marker.destroy({ children: true })
  }
  questMarkers.clear()
  if (!app || scene.kind !== 'room') return

  for (const object of activeQuestObjects) {
    const marker = new Container()
    const ring = new Graphics()
      .circle(0, 0, 31)
      .fill({ color: 0xffdc54, alpha: 0.2 })
      .stroke({ color: 0xffffff, alpha: 0.95, width: 4 })
    const sparkle = new Text({
      text: '✨',
      style: { fontSize: 34, dropShadow: { color: 0x6b3c00, alpha: 0.5, blur: 4, distance: 2 } },
    })
    sparkle.anchor.set(0.5)
    marker.addChild(ring, sparkle)
    marker.position.set(object.x, object.y)
    questMarkers.set(object.id, marker)
    app.stage.addChild(marker)
  }
}

export function showRoomQuestCompletion(object: QuestObject | undefined) {
  setRoomQuestObjects(null)
  if (!app || scene.kind !== 'room' || !object) return
  const marker = new Container()
  const badge = new Graphics()
    .circle(0, 0, 30)
    .fill({ color: 0x4fa96f, alpha: 0.92 })
    .stroke({ color: 0xffffff, alpha: 0.96, width: 5 })
  const check = new Text({ text: '✓', style: { fontSize: 36, fontWeight: '900', fill: 0xffffff } })
  check.anchor.set(0.5)
  marker.addChild(badge, check)
  marker.position.set(object.x, object.y)
  questMarkers.set(`completed_${object.id}`, marker)
  app.stage.addChild(marker)
}

// ── Ticker ────────────────────────────────────────────────────────────────────
function tick(ticker: { deltaMS: number }) {
  if (!app || !playerSprite) return
  const dt = Math.min(ticker.deltaMS, 100) / 1000
  const store = useGameStore.getState()
  const { game } = store
  if (!game) return

  let { vx, vy } = getAxis()
  if (vx !== 0 || vy !== 0) {
    moveTarget = null
  } else if (moveTarget) {
    const dx = moveTarget.x - player.x
    const dy = moveTarget.y - player.y
    const distance = Math.hypot(dx, dy)
    if (distance < 10) {
      moveTarget = null
    } else {
      vx = dx / distance
      vy = dy / distance
    }
  }
  moving = vx !== 0 || vy !== 0

  if (moving) {
    const nx = player.x + vx * SPEED * dt
    const ny = player.y + vy * SPEED * dt

    if (scene.kind === 'street') {
      // Hackathon call: no collision — Piglet roams freely, clamped to the world
      player.x = Math.max(24, Math.min(WORLD_W - 24, nx))
      player.y = Math.max(60, Math.min(WORLD_H - 8, ny))
    } else {
      if (nx > ROOM_BAND.minX && nx < ROOM_BAND.maxX) player.x = nx
      if (ny > ROOM_BAND.minY && ny < ROOM_BAND.maxY) player.y = ny
    }

    // Trotting sound while walking
    stepT += dt
    if (stepT > 0.26) {
      stepT = 0
      footstep()
    }

    // Facing + texture
    let facing = player.facing
    if (vx < 0) facing = 'left'
    else if (vx > 0) facing = 'right'
    else if (vy < 0) facing = 'back'
    else if (vy > 0) facing = 'front'
    if (facing !== player.facing) {
      player.facing = facing
      const useSide = (facing === 'left' || facing === 'right') && sideTex
      playerSprite.texture = useSide ? sideTex! : frontTex ?? playerSprite.texture
      applyHeight(playerSprite)
      const flip = facing === 'left' ? -1 : 1
      playerSprite.scale.x = flip * Math.abs(playerSprite.scale.x)
    }
    bobT += dt * 9
  }

  // Render position = state + bob (bob never feeds back into state)
  playerSprite.position.set(player.x, player.y + (moving ? Math.sin(bobT) * 3 : 0))

  animT += dt

  // ── Proximity + affordances ──
  let nearby: Nearby | null = null

  if (scene.kind === 'street' && game.annotation && game.bible) {
    const door = nearestDoor(game.annotation, player.x, player.y, DOOR_RADIUS)
    for (const [bid, marker] of doorMarkers) {
      const isMama = bid === game.bible.finalLocationBuildingId
      const near = door?.buildingId === bid
      const building = game.bible.buildings.find(b => b.id === bid)
      const hint = game.bible.hints.find(h => h.npcId === building?.npcId)
      const isUnvisitedNeighbor = !!hint && !store.collectedHintIds.includes(hint.id)
      marker.visible = near || isUnvisitedNeighbor || (isMama && store.solved)
      if (marker.visible) {
        const base = game.annotation.doors.find(d => d.buildingId === bid)
        if (base) marker.y = base.y - 14 - Math.abs(Math.sin(animT * 3)) * 10
        const pulse = lookMarkerIds.has(bid) ? 1 + Math.sin(animT * 5) * 0.09 : 1
        marker.scale.set(pulse)
      }
    }
    if (mamaGlow) {
      mamaGlow.visible = store.solved
      const pulse = 1 + Math.sin(animT * 2.5) * 0.15
      mamaGlow.scale.set(pulse)
    }
    if (door) {
      const building = game.bible.buildings.find(b => b.id === door.buildingId)
      if (building) {
        const isMama = building.id === game.bible.finalLocationBuildingId
        nearby = {
          kind: 'door',
          buildingId: building.id,
          label: isMama && store.solved
            ? '💛 Find Mama!'
            : building.isEnterable
              ? '🚪 Go Inside'
              : `👀 LOOK: ${building.name}`,
          enterable: building.isEnterable,
          isMama,
        }
      }
    }
  } else if (scene.kind === 'room' && game.bible) {
    const dNpc = Math.hypot(npcCenter.x - player.x, npcCenter.y - player.y)
    const dExit = Math.hypot(exitPos.x - player.x, exitPos.y - player.y)
    const building = game.bible.buildings.find(b => b.id === (scene as { buildingId: string }).buildingId)
    const npc = game.bible.npcs.find(n => n.id === building?.npcId)

    if (npcMarker) {
      npcMarker.visible = dNpc < NPC_RADIUS
      if (npcMarker.visible) {
        const room = game.assets.rooms[(scene as { buildingId: string }).buildingId]
        const boxY = room?.annotation?.npcBox.y ?? 250
        npcMarker.y = boxY - 6 - Math.abs(Math.sin(animT * 3)) * 10
      }
    }
    if (exitMarker) exitMarker.visible = dExit < EXIT_RADIUS

    let closestQuest: QuestObject | undefined
    let closestQuestDistance = Number.POSITIVE_INFINITY
    for (const object of activeQuestObjects) {
      // The artwork can place an object on a high shelf while Piglet walks
      // only along the open floor. Interact from the floor directly beneath it.
      const approachY = Math.max(ROOM_BAND.minY + 55, Math.min(ROOM_BAND.maxY - 45, object.y))
      const distance = Math.hypot(object.x - player.x, approachY - player.y)
      const marker = questMarkers.get(object.id)
      if (marker) {
        const pulse = 1 + Math.sin(animT * 4 + object.x * 0.01) * 0.12
        marker.scale.set(pulse)
        marker.alpha = distance < 145 ? 1 : 0.72
      }
      if (distance < 118 && distance < closestQuestDistance) {
        closestQuest = object
        closestQuestDistance = distance
      }
    }

    if (closestQuest) {
      nearby = { kind: 'quest', objectId: closestQuest.id, label: `✨ Inspect ${closestQuest.label}` }
    } else if (dNpc < NPC_RADIUS && npc) {
      nearby = { kind: 'npc', npcId: npc.id, label: `💬 Talk to ${npc.name}` }
    } else if (dExit < EXIT_RADIUS) {
      nearby = { kind: 'exit', label: '🚪 Go outside' }
    }
  }

  store.setNearby(nearby)
}

export function getApp() { return app }

// Debug handle (dev only)
if (typeof window !== 'undefined') {
  ;(window as unknown as Record<string, unknown>).__oink = {
    player,
    getApp: () => app,
    getScene: () => scene,
    hasTicker: () => !!app?.ticker.started,
  }
}
