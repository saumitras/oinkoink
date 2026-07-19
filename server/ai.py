import asyncio
import base64
import hashlib
import io

import numpy as np
from PIL import Image
from openai import AsyncOpenAI

from server.config import (
    OPENAI_API_KEY, TEXT_MODEL, NPC_MODEL, OPENAI_IMAGE_MODEL,
    OPENAI_IMAGE_QUALITY, OPENAI_IMAGE_SIZE,
    TTS_MODEL, TRANSCRIBE_MODEL, MODERATION_MODEL,
)
from server.cache import cache_get_bytes, cache_set_bytes, cache_get_json, cache_set_json
from server.schema import GameBible, ScreenAnnotation, RoomAnnotation, NPCModelReply, NPC, SuggestedReply
from server.schema_utils import make_strict_schema

openai_client = AsyncOpenAI(api_key=OPENAI_API_KEY)

COZY_STYLE_BLOCK = (
    "STYLE: Cozy children's storybook watercolor illustration. Soft pastel palette, "
    "warm sunlight, thick clean outlines, chunky rounded shapes, flat colors with gentle texture. "
    "Cheerful and bright, absolutely nothing scary or dark. No text, no letters, no words in the image."
)

THEME_STYLE_BASE = (
    "STYLE: Polished hand-painted children's storybook illustration with clear silhouettes, "
    "coherent perspective, tactile texture, and a palette and lighting scheme that strongly match "
    "the requested world. Mystery and gentle spookiness are allowed when the theme calls for them, "
    "but no gore, injury, realistic horror, or threatening characters. No text, letters, or words."
)

NPC_VOICES = ["alloy", "echo", "fable"]
NARRATOR_VOICE = "nova"
PIGLET_VOICE = "shimmer"

DEFAULT_TTS_INSTRUCTIONS = (
    "Speak warmly and clearly at a relaxed conversational pace. "
    "Use natural intonation and avoid exaggerated baby talk."
)

PIGLET_TTS_INSTRUCTIONS = (
    "Perform as Piglet, a very young storybook pig with the voice and energy of a cheerful kindergarten-age child. "
    "Use a small, bright, slightly higher-pitched voice, a soft rounded tone, bouncy curious intonation, and an audible smile. "
    "Sound sweet, innocent, eager, and a tiny bit shy-brave, as if asking a trusted animal friend for help. "
    "Keep each line playful, intimate, and easy to understand. Do not sound like an adult, narrator, teacher, or announcer, "
    "and do not add words that are not in the script."
)

PUMPKIN_NPC_VOICE_PROFILES: dict[str, tuple[str, str]] = {
    "cow": (
        "cedar",
        "Speak as Mabel, a kind, slightly sleepy farm cow talking naturally to one small friend. "
        "Use a warm low register, relaxed conversational pacing, gentle humor, and an audible smile. "
        "Let thoughtful commas and ellipses breathe. Do not sound like a narrator, teacher, cartoon announcer, or baby-talk performer.",
    ),
    "goat": (
        "marin",
        "Speak as Tilly, a playful young farm goat who is genuinely pleased to see Piglet. "
        "Use lively but believable conversational rhythm, light curiosity, and small changes in pace. "
        "Keep the delivery intimate rather than theatrical. Do not use baby talk or an exaggerated cartoon voice.",
    ),
    "duck": (
        "coral",
        "Speak as Dottie, a bright, observant farm duck chatting with a friend. "
        "Use crisp natural phrasing, cheerful confidence, and a quick playful lift on the animal sound, then settle into ordinary conversation. "
        "Avoid sing-song narration, forced excitement, and baby talk.",
    ),
}

MOON_NPC_VOICE_PROFILES: dict[str, tuple[str, str]] = {
    "captain_owl": (
        "cedar",
        "Speak as Captain Hoot, a calm, wise space-station owl welcoming one small explorer. "
        "Use a warm low register, unhurried natural phrasing, dry gentle humor, and a reassuring smile. "
        "Give each Hoo a soft owl-like lift without turning it into a cartoon catchphrase. Do not sound like a narrator or announcer.",
    ),
    "robot_rabbit": (
        "marin",
        "Speak as Bun-Bit, a friendly young robot rabbit who is delighted to help Piglet. "
        "Use bright natural energy, precise but playful rhythm, and tiny cheerful lifts on Boop. "
        "Sound warm and companionable rather than mechanical, theatrical, or sing-song.",
    ),
    "chef_cat": (
        "coral",
        "Speak as Mira, a cozy, quick-witted space-cafe cat chatting with a small friend. "
        "Use warm conversational phrasing, lively curiosity, a gentle purr in the tone, and an audible smile. "
        "Let Meow feel playful, then settle into believable speech. Avoid forced excitement, narration, and baby talk.",
    ),
}

CLOUD_NPC_VOICE_PROFILES: dict[str, tuple[str, str]] = {
    "npc-parrot": (
        "coral",
        "Speak as Pippa, a bright, chatty toy-shop parrot talking naturally to one small friend. "
        "Use quick, crisp conversational phrasing, playful curiosity, and an audible smile. "
        "Give Squawk a light bird-like flourish, then settle into warm ordinary speech. "
        "Do not sound like a narrator, announcer, or exaggerated cartoon character, and do not use baby talk.",
    ),
    "npc-bunny": (
        "marin",
        "Speak as Bobo, a gentle young cloud-shop bunny talking softly with Piglet. "
        "Use a warm, slightly higher voice, calm bouncy cadence, shy curiosity, and small natural pauses. "
        "Let Sniff-sniff feel playful and subtle. Do not sound mechanical, theatrical, sing-song, or babyish.",
    ),
    "npc-bear": (
        "cedar",
        "Speak as Bruno, a patient, cozy toy-shop bear chatting with one small friend. "
        "Use a warm low register, unhurried natural phrasing, gentle humor, and a reassuring smile. "
        "Make Grr-hmm soft and thoughtful, never threatening. Do not sound like a narrator or announcer.",
    ),
}


def npc_voice(index: int) -> str:
    return NPC_VOICES[index % len(NPC_VOICES)]


def is_pumpkin_bible(bible: GameBible | None) -> bool:
    return bool(bible and {npc.id for npc in bible.npcs} == {"cow", "goat", "duck"})


def is_moon_bible(bible: GameBible | None) -> bool:
    return bool(bible and {npc.id for npc in bible.npcs} == {"captain_owl", "robot_rabbit", "chef_cat"})


def is_cloud_bible(bible: GameBible | None) -> bool:
    return bool(bible and {npc.id for npc in bible.npcs} == {"npc-parrot", "npc-bunny", "npc-bear"})


def npc_tts_profile(npc: NPC, bible: GameBible | None = None) -> tuple[str, str]:
    if is_pumpkin_bible(bible) and npc.id in PUMPKIN_NPC_VOICE_PROFILES:
        return PUMPKIN_NPC_VOICE_PROFILES[npc.id]
    if is_moon_bible(bible) and npc.id in MOON_NPC_VOICE_PROFILES:
        return MOON_NPC_VOICE_PROFILES[npc.id]
    if is_cloud_bible(bible) and npc.id in CLOUD_NPC_VOICE_PROFILES:
        return CLOUD_NPC_VOICE_PROFILES[npc.id]
    return npc.ttsVoice or "alloy", DEFAULT_TTS_INSTRUCTIONS


ANIMAL_SOUNDS = {
    "bat": "Eek",
    "cat": "Meow",
    "chicken": "Cluck",
    "cow": "Moo",
    "dinosaur": "Roar",
    "dog": "Woof",
    "duck": "Quack",
    "elephant": "Trumpet",
    "fox": "Yip",
    "frog": "Ribbit",
    "goat": "Baa",
    "horse": "Neigh",
    "mouse": "Squeak",
    "otter": "Chirp",
    "owl": "Hoo",
    "pig": "Oink",
    "rabbit": "Sniff-sniff",
    "seagull": "Kree",
    "sheep": "Baa",
}


def build_npc_opener(npc: NPC, bible: GameBible | None = None) -> NPCModelReply:
    """Build the first turn without an interaction-time model call."""
    profile = npc.conversation
    sound = (profile.animalSound or ANIMAL_SOUNDS.get(npc.species.casefold(), "Hello")).strip(" .!?-")
    greeting = npc.lines.greeting.strip()
    if greeting.casefold().startswith(sound.casefold()):
        reply = greeting
    elif greeting.casefold().startswith(("hello", "hiya", "hi ")):
        reply = f"{sound}-{greeting[0].lower()}{greeting[1:]}"
    else:
        reply = f"{sound}! {greeting}"

    topic = profile.favoriteTopic
    if topic == "the cozy world around them" and bible:
        building = next((building for building in bible.buildings if building.npcId == npc.id), None)
        topic = f"the {building.name}" if building else bible.setting.name
    choices = profile.openingChoices or [
        "Have you seen Mama?",
        f"Tell me about {topic}.",
        "What do you like to do here?",
    ]
    suggestions = []
    seen_suggestions: set[str] = set()
    for choice in choices[:3]:
        normalized = choice.casefold()
        intent = "ask_mama" if any(word in normalized for word in ("mama", "mother", "clue", "help")) else "small_talk"
        text = "Have you seen my Mama?" if intent == "ask_mama" else choice
        key = f"{intent}:{text.casefold()}"
        if key in seen_suggestions:
            continue
        seen_suggestions.add(key)
        suggestions.append(SuggestedReply(text=text, intent=intent))
    return NPCModelReply(
        reply=reply,
        suggestedReplies=suggestions,
        mood="cheerful",
        conversationComplete=False,
    )


def build_npc_mama_reply(npc: NPC, bible: GameBible) -> NPCModelReply:
    """Build the high-frequency Mama answer without an interaction-time model call."""
    hint = next((item for item in bible.hints if item.npcId == npc.id), None)
    if not hint:
        raise ValueError(f"Hint missing for NPC: {npc.id}")

    lead_in = npc.conversation.clueLeadIn.strip()
    if lead_in and lead_in[-1] not in ".!?…":
        lead_in += "."
    reply = f"{lead_in} {hint.text}".strip()
    topic = npc.conversation.favoriteTopic
    return NPCModelReply(
        reply=reply,
        suggestedReplies=[
            SuggestedReply(text=f"Tell me about {topic}.", intent="small_talk"),
            SuggestedReply(text="Thank you!", intent="goodbye"),
        ],
        mood="helpful",
        conversationComplete=False,
    )


async def _with_retry(fn, attempts: int = 2, backoff: float = 2.0):
    last: Exception | None = None
    for i in range(attempts):
        try:
            return await fn()
        except Exception as e:  # noqa: BLE001
            last = e
            if i + 1 < attempts:
                print(f"[ai] attempt {i + 1} failed ({e}), retrying in {backoff}s")
                await asyncio.sleep(backoff)
    raise last  # type: ignore[misc]


# ── Text generation ───────────────────────────────────────────────────────────

BIBLE_SYSTEM = """You are the game designer for "Oink Oink Lost", a cozy mystery game for children aged 5–8.
A baby pig named Piglet is gently lost and must find Mama Pig by collecting hints from three friendly animal neighbors.

Hard rules:
- Story tone: warm, gently funny, and ZERO peril. Mama is never in danger.
- Visual atmosphere should strongly follow the user's idea. Gothic, dark, mysterious,
  moonlit, or gently spooky visuals are allowed when thematically appropriate, but no
  gore, injuries, realistic horror, or threatening characters.
- Reading level: age 5–8. Dialogue lines are at most 2 short sentences.
- Give every NPC a conversation profile: a distinctive speechStyle, favoriteTopic,
  2-3 smallTalkFacts grounded in the setting, 3 short openingChoices, a clueLeadIn,
  and the natural written animalSound for its species (for example Baa, Moo, Quack, or Hoo).
- Exactly 3 neighbors, 3 hints, 3 enterable buildings, 2–4 flavor buildings.
  Each enterable building has exactly one NPC via npcId; flavor buildings have npcId null
  and isEnterable false. Never create an enterable room without an NPC.
  4 candidate locations for Mama (one of which is the true finalLocation).
- Every candidateLocation id MUST be the id of one of the buildings in the scene,
  and finalLocationBuildingId MUST equal finalLocationId (Mama is at a real building
  the player can walk to).
- Always produce visualDirection. Choose outdoor_hub for villages/farms/open worlds,
  interior_hub when the requested adventure is principally inside one place (castle,
  spaceship, mansion, museum), or mixed_hub only when both are essential.
- visualDirection must be concrete and theme-specific: architecture, 3-6 palette colors,
  lighting, atmosphere, walkableSurface, imageStyle, and explicit visual elements to avoid.
  For an interior hub, buildings represent distinct rooms, wings, alcoves, or doorways
  arranged around one connected central floor. Their exteriorDescription describes the
  entrance visible from that hub. Do not fall back to grass, sunshine, or a village unless
  the user's idea actually calls for those things.

Hint design — TRIANGULATION (follow this procedure exactly):
Step 1: For EVERY candidateLocation, fill clueFacts with three short clauses:
  attribute: sensory property; direction: where it is; object: an object/activity.
  Each clause must grammatically follow "Mama went somewhere ...", for example
  "that smells like warm apples", "beside the south gate", "with a shiny pie counter".
  Reuse the EXACT same clause string when two places share a property.
  Design the table so each final-location fact is shared by at least one other candidate,
  but only finalLocation has all three final facts.
Step 2: Each hint states ONE of those attributes of the place Mama went —
  the hint text always describes the finalLocation, never any other place. There must be
  exactly one hint of each kind: attribute, direction, object.
  ("Mama went somewhere that smells of warm apples", "I saw her waddle toward
  the gates at the south fence", "She said something about a shiny pie counter")
Step 3: For each hint, eliminatesLocationIds = the candidate locations that do
  NOT have that attribute. Rules:
  - finalLocation must NEVER appear in any eliminatesLocationIds (its attributes are all true).
  - Each hint must leave at least 2 candidates possible (eliminate at most 2).
  - Together the three hints must eliminate every candidate except finalLocation.
Step 4: In the verification field, check each of the 4 candidates against each
  hint and confirm exactly one location — the finalLocation — survives all three.
  If more than one survives, redesign the hints before answering.

The player wins by asking: "which place has ALL THREE things?" — make sure
that question has exactly one answer. Never use another language unless the user's
world idea is written in that language."""


async def generate_bible(idea: str, correction: str = "", cozy_visuals: bool = False) -> GameBible:
    # Cache key includes the system prompt so prompt iterations invalidate stale bibles
    visual_mode = (
        "VISUAL MODE OVERRIDE: Use soft pastels, warm sunlight, cheerful bright colors, and nothing dark or scary."
        if cozy_visuals
        else "VISUAL MODE: Match the visual mood of the user's idea; do not automatically make it sunny, pastel, green, or outdoors."
    )
    instructions = f"{BIBLE_SYSTEM}\n\n{visual_mode}"
    sys_hash = hashlib.sha256(instructions.encode()).hexdigest()[:8]
    payload = f"{sys_hash}|{idea}|{correction}|cozy:{cozy_visuals}"
    cached = cache_get_json("bible", payload)
    if cached:
        return GameBible.model_validate(cached)

    user_msg = f'World idea: "{idea}". Design the game bible.'
    if correction:
        user_msg += f"\n\nCorrection needed: {correction}"

    async def call():
        return await openai_client.responses.parse(
            model=TEXT_MODEL,
            instructions=instructions,
            input=user_msg,
            text={"format": {"type": "json_schema", "name": "game_bible", "schema": make_strict_schema(GameBible.model_json_schema()), "strict": True}},
        )

    response = await _with_retry(call)
    bible = GameBible.model_validate_json(response.output_text)
    cache_set_json("bible", payload, bible.model_dump())
    return bible


async def generate_npc_reply(
    bible: GameBible,
    npc_id: str,
    player_message: str,
    history: list[dict[str, str]],
    must_reveal_hint: bool,
    hint_already_collected: bool,
) -> NPCModelReply:
    """Generate characterful dialogue while the server owns clue progression."""
    npc = next((n for n in bible.npcs if n.id == npc_id), None)
    building = next((b for b in bible.buildings if b.npcId == npc_id), None)
    hint = next((h for h in bible.hints if h.npcId == npc_id), None)
    if not npc or not building or not hint:
        raise ValueError(f"NPC conversation data missing: {npc_id}")

    profile = npc.conversation
    recent_history = "\n".join(
        f"{turn.get('role', 'player')}: {turn.get('text', '')}" for turn in history[-8:]
    ) or "No earlier turns."
    small_talk = "; ".join(profile.smallTalkFacts) or bible.setting.description

    clue_rule = (
        f'You MUST naturally include this exact clue sentence verbatim in reply: "{hint.text}"'
        if must_reveal_hint
        else (
            "The player already knows the clue. You may discuss it if asked, but do not pretend it is new."
            if hint_already_collected
            else f'Do NOT reveal or paraphrase this clue yet: "{hint.text}"'
        )
    )

    instructions = f"""You are {npc.name}, a {npc.species} in the cozy game Oink Oink Lost.
Stay completely in character and speak directly to Piglet.

Character:
- Personality: {npc.personality}
- Speech style: {profile.speechStyle}
- Favorite topic: {profile.favoriteTopic}
- Room: {building.name} — {building.interiorDescription or building.exteriorDescription}
- Setting: {bible.setting.name} — {bible.setting.description}
- Small-talk facts you may use: {small_talk}

Conversation rules:
- Reply in 1-2 short sentences, at most 34 words total.
- Be warm, specific, playful, and conversational. Ask at most one question.
- Write for speech, not for a page: use contractions, everyday wording, and punctuation that creates a natural cadence.
- Vary sentence length. A small hesitation such as “Hmm…” is welcome when it fits, but never repeat a stock opener every turn.
- Avoid formal phrases such as “I am sure,” “I did notice,” and “perhaps you should.”
- Never invent another clue, Mama sighting, location fact, or game objective.
- {clue_rule}
- Return 2-3 very short suggested replies. Include an ask_mama option whenever the clue is not yet known.
- Use goodbye intent only for a natural conversation-ending choice.
"""

    user_input = (
        f"Recent conversation:\n{recent_history}\n\nPiglet says: {player_message}"
        if player_message
        else f"Recent conversation:\n{recent_history}\n\nPiglet has just approached. Give a welcoming opening line."
    )

    async def call():
        return await openai_client.responses.parse(
            model=NPC_MODEL,
            instructions=instructions,
            input=user_input,
            store=False,
            text={"format": {
                "type": "json_schema",
                "name": "npc_conversation_turn",
                "schema": make_strict_schema(NPCModelReply.model_json_schema()),
                "strict": True,
            }},
        )

    response = await _with_retry(call)
    result = NPCModelReply.model_validate_json(response.output_text)

    unique_suggestions: list[SuggestedReply] = []
    seen_suggestions: set[str] = set()
    for suggestion in result.suggestedReplies:
        if suggestion.intent == "ask_mama":
            suggestion.text = "Have you seen my Mama?"
        key = f"{suggestion.intent}:{suggestion.text.casefold()}"
        if key in seen_suggestions:
            continue
        seen_suggestions.add(key)
        unique_suggestions.append(suggestion)
    result.suggestedReplies = unique_suggestions

    # The clue text is game state, not model state. Guarantee the player hears
    # the verified canonical sentence even if the model tried to paraphrase it.
    if must_reveal_hint and hint.text not in result.reply:
        result.reply = f"{result.reply.rstrip()} {profile.clueLeadIn} {hint.text}".strip()
    return result


async def extract_hotspots(bible: GameBible, street_b64: str, outline_b64: str, correction: str = "") -> ScreenAnnotation:
    room_list = "\n".join(
        f'- id "{b.id}" ({b.name}): {b.exteriorDescription}'
        for b in bible.buildings if b.isEnterable
    )
    landmark_list = "\n".join(
        f'- id "{b.id}" ({b.name}): {b.exteriorDescription}'
        for b in bible.buildings if not b.isEnterable
    )
    direction = bible.visualDirection
    walkable_surface = direction.walkableSurface if direction else "paths, floors, grass, or open ground"
    prompt = f"""You are annotating a top-down game map. Image 1 is the playable scene. Image 2 is the same scene with magenta outlines around objects and green dots on doors.
The image is 1024x1024 pixels. Coordinate system: x 0-1024 left→right, y 0-1024 top→bottom.

ENTERABLE SUB-ROOMS — locate the center of the actual doorway:
{room_list}

LOOK-ONLY LANDMARKS — locate the center of the described object or feature, not a nearby door:
{landmark_list}

Tasks:
1. WALKABILITY GRID: Divide the image into a 16x16 grid (each cell 64x64 px).
   For each cell output '1' if a small character can walk there ({walkable_surface})
   or '0' if blocked (walls, buildings, furniture, trees, crops, water, fences, large objects).
   Solid structures and large objects are ALWAYS '0'. Open floors, corridors, and routes are ALWAYS '1'.
   A correct scene has a healthy mix of both — typically 40-75% walkable.
   Output exactly 16 strings of 16 characters, top row first.
2. INTERACTION POINTS: Return one entry in doors for EVERY id above.
   - For an ENTERABLE SUB-ROOM, use the center of its real, visibly reachable door.
     Match the visual details carefully; never substitute a window, bookcase, wall, or unrelated door.
   - For a LOOK-ONLY LANDMARK, use the center of that landmark itself.
   The grid cell is col = x//64, row = y//64. Pick a point reachable from open floor/path.
3. SPAWN: One walkable cell on open path near the center of the map, not adjacent to a door.
Be precise. If a cell is partly path and partly object edge, or you are unsure, mark it '1'
(walkable) — blocking open ground feels like an invisible wall and is the worst failure."""
    if correction:
        prompt += f"\n\nIMPORTANT CORRECTION: {correction}"

    img_hash = hashlib.sha256(street_b64.encode()).hexdigest()[:16]
    cache_key = f"{img_hash}|{prompt}"
    cached = cache_get_json("hotspots", cache_key)
    if cached:
        return ScreenAnnotation.model_validate(cached)

    async def call():
        return await openai_client.responses.parse(
            model=TEXT_MODEL,
            input=[
                {"role": "user", "content": [
                    {"type": "input_text", "text": prompt},
                    {"type": "input_image", "image_url": f"data:image/png;base64,{street_b64}"},
                    {"type": "input_image", "image_url": f"data:image/png;base64,{outline_b64}"},
                ]}
            ],
            text={"format": {"type": "json_schema", "name": "screen_annotation", "schema": make_strict_schema(ScreenAnnotation.model_json_schema()), "strict": True}},
        )

    response = await _with_retry(call)
    annotation = ScreenAnnotation.model_validate_json(response.output_text)
    cache_set_json("hotspots", cache_key, annotation.model_dump())
    return annotation


async def extract_room_annotation(room_b64: str) -> RoomAnnotation:
    prompt = (
        "This is a game room interior, 1024x1024 pixels. Coordinates: x 0-1024 left→right, y 0-1024 top→bottom. "
        "Give: 1) The bounding box (x,y,w,h) of the animal character standing in the room. "
        "2) The exit door center (x,y) — usually at the bottom edge."
    )
    cache_key = hashlib.sha256(room_b64.encode()).hexdigest()[:16] + prompt
    cached = cache_get_json("room_annotation", cache_key)
    if cached:
        return RoomAnnotation.model_validate(cached)

    async def call():
        return await openai_client.responses.parse(
            model=TEXT_MODEL,
            input=[
                {"role": "user", "content": [
                    {"type": "input_text", "text": prompt},
                    {"type": "input_image", "image_url": f"data:image/png;base64,{room_b64}"},
                ]}
            ],
            text={"format": {"type": "json_schema", "name": "room_annotation", "schema": make_strict_schema(RoomAnnotation.model_json_schema()), "strict": True}},
        )

    response = await _with_retry(call)
    annotation = RoomAnnotation.model_validate_json(response.output_text)
    cache_set_json("room_annotation", cache_key, annotation.model_dump())
    return annotation


# ── Image generation ──────────────────────────────────────────────────────────

def _visual_style(bible: GameBible, cozy_visuals: bool = False) -> str:
    if cozy_visuals:
        return COZY_STYLE_BLOCK
    direction = bible.visualDirection
    if not direction:
        return THEME_STYLE_BASE
    avoid = ", ".join(direction.avoid) or "unrelated scenery and generic visual themes"
    return f"""{THEME_STYLE_BASE}
VISUAL DIRECTION:
- Architecture: {direction.architecture}
- Palette: {', '.join(direction.palette)}
- Lighting: {direction.lighting}
- Atmosphere: {direction.atmosphere}
- Medium: {direction.imageStyle}
- Avoid: {avoid}"""

def _extract_openai_image_bytes(response) -> bytes:
    if not response.data or not response.data[0].b64_json:
        raise RuntimeError("No image in OpenAI response")
    return base64.b64decode(response.data[0].b64_json)


async def _generate_image(prompt: str, reference_png: bytes | None = None) -> bytes:
    provider_config = f"openai:{OPENAI_IMAGE_MODEL}:{OPENAI_IMAGE_QUALITY}:{OPENAI_IMAGE_SIZE}"
    cache_key = f"{provider_config}|{prompt}" + (
        f"|ref:{hashlib.sha256(reference_png).hexdigest()[:16]}" if reference_png else ""
    )
    cached = cache_get_bytes("images", cache_key)
    if cached:
        return cached

    async def call() -> bytes:
        if reference_png is None:
            response = await openai_client.images.generate(
                model=OPENAI_IMAGE_MODEL,
                prompt=prompt,
                size=OPENAI_IMAGE_SIZE,
                quality=OPENAI_IMAGE_QUALITY,  # type: ignore[arg-type]
                output_format="png",
            )
        else:
            response = await openai_client.images.edit(
                model=OPENAI_IMAGE_MODEL,
                image=("reference.png", reference_png, "image/png"),
                prompt=prompt,
                size=OPENAI_IMAGE_SIZE,
                quality=OPENAI_IMAGE_QUALITY,  # type: ignore[arg-type]
                output_format="png",
            )
        return _extract_openai_image_bytes(response)

    data = await _with_retry(call)
    cache_set_bytes("images", cache_key, data)
    return data


async def generate_street_scene(bible: GameBible, cozy_visuals: bool = False) -> bytes:
    room_list = "\n".join(
        f"- {b.name}: {b.exteriorDescription} ({b.sizeHint})"
        for b in bible.buildings if b.isEnterable
    )
    landmark_list = "\n".join(
        f"- {b.name}: {b.exteriorDescription} ({b.sizeHint})"
        for b in bible.buildings if not b.isEnterable
    )
    direction = bible.visualDirection
    layout = direction.layout if direction else "outdoor_hub"
    surface = direction.walkableSurface if direction else "open paths and ground"
    if layout == "interior_hub":
        layout_instruction = (
            "A single connected INTERIOR hub viewed from directly overhead: a large central floor with "
            "exactly THREE large, distinct, visibly usable sub-room doors arranged around it. Each door must "
            "look unmistakably different and match one of the three ENTERABLE SUB-ROOM descriptions below. "
            "Do not merge a requested doorway into a window, bookcase, wall decoration, or painted backdrop. "
            "All three doors have open floor directly in front of them. The complete image is inside the "
            "structure. No outdoor terrain, lawn, village map, or exterior establishing shot."
        )
    elif layout == "mixed_hub":
        layout_instruction = (
            "A connected overhead hub combining a dominant interior floor with a small, clearly connected courtyard."
        )
    else:
        layout_instruction = "A connected outdoor overhead hub with landmarks arranged around open walkable routes."

    prompt = f"""{_visual_style(bible, cozy_visuals)}

Top-down (bird's-eye, directly overhead) playable view of {bible.setting.name}: {bible.setting.description}
LAYOUT: {layout_instruction}

ENTERABLE SUB-ROOMS — give each one a prominent, separate, reachable door:
{room_list}

LOOK-ONLY LANDMARKS — depict these as objects or architectural features, NOT as additional doors:
{landmark_list}

Every sub-room door faces the open floor/path so a character can reach it.
At least a third of the image is open, unobstructed walkable space made of {surface}.
Decorations: {', '.join(bible.setting.decorations)}.
No characters or animals. No text."""
    return await _generate_image(prompt)


async def generate_outline_pass(street_bytes: bytes) -> bytes:
    prompt = (
        "Trace this exact image. Keep every object exactly where it is. "
        "Draw a thick bright magenta (#FF00FF) CLOSED outline around every building, planted field, "
        "and large decoration — the outline must fully enclose each object including its base at the ground. "
        "Draw a thick bright green (#00FF00) small circle on each building's door/entrance. "
        "Change nothing else."
    )
    return await _generate_image(prompt, reference_png=street_bytes)


GREEN_SCREEN = (
    " The character stands alone, centered, on a COMPLETELY FLAT SOLID pure green (#00FF00) background. "
    "The entire background is one uniform green color. No shadow, no ground, no scenery, no checkered pattern."
)


def _chroma_key(png_bytes: bytes) -> bytes:
    """Remove the solid background and return a real-alpha PNG.

    The model rarely paints the exact green we ask for (it drifts to sage,
    olive, even checkerboards), so instead of matching a color we flood-fill
    from the borders with a tolerance: whatever is connected to the edge and
    roughly uniform is background.
    """
    from PIL import ImageDraw

    img = Image.open(io.BytesIO(png_bytes)).convert("RGB")
    w, h = img.size
    SENTINEL = (255, 0, 255)
    seeds = [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1),
             (w // 2, 0), (w // 2, h - 1), (0, h // 2), (w - 1, h // 2)]
    for seed in seeds:
        if img.getpixel(seed) != SENTINEL:
            ImageDraw.floodfill(img, seed, SENTINEL, thresh=60)

    arr = np.asarray(img, dtype=np.uint8)
    bg = (arr[..., 0] == 255) & (arr[..., 1] == 0) & (arr[..., 2] == 255)

    orig = Image.open(io.BytesIO(png_bytes)).convert("RGBA")
    a = np.asarray(orig, dtype=np.uint8).copy()
    a[..., 3] = np.where(bg, 0, a[..., 3])
    out = Image.fromarray(a, "RGBA")
    # Trim to content so the sprite has no huge transparent margins
    bbox = out.getchannel("A").getbbox()
    if bbox:
        out = out.crop(bbox)
    buf = io.BytesIO()
    out.save(buf, format="PNG")
    return buf.getvalue()


async def generate_character_sprites(bible: GameBible, cozy_visuals: bool = False) -> tuple[bytes, bytes]:
    base = (
        f"{_visual_style(bible, cozy_visuals)}\nCute baby pig character sprite for a children's game, {bible.player.description}, "
        f"wearing {bible.player.accessory}. Full body."
    )
    front_raw, side_raw = await asyncio.gather(
        _generate_image(base + " Facing the viewer, front view." + GREEN_SCREEN),
        _generate_image(base + " Side profile facing right, mid-waddle step." + GREEN_SCREEN),
    )
    return _chroma_key(front_raw), _chroma_key(side_raw)


async def generate_room_image(bible: GameBible, building_id: str, cozy_visuals: bool = False) -> bytes:
    building = next(b for b in bible.buildings if b.id == building_id)
    npc = next(n for n in bible.npcs if n.id == building.npcId)
    prompt = f"""{_visual_style(bible, cozy_visuals)}
Interior of {building.interiorDescription}, dollhouse front view. Single cozy room.
{npc.name} the {npc.species} ({npc.appearance}) stands on the {npc.roomPosition} side of the room,
full body visible, standing on the floor (lower half of the image).
The floor is open and uncluttered so a small character can walk around.
A door/exit is visible at the bottom edge. No text."""
    return await _generate_image(prompt)


async def generate_reunion_photo(bible: GameBible, cozy_visuals: bool = False) -> bytes:
    prompt = f"""{_visual_style(bible, cozy_visuals)}
Heartwarming reunion: baby pig (Piglet, {bible.player.description}) running joyfully toward Mama Pig at {bible.setting.name}.
Both pigs smiling, warm golden light. Cozy and sweet. No text."""
    return await _generate_image(prompt)


# ── TTS ───────────────────────────────────────────────────────────────────────

async def generate_tts(text: str, voice: str, instructions: str = DEFAULT_TTS_INSTRUCTIONS) -> bytes:
    cache_key = f"{voice}:{instructions}:{text}"
    cached = cache_get_bytes("tts", cache_key)
    if cached:
        return cached

    async def call():
        return await openai_client.audio.speech.create(
            model=TTS_MODEL,
            voice=voice,  # type: ignore
            input=text,
            instructions=instructions,
            response_format="mp3",
        )

    response = await _with_retry(call)
    data = response.read()
    cache_set_bytes("tts", cache_key, data)
    return data


async def transcribe_audio(audio: bytes, content_type: str = "audio/webm") -> str:
    extension = "mp4" if "mp4" in content_type else "webm"
    response = await openai_client.audio.transcriptions.create(
        model=TRANSCRIBE_MODEL,
        file=(f"piglet.{extension}", audio, content_type),
        prompt="A young player is speaking to a friendly animal in the game Oink Oink Lost. Mama means Mama Pig.",
    )
    return response.text.strip()


# ── Moderation ────────────────────────────────────────────────────────────────

async def moderate_idea(idea: str) -> bool:
    """Returns True if flagged."""
    response = await openai_client.moderations.create(model=MODERATION_MODEL, input=idea)
    return response.results[0].flagged
