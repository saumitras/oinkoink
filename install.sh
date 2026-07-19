#!/usr/bin/env bash
# Oink Oink Lost — one-command local installer
#
# Usage:
#   curl -fsSL https://raw.githubusercontent.com/saumitras/oinkoink/main/install.sh | bash
#
# Non-interactive:
#   curl -fsSL https://raw.githubusercontent.com/saumitras/oinkoink/main/install.sh \
#     | OPENAI_API_KEY=sk-... bash

set -Eeuo pipefail

IMAGE="${OINKOINK_IMAGE:-saumitras/oinkoink:latest}"
CONTAINER_NAME="${OINKOINK_CONTAINER:-oinkoink}"
VOLUME_NAME="${OINKOINK_VOLUME:-oinkoink-data}"
PORT="${OINKOINK_PORT:-5173}"
BIND_ADDRESS="${OINKOINK_BIND:-127.0.0.1}"
SKIP_PULL="${OINKOINK_SKIP_PULL:-false}"
TEMP_ENV=""

cleanup() {
  if [ -n "$TEMP_ENV" ] && [ -f "$TEMP_ENV" ]; then
    rm -f "$TEMP_ENV"
  fi
}
trap cleanup EXIT INT TERM

fail() {
  echo "  ✗ $*" >&2
  exit 1
}

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║                 Oink Oink Lost                               ║"
echo "║       A little lost piglet. One big Mama mystery.            ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "▶ Checking prerequisites..."

command -v docker >/dev/null 2>&1 \
  || fail "Docker was not found. Install it from https://docs.docker.com/get-docker/"
docker info >/dev/null 2>&1 \
  || fail "Docker is installed but not running. Start Docker and try again."
command -v curl >/dev/null 2>&1 \
  || fail "curl is required for the startup health check."

case "$PORT" in
  ''|*[!0-9]*) fail "OINKOINK_PORT must be a number between 1 and 65535." ;;
esac
if [ "$PORT" -lt 1 ] || [ "$PORT" -gt 65535 ]; then
  fail "OINKOINK_PORT must be a number between 1 and 65535."
fi

echo "  ✓ Docker $(docker --version | cut -d' ' -f3 | tr -d ',')"
echo "  ✓ App port: $BIND_ADDRESS:$PORT"

if [ -z "${OPENAI_API_KEY:-}" ]; then
  if [ ! -r /dev/tty ]; then
    fail "OPENAI_API_KEY is required. Set it in the environment and run the installer again."
  fi
  echo ""
  printf "▶ Enter your OpenAI API key: " >/dev/tty
  IFS= read -r -s OPENAI_API_KEY </dev/tty
  printf "\n" >/dev/tty
fi

[ -n "$OPENAI_API_KEY" ] || fail "The OpenAI API key cannot be empty."
case "$OPENAI_API_KEY" in
  *$'\n'*|*$'\r'*) fail "The OpenAI API key contains an invalid newline." ;;
esac

TEMP_ENV="$(mktemp "${TMPDIR:-/tmp}/oinkoink-env.XXXXXX")"
chmod 600 "$TEMP_ENV"
printf 'OPENAI_API_KEY=%s\n' "$OPENAI_API_KEY" >"$TEMP_ENV"

if [ "$SKIP_PULL" != "true" ]; then
  echo ""
  echo "▶ Pulling $IMAGE..."
  docker pull "$IMAGE"
else
  echo ""
  echo "▶ Using local image $IMAGE"
fi

existing_id="$(docker ps -aq --filter "name=^/${CONTAINER_NAME}$")"
if [ -n "$existing_id" ]; then
  managed="$(docker inspect --format '{{ index .Config.Labels "fun.oinkoink.managed" }}' "$CONTAINER_NAME" 2>/dev/null || true)"
  if [ "$managed" != "true" ]; then
    fail "A container named '$CONTAINER_NAME' already exists and was not created by this installer."
  fi
  echo "▶ Replacing the existing Oink Oink Lost container..."
  docker rm -f "$CONTAINER_NAME" >/dev/null
fi

docker volume create "$VOLUME_NAME" >/dev/null

echo "▶ Starting Oink Oink Lost..."
if ! docker run -d \
  --name "$CONTAINER_NAME" \
  --label fun.oinkoink.managed=true \
  --label "fun.oinkoink.image=$IMAGE" \
  --restart unless-stopped \
  --env-file "$TEMP_ENV" \
  --mount "type=volume,src=$VOLUME_NAME,dst=/app/local-assets" \
  --publish "$BIND_ADDRESS:$PORT:8000" \
  "$IMAGE" >/dev/null; then
  docker rm -f "$CONTAINER_NAME" >/dev/null 2>&1 || true
  fail "The container could not start. Port $PORT may already be in use."
fi

echo -n "▶ Waiting for the game"
attempt=0
until curl -fsS "http://127.0.0.1:$PORT/healthz" >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if ! docker ps --quiet --filter "name=^/${CONTAINER_NAME}$" | grep -q .; then
    echo ""
    docker logs "$CONTAINER_NAME" 2>&1 | tail -40
    fail "The container stopped before becoming healthy."
  fi
  if [ "$attempt" -ge 60 ]; then
    echo ""
    docker logs "$CONTAINER_NAME" 2>&1 | tail -40
    fail "Timed out waiting for the game to become healthy."
  fi
  echo -n "."
  sleep 2
done
echo " ✓"

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║  ✓ Oink Oink Lost is ready!                                 ║"
echo "║                                                              ║"
printf "║  Open:  http://localhost:%-35s║\n" "$PORT"
echo "║                                                              ║"
printf "║  Logs:  docker logs -f %-36s║\n" "$CONTAINER_NAME"
printf "║  Stop:  docker stop %-38s║\n" "$CONTAINER_NAME"
printf "║  Start: docker start %-36s║\n" "$CONTAINER_NAME"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "Rerun this installer to update while preserving your adventures."
echo "Remove saved adventures with: docker volume rm $VOLUME_NAME"
