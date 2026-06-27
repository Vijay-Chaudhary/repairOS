#!/usr/bin/env bash
# Shared helpers sourced by the other scripts. Not meant to be run directly.
set -euo pipefail

# Repo root = two levels up from this file (infra/scripts/_common.sh).
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$REPO_DIR"

COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
COMPOSE=(docker compose -f "$COMPOSE_FILE")

log()  { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m[warn] %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31m[error] %s\033[0m\n' "$*" >&2; exit 1; }

[[ -f .env ]] || die ".env not found in $REPO_DIR — copy .env.production.example and fill it."
