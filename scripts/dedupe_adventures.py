#!/usr/bin/env python3
"""Use GPT to identify semantic duplicate adventures and optionally remove them.

The script never deletes curated Pumpkin Farm or Moon Station. With --apply it
removes duplicate source snapshots and every replay clone that still references
those sources, then writes a JSON audit report under local-assets/.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import shutil
import sys
from datetime import datetime, timezone
from pathlib import Path

from openai import AsyncOpenAI
from pydantic import BaseModel, Field

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from server.adventure_library import _canonical_id, _distinct_adventures
from server.config import ASSETS_DIR, OPENAI_API_KEY, TEXT_MODEL
from server.schema import Game
from server.schema_utils import make_strict_schema


PROTECTED_IDS = {"76VwFrCWC21dOuUiBJWhA", "Kgo4d31zD9kv1nANmRLep"}


class DuplicateGroup(BaseModel):
    label: str
    keeperId: str
    duplicateIds: list[str] = Field(min_length=1)
    reason: str


class DuplicateReview(BaseModel):
    groups: list[DuplicateGroup]


def inventory() -> list[dict]:
    items = []
    for game in _distinct_adventures():
        assert game.bible
        items.append({
            "id": _canonical_id(game),
            "title": game.bible.title,
            "setting": game.bible.setting.name,
            "idea": game.idea,
            "description": game.bible.setting.description,
            "createdAt": game.createdAt,
            "hasReunionPhoto": bool(game.assets.reunionPhotoUrl),
            "completedRooms": sum(bool(room.imageUrl and room.annotation) for room in game.assets.rooms.values()),
            "audioClipCount": len(game.assets.audio),
            "protectedCuratedAdventure": _canonical_id(game) in PROTECTED_IDS,
        })
    return items


async def review_with_gpt(items: list[dict]) -> DuplicateReview:
    client = AsyncOpenAI(api_key=OPENAI_API_KEY)
    instructions = """You are cleaning a game adventure library. Group semantic duplicates.

Two adventures are duplicates when they are separate generations of essentially the same user premise, setting, and activity. Different titles or minor decorative details do not make repeated pumpkin farms, Dracula castles, tiny seaside villages, or dinosaur birthday parties unique. Do not group merely because two settings share a broad word: a moonlit airport is not a moon station, and a cloud castle is not a Dracula castle.

Return only groups containing at least two ids. Put every id in at most one group. keeperId must be one member of its group; put all other members in duplicateIds. If a group contains protectedCuratedAdventure=true, that item must be the keeper. Otherwise prefer the most complete item (reunion photo, rooms, audio), then the most coherent and distinctive description. Be conservative when the underlying adventure premise is meaningfully different."""
    response = await client.responses.parse(
        model=TEXT_MODEL,
        instructions=instructions,
        input=json.dumps(items, ensure_ascii=False),
        text={"format": {
            "type": "json_schema",
            "name": "duplicate_adventure_review",
            "schema": make_strict_schema(DuplicateReview.model_json_schema()),
            "strict": True,
        }},
    )
    return DuplicateReview.model_validate_json(response.output_text)


def validate_review(review: DuplicateReview, items: list[dict]) -> None:
    known = {item["id"] for item in items}
    seen: set[str] = set()
    for group in review.groups:
        members = [group.keeperId, *group.duplicateIds]
        if len(set(members)) != len(members):
            raise ValueError(f"Repeated id inside group {group.label}")
        if not set(members) <= known:
            raise ValueError(f"Unknown id in group {group.label}: {set(members) - known}")
        if seen.intersection(members):
            raise ValueError(f"An adventure appears in multiple groups: {seen.intersection(members)}")
        if any(member in PROTECTED_IDS for member in group.duplicateIds):
            raise ValueError(f"GPT attempted to delete protected adventure in {group.label}")
        protected_members = set(members).intersection(PROTECTED_IDS)
        if protected_members and group.keeperId not in protected_members:
            raise ValueError(f"Protected adventure was not selected as keeper in {group.label}")
        seen.update(members)


def game_source_id(state_path: Path) -> str | None:
    try:
        game = Game.model_validate(json.loads(state_path.read_text()))
    except (OSError, ValueError):
        return None
    return _canonical_id(game)


def apply_deletions(review: DuplicateReview) -> list[dict]:
    duplicate_ids = {item for group in review.groups for item in group.duplicateIds}
    deleted = []
    games_dir = ASSETS_DIR / "games"
    for state_path in games_dir.glob("*/state.json"):
        source_id = game_source_id(state_path)
        if source_id not in duplicate_ids:
            continue
        game_dir = state_path.parent
        deleted.append({
            "directoryId": game_dir.name,
            "sourceAdventureId": source_id,
            "bytes": sum(path.stat().st_size for path in game_dir.rglob("*") if path.is_file()),
        })
        shutil.rmtree(game_dir)
    return deleted


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--apply", action="store_true", help="delete duplicates after GPT review")
    parser.add_argument("--review-file", type=Path, help="use a previously completed LLM review JSON")
    args = parser.parse_args()

    items = inventory()
    if args.review_file:
        review = DuplicateReview.model_validate_json(args.review_file.read_text())
    else:
        review = await review_with_gpt(items)
    validate_review(review, items)
    deleted = apply_deletions(review) if args.apply else []
    timestamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    report = {
        "generatedAt": datetime.now(timezone.utc).isoformat(),
        "reviewSource": str(args.review_file) if args.review_file else f"external GPT model: {TEXT_MODEL}",
        "applied": args.apply,
        "adventuresReviewed": len(items),
        "groups": [group.model_dump() for group in review.groups],
        "duplicateAdventureCount": sum(len(group.duplicateIds) for group in review.groups),
        "deletedDirectories": deleted,
        "deletedBytes": sum(item["bytes"] for item in deleted),
    }
    report_path = ASSETS_DIR / f"adventure-dedup-report-{timestamp}.json"
    report_path.write_text(json.dumps(report, indent=2, ensure_ascii=False))
    print(json.dumps({**report, "reportPath": str(report_path)}, indent=2, ensure_ascii=False))


if __name__ == "__main__":
    asyncio.run(main())
