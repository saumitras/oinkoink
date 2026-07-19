import asyncio
from collections import defaultdict
from server.schema import Game

_queues: dict[str, list[asyncio.Queue]] = defaultdict(list)


def subscribe(game_id: str) -> asyncio.Queue:
    q: asyncio.Queue = asyncio.Queue()
    _queues[game_id].append(q)
    return q


def unsubscribe(game_id: str, q: asyncio.Queue) -> None:
    try:
        _queues[game_id].remove(q)
    except ValueError:
        pass


def emit(game_id: str, event: dict) -> None:
    for q in list(_queues.get(game_id, [])):
        q.put_nowait(event)
