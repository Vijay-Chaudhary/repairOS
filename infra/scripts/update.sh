#!/usr/bin/env bash
# Pull the latest code (compose/nginx/infra files) from master and redeploy.
# Does NOT touch .env. Idempotent.
source "$(dirname "${BASH_SOURCE[0]}")/_common.sh"

log "Fetching latest master"
git fetch --depth 1 origin master
git reset --hard origin/master

exec bash "$(dirname "${BASH_SOURCE[0]}")/deploy.sh" "$@"
