#!/usr/bin/env bash
# Production backend entrypoint (backend service only).
#
# Unlike entrypoint.sh (dev), this NEVER seeds demo tenants or demo data.
# Celery worker/beat override CMD entirely so this script never runs there.
#
# Steps: wait for master DB → migrate master → migrate every active tenant →
#        collectstatic (runtime, so build needs no secrets) → exec daphne.
set -euo pipefail

export DJANGO_SETTINGS_MODULE="${DJANGO_SETTINGS_MODULE:-config.settings.production}"

echo "==> [prod] Waiting for master DB to accept connections..."
until python -c "
import django
django.setup()
from django.db import connections
connections['default'].ensure_connection()
print('ok')
" 2>/dev/null; do
  sleep 2
done

echo "==> [prod] Running master DB migrations..."
python manage.py migrate --database=default --noinput

echo "==> [prod] Migrating all active tenant databases..."
python manage.py migrate_all_tenants

echo "==> [prod] Collecting static files..."
python manage.py collectstatic --noinput

echo "==> [prod] Starting Daphne (ASGI)..."
exec daphne -b 0.0.0.0 -p 8000 config.asgi:application
