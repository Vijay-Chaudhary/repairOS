#!/usr/bin/env bash
# Build + start the bare-IP stack on the VPS and wait for backend health.
# Run from anywhere; resolves the repo root from its own location.
#
#   bash infra/scripts/deploy-ip.sh
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."

COMPOSE=(docker compose -f docker-compose.prod.yml -f docker-compose.ip.yml)

log() { printf '\n\033[1;32m==> %s\033[0m\n' "$*"; }

log "Building images on the box and starting the stack"
"${COMPOSE[@]}" up -d --build --remove-orphans

log "Waiting for backend to become healthy (up to ~180s)"
for i in $(seq 1 36); do
  state="$("${COMPOSE[@]}" ps --format '{{.Service}} {{.Health}}' | awk '$1=="backend"{print $2}')"
  [[ "$state" == "healthy" ]] && { log "Backend healthy ✓"; break; }
  sleep 5
done

state="$("${COMPOSE[@]}" ps --format '{{.Service}} {{.Health}}' | awk '$1=="backend"{print $2}')"
if [[ "$state" != "healthy" ]]; then
  log "Backend did not become healthy — recent logs:"
  "${COMPOSE[@]}" logs --tail 50 backend
  exit 1
fi

log "Stack up. Reachable at http://200.97.165.67"
