import asyncio
import hashlib
import html
import json
import random
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal, Optional
from nanoid import generate as nanoid
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel
from server.config import ASSETS_DIR, PORT
from server.pipeline import run_pipeline, pick_random_idea, spawn_task
from server.gamestore import get_or_load_game, set_game, snapshot_game
from server.events import subscribe, unsubscribe, emit
from server.ai import (
    build_npc_opener, build_npc_mama_reply, moderate_idea, generate_reunion_photo,
    generate_npc_reply, generate_tts, npc_tts_profile, transcribe_audio,
    PIGLET_TTS_INSTRUCTIONS, PIGLET_VOICE,
)
from server.schema import NPCModelReply, PreloadedNPCReply, SuggestedReply
from server.storage import save_asset
from server.adventure_library import (
    is_library_ready, list_adventures, lookup_adventures, valid_game_id,
)

app = FastAPI()
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

ASSETS_DIR.mkdir(parents=True, exist_ok=True)

# Docker ships three curated adventures separately from the writable asset
# volume. Seed any missing templates before mounting the public asset route.
PRESET_ASSETS_DIR = Path(__file__).resolve().parent.parent / "preset-assets" / "games"
if PRESET_ASSETS_DIR.exists():
    for preset_dir in PRESET_ASSETS_DIR.iterdir():
        if preset_dir.is_dir():
            shutil.copytree(preset_dir, ASSETS_DIR / "games" / preset_dir.name, dirs_exist_ok=True)

app.mount("/assets", StaticFiles(directory=str(ASSETS_DIR)), name="assets")


class StartGameBody(BaseModel):
    idea: str = ""
    cozyVisuals: bool = False


class SolveBody(BaseModel):
    locationId: str


class NPCChatBody(BaseModel):
    sessionId: str
    message: str = ""
    source: Literal["start", "suggestion", "typed"] = "typed"
    intent: Optional[Literal["ask_mama", "small_talk", "goodbye"]] = None
    hintAlreadyCollected: bool = False


class PigletSpeechBody(BaseModel):
    text: str


class AdventureLookupBody(BaseModel):
    ids: list[str] = []


# Short-lived dev-mode memory. A session is stable while the current adventure
# remains mounted, including when the player leaves and revisits an NPC.
_npc_sessions: dict[str, dict] = {}

PRESET_WORLDS = {
    "pumpkin-farm": {
        "templateId": "76VwFrCWC21dOuUiBJWhA",
        "title": "Pumpkin Farm",
        "subtitle": "Autumn paths, cider, and cozy barns",
        "emoji": "🎃",
    },
    "moon-station": {
        "templateId": "Kgo4d31zD9kv1nANmRLep",
        "title": "Moon Station",
        "subtitle": "Moon views, space gardens, and cosmic clues",
        "emoji": "🚀",
    },
    "toy-shop-clouds": {
        "templateId": "cjfwNIfLt411ZZKDOC0Qo",
        "title": "Cloud Toy Shop",
        "subtitle": "Floating toys, rainbow bridges, and sky-high clues",
        "emoji": "☁️",
    },
}


CURATED_CLUE_OPENERS = {
    "pumpkin-farm": {"cow": "Moo… ", "goat": "Baa—", "duck": "Quack! "},
    "moon-station": {"captain_owl": "Hoo… ", "robot_rabbit": "Boop! ", "chef_cat": "Meow! "},
    "toy-shop-clouds": {"npc-parrot": "Squawk! ", "npc-bunny": "Sniff-sniff! ", "npc-bear": "Grr-hmm… "},
}


def mama_reply_variant_key(npc_id: str, eliminated_id: str) -> str:
    return f"{npc_id}:{eliminated_id}"


def ensure_preloaded_mama_replies(game) -> None:
    """Backfill old library games without contacting the dialogue model."""
    if not game.bible:
        return
    for npc in game.bible.npcs:
        if npc.id in game.assets.npcMamaReplies:
            continue
        turn = build_npc_mama_reply(npc, game.bible)
        game.assets.npcMamaReplies[npc.id] = PreloadedNPCReply(
            **turn.model_dump(),
            audioUrl=None,
        )


def apply_curated_mystery_variant(game, slug: str) -> None:
    """Reuse curated art with a different truthful Mama location each play."""
    if not game.bible:
        return
    candidates = game.bible.candidateLocations
    if len(candidates) < 4:
        return

    final = random.choice(candidates)
    game.bible.finalLocationId = final.id
    game.bible.finalLocationBuildingId = final.id
    alternatives = [candidate for candidate in candidates if candidate.id != final.id]
    clue_openers = CURATED_CLUE_OPENERS.get(slug, {})
    random.shuffle(alternatives)
    for hint, eliminated in zip(game.bible.hints, alternatives):
        opener = clue_openers.get(hint.npcId, "Hmm… ")
        hint.text = f"{opener}Mama didn't stop at {eliminated.name}. I'm sure of that."
        hint.eliminatesLocationIds = [eliminated.id]
        # Use the pre-generated performance that matches this playthrough's
        # randomized clue. Older presets without variants still fall back to
        # deterministic text and can be upgraded without breaking playability.
        game.assets.audio.pop(f"npc_{hint.npcId}.hint", None)
        game.assets.npcMamaReplies.pop(hint.npcId, None)
        turn = build_npc_mama_reply(
            next(npc for npc in game.bible.npcs if npc.id == hint.npcId),
            game.bible,
        )
        variant = game.assets.npcMamaReplyVariants.get(
            mama_reply_variant_key(hint.npcId, eliminated.id)
        )
        if variant and variant.reply == turn.reply:
            game.assets.npcMamaReplies[hint.npcId] = variant
            if variant.audioUrl:
                game.assets.audio[f"npc_{hint.npcId}.hint"] = variant.audioUrl
    game.bible.verification = (
        f"This playthrough eliminates {', '.join(candidate.name for candidate in alternatives)}, "
        f"leaving only {final.name}."
    )
    ensure_preloaded_mama_replies(game)


@app.post("/api/game", status_code=201)
async def start_game(body: StartGameBody):
    idea = body.idea.strip() or pick_random_idea()

    flagged = await moderate_idea(idea)
    if flagged:
        raise HTTPException(status_code=403, detail={
            "error": "idea_flagged",
            "suggestions": ["a pumpkin farm in autumn", "a cozy space station on the moon"],
        })

    game = await run_pipeline(idea, cozy_visuals=body.cozyVisuals)
    return {"gameId": game.id}


@app.get("/api/presets")
async def list_presets():
    presets = []
    for slug, meta in PRESET_WORLDS.items():
        template = get_or_load_game(meta["templateId"])
        if not template or not template.assets.streetUrl:
            continue
        presets.append({
            "slug": slug,
            "title": meta["title"],
            "subtitle": meta["subtitle"],
            "emoji": meta["emoji"],
            "previewUrl": template.assets.streetUrl,
        })
    return presets


@app.get("/api/adventures")
async def browse_adventures(query: str = "", offset: int = 0, limit: int = 20):
    return list_adventures(
        query=query,
        offset=max(0, offset),
        limit=min(20, max(1, limit)),
    )


@app.post("/api/adventures/lookup")
async def adventure_history(body: AdventureLookupBody):
    return {"items": lookup_adventures(body.ids[:40])}


@app.post("/api/adventures/{adventure_id}/play", status_code=201)
async def play_library_adventure(adventure_id: str):
    if not valid_game_id(adventure_id):
        raise HTTPException(status_code=404, detail="adventure_not_found")
    template = get_or_load_game(adventure_id)
    if not template or not is_library_ready(template):
        raise HTTPException(status_code=404, detail="adventure_not_found")

    game = template.model_copy(deep=True)
    game.id = nanoid()
    game.createdAt = datetime.now(timezone.utc).isoformat()
    game.fromWarmPool = True
    game.librarySourceId = template.librarySourceId or template.id

    preset_slug = next((
        slug for slug, meta in PRESET_WORLDS.items()
        if meta["templateId"] == game.librarySourceId
    ), None)
    if preset_slug in CURATED_CLUE_OPENERS:
        apply_curated_mystery_variant(game, preset_slug)
    ensure_preloaded_mama_replies(game)

    set_game(game)
    snapshot_game(game)
    return {"gameId": game.id, "sourceAdventureId": game.librarySourceId}


@app.post("/api/presets/{slug}", status_code=201)
async def start_preset(slug: str):
    meta = PRESET_WORLDS.get(slug)
    if not meta:
        raise HTTPException(status_code=404, detail="preset_not_found")
    template = get_or_load_game(meta["templateId"])
    if not template or template.status != "playable":
        raise HTTPException(status_code=503, detail="preset_unavailable")

    # Clone only lightweight game state. Asset URLs continue pointing at the
    # immutable pre-generated template files, so starting costs no AI calls.
    game = template.model_copy(deep=True)
    game.id = nanoid()
    game.createdAt = datetime.now(timezone.utc).isoformat()
    game.fromWarmPool = True
    game.librarySourceId = meta["templateId"]
    if slug in CURATED_CLUE_OPENERS:
        apply_curated_mystery_variant(game, slug)
    ensure_preloaded_mama_replies(game)
    for npc in game.bible.npcs:  # type: ignore[union-attr]
        if npc.id not in game.assets.npcOpeners:
            opener = build_npc_opener(npc, game.bible)
            game.assets.npcOpeners[npc.id] = PreloadedNPCReply(
                **opener.model_dump(),
                audioUrl=None,
            )
    set_game(game)
    snapshot_game(game)
    return {"gameId": game.id, "preset": slug, "sourceAdventureId": meta["templateId"]}


@app.get("/api/game/{game_id}/events")
async def game_events(game_id: str):
    game = get_or_load_game(game_id)
    if not game:
        raise HTTPException(status_code=404)

    async def stream():
        # Subscribe BEFORE replaying so no events are lost in between
        q = subscribe(game_id)

        # Replay current state for (re)connects
        for stage, status in game.stages.items():
            if status in ("done", "failed"):
                meta = {}
                if stage == "street" and game.assets.streetUrl:
                    meta = {"meta": {"url": game.assets.streetUrl}}
                elif stage == "character" and game.assets.characterFrontUrl:
                    meta = {"meta": {"url": game.assets.characterFrontUrl}}
                elif stage == "bible" and game.bible:
                    meta = {"meta": {"title": game.bible.title}}
                yield f"event: stage\ndata: {json.dumps({'type':'stage','stage':stage,'status':status, **meta})}\n\n"
        if game.status == "playable":
            yield f"event: playable\ndata: {json.dumps({'type':'playable'})}\n\n"
        if game.status == "failed":
            yield f"event: failed\ndata: {json.dumps({'type':'failed','message':'Generation failed'})}\n\n"
            unsubscribe(game_id, q)
            return
        if game.status == "playable" and all(s in ("done", "failed") for s in game.stages.values()):
            yield f"event: done\ndata: {json.dumps({'type':'done'})}\n\n"
            unsubscribe(game_id, q)
            return

        try:
            while True:
                try:
                    event = await asyncio.wait_for(q.get(), timeout=30)
                    yield f"event: {event['type']}\ndata: {json.dumps(event)}\n\n"
                    if event["type"] in ("done", "failed"):
                        break
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        finally:
            unsubscribe(game_id, q)

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.get("/api/game/{game_id}")
async def get_game(game_id: str):
    game = get_or_load_game(game_id)
    if not game:
        raise HTTPException(status_code=404)
    return game.model_dump()


@app.get("/share/{game_id}", response_class=HTMLResponse)
async def share_adventure_card(game_id: str, request: Request):
    """WhatsApp-readable postcard metadata, followed by a playable redirect."""
    if not valid_game_id(game_id):
        raise HTTPException(status_code=404)
    game = get_or_load_game(game_id)
    if not game or not game.bible:
        raise HTTPException(status_code=404)

    forwarded_proto = request.headers.get("x-forwarded-proto", request.url.scheme).split(",", 1)[0]
    origin = f"{forwarded_proto}://{request.headers.get('host', request.url.netloc)}"
    source_id = game.librarySourceId if game.librarySourceId and valid_game_id(game.librarySourceId) else game.id
    play_url = f"{origin}/?adventure={source_id}"
    image_path = game.assets.reunionPhotoUrl or game.assets.streetUrl
    image_url = f"{origin}{image_path}" if image_path and image_path.startswith("/") else image_path
    title = html.escape(f"You found Mama! · {game.bible.title}", quote=True)
    description = html.escape(
        f"Play the {game.bible.setting.name} adventure and help Piglet find Mama.",
        quote=True,
    )
    safe_play_url = html.escape(play_url, quote=True)
    safe_image_url = html.escape(image_url or "", quote=True)
    page = f"""<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title}</title>
<meta name="description" content="{description}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Oink Oink Lost">
<meta property="og:title" content="{title}">
<meta property="og:description" content="{description}">
<meta property="og:url" content="{html.escape(f'{origin}{request.url.path}', quote=True)}">
<meta property="og:image" content="{safe_image_url}">
<meta property="og:image:alt" content="Piglet reunited with Mama Pig">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:image" content="{safe_image_url}">
<meta http-equiv="refresh" content="0;url={safe_play_url}">
</head><body><p>Opening <a href="{safe_play_url}">{title}</a>…</p>
<script>window.location.replace({json.dumps(play_url)})</script></body></html>"""
    return HTMLResponse(page, headers={"Cache-Control": "no-cache"})


@app.post("/api/transcribe")
async def transcribe(request: Request):
    audio = await request.body()
    if not audio:
        raise HTTPException(status_code=400, detail="empty_audio")
    content_type = request.headers.get("content-type", "audio/webm").split(";", 1)[0]
    try:
        text = await transcribe_audio(audio, content_type)
    except Exception as exc:
        print(f"[transcribe] {exc}")
        raise HTTPException(status_code=502, detail="transcription_failed") from exc
    return {"text": text}


@app.post("/api/game/{game_id}/piglet/speech")
async def piglet_speech(game_id: str, body: PigletSpeechBody):
    game = get_or_load_game(game_id)
    if not game:
        raise HTTPException(status_code=404)

    text = body.text.strip()
    if not text:
        raise HTTPException(status_code=400, detail="empty_text")
    if len(text) > 300:
        raise HTTPException(status_code=400, detail="text_too_long")

    digest = hashlib.sha256(
        f"{PIGLET_VOICE}:{PIGLET_TTS_INSTRUCTIONS}:{text}".encode()
    ).hexdigest()[:16]
    asset_key = f"shared-audio/piglet_{digest}.mp3"
    asset_path = ASSETS_DIR / asset_key
    if not asset_path.exists():
        try:
            audio = await generate_tts(text, PIGLET_VOICE, PIGLET_TTS_INSTRUCTIONS)
            save_asset(asset_key, audio)
        except Exception as exc:
            print(f"[piglet-tts:{game_id}] {exc}")
            raise HTTPException(status_code=502, detail="speech_generation_failed") from exc

    return {"audioUrl": f"/assets/{asset_key}"}


@app.post("/api/game/{game_id}/npcs/{npc_id}/chat")
async def npc_chat(game_id: str, npc_id: str, body: NPCChatBody):
    game = get_or_load_game(game_id)
    if not game or not game.bible:
        raise HTTPException(status_code=404)

    npc = next((n for n in game.bible.npcs if n.id == npc_id), None)
    hint = next((h for h in game.bible.hints if h.npcId == npc_id), None)
    if not npc or not hint:
        raise HTTPException(status_code=404, detail="npc_not_found")

    session_key = f"{game_id}:{npc_id}:{body.sessionId}"
    state = _npc_sessions.setdefault(session_key, {
        "history": [],
        "userTurns": 0,
        "clueGranted": body.hintAlreadyCollected,
    })
    if body.hintAlreadyCollected:
        state["clueGranted"] = True

    message = body.message.strip()
    preloaded = game.assets.npcOpeners.get(npc_id)
    preloaded_mama = game.assets.npcMamaReplies.get(npc_id)
    if body.source != "start" and not state["history"] and preloaded:
        # The client can render a shipped opener immediately without making a
        # setup request. Seed it here when the player's first real turn arrives.
        state["history"].append({"role": npc.name, "text": preloaded.reply})
    if body.source != "start" and message:
        state["userTurns"] += 1
        state["history"].append({"role": "Piglet", "text": message})

    asks_for_mama = body.intent == "ask_mama" or any(
        phrase in message.lower()
        for phrase in ("mama", "mother", "help me", "help find", "seen her", "clue")
    )
    should_grant = (
        not state["clueGranted"]
        and not body.hintAlreadyCollected
        and (asks_for_mama or state["userTurns"] >= 2)
    )

    use_preloaded = body.source == "start" and not state["history"] and preloaded is not None
    use_preloaded_mama = should_grant and asks_for_mama and preloaded_mama is not None
    if use_preloaded:
        turn = NPCModelReply.model_validate(preloaded.model_dump(exclude={"audioUrl"}))
    elif use_preloaded_mama:
        turn = NPCModelReply.model_validate(preloaded_mama.model_dump(exclude={"audioUrl"}))
    else:
        try:
            turn = await generate_npc_reply(
                game.bible,
                npc_id,
                message,
                state["history"],
                must_reveal_hint=should_grant,
                hint_already_collected=bool(state["clueGranted"]),
            )
        except Exception as e:
            # Keep the prototype playable while prompts/models are being iterated.
            print(f"[npc-chat:{game_id}:{npc_id}] {e}")
            if should_grant:
                reply = f"{npc.conversation.clueLeadIn} {hint.text}"
            elif body.source == "start":
                reply = build_npc_opener(npc, game.bible).reply
            else:
                reply = npc.lines.idle
            turn = NPCModelReply(
                reply=reply,
                suggestedReplies=[
                    SuggestedReply(text="Have you seen my Mama?", intent="ask_mama"),
                    SuggestedReply(text=f"Tell me about {npc.conversation.favoriteTopic}.", intent="small_talk"),
                    SuggestedReply(text="See you soon!", intent="goodbye"),
                ],
                mood="helpful" if should_grant else "cheerful",
                conversationComplete=False,
            )

    if should_grant:
        state["clueGranted"] = True
    state["history"].append({"role": npc.name, "text": turn.reply})
    state["history"] = state["history"][-10:]

    audio_url = (
        preloaded.audioUrl if use_preloaded and preloaded
        else preloaded_mama.audioUrl if use_preloaded_mama and preloaded_mama
        else None
    )
    if not use_preloaded and not use_preloaded_mama:
        try:
            voice, instructions = npc_tts_profile(npc, game.bible)
            audio = await generate_tts(turn.reply, voice, instructions)
            digest = hashlib.sha256(f"{npc_id}:{voice}:{instructions}:{turn.reply}".encode()).hexdigest()[:16]
            audio_url = save_asset(f"games/{game.id}/audio/chat_{digest}.mp3", audio)
            if should_grant:
                # Keep the exact generated clue performance available to the
                # clue panel instead of falling back to the browser's voice.
                game.assets.audio[f"npc_{npc_id}.hint"] = audio_url
                set_game(game)
                snapshot_game(game)
        except Exception as e:
            print(f"[npc-chat-tts:{game_id}:{npc_id}] {e}")

    return {
        **turn.model_dump(),
        "sessionId": body.sessionId,
        "audioUrl": audio_url,
        "clueGranted": should_grant,
        "hintId": hint.id if should_grant else None,
    }


@app.post("/api/game/{game_id}/solve")
async def solve(game_id: str, body: SolveBody):
    game = get_or_load_game(game_id)
    if not game or not game.bible:
        raise HTTPException(status_code=404)

    correct = body.locationId == game.bible.finalLocationId

    if correct and not game.assets.reunionPhotoUrl:
        async def gen_reunion():
            try:
                data = await generate_reunion_photo(game.bible, game.cozyVisuals)  # type: ignore
                url = save_asset(f"games/{game.id}/reunion.png", data)
                game.assets.reunionPhotoUrl = url
                set_game(game)
                snapshot_game(game)
            except Exception as e:
                print(f"[reunion:{game.id}] {e}")
        spawn_task(gen_reunion())

    if not correct:
        chosen = next((l for l in game.bible.candidateLocations if l.id == body.locationId), None)
        hint = next((h for h in game.bible.hints if body.locationId in h.eliminatesLocationIds), None)
        nudge = (
            f'Hmm, remember: "{hint.text}" — does that fit {chosen.name if chosen else "that place"}?'
            if hint else "Hmm, think about all three hints together!"
        )
        return {"correct": False, "nudge": nudge}

    return {"correct": True}


@app.get("/healthz")
async def healthz():
    return "ok"


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("server.main:app", host="0.0.0.0", port=PORT, reload=True)
