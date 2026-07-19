import os
from pathlib import Path
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent.parent / ".env.local")

OPENAI_API_KEY = os.environ["OPENAI_API_KEY"]
TEXT_MODEL = os.getenv("TEXT_MODEL", "gpt-5.4-mini-2026-03-17")
NPC_MODEL = os.getenv("NPC_MODEL", "gpt-5.6-luna")
OPENAI_IMAGE_MODEL = os.getenv("OPENAI_IMAGE_MODEL", "gpt-image-2")
OPENAI_IMAGE_QUALITY = os.getenv("OPENAI_IMAGE_QUALITY", "medium")
OPENAI_IMAGE_SIZE = os.getenv("OPENAI_IMAGE_SIZE", "1024x1024")
TTS_MODEL = os.getenv("TTS_MODEL", "gpt-4o-mini-tts")
TRANSCRIBE_MODEL = os.getenv("TRANSCRIBE_MODEL", "gpt-4o-mini-transcribe")
MODERATION_MODEL = os.getenv("MODERATION_MODEL", "omni-moderation-latest")
ASSETS_DIR = Path(os.getenv("ASSETS_DIR", "./local-assets"))
PORT = int(os.getenv("PORT", "8000"))

# Dev mode: cache all AI generations to disk, skip API calls on cache hit
DEV_CACHE = os.getenv("DEV_CACHE", "true").lower() == "true"
DEV_CACHE_DIR = Path(os.getenv("DEV_CACHE_DIR", "./dev-cache"))
