import hashlib
import json
from pathlib import Path
from server.config import DEV_CACHE, DEV_CACHE_DIR


def _key(namespace: str, payload: str) -> str:
    h = hashlib.sha256(f"{namespace}:{payload}".encode()).hexdigest()[:16]
    return h


def cache_get_bytes(namespace: str, payload: str) -> bytes | None:
    if not DEV_CACHE:
        return None
    path = DEV_CACHE_DIR / namespace / (_key(namespace, payload) + ".bin")
    if path.exists():
        print(f"[cache HIT] {namespace}/{path.name}")
        return path.read_bytes()
    return None


def cache_set_bytes(namespace: str, payload: str, data: bytes) -> None:
    if not DEV_CACHE:
        return
    path = DEV_CACHE_DIR / namespace / (_key(namespace, payload) + ".bin")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    print(f"[cache SET] {namespace}/{path.name}")


def cache_get_json(namespace: str, payload: str) -> dict | None:
    if not DEV_CACHE:
        return None
    path = DEV_CACHE_DIR / namespace / (_key(namespace, payload) + ".json")
    if path.exists():
        print(f"[cache HIT] {namespace}/{path.name}")
        return json.loads(path.read_text())
    return None


def cache_set_json(namespace: str, payload: str, data: dict) -> None:
    if not DEV_CACHE:
        return
    path = DEV_CACHE_DIR / namespace / (_key(namespace, payload) + ".json")
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data))
    print(f"[cache SET] {namespace}/{path.name}")
