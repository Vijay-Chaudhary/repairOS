#!/usr/bin/env bash
# Roll back to a previous image tag (commit SHA). Idempotent.
#
# Usage:
#   rollback.sh <git-sha>     # explicit previous tag (recommended)
#   rollback.sh               # falls back to ':previous' if you maintain it
#
# NOTE: code rollback does NOT undo DB migrations. Keep migrations backwards
# compatible (project rule: reversible, deprecate-don't-drop).
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

TAG="${1:-previous}"
owner="$(grep -E '^BACKEND_IMAGE=' .env | sed -E 's#.*/([^/]+)/repaiross-backend.*#\1#')"
: "${owner:=vijay-chaudhary}"

export BACKEND_IMAGE="ghcr.io/${owner}/repaiross-backend:${TAG}"
export FRONTEND_IMAGE="ghcr.io/${owner}/repaiross-frontend:${TAG}"

warn "Rolling back to tag '${TAG}'"
"${COMPOSE[@]}" pull backend frontend
"${COMPOSE[@]}" up -d --remove-orphans backend celery-worker celery-beat frontend

bash "$(dirname "${BASH_SOURCE[0]}")/healthcheck.sh"
log "Rollback to '${TAG}' complete ✓"
