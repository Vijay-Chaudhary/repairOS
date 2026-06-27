#!/usr/bin/env bash
# Restore PostgreSQL from a pg_dumpall backup produced by backup.sh.
# DESTRUCTIVE: overwrites current database contents. Requires confirmation.
#
#   restore.sh ./backups/pg-20260627-031500.sql.gz
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

dump="${1:-}"
[[ -n "$dump" && -f "$dump" ]] || die "Usage: restore.sh <path-to-pg-*.sql.gz>"

gzip -t "$dump" || die "Backup file is corrupt: $dump"

warn "This will OVERWRITE all current databases from:"
echo "  $dump"
read -r -p "Type 'RESTORE' to proceed: " confirm
[[ "$confirm" == "RESTORE" ]] || die "Aborted."

log "Stopping app services (keep postgres up)"
"${COMPOSE[@]}" stop backend celery-worker celery-beat frontend

log "Restoring (pg_dumpall stream → psql)"
gunzip -c "$dump" | "${COMPOSE[@]}" exec -T postgres psql -U postgres -d postgres

log "Restarting app services"
"${COMPOSE[@]}" up -d backend celery-worker celery-beat frontend

bash "$(dirname "${BASH_SOURCE[0]}")/healthcheck.sh"
log "Restore complete ✓"
