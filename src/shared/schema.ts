import { z } from 'zod'

export const NPC = z.object({
  id: z.string(),
  name: z.string(),
  species: z.string(),
  appearance: z.string(),
  personality: z.string(),
  roomPosition: z.enum(['left', 'right', 'center']),
  ttsVoice: z.string().optional(),
  lines: z.object({
    greeting: z.string(),
    hint: z.string(),
    idle: z.string(),
  }),
  conversation: z.object({
    speechStyle: z.string(),
    favoriteTopic: z.string(),
    smallTalkFacts: z.array(z.string()),
    openingChoices: z.array(z.string()),
    clueLeadIn: z.string(),
    animalSound: z.string().nullish(),
  }).optional(),
})

export const Building = z.object({
  id: z.string(),
  name: z.string(),
  exteriorDescription: z.string(),
  sizeHint: z.enum(['small', 'medium', 'large']),
  isEnterable: z.boolean(),
  interiorDescription: z.string().optional(),
  npcId: z.string().nullable(),
})

export const Hint = z.object({
  id: z.string(),
  npcId: z.string(),
  kind: z.enum(['attribute', 'direction', 'object']),
  text: z.string(),
  eliminatesLocationIds: z.array(z.string()),
})

export const CandidateLocation = z.object({
  id: z.string(),
  name: z.string(),
  emoji: z.string(),
  description: z.string(),
  clueFacts: z.object({
    attribute: z.string(),
    direction: z.string(),
    object: z.string(),
  }).nullish(),
})

export const GameBible = z.object({
  title: z.string(),
  setting: z.object({
    name: z.string(),
    description: z.string(),
    decorations: z.array(z.string()),
  }),
  player: z.object({ description: z.string(), accessory: z.string() }),
  narratorIntro: z.string(),
  buildings: z.array(Building).min(5).max(7),
  npcs: z.array(NPC).length(3),
  hints: z.array(Hint).length(3),
  candidateLocations: z.array(CandidateLocation).length(4),
  finalLocationId: z.string(),
  finalLocationBuildingId: z.string(),
  reunionLine: z.string(),
  verification: z.string(),
  visualDirection: z.object({
    layout: z.enum(['outdoor_hub', 'interior_hub', 'mixed_hub']),
    architecture: z.string(),
    palette: z.array(z.string()).min(2).max(6),
    lighting: z.string(),
    atmosphere: z.string(),
    walkableSurface: z.string(),
    imageStyle: z.string(),
    avoid: z.array(z.string()),
  }).nullish(),
})

export const ScreenAnnotation = z.object({
  grid: z.array(z.string().length(24)).length(16),
  doors: z.array(z.object({
    buildingId: z.string(),
    x: z.number(),
    y: z.number(),
    cell: z.object({ col: z.number(), row: z.number() }),
  })),
  spawn: z.object({ col: z.number(), row: z.number() }),
})

export const RoomAnnotation = z.object({
  npcBox: z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }),
  exit: z.object({ x: z.number(), y: z.number() }),
})

export type GameBible = z.infer<typeof GameBible>
export type NPC = z.infer<typeof NPC>
export type Building = z.infer<typeof Building>
export type Hint = z.infer<typeof Hint>
export type CandidateLocation = z.infer<typeof CandidateLocation>
export type ScreenAnnotation = z.infer<typeof ScreenAnnotation>
export type RoomAnnotation = z.infer<typeof RoomAnnotation>

export interface SuggestedNPCReply {
  text: string
  intent: 'ask_mama' | 'small_talk' | 'goodbye'
}

export interface NPCChatResponse {
  sessionId: string
  reply: string
  suggestedReplies: SuggestedNPCReply[]
  mood: 'cheerful' | 'curious' | 'helpful' | 'thoughtful' | 'excited'
  conversationComplete: boolean
  audioUrl?: string | null
  clueGranted: boolean
  hintId?: string | null
}

export interface PreloadedNPCReply {
  reply: string
  suggestedReplies: SuggestedNPCReply[]
  mood: NPCChatResponse['mood']
  conversationComplete: boolean
  audioUrl?: string | null
}

export type Stage =
  | 'bible' | 'street' | 'outline' | 'hotspots' | 'character'
  | 'npc_openers' | `room_${string}` | 'tts' | 'reunion'

export type StageStatus = 'pending' | 'running' | 'done' | 'failed'

export interface Game {
  id: string
  idea: string
  createdAt: string
  status: 'generating' | 'playable' | 'failed'
  stages: Record<string, StageStatus>
  bible?: GameBible
  assets: {
    streetUrl?: string
    outlineUrl?: string
    characterFrontUrl?: string
    characterSideUrl?: string
    rooms: Record<string, { imageUrl?: string; annotation?: RoomAnnotation }>
    audio: Record<string, string>
    npcOpeners?: Record<string, PreloadedNPCReply>
    npcMamaReplies?: Record<string, PreloadedNPCReply>
    npcMamaReplyVariants?: Record<string, PreloadedNPCReply>
    reunionPhotoUrl?: string
  }
  annotation?: ScreenAnnotation
  fromWarmPool: boolean
  cozyVisuals?: boolean
  librarySourceId?: string
}

export interface AdventureSummary {
  id: string
  title: string
  settingName: string
  description: string
  idea: string
  previewUrl: string
  reunionPhotoUrl?: string | null
  createdAt: string
  emoji: string
}

export interface AdventurePage {
  items: AdventureSummary[]
  offset: number
  limit: number
  total: number
  hasMore: boolean
}

export interface SSEEvent {
  type: 'stage' | 'playable' | 'done' | 'failed'
  stage?: string
  status?: StageStatus
  meta?: Record<string, unknown>
  message?: string
}
