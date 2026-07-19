from __future__ import annotations

import json
import re
from typing import Iterable

from server.config import ASSETS_DIR
from server.schema import Game


GAME_ID_RE = re.compile(r"^[A-Za-z0-9_-]{5,80}$")
HIDDEN_LIBRARY_IDS = {
    # These were intentionally removed from the curated library.
    "B9888D_mmeb8VQ1H84jVq",
    "DS1Wm9QZ2cHIblaVfvLDx",
}


def valid_game_id(game_id: str) -> bool:
    return bool(GAME_ID_RE.fullmatch(game_id))


def is_library_ready(game: Game) -> bool:
    return (
        game.status == "playable"
        and game.bible is not None
        and bool(game.assets.streetUrl)
        and bool(game.stages)
        and all(status in ("done", "failed") for status in game.stages.values())
    )


def _load_playable_states() -> list[Game]:
    games_dir = ASSETS_DIR / "games"
    if not games_dir.exists():
        return []

    games: list[Game] = []
    for state_path in games_dir.glob("*/state.json"):
        try:
            game = Game.model_validate(json.loads(state_path.read_text()))
        except (OSError, ValueError):
            continue
        if is_library_ready(game):
            games.append(game)
    return games


def _canonical_id(game: Game) -> str:
    if game.librarySourceId and valid_game_id(game.librarySourceId):
        return game.librarySourceId
    street_url = game.assets.streetUrl or ""
    match = re.search(r"/assets/games/([A-Za-z0-9_-]+)/street(?:[._?]|$)", street_url)
    return match.group(1) if match else game.id


def _emoji(game: Game) -> str:
    haystack = " ".join([
        game.idea,
        game.bible.title if game.bible else "",
        game.bible.setting.name if game.bible else "",
    ]).lower()
    choices = (
        (("moon", "space", "station", "planet", "rocket"), "🚀"),
        (("pumpkin", "farm", "barn", "harvest"), "🎃"),
        (("castle", "dracula", "royal", "palace"), "🏰"),
        (("ocean", "sea", "beach", "island"), "🌊"),
        (("forest", "woodland", "jungle"), "🌳"),
        (("bakery", "cake", "candy", "kitchen"), "🧁"),
        (("snow", "ice", "winter"), "❄️"),
        (("dinosaur", "jurassic"), "🦕"),
        (("cloud", "sky"), "☁️"),
    )
    for keywords, emoji in choices:
        if any(keyword in haystack for keyword in keywords):
            return emoji
    return "✨"


def summarize_adventure(game: Game) -> dict:
    assert game.bible and game.assets.streetUrl
    source_id = _canonical_id(game)
    return {
        "id": source_id,
        "title": game.bible.title,
        "settingName": game.bible.setting.name,
        "description": game.bible.setting.description,
        "idea": game.idea,
        "previewUrl": game.assets.streetUrl,
        "reunionPhotoUrl": game.assets.reunionPhotoUrl,
        "createdAt": game.createdAt,
        "emoji": _emoji(game),
    }


def _distinct_adventures() -> list[Game]:
    by_source: dict[str, Game] = {}
    for game in _load_playable_states():
        source_id = _canonical_id(game)
        if source_id in HIDDEN_LIBRARY_IDS:
            continue
        existing = by_source.get(source_id)
        # Prefer the source snapshot itself. Otherwise retain the oldest clone,
        # whose assets and story are equivalent but whose id is stable on disk.
        if existing is None or game.id == source_id or game.createdAt < existing.createdAt:
            by_source[source_id] = game
    return sorted(by_source.values(), key=lambda game: game.createdAt, reverse=True)


def list_adventures(query: str = "", offset: int = 0, limit: int = 20) -> dict:
    normalized = query.strip().casefold()
    adventures = _distinct_adventures()
    if normalized:
        adventures = [game for game in adventures if normalized in " ".join([
            game.idea,
            game.bible.title if game.bible else "",
            game.bible.setting.name if game.bible else "",
            game.bible.setting.description if game.bible else "",
        ]).casefold()]
    total = len(adventures)
    page = adventures[offset:offset + limit]
    return {
        "items": [summarize_adventure(game) for game in page],
        "offset": offset,
        "limit": limit,
        "total": total,
        "hasMore": offset + len(page) < total,
    }


def lookup_adventures(ids: Iterable[str]) -> list[dict]:
    requested = [game_id for game_id in ids if valid_game_id(game_id)]
    if not requested:
        return []
    all_games = _load_playable_states()
    by_id = {game.id: game for game in all_games}
    by_source = {_canonical_id(game): game for game in all_games}
    result = []
    seen: set[str] = set()
    for game_id in requested:
        game = by_id.get(game_id) or by_source.get(game_id)
        if not game:
            continue
        source_id = _canonical_id(game)
        if source_id in HIDDEN_LIBRARY_IDS or source_id in seen:
            continue
        seen.add(source_id)
        result.append(summarize_adventure(game))
    return result
