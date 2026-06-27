#!/usr/bin/env bash
# Back up all PostgreSQL databases (master + every tenant) and the MinIO bucket.
# Verifies the dump, rotates old backups. Idempotent; safe to run from cron.
#
#   backup.sh                       # → ./backups/
#   BACKUP_DIR=/mnt/backups RETENTION=14 backup.sh
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

BACKUP_DIR="${BACKUP_DIR:-$REPO_DIR/backups}"
RETENTION="${RETENTION:-7}"
ts="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"

dump="$BACKUP_DIR/pg-${ts}.sql.gz"
log "Dumping all PostgreSQL databases → $dump"
# pg_dumpall captures master + all tenant DBs + roles in one consistent pass.
"${COMPOSE[@]}" exec -T postgres pg_dumpall -U postgres | gzip > "$dump"

log "Verifying dump integrity"
gzip -t "$dump" || die "Backup is corrupt: $dump"
[[ -s "$dump" ]] || die "Backup is empty: $dump"
echo "OK ($(du -h "$dump" | cut -f1))"

log "Mirroring MinIO bucket"
bucket="$(grep -E '^AWS_STORAGE_BUCKET_NAME=' .env | cut -d= -f2)"
mirror="$BACKUP_DIR/minio-${ts}"
if [[ -n "$bucket" ]]; then
  "${COMPOSE[@]}" run --rm --no-deps --entrypoint sh minio-init -c "
    mc alias set local http://minio:9000 \"\$MINIO_ROOT_USER\" \"\$MINIO_ROOT_PASSWORD\" >/dev/null &&
    mc mirror --overwrite --quiet local/${bucket} /tmp/mirror
  " 2>/dev/null || warn "MinIO mirror skipped/failed (non-fatal)"
fi

log "Rotating backups (keeping ${RETENTION})"
ls -1t "$BACKUP_DIR"/pg-*.sql.gz 2>/dev/null | tail -n +$((RETENTION + 1)) | xargs -r rm -f

log "Backup complete ✓  ($dump)"
