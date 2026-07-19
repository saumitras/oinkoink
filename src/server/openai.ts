import OpenAI from 'openai'
import { config } from './config.js'
import type { GameBible, ScreenAnnotation, RoomAnnotation } from '../shared/schema.js'
import { GameBible as GameBibleSchema, ScreenAnnotation as ScreenAnnotationSchema, RoomAnnotation as RoomAnnotationSchema } from '../shared/schema.js'
import { zodResponseFormat } from 'openai/helpers/zod'

export const openai = new OpenAI({ apiKey: config.OPENAI_API_KEY })

export async function withRetry<T>(fn: () => Promise<T>, retries = 1, backoffMs = 2000): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (retries <= 0) throw err
    await new Promise(r => setTimeout(r, backoffMs))
    return withRetry(fn, retries - 1, backoffMs * 2)
  }
}

export async function generateBible(idea: string, correctionNote?: string): Promise<GameBible> {
  const systemPrompt = `You are the game designer for "Oink Oink Lost", a cozy mystery game for children aged 5–8. A baby pig named Piglet is gently lost and must find Mama Pig by collecting hints from three friendly animal neighbors.

Hard rules:
- Tone: warm, cozy, gently funny. ZERO peril. Mama is never in danger — she is simply somewhere lovely.
- No villains, no scary places, no darkness, no injuries.
- Reading level: age 5–8. Dialogue lines are at most 2 short sentences.
- Exactly 3 neighbors, 3 hints, 3 enterable buildings, 2–4 flavor buildings, 4 candidate locations for Mama (one of which is the true finalLocation).

Hint design — TRIANGULATION (critical):
Each hint must be a different KIND of cue:
  hint 1 = a sensory/attribute cue about the place,
  hint 2 = a direction or spatial cue,
  hint 3 = a distinguishing object/activity cue.
Each hint alone must be consistent with at least 2 of the 4 candidate locations. Only the finalLocation is consistent with ALL THREE hints.
In the verification field, check each candidate against each hint and show that exactly one location survives.

The world must be expressible as ONE top-down street/outdoor scene where all buildings are visible, plus 3 small interior rooms.`

  const userPrompt = `World idea: "${idea}". Design the game bible.${correctionNote ? `\n\nCorrection needed: ${correctionNote}` : ''}`

  const response = await openai.beta.chat.completions.parse({
    model: config.TEXT_MODEL,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userPrompt },
    ],
    response_format: zodResponseFormat(GameBibleSchema, 'game_bible'),
  })

  const bible = response.choices[0].message.parsed
  if (!bible) throw new Error('Bible generation returned null')
  return bible
}

export async function generateStreetScene(bible: GameBible): Promise<Buffer> {
  const styleBlock = `STYLE: Cozy children's storybook watercolor illustration. Soft pastel palette, warm sunlight, thick clean outlines, chunky rounded shapes, flat colors with gentle texture. Cheerful and bright, absolutely nothing scary or dark. Consistent art style throughout. No text, no letters, no words in the image.`

  const buildingList = bible.buildings
    .map(b => `- ${b.exteriorDescription} (${b.sizeHint})`)
    .join('\n')

  const prompt = `${styleBlock}

Top-down (bird's-eye, directly overhead, 90-degree) view of ${bible.setting.name}: ${bible.setting.description}

The scene must contain, clearly separated and each fully visible:
${buildingList}

A clear walkable dirt path or street connects all buildings. Wide open walkable ground between everything — at least a third of the image is open path/grass. Decorations: ${bible.setting.decorations.join(', ')}.
No characters or animals in the scene. No text anywhere.`

  const response = await openai.images.generate({
    model: config.IMAGE_MODEL,
    prompt,
    size: '1536x1024',
    quality: 'high',
    output_format: 'png',
  } as Parameters<typeof openai.images.generate>[0])

  const url = response.data?.[0]?.url
  if (!url) throw new Error('No image URL returned')
  const res = await fetch(url)
  return Buffer.from(await res.arrayBuffer())
}

export async function generateOutlinePass(streetImageBase64: string): Promise<Buffer> {
  const prompt = `Trace this exact image. Keep every object exactly where it is. Draw a thick bright magenta (#FF00FF) outline around: every building (one closed outline per building), every tree/large decoration, and the borders of the walkable path/street area. Draw a thick bright green (#00FF00) small circle on each building's door/entrance. Change nothing else about the image.`

  const imageFile = new File([Buffer.from(streetImageBase64, 'base64')], 'street.png', { type: 'image/png' })
  const response = await openai.images.edit({
    model: config.IMAGE_MODEL_FAST,
    image: imageFile,
    prompt,
    size: '1536x1024',
  } as Parameters<typeof openai.images.edit>[0])

  const url = response.data?.[0]?.url
  if (!url) throw new Error('No outline image URL returned')
  const res = await fetch(url)
  return Buffer.from(await res.arrayBuffer())
}

const HotspotsSchema = ScreenAnnotationSchema

export async function extractHotspots(
  bible: GameBible,
  streetImageBase64: string,
  outlineImageBase64: string,
): Promise<ScreenAnnotation> {
  const buildingList = bible.buildings
    .map(b => `- id "${b.id}": ${b.exteriorDescription}${b.isEnterable ? ' [ENTERABLE]' : ''}`)
    .join('\n')

  const prompt = `You are annotating a game map. Image 1 is the playable scene. Image 2 is the same scene with magenta outlines around objects and green dots on doors.
The coordinate system is: x 0–1536 left→right, y 0–1024 top→bottom.

The scene contains these buildings from the game design:
${buildingList}

Tasks:
1. WALKABILITY GRID: Divide the image into a 24×16 grid (each cell 64×64 px). For each cell output 1 if a small character can walk there (path, grass, open ground) or 0 if blocked (building, tree, water, large object). Output as 16 strings of 24 characters, top row first.
2. DOORS: For each building id, give the door position (the green dot on image 2): center x,y and which grid cell it is in. Mark isEnterable from the design list above.
3. SPAWN: One walkable cell near the center-bottom, not adjacent to a door, for the player start.
Be precise: prefer marking a cell blocked if unsure.`

  const response = await openai.beta.chat.completions.parse({
    model: config.TEXT_MODEL,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${streetImageBase64}` } },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${outlineImageBase64}` } },
      ],
    }],
    response_format: zodResponseFormat(HotspotsSchema, 'screen_annotation'),
  })

  const annotation = response.choices[0].message.parsed
  if (!annotation) throw new Error('Hotspot extraction returned null')
  return annotation
}

export async function generateCharacterSprites(bible: GameBible): Promise<{ front: Buffer; side: Buffer }> {
  const styleBlock = `STYLE: Cozy children's storybook watercolor illustration. Soft pastel palette, warm sunlight, thick clean outlines, chunky rounded shapes, flat colors with gentle texture. Cheerful and bright. No text in the image.`

  const basePrompt = `${styleBlock}
A cute baby pig character sprite for a children's game, ${bible.player.description}, wearing ${bible.player.accessory}. Full body, centered, isolated on a fully transparent background. No shadow, no ground.`

  const [frontRes, sideRes] = await Promise.all([
    openai.images.generate({
      model: config.IMAGE_MODEL_FAST,
      prompt: basePrompt + ' Facing the viewer directly, front view.',
      size: '1024x1024',
      output_format: 'png',
    } as Parameters<typeof openai.images.generate>[0]),
    openai.images.generate({
      model: config.IMAGE_MODEL_FAST,
      prompt: basePrompt + ' Side profile facing right, mid-waddle step.',
      size: '1024x1024',
      output_format: 'png',
    } as Parameters<typeof openai.images.generate>[0]),
  ])

  const [frontUrl, sideUrl] = [frontRes.data?.[0]?.url, sideRes.data?.[0]?.url]
  if (!frontUrl || !sideUrl) throw new Error('Character sprite generation failed')

  const [frontBuf, sideBuf] = await Promise.all([
    fetch(frontUrl).then(r => r.arrayBuffer()).then(Buffer.from),
    fetch(sideUrl).then(r => r.arrayBuffer()).then(Buffer.from),
  ])
  return { front: frontBuf, side: sideBuf }
}

export async function generateRoomImage(
  bible: GameBible,
  buildingId: string,
): Promise<Buffer> {
  const building = bible.buildings.find(b => b.id === buildingId)
  const npc = bible.npcs.find(n => n.id === building?.npcId)
  if (!building || !npc) throw new Error(`Building/NPC not found: ${buildingId}`)

  const styleBlock = `STYLE: Cozy children's storybook watercolor illustration. Soft pastel palette, warm sunlight, thick clean outlines, chunky rounded shapes, flat colors with gentle texture. Cheerful and bright. No text in the image.`

  const prompt = `${styleBlock}
Interior of ${building.interiorDescription}, seen from a slightly elevated front view like a dollhouse room or theater stage. A single cozy room. ${npc.name} the ${npc.species} (${npc.appearance}) stands on the ${npc.roomPosition} side of the room, full body visible. A door/exit is visible at the bottom edge. No text anywhere.`

  const response = await openai.images.generate({
    model: config.IMAGE_MODEL_FAST,
    prompt,
    size: '1536x1024',
    output_format: 'png',
  } as Parameters<typeof openai.images.generate>[0])

  const url = response.data?.[0]?.url
  if (!url) throw new Error('Room image generation failed')
  const res = await fetch(url)
  return Buffer.from(await res.arrayBuffer())
}

export async function extractRoomAnnotation(roomImageBase64: string): Promise<RoomAnnotation> {
  const prompt = `This is a game room interior (1536x1024 pixels). Identify:
1. The NPC character's bounding box (x, y, w, h in pixels — top-left origin).
2. The exit door position (x, y center in pixels) at the bottom of the room.`

  const response = await openai.beta.chat.completions.parse({
    model: config.TEXT_MODEL,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: prompt },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${roomImageBase64}` } },
      ],
    }],
    response_format: zodResponseFormat(RoomAnnotationSchema, 'room_annotation'),
  })

  const annotation = response.choices[0].message.parsed
  if (!annotation) throw new Error('Room annotation returned null')
  return annotation
}

export async function generateTTS(text: string, voice: string): Promise<Buffer> {
  const response = await openai.audio.speech.create({
    model: config.TTS_MODEL,
    voice: voice as 'alloy',
    input: text,
    instructions: 'Warm, slow, gentle storyteller voice for a young child. Cheerful.',
    response_format: 'mp3',
  })
  return Buffer.from(await response.arrayBuffer())
}

export async function generateReunionPhoto(bible: GameBible): Promise<Buffer> {
  const styleBlock = `STYLE: Cozy children's storybook watercolor illustration. Soft pastel palette, warm sunlight, thick clean outlines, chunky rounded shapes, flat colors with gentle texture. Cheerful and bright. No text in the image.`

  const prompt = `${styleBlock}
A heartwarming reunion scene: a baby pig (Piglet, ${bible.player.description}) running joyfully toward Mama Pig, who is waiting with open arms at ${bible.setting.name}. Both pigs are smiling. Warm golden light. Cozy and sweet.`

  const response = await openai.images.generate({
    model: config.IMAGE_MODEL,
    prompt,
    size: '1536x1024',
    quality: 'high',
    output_format: 'png',
  } as Parameters<typeof openai.images.generate>[0])

  const url = response.data?.[0]?.url
  if (!url) throw new Error('Reunion photo generation failed')
  const res = await fetch(url)
  return Buffer.from(await res.arrayBuffer())
}

export async function moderateIdea(idea: string): Promise<{ flagged: boolean }> {
  const response = await openai.moderations.create({
    model: config.MODERATION_MODEL,
    input: idea,
  })
  return { flagged: response.results[0].flagged }
}
