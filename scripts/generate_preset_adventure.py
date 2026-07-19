#!/usr/bin/env python3
"""Generate a complete adventure and copy it into the immutable preset library."""

from __future__ import annotations

import argparse
import asyncio
import shutil
from pathlib import Path

from server.ai import generate_reunion_photo
from server.config import ASSETS_DIR, OPENAI_IMAGE_MODEL
from server.gamestore import snapshot_game
from server.pipeline import run_pipeline
from server.storage import save_asset


ROOT = Path(__file__).resolve().parent.parent
PRESET_GAMES_DIR = ROOT / "preset-assets" / "games"


async def generate(idea: str) -> str:
    game = await run_pipeline(idea)
    print(f"Started {game.id} with OPENAI_IMAGE_MODEL={OPENAI_IMAGE_MODEL}", flush=True)

    while True:
        await asyncio.sleep(2)
        terminal = bool(game.stages) and all(
            status in {"done", "failed"} for status in game.stages.values()
        )
        completed = sum(status in {"done", "failed"} for status in game.stages.values())
        print(
            f"{game.id}: status={game.status}, stages={completed}/{len(game.stages)}",
            flush=True,
        )
        if game.status == "failed":
            raise RuntimeError(f"Adventure generation failed: {game.id}")
        if game.status == "playable" and terminal:
            break

    assert game.bible
    reunion = await generate_reunion_photo(game.bible, game.cozyVisuals)
    game.assets.reunionPhotoUrl = save_asset(f"games/{game.id}/reunion.png", reunion)
    snapshot_game(game)

    source = ASSETS_DIR / "games" / game.id
    destination = PRESET_GAMES_DIR / game.id
    if destination.exists():
        raise FileExistsError(f"Preset already exists: {destination}")
    destination.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(source, destination)
    print(f"Preset ready: {destination}", flush=True)
    return game.id


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("idea", help="Adventure theme supplied to the game generator")
    args = parser.parse_args()
    game_id = asyncio.run(generate(args.idea))
    print(f"PRESET_GAME_ID={game_id}")


if __name__ == "__main__":
    main()
