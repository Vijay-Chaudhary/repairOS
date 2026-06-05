#!/usr/bin/env bash
# Runs inside the postgres container on first boot (docker-entrypoint-initdb.d).
# POSTGRES_USER=postgres (superuser), POSTGRES_DB=repaiross_master already created by image.
set -euo pipefail

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL

  -- ── Master app user ────────────────────────────────────────────────────────
  DO \$\$
  BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'repaiross_master_user') THEN
      -- CREATEDB + CREATEROLE required by create_tenant: creates tenant DBs and per-tenant PG users.
      CREATE USER repaiross_master_user WITH PASSWORD '${MASTER_DB_PASSWORD}' CREATEDB CREATEROLE;
    END IF;
  END \$\$;

  GRANT ALL PRIVILEGES ON DATABASE repaiross_master TO repaiross_master_user;
  GRANT ALL ON SCHEMA public TO repaiross_master_user;

EOSQL

# Switch to md5 password storage and auth so PgBouncer (auth_type=md5)
# can authenticate both tenant users and the auth-query lookup user.
# SCRAM-SHA-256 (PG16 default) is incompatible with PgBouncer md5 auth mode.
# Must happen BEFORE creating pgbouncer_auth so its password is stored as md5.
sed -i 's/scram-sha-256/md5/g' "$PGDATA/pg_hba.conf"
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -c "ALTER SYSTEM SET password_encryption = 'md5';"
pg_ctl reload -D "$PGDATA" -s

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
  -- ── PgBouncer auth lookup user ─────────────────────────────────────────────
  -- Created AFTER password_encryption='md5' is active so the hash is md5,
  -- not SCRAM-SHA-256. PgBouncer auth_type=md5 cannot verify SCRAM hashes.
  DO \$\$
  BEGIN
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'pgbouncer_auth') THEN
      CREATE USER pgbouncer_auth WITH PASSWORD '${PGBOUNCER_AUTH_PASSWORD}';
    END IF;
  END \$\$;

  GRANT pg_monitor TO pgbouncer_auth;
  -- pg_monitor alone does NOT cover pg_shadow (password hashes).
  -- PgBouncer auth_query needs to read it to verify tenant user passwords.
  GRANT SELECT ON pg_shadow TO pgbouncer_auth;

EOSQL
