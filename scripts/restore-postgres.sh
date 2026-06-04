#!/usr/bin/env bash
set -euo pipefail

COMPOSE_FILE="${COMPOSE_FILE:-compose.production.yml}"
ENV_FILE="${ENV_FILE:-.env.production}"
PROJECT_NAME="${PROJECT_NAME:-count-on-us}"
BACKUP_DIR="${BACKUP_DIR:-backups/postgres}"
PRE_RESTORE_BACKUP_DIR="${PRE_RESTORE_BACKUP_DIR:-$BACKUP_DIR/pre-restore}"
SKIP_PRE_RESTORE_BACKUP="${SKIP_PRE_RESTORE_BACKUP:-false}"
FILTER_UNSUPPORTED_PG_SETTINGS="${FILTER_UNSUPPORTED_PG_SETTINGS:-true}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

usage() {
  cat <<'USAGE'
Usage:
  bash scripts/restore-postgres.sh <backup.sql.gz|backup.sql> [--yes]

Environment overrides:
  COMPOSE_FILE=compose.production.yml
  ENV_FILE=.env.production
  PROJECT_NAME=count-on-us
  BACKUP_DIR=backups/postgres
  PRE_RESTORE_BACKUP_DIR=backups/postgres/pre-restore
  SKIP_PRE_RESTORE_BACKUP=true
  FILTER_UNSUPPORTED_PG_SETTINGS=false

This is destructive: it restores into the production database and may drop
existing database objects because backups are created with pg_dump --clean.
USAGE
}

if [[ $# -lt 1 || $# -gt 2 ]]; then
  usage >&2
  exit 1
fi

BACKUP_FILE="$1"
CONFIRM="${2:-}"

if [[ "$CONFIRM" != "" && "$CONFIRM" != "--yes" ]]; then
  usage >&2
  exit 1
fi

if [[ ! -f "$ENV_FILE" ]]; then
  echo "Missing $ENV_FILE. Cannot locate production database settings." >&2
  exit 1
fi

if [[ ! -f "$BACKUP_FILE" ]]; then
  echo "Missing backup file: $BACKUP_FILE" >&2
  exit 1
fi

if [[ "$CONFIRM" != "--yes" ]]; then
  if [[ ! -t 0 ]]; then
    echo "Refusing non-interactive restore without --yes." >&2
    exit 1
  fi

  echo "About to restore PostgreSQL from:"
  echo "  $BACKUP_FILE"
  echo
  echo "This will stop the app and overwrite database state in project '$PROJECT_NAME'."
  read -r -p "Type 'restore' to continue: " RESPONSE

  if [[ "$RESPONSE" != "restore" ]]; then
    echo "Restore cancelled."
    exit 0
  fi
fi

compose() {
  APP_ENV_FILE="$ENV_FILE" docker compose \
    --project-name "$PROJECT_NAME" \
    --env-file "$ENV_FILE" \
    -f "$COMPOSE_FILE" \
    "$@"
}

restore_input() {
  case "$BACKUP_FILE" in
    *.gz | *.gzip)
      gunzip -c "$BACKUP_FILE"
      ;;
    *)
      cat "$BACKUP_FILE"
      ;;
  esac
}

restore_sql() {
  if [[ "$FILTER_UNSUPPORTED_PG_SETTINGS" == "true" ]]; then
    restore_input | sed '/^SET transaction_timeout = /d'
  else
    restore_input
  fi
}

on_error() {
  echo "Restore failed. The app may still be stopped; inspect the database before restarting traffic." >&2
}

trap on_error ERR

if [[ "$SKIP_PRE_RESTORE_BACKUP" != "true" ]]; then
  echo "Taking pre-restore safety backup..."
  BACKUP_DIR="$PRE_RESTORE_BACKUP_DIR" \
    COMPOSE_FILE="$COMPOSE_FILE" \
    ENV_FILE="$ENV_FILE" \
    PROJECT_NAME="$PROJECT_NAME" \
    "$SCRIPT_DIR/backup-postgres.sh"
else
  echo "Skipping pre-restore safety backup because SKIP_PRE_RESTORE_BACKUP=true."
fi

echo "Stopping app before database restore..."
compose stop app

echo "Restoring PostgreSQL from $BACKUP_FILE..."
if [[ "$FILTER_UNSUPPORTED_PG_SETTINGS" == "true" ]]; then
  echo "Filtering known unsupported PostgreSQL session settings from restore input."
fi
restore_sql | compose exec -T db psql -v ON_ERROR_STOP=1 -U countonus -d countonus

echo "Starting app after restore..."
compose up -d --wait app

echo "Current service status:"
compose ps

trap - ERR
echo "Restore complete."
