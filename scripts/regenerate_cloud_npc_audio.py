"""Regenerate Cloud Toy Shop NPC dialogue with distinct natural voices."""

from __future__ import annotations

import asyncio
import hashlib
import json
from pathlib import Path

from server.ai import build_npc_mama_reply, build_npc_opener, generate_tts, npc_tts_profile
from server.schema import Game, PreloadedNPCReply


ROOT = Path(__file__).resolve().parent.parent
TEMPLATE_ID = "cjfwNIfLt411ZZKDOC0Qo"
TEMPLATE_DIR = ROOT / "preset-assets" / "games" / TEMPLATE_ID
STATE_PATH = TEMPLATE_DIR / "state.json"
ANIMAL_SOUNDS = {
    "npc-parrot": "Squawk",
    "npc-bunny": "Sniff-sniff",
    "npc-bear": "Grr-hmm",
}
CLUE_OPENERS = {
    "npc-parrot": "Squawk! ",
    "npc-bunny": "Sniff-sniff! ",
    "npc-bear": "Grr-hmm… ",
}


async def save_performance(game: Game, npc_id: str, label: str, text: str) -> str:
    npc = next(npc for npc in game.bible.npcs if npc.id == npc_id)  # type: ignore[union-attr]
    voice, instructions = npc_tts_profile(npc, game.bible)
    audio = await generate_tts(text, voice, instructions)
    digest = hashlib.sha256(f"{npc_id}:{voice}:{instructions}:{text}".encode()).hexdigest()[:16]
    filename = f"{label}_{npc_id}_{digest}.mp3"
    (TEMPLATE_DIR / "audio" / filename).write_bytes(audio)
    return f"/assets/games/{TEMPLATE_ID}/audio/{filename}"


async def main() -> None:
    game = Game.model_validate(json.loads(STATE_PATH.read_text()))
    if not game.bible:
        raise RuntimeError("Cloud Toy Shop template has no game bible")

    game.assets.npcMamaReplyVariants = {}
    for npc in game.bible.npcs:
        npc.conversation.animalSound = ANIMAL_SOUNDS[npc.id]
        opener = build_npc_opener(npc, game.bible)
        opener_url = await save_performance(game, npc.id, "opener", opener.reply)
        game.assets.npcOpeners[npc.id] = PreloadedNPCReply(**opener.model_dump(), audioUrl=opener_url)
        game.assets.audio[f"npc_{npc.id}.greeting"] = opener_url

        for line_name in ("hint", "idle"):
            text = getattr(npc.lines, line_name)
            game.assets.audio[f"npc_{npc.id}.{line_name}"] = await save_performance(
                game, npc.id, line_name, text
            )

        hint = next(item for item in game.bible.hints if item.npcId == npc.id)
        original_text = hint.text
        original_eliminated = hint.eliminatesLocationIds
        for candidate in game.bible.candidateLocations:
            hint.text = (
                f"{CLUE_OPENERS[npc.id]}Mama didn't stop at {candidate.name}. "
                "I'm sure of that."
            )
            hint.eliminatesLocationIds = [candidate.id]
            reply = build_npc_mama_reply(npc, game.bible)
            audio_url = await save_performance(game, npc.id, f"mama_{candidate.id}", reply.reply)
            game.assets.npcMamaReplyVariants[f"{npc.id}:{candidate.id}"] = PreloadedNPCReply(
                **reply.model_dump(), audioUrl=audio_url
            )
        hint.text = original_text
        hint.eliminatesLocationIds = original_eliminated

        current_reply = build_npc_mama_reply(npc, game.bible)
        current_key = f"{npc.id}:{hint.eliminatesLocationIds[0]}"
        game.assets.npcMamaReplies[npc.id] = game.assets.npcMamaReplyVariants[current_key]
        print(f"generated natural dialogue for {npc.name}")

    STATE_PATH.write_text(json.dumps(game.model_dump(), indent=2) + "\n")


if __name__ == "__main__":
    asyncio.run(main())
