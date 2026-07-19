import asyncio
import base64
import hashlib
from datetime import datetime, timezone
from nanoid import generate as nanoid
from server.schema import Game, GameAssets, RoomAssets, RoomAnnotation, PreloadedNPCReply
from server.gamestore import get_or_load_game, set_game, snapshot_game
from server.events import emit
from server.storage import save_asset
from server.postprocess import (
    post_process_annotation, repair_bible,
    repair_hint_elimination, derive_hint_logic, is_degenerate,
)
from server.ai import (
    generate_bible, generate_street_scene, generate_outline_pass,
    extract_hotspots, generate_character_sprites, generate_room_image,
    extract_room_annotation, generate_tts,
    build_npc_opener, build_npc_mama_reply, npc_voice, npc_tts_profile,
    DEFAULT_TTS_INSTRUCTIONS, NARRATOR_VOICE,
)

CANNED_IDEAS = ["a pumpkin farm in autumn", "a cozy space station on the moon"]

# Keep references to fire-and-forget tasks so they aren't garbage-collected.
_bg_tasks: set[asyncio.Task] = set()


def spawn_task(coro) -> asyncio.Task:
    task = asyncio.create_task(coro)
    _bg_tasks.add(task)
    task.add_done_callback(_bg_tasks.discard)
    return task


def pick_random_idea() -> str:
    import random
    return random.choice(CANNED_IDEAS)


def _set_stage(game: Game, stage: str, status: str, meta: dict | None = None) -> None:
    game.stages[stage] = status  # type: ignore
    emit(game.id, {"type": "stage", "stage": stage, "status": status, **({"meta": meta} if meta else {})})
    set_game(game)


async def run_pipeline(idea: str, cozy_visuals: bool = False) -> Game:
    game = Game(
        id=nanoid(),
        idea=idea,
        createdAt=datetime.now(timezone.utc).isoformat(),
        status="generating",
        stages={s: "pending" for s in ["bible", "street", "outline", "hotspots", "character", "npc_openers", "tts"]},
        assets=GameAssets(),
        cozyVisuals=cozy_visuals,
    )
    set_game(game)
    spawn_task(_execute(game))
    return game


async def _execute(game: Game) -> None:
    try:
        # Stage 1: Bible
        _set_stage(game, "bible", "running")
        bible = await generate_bible(game.idea, cozy_visuals=game.cozyVisuals)
        if not derive_hint_logic(bible):
            print(f"[pipeline:{game.id}] bible triangulation invalid, retrying")
            bible = await generate_bible(
                game.idea,
                "Previous hint triangulation was invalid — the three hints together must eliminate every "
                "candidate location except finalLocationId, and must never eliminate finalLocationId. "
                "Redesign the hints and eliminatesLocationIds so exactly one location survives all three.",
                cozy_visuals=game.cozyVisuals,
            )
            if not derive_hint_logic(bible):
                print(f"[pipeline:{game.id}] triangulation still invalid after retry -> truthful fallback")
                bible = repair_hint_elimination(bible)
        bible = repair_bible(bible)
        game.bible = bible
        for i, npc in enumerate(bible.npcs):
            npc.ttsVoice = npc_voice(i)
        for b in [b for b in bible.buildings if b.isEnterable]:
            game.stages[f"room_{b.id}"] = "pending"
            game.assets.rooms[b.id] = RoomAssets()
        _set_stage(game, "bible", "done", {"title": bible.title})
        snapshot_game(game)

        # Stages 2-4 (critical path) + 5 (parallel)
        await asyncio.gather(
            _run_street_chain(game),
            _run_character(game),
            _run_npc_openers(game),
        )

        if game.assets.streetUrl and game.annotation and game.assets.characterFrontUrl:
            game.status = "playable"
            emit(game.id, {"type": "playable"})
            set_game(game)
            snapshot_game(game)

        # Background: rooms + TTS
        await asyncio.gather(
            _run_rooms(game),
            _run_tts(game),
            return_exceptions=True,
        )

        emit(game.id, {"type": "done"})
        set_game(game)
        snapshot_game(game)

    except Exception as e:
        print(f"[pipeline:{game.id}] fatal: {e}")
        game.status = "failed"
        emit(game.id, {"type": "failed", "message": str(e)})
        set_game(game)


async def _run_street_chain(game: Game) -> None:
    bible = game.bible
    assert bible

    _set_stage(game, "street", "running")
    street_bytes = await generate_street_scene(bible, game.cozyVisuals)
    url = save_asset(f"games/{game.id}/street.png", street_bytes)
    game.assets.streetUrl = url
    street_b64 = base64.b64encode(street_bytes).decode()
    _set_stage(game, "street", "done", {"url": url})

    _set_stage(game, "outline", "running")
    outline_bytes: bytes | None = None
    try:
        outline_bytes = await generate_outline_pass(street_bytes)
        outline_b64 = base64.b64encode(outline_bytes).decode()
        game.assets.outlineUrl = save_asset(f"games/{game.id}/outline.png", outline_bytes)
        _set_stage(game, "outline", "done")
    except Exception as e:
        print(f"[pipeline:{game.id}] outline failed, using street: {e}")
        outline_b64 = street_b64
        _set_stage(game, "outline", "failed")

    _set_stage(game, "hotspots", "running")
    raw = await extract_hotspots(bible, street_b64, outline_b64)
    # Model grid only matters when there's no outline to derive collision from
    if is_degenerate(raw.grid) and outline_bytes is None:
        print(f"[pipeline:{game.id}] degenerate grid from model, retrying with correction")
        raw = await extract_hotspots(
            bible, street_b64, outline_b64,
            correction="Your previous walkability grid was invalid — nearly every cell had the same value. "
                       "Look at the image carefully: buildings, planted fields, and large objects are '0'; "
                       "open paths and grass are '1'. The grid must contain a realistic mix of both.",
        )
    game.annotation = post_process_annotation(raw, outline_bytes)
    _set_stage(game, "hotspots", "done")
    snapshot_game(game)


async def _run_character(game: Game) -> None:
    bible = game.bible
    assert bible
    _set_stage(game, "character", "running")
    front, side = await generate_character_sprites(bible, game.cozyVisuals)
    game.assets.characterFrontUrl = save_asset(f"games/{game.id}/char_front.png", front)
    game.assets.characterSideUrl = save_asset(f"games/{game.id}/char_side.png", side)
    _set_stage(game, "character", "done", {"url": game.assets.characterFrontUrl})


async def _run_npc_openers(game: Game) -> None:
    """Prepare every first NPC turn before the world becomes playable."""
    bible = game.bible
    assert bible
    _set_stage(game, "npc_openers", "running")

    async def prepare(npc):
        turn = build_npc_opener(npc, bible)
        mama_turn = build_npc_mama_reply(npc, bible)
        voice, instructions = npc_tts_profile(npc, bible)

        async def prepare_audio(kind: str, text: str) -> str | None:
            try:
                data = await generate_tts(text, voice, instructions)
                digest = hashlib.sha256(f"{npc.id}:{voice}:{instructions}:{text}".encode()).hexdigest()[:16]
                return save_asset(f"games/{game.id}/audio/{kind}_{digest}.mp3", data)
            except Exception as e:
                print(f"[npc-{kind}-tts:{game.id}:{npc.id}] {e}")
                return None

        audio_url, mama_audio_url = await asyncio.gather(
            prepare_audio("opener", turn.reply),
            prepare_audio("mama", mama_turn.reply),
        )
        game.assets.npcOpeners[npc.id] = PreloadedNPCReply(
            **turn.model_dump(),
            audioUrl=audio_url,
        )
        game.assets.npcMamaReplies[npc.id] = PreloadedNPCReply(
            **mama_turn.model_dump(),
            audioUrl=mama_audio_url,
        )
        if mama_audio_url:
            game.assets.audio[f"npc_{npc.id}.hint"] = mama_audio_url
        set_game(game)

    await asyncio.gather(*[prepare(npc) for npc in bible.npcs])
    _set_stage(game, "npc_openers", "done")
    snapshot_game(game)


async def _run_rooms(game: Game) -> None:
    bible = game.bible
    assert bible
    enterable = [b for b in bible.buildings if b.isEnterable]

    async def do_room(building):
        key = f"room_{building.id}"
        _set_stage(game, key, "running")
        try:
            img = await generate_room_image(bible, building.id, game.cozyVisuals)
            url = save_asset(f"games/{game.id}/room_{building.id}.png", img)
            b64 = base64.b64encode(img).decode()
            try:
                ann = await extract_room_annotation(b64)
            except Exception:
                ann = RoomAnnotation(
                    npcBox={"x": 400, "y": 250, "w": 220, "h": 400},
                    exit={"x": 512, "y": 980},
                )
            game.assets.rooms[building.id] = RoomAssets(imageUrl=url, annotation=ann)
            _set_stage(game, key, "done", {"url": url})
        except Exception as e:
            print(f"[pipeline:{game.id}] room {building.id} failed: {e}")
            _set_stage(game, key, "failed")
        snapshot_game(game)

    await asyncio.gather(*[do_room(b) for b in enterable])


async def _run_tts(game: Game) -> None:
    bible = game.bible
    assert bible
    _set_stage(game, "tts", "running")

    lines = [
        ("narrator.intro", bible.narratorIntro, NARRATOR_VOICE),
        ("narrator.allHints", "You have all the hints! Where do you think Mama went?", NARRATOR_VOICE),
        ("narrator.reunion", bible.reunionLine, NARRATOR_VOICE),
    ]
    for i, npc in enumerate(bible.npcs):
        voice, instructions = npc_tts_profile(npc, bible)
        lines += [
            (f"npc_{npc.id}.hint", npc.lines.hint, voice, instructions),
            (f"npc_{npc.id}.idle", npc.lines.idle, voice, instructions),
        ]
    for building in bible.buildings:
        if not building.isEnterable:
            lines.append((
                f"building_{building.id}.look",
                f"{building.name}. {building.exteriorDescription} Mama is not here.",
                NARRATOR_VOICE,
                DEFAULT_TTS_INSTRUCTIONS,
            ))

    # Narrator entries use the shared natural direction; NPC entries carry a
    # character-specific performance direction.
    normalized_lines = [
        (*line, DEFAULT_TTS_INSTRUCTIONS) if len(line) == 3 else line
        for line in lines
    ]

    async def do_tts(key, text, voice, instructions):
        try:
            data = await generate_tts(text, voice, instructions)
            url = save_asset(f"games/{game.id}/audio/{key}.mp3", data)
            game.assets.audio[key] = url
            set_game(game)
        except Exception as e:
            print(f"[tts:{game.id}] {key} failed: {e}")

    await asyncio.gather(*[do_tts(k, t, v, instructions) for k, t, v, instructions in normalized_lines])
    _set_stage(game, "tts", "done")
    snapshot_game(game)


async def regenerate_hub(game_id: str) -> Game:
    """Regenerate only a world's hub and annotations, preserving completed rooms."""
    game = get_or_load_game(game_id)
    if not game or not game.bible:
        raise ValueError(f"Game not found: {game_id}")

    bible = repair_bible(game.bible)
    valid_room_ids = {building.id for building in bible.buildings if building.isEnterable}
    for room_id in list(game.assets.rooms):
        if room_id not in valid_room_ids:
            game.assets.rooms.pop(room_id, None)
            game.stages.pop(f"room_{room_id}", None)

    _set_stage(game, "street", "running")
    street_bytes = await generate_street_scene(bible, game.cozyVisuals)
    street_url = save_asset(f"games/{game.id}/street.png", street_bytes)
    version = int(datetime.now(timezone.utc).timestamp())
    game.assets.streetUrl = f"{street_url}?v={version}"
    street_b64 = base64.b64encode(street_bytes).decode()
    _set_stage(game, "street", "done", {"url": game.assets.streetUrl})

    _set_stage(game, "outline", "running")
    outline_bytes: bytes | None = None
    try:
        outline_bytes = await generate_outline_pass(street_bytes)
        outline_b64 = base64.b64encode(outline_bytes).decode()
        game.assets.outlineUrl = save_asset(f"games/{game.id}/outline.png", outline_bytes)
        _set_stage(game, "outline", "done")
    except Exception as e:
        print(f"[regenerate-hub:{game.id}] outline failed, using hub image: {e}")
        outline_b64 = street_b64
        _set_stage(game, "outline", "failed")

    _set_stage(game, "hotspots", "running")
    raw = await extract_hotspots(bible, street_b64, outline_b64)
    game.annotation = post_process_annotation(raw, outline_bytes)
    _set_stage(game, "hotspots", "done")
    set_game(game)
    snapshot_game(game)
    return game
