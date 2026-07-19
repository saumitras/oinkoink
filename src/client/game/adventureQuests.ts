import type { Game } from '@shared/schema'

export interface QuestObject {
  id: string
  label: string
  emoji: string
  x: number
  y: number
  correct: boolean
  response: string
}

export interface AdventureQuest {
  id: string
  npcId: string
  roomId: string
  title: string
  request: string
  searchPrompt: string
  success: string
  objects: QuestObject[]
}

export type CuratedAdventure = 'pumpkin' | 'moon' | 'cloud'

const PUMPKIN_QUESTS: AdventureQuest[] = [
  {
    id: 'cow_hay_fork',
    npcId: 'cow',
    roomId: 'barn',
    title: 'The missing hay fork',
    request: 'Moo! I did see Mama, but first could you help me? Find the blue tool with three prongs. It is perfect for lifting hay.',
    searchPrompt: 'Look around the barn for the blue tool with three prongs.',
    success: 'Moo-velous! That is my hay fork. Come talk to me and I will tell you what I noticed about Mama.',
    objects: [
      { id: 'satchel', label: 'Leather satchel', emoji: '🎒', x: 220, y: 445, correct: false, response: 'That is my little tool satchel. Useful—but it has no prongs!' },
      { id: 'hay_fork', label: 'Blue hay fork', emoji: '✨', x: 515, y: 410, correct: true, response: 'You found the blue hay fork!' },
      { id: 'shovel', label: 'Blue shovel', emoji: '🧹', x: 580, y: 410, correct: false, response: 'That tool has one wide scoop. Look for three pointy prongs.' },
    ],
  },
  {
    id: 'goat_top_pie',
    npcId: 'goat',
    roomId: 'market',
    title: 'The pie on top',
    request: 'Baa-hello! I can help with Mama, but my special pie is hiding in plain sight. Find the pie sitting all by itself at the very top.',
    searchPrompt: 'Find the pie sitting alone at the very top of the bakery shelves.',
    success: 'Baa-rilliant! That is the special top-shelf pie. Come talk to me for the clue I promised.',
    objects: [
      { id: 'top_pie', label: 'Top-shelf pie', emoji: '🥧', x: 300, y: 170, correct: true, response: 'That pie is sitting all alone at the very top!' },
      { id: 'middle_pies', label: 'Middle-shelf pies', emoji: '🥧', x: 384, y: 292, correct: false, response: 'Those pies have neighbors. The special pie is sitting all alone.' },
      { id: 'wooden_tubs', label: 'Wooden pie tubs', emoji: '🪵', x: 205, y: 520, correct: false, response: 'Those are wooden tubs. Look higher—much higher!' },
    ],
  },
  {
    id: 'duck_rolling_apple',
    npcId: 'duck',
    roomId: 'orchard',
    title: 'The runaway apple',
    request: 'Quack! Mama hurried past here, but one apple rolled away while I waved. Can you find the apple sitting alone on the floor?',
    searchPrompt: 'Find the single apple that rolled away from all the baskets and crates.',
    success: 'Quack-tastic! You rescued the runaway apple. Come back and I will share my Mama clue.',
    objects: [
      { id: 'apple_basket', label: 'Basket of apples', emoji: '🧺', x: 285, y: 420, correct: false, response: 'Those apples are safely together in their basket. One apple rolled away alone.' },
      { id: 'cider_mugs', label: 'Warm cider mugs', emoji: '☕', x: 455, y: 515, correct: false, response: 'Mmm, warm cider! But we are searching for one runaway apple.' },
      { id: 'runaway_apple', label: 'Runaway apple', emoji: '🍎', x: 575, y: 640, correct: true, response: 'There is the runaway apple, all by itself!' },
    ],
  },
]

const MOON_QUESTS: AdventureQuest[] = [
  {
    id: 'owl_folded_map',
    npcId: 'captain_owl',
    roomId: 'bridge',
    title: 'The captain’s tiny map',
    request: 'Hoo-hoo! Before I share what I saw, help me spot my tiny folded map. It has little green and gold patches on it.',
    searchPrompt: 'Find Captain Hoot’s tiny folded map with green and gold patches.',
    success: 'Hoo-ray! It was tucked safely on my coat. Come talk to me and I will share my Mama clue.',
    objects: [
      { id: 'star_screen', label: 'Star-map screen', emoji: '🛰️', x: 350, y: 520, correct: false, response: 'That is a glowing star-map screen. Look for a tiny folded paper map.' },
      { id: 'folded_map', label: 'Tiny folded map', emoji: '🗺️', x: 365, y: 760, correct: true, response: 'There it is—the tiny green-and-gold folded map!' },
      { id: 'captain_chair', label: 'Captain chair', emoji: '💺', x: 520, y: 620, correct: false, response: 'That is the swiveling captain chair. The map is much smaller.' },
    ],
  },
  {
    id: 'rabbit_high_tomato',
    npcId: 'robot_rabbit',
    roomId: 'greenhouse',
    title: 'The highest moon tomato',
    request: 'Boop-boop! My plant scanner needs one special tomato. Can you find the tomato sitting highest on the far-left shelf?',
    searchPrompt: 'Find the highest tomato on the far-left greenhouse shelf.',
    success: 'Boop-tastic! That is the high little moon tomato. Come talk to me for your Mama clue.',
    objects: [
      { id: 'high_tomato', label: 'Highest moon tomato', emoji: '🍅', x: 150, y: 345, correct: true, response: 'Correct! That tomato is highest on the far-left shelf.' },
      { id: 'left_tomatoes', label: 'Lower tomato cluster', emoji: '🍅', x: 165, y: 585, correct: false, response: 'Those tomatoes are on the left, but they are much lower.' },
      { id: 'right_tomatoes', label: 'Right tomato cluster', emoji: '🍅', x: 840, y: 570, correct: false, response: 'Those are bright and ripe, but they are on the right side.' },
    ],
  },
  {
    id: 'cat_blue_jar',
    npcId: 'chef_cat',
    roomId: 'cafe',
    title: 'The little blue jar',
    request: 'Meow! I can help with Mama, but first find my tiny blue sprinkle jar. It is hiding on the counter near the sticky buns.',
    searchPrompt: 'Find the tiny blue jar sitting on the café counter near the buns.',
    success: 'Purr-fect! Those moon sprinkles make every bun sparkle. Come talk to me and I will share the clue I promised.',
    objects: [
      { id: 'blue_bottles', label: 'Tall blue bottles', emoji: '🧴', x: 80, y: 480, correct: false, response: 'Those bottles are blue, but they are tall. Find one tiny jar.' },
      { id: 'sprinkle_jar', label: 'Tiny blue sprinkle jar', emoji: '🫙', x: 415, y: 435, correct: true, response: 'You found the tiny blue sprinkle jar beside the buns!' },
      { id: 'mira_bun', label: 'Sticky bun', emoji: '🍩', x: 710, y: 480, correct: false, response: 'That bun looks delicious, but we still need the tiny blue jar.' },
    ],
  },
]

export function curatedAdventure(game: Game): CuratedAdventure | null {
  const name = game.bible?.setting.name.toLowerCase() ?? ''
  if (name.includes('pumpkin')) return 'pumpkin'
  if (name.includes('moon station')) return 'moon'
  if (name.includes('cloud toy shop')) return 'cloud'
  return null
}

export function isCuratedAdventure(game: Game): boolean {
  return curatedAdventure(game) !== null
}

function questsForGame(game: Game): AdventureQuest[] {
  const adventure = curatedAdventure(game)
  if (adventure === 'pumpkin') return PUMPKIN_QUESTS
  if (adventure === 'moon') return MOON_QUESTS
  return []
}

export function questForNpc(game: Game, npcId: string): AdventureQuest | undefined {
  return questsForGame(game).find(quest => quest.npcId === npcId)
}

export function questForRoom(game: Game, roomId: string): AdventureQuest | undefined {
  return questsForGame(game).find(quest => quest.roomId === roomId)
}
