#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-compose.production.yml}"
ENV_FILE="${ENV_FILE:-.env.production}"
PROJECT_NAME="${PROJECT_NAME:-count-on-us}"
BACKUP_DIR="${BACKUP_DIR:-backups/postgres}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$BACKUP_DIR/countonus-$STAMP.sql.gz"

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE. Cannot locate production database settings." >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

echo "Writing compressed PostgreSQL backup to $OUT..."
APP_ENV_FILE="$ENV_FILE" docker compose \
  --project-name "$PROJECT_NAME" \
  --env-file "$ENV_FILE" \
  -f "$COMPOSE_FILE" \
  exec -T db pg_dump -U countonus -d countonus --clean --if-exists \
  | gzip -9 >"$OUT"

echo "Backup complete: $OUT"
