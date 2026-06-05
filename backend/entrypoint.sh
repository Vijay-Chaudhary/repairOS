#!/usr/bin/env bash
# Backend container entrypoint (backend service only).
# Celery services override CMD entirely so this script never runs there.
set -euo pipefail

echo "==> [seed] Waiting for master DB to accept connections..."
until python -c "
import os, django
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings.local')
django.setup()
from django.db import connections
connections['default'].ensure_connection()
print('ok')
" 2>/dev/null; do
  sleep 2
done

echo "==> [seed] Running master DB migrations..."
python manage.py migrate --database=default --noinput

echo "==> [seed] Seeding demo tenants (idempotent)..."

python manage.py create_tenant \
  --slug demo \
  --name "Shree Electronics" \
  --email "admin@demo.com" \
  --phone "+919876543210" \
  --admin-password "Demo@1234!" \
  --plan professional \
  2>&1 | grep -v "already exists" || true

python manage.py create_tenant \
  --slug testshop \
  --name "Test Shop" \
  --email "admin@testshop.com" \
  --phone "+919876543211" \
  --admin-password "Demo@1234!" \
  --plan starter \
  2>&1 | grep -v "already exists" || true

echo "==> [seed] Loading demo data (idempotent)..."
python manage.py seed_demo

echo "==> [seed] Starting Daphne..."
exec daphne -b 0.0.0.0 -p 8000 config.asgi:application
