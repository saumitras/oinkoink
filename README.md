# Oink Oink Lost - Game

An AI-powered storybook adventure game where a little lost Piglet explore and interact with dynamically generated world and NPCs to get clues and find Mama.

Play online at [oinkoink.fun](https://oinkoink.fun).

## One-command local install

You need Docker and an OpenAI API key. The installer supports macOS and Linux on Intel/AMD and ARM machines.

To install without cloning the repository:

```bash
curl -fsSL https://raw.githubusercontent.com/saumitras/oinkoink/main/install.sh | bash
```

Or pass the key non-interactively:

```bash
curl -fsSL https://raw.githubusercontent.com/saumitras/oinkoink/main/install.sh \
  | OPENAI_API_KEY=sk-your-key bash
```

The installer securely prompts for your OpenAI API key, pulls the latest
`saumitras/oinkoink` Docker image, and starts the game at
[http://localhost:5173](http://localhost:5173).

## Run from this repository

From the repository root, run:

```bash
./install.sh
```

For a non-interactive install:

```bash
OPENAI_API_KEY=sk-your-key ./install.sh
```

Do not commit your API key or add it to the repository. The installer uses a
temporary environment file and removes it after starting the container.

Optional settings:

```bash
OINKOINK_PORT=8080          # local port, default 5173
OINKOINK_BIND=0.0.0.0       # allow other devices to connect, default 127.0.0.1
OINKOINK_IMAGE=user/tag     # alternate image, default saumitras/oinkoink:latest
```

Place settings before the command. For example:

```bash
OPENAI_API_KEY=sk-your-key OINKOINK_PORT=8080 ./install.sh
```

Rerun the same installer command to pull the newest image and replace the app
container without deleting saved adventures. Generated adventures are retained
in the `oinkoink-data` Docker volume.

```bash
docker logs -f oinkoink         # logs
docker stop oinkoink            # stop
docker start oinkoink           # start again
docker rm -f oinkoink           # uninstall the container
docker volume rm oinkoink-data  # also delete generated adventures
```

The API key is passed only to the local container. Like other Docker environment
variables, it is visible to users who have administrative access to the local
Docker daemon.

## OpenAI services used

| Purpose | Model | OpenAI service |
| --- | --- | --- |
| Adventure bible and structured story generation | `gpt-5.4-mini-2026-03-17` | Responses API |
| Hub hotspot detection and room annotation | `gpt-5.4-mini-2026-03-17` | Responses API with image input |
| Live NPC conversations | `gpt-5.6-luna` | Responses API |
| Hub, room, character, outline, and reunion images | `gpt-image-2` | Images API (generation and editing) |
| Narrator, NPC, and Piglet voices | `gpt-4o-mini-tts` | Audio Speech API |
| Microphone speech recognition | `gpt-4o-mini-transcribe` | Audio Transcriptions API |
| Adventure prompt screening | `omni-moderation-latest` | Moderations API |

Images are generated as medium-quality 1024 x 1024 PNG files. Model defaults
can be overridden with environment variables; see `.env.example`.

## Run the source build with Docker Compose

```bash
cp .env.example .env.local
# Add your OPENAI_API_KEY to .env.local, then run:
docker compose up --build
```

This builds the React frontend and FastAPI server from source and opens the game
at [http://localhost:5173](http://localhost:5173). Generated assets are stored
in the local `local-assets` directory.
