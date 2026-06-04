#!/usr/bin/env bash
# Runs inside the postgres container on first boot (docker-entrypoint-initdb.d).
# POSTGRES_USER=postgres (superuser), POSTGRES_DB=repaiross_master already created by image.
set -euo pipefail

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL

  -- ── Master app user ────────────────────────────────────────────────────────
  DO \$\$
  BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'repaiross_master_user') THEN
      CREATE USER repaiross_master_user WITH PASSWORD '${MASTER_DB_PASSWORD}';
    END IF;
  END \$\$;

  GRANT ALL PRIVILEGES ON DATABASE repaiross_master TO repaiross_master_user;
  GRANT ALL ON SCHEMA public TO repaiross_master_user;

  -- ── PgBouncer auth lookup user ─────────────────────────────────────────────
  -- This user authenticates on behalf of all other users (including dynamic
  -- tenant users) by querying pg_shadow. Requires pg_monitor membership.
  DO \$\$
  BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'pgbouncer_auth') THEN
      CREATE USER pgbouncer_auth WITH PASSWORD '${PGBOUNCER_AUTH_PASSWORD}';
    END IF;
  END \$\$;

  GRANT pg_monitor TO pgbouncer_auth;

EOSQL
