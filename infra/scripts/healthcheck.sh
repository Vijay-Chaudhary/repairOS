#!/usr/bin/env bash
# Probe every service and the app health endpoint. Exit non-zero on any failure
# so CI/cron can act on it. Idempotent and read-only.
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

fail=0

log "Container status"
"${COMPOSE[@]}" ps

log "Checking for unhealthy / exited containers"
ps_out="$("${COMPOSE[@]}" ps --format '{{.Service}} {{.State}} {{.Health}}')"
unhealthy="$(echo "$ps_out" | awk '$2!="running" || ($3!="" && $3!="healthy") {print}')"
if [[ -n "$unhealthy" ]]; then
  warn "Problem containers:"; echo "$unhealthy"; fail=1
fi

log "Backend health endpoint"
if "${COMPOSE[@]}" exec -T backend curl -fsS http://localhost:8000/api/v1/health/ >/dev/null 2>&1; then
  echo "backend: OK"
else
  warn "backend health endpoint failed"; fail=1
fi

log "Redis ping"
if "${COMPOSE[@]}" exec -T redis sh -c 'redis-cli -a "$REDIS_PASSWORD" ping' 2>/dev/null | grep -q PONG; then
  echo "redis: OK"
else
  warn "redis ping failed"; fail=1
fi

log "Postgres ready"
if "${COMPOSE[@]}" exec -T postgres pg_isready -U postgres -d repaiross_master >/dev/null 2>&1; then
  echo "postgres: OK"
else
  warn "postgres not ready"; fail=1
fi

if [[ $fail -eq 0 ]]; then log "All checks passed ✓"; else die "Health check FAILED"; fi
