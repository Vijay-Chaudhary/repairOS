#!/bin/sh
# Generates /tmp/userlist.txt from env vars, then starts PgBouncer.
# Runs as the 'postgres' user inside the edoburu/pgbouncer container.
set -eu

md5hash() {
    # PgBouncer md5 format: md5( password || username )
    printf '%s%s' "$1" "$2" | md5sum | cut -d' ' -f1
}

cat > /tmp/userlist.txt <<EOF
"pgbouncer_admin" "md5$(md5hash "${PGBOUNCER_ADMIN_PASSWORD}" "pgbouncer_admin")"
"pgbouncer_auth"  "md5$(md5hash "${PGBOUNCER_AUTH_PASSWORD}"  "pgbouncer_auth")"
EOF

exec pgbouncer /etc/pgbouncer/pgbouncer.ini
