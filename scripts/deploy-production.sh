#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-compose.production.yml}"
ENV_FILE="${ENV_FILE:-.env.production}"
PROJECT_NAME="${PROJECT_NAME:-count-on-us}"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE. Create it from .env.production.example before deploying." >&2
  exit 1
fi

echo "Validating production compose configuration..."
APP_ENV_FILE="$ENV_FILE" docker compose \
  --project-name "$PROJECT_NAME" \
  --env-file "$ENV_FILE" \
  -f "$COMPOSE_FILE" \
  config >/tmp/count-on-us-compose.yml

echo "Building app image..."
APP_ENV_FILE="$ENV_FILE" docker compose \
  --project-name "$PROJECT_NAME" \
  --env-file "$ENV_FILE" \
  -f "$COMPOSE_FILE" \
  build app

echo "Starting production stack..."
APP_ENV_FILE="$ENV_FILE" docker compose \
  --project-name "$PROJECT_NAME" \
  --env-file "$ENV_FILE" \
  -f "$COMPOSE_FILE" \
  up -d --remove-orphans --wait

echo "Current service status:"
APP_ENV_FILE="$ENV_FILE" docker compose \
  --project-name "$PROJECT_NAME" \
  --env-file "$ENV_FILE" \
  -f "$COMPOSE_FILE" \
  ps

echo "Recent app logs:"
APP_ENV_FILE="$ENV_FILE" docker compose \
  --project-name "$PROJECT_NAME" \
  --env-file "$ENV_FILE" \
  -f "$COMPOSE_FILE" \
  logs --tail=80 app
