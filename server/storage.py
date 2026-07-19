import json
from pathlib import Path
from server.config import ASSETS_DIR


def save_asset(key: str, data: bytes) -> str:
    path = ASSETS_DIR / key
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return f"/assets/{key}"


def save_json(key: str, data: dict) -> None:
    path = ASSETS_DIR / key
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2))


def load_json(key: str) -> dict | None:
    path = ASSETS_DIR / key
    if path.exists():
        return json.loads(path.read_text())
    return None
