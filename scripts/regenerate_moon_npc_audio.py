"""Regenerate Moon Station's curated NPC openers with character voice direction."""

from __future__ import annotations

import asyncio
import hashlib
import json
from pathlib import Path

from server.ai import build_npc_opener, generate_tts, npc_tts_profile
from server.schema import Game, PreloadedNPCReply


ROOT = Path(__file__).resolve().parent.parent
TEMPLATE_ID = "Kgo4d31zD9kv1nANmRLep"
TEMPLATE_DIR = ROOT / "preset-assets" / "games" / TEMPLATE_ID
STATE_PATH = TEMPLATE_DIR / "state.json"


async def main() -> None:
    state = json.loads(STATE_PATH.read_text())
    game = Game.model_validate(state)
    if not game.bible:
        raise RuntimeError("Moon Station template has no game bible")

    for npc in game.bible.npcs:
        turn = build_npc_opener(npc, game.bible)
        voice, instructions = npc_tts_profile(npc, game.bible)
        audio = await generate_tts(turn.reply, voice, instructions)
        digest = hashlib.sha256(
            f"{npc.id}:{voice}:{instructions}:{turn.reply}".encode()
        ).hexdigest()[:16]
        filename = f"opener_{npc.id}_{digest}.mp3"
        relative_url = f"/assets/games/{TEMPLATE_ID}/audio/{filename}"
        (TEMPLATE_DIR / "audio" / filename).write_bytes(audio)
        game.assets.npcOpeners[npc.id] = PreloadedNPCReply(
            **turn.model_dump(),
            audioUrl=relative_url,
        )
        game.assets.audio[f"npc_{npc.id}.greeting"] = relative_url
        state["assets"].setdefault("npcOpeners", {})[npc.id] = game.assets.npcOpeners[npc.id].model_dump()
        state["assets"]["audio"][f"npc_{npc.id}.greeting"] = relative_url
        print(f"generated {npc.name}: {voice} -> {filename}")

    STATE_PATH.write_text(json.dumps(state, indent=2) + "\n")


if __name__ == "__main__":
    asyncio.run(main())
