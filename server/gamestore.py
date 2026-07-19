from server.schema import Game
from server.storage import save_json, load_json

_store: dict[str, Game] = {}


def get_game(game_id: str) -> Game | None:
    return _store.get(game_id)


def set_game(game: Game) -> None:
    _store[game.id] = game


def get_or_load_game(game_id: str) -> Game | None:
    if game_id in _store:
        return _store[game_id]
    data = load_json(f"games/{game_id}/state.json")
    if data:
        game = Game.model_validate(data)
        _store[game_id] = game
        return game
    return None


def snapshot_game(game: Game) -> None:
    save_json(f"games/{game.id}/state.json", game.model_dump())
