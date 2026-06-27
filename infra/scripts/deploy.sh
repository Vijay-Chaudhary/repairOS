#!/usr/bin/env bash
# Pull the target images and roll out. Idempotent.
#
# Usage:
#   deploy.sh                 # uses BACKEND_IMAGE/FRONTEND_IMAGE from env/.env
#   deploy.sh <git-sha>       # deploy a specific image tag (both images)
#
# The backend entrypoint runs migrations + collectstatic on start, so no
# separate migrate step is needed here. Auto-rolls back is handled by the
# caller (CI) via rollback.sh on health failure.
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

TAG="${1:-}"
if [[ -n "$TAG" ]]; then
  owner="$(grep -E '^BACKEND_IMAGE=' .env | sed -E 's#.*/([^/]+)/repaiross-backend.*#\1#')"
  : "${owner:=vijay-chaudhary}"
  export BACKEND_IMAGE="ghcr.io/${owner}/repaiross-backend:${TAG}"
  export FRONTEND_IMAGE="ghcr.io/${owner}/repaiross-frontend:${TAG}"
  log "Deploying tag ${TAG}"
fi

log "Pulling images"
"${COMPOSE[@]}" pull backend frontend

log "Building local-only images (pgbouncer)"
"${COMPOSE[@]}" build pgbouncer

log "Starting stack"
"${COMPOSE[@]}" up -d --remove-orphans

log "Waiting for backend to become healthy (up to ~120s)"
for i in $(seq 1 24); do
  state="$("${COMPOSE[@]}" ps --format '{{.Service}} {{.Health}}' | awk '$1=="backend"{print $2}')"
  [[ "$state" == "healthy" ]] && break
  sleep 5
done

log "Pruning dangling images"
docker image prune -f >/dev/null 2>&1 || true

bash "$(dirname "${BASH_SOURCE[0]}")/healthcheck.sh"
log "Deploy complete ✓"
