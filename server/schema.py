from __future__ import annotations
from typing import Literal, Optional
from pydantic import BaseModel, Field


class NPCConversation(BaseModel):
    speechStyle: str = "warm, playful, and concise"
    favoriteTopic: str = "the cozy world around them"
    smallTalkFacts: list[str] = []
    openingChoices: list[str] = []
    clueLeadIn: str = "I did notice something that may help."
    animalSound: str = ""


class NPC(BaseModel):
    id: str
    name: str
    species: str
    appearance: str
    personality: str
    roomPosition: Literal["left", "right", "center"]
    ttsVoice: Optional[str] = None
    lines: NPCLines
    conversation: NPCConversation = NPCConversation()


class NPCLines(BaseModel):
    greeting: str
    hint: str
    idle: str


NPC.model_rebuild()


class Building(BaseModel):
    id: str
    name: str
    exteriorDescription: str
    sizeHint: Literal["small", "medium", "large"]
    isEnterable: bool
    interiorDescription: Optional[str] = None
    npcId: Optional[str] = None


class Hint(BaseModel):
    id: str
    npcId: str
    kind: Literal["attribute", "direction", "object"]
    text: str
    eliminatesLocationIds: list[str]


class ClueFacts(BaseModel):
    # Each value is a clause that can follow "Mama went somewhere ...".
    # Identical strings mean two candidates share that property.
    attribute: str
    direction: str
    object: str


class CandidateLocation(BaseModel):
    id: str
    name: str
    emoji: str
    description: str
    clueFacts: Optional[ClueFacts] = None


class Setting(BaseModel):
    name: str
    description: str
    decorations: list[str]


class Player(BaseModel):
    description: str
    accessory: str


class VisualDirection(BaseModel):
    layout: Literal["outdoor_hub", "interior_hub", "mixed_hub"] = "outdoor_hub"
    architecture: str = "storybook village"
    palette: list[str] = Field(default=["warm earth tones", "soft greens"], min_length=2, max_length=6)
    lighting: str = "soft daylight"
    atmosphere: str = "welcoming and playful"
    walkableSurface: str = "open paths and grass"
    imageStyle: str = "hand-painted children's storybook illustration"
    avoid: list[str] = []


class GameBible(BaseModel):
    title: str
    setting: Setting
    player: Player
    narratorIntro: str
    buildings: list[Building] = Field(min_length=5, max_length=7)
    npcs: list[NPC] = Field(min_length=3, max_length=3)
    hints: list[Hint] = Field(min_length=3, max_length=3)
    candidateLocations: list[CandidateLocation] = Field(min_length=4, max_length=4)
    finalLocationId: str
    finalLocationBuildingId: str
    reunionLine: str
    verification: str
    visualDirection: Optional[VisualDirection] = None


class DoorCell(BaseModel):
    col: int
    row: int


class Door(BaseModel):
    buildingId: str
    x: float
    y: float
    cell: DoorCell


class Spawn(BaseModel):
    col: int
    row: int


class ScreenAnnotation(BaseModel):
    grid: list[str]  # 16 strings of 24 chars each
    doors: list[Door]
    spawn: Spawn


class NpcBox(BaseModel):
    x: float
    y: float
    w: float
    h: float


class ExitPoint(BaseModel):
    x: float
    y: float


class RoomAnnotation(BaseModel):
    npcBox: NpcBox
    exit: ExitPoint


class SuggestedReply(BaseModel):
    text: str
    intent: Literal["ask_mama", "small_talk", "goodbye"]


class NPCModelReply(BaseModel):
    reply: str
    suggestedReplies: list[SuggestedReply]
    mood: Literal["cheerful", "curious", "helpful", "thoughtful", "excited"]
    conversationComplete: bool


class PreloadedNPCReply(NPCModelReply):
    audioUrl: Optional[str] = None


class RoomAssets(BaseModel):
    imageUrl: Optional[str] = None
    annotation: Optional[RoomAnnotation] = None


class GameAssets(BaseModel):
    streetUrl: Optional[str] = None
    outlineUrl: Optional[str] = None
    characterFrontUrl: Optional[str] = None
    characterSideUrl: Optional[str] = None
    rooms: dict[str, RoomAssets] = {}
    audio: dict[str, str] = {}
    npcOpeners: dict[str, PreloadedNPCReply] = {}
    npcMamaReplies: dict[str, PreloadedNPCReply] = {}
    npcMamaReplyVariants: dict[str, PreloadedNPCReply] = {}
    reunionPhotoUrl: Optional[str] = None


StageStatus = Literal["pending", "running", "done", "failed"]


class Game(BaseModel):
    id: str
    idea: str
    createdAt: str
    status: Literal["generating", "playable", "failed"]
    stages: dict[str, StageStatus] = {}
    bible: Optional[GameBible] = None
    assets: GameAssets = GameAssets()
    annotation: Optional[ScreenAnnotation] = None
    fromWarmPool: bool = False
    cozyVisuals: bool = False
    librarySourceId: Optional[str] = None
