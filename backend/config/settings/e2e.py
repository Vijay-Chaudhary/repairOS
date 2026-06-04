"""
E2E settings: inherits test.py (which already strips debug_toolbar)
but uses a file-based SQLite so data persists between requests.
"""
from .test import *  # noqa: F401, F403

import sys
import environ
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent.parent

env = environ.Env()
# Don't crash if .env isn't set — we only need TENANT_CRED_ENCRYPTION_KEY
try:
    environ.Env.read_env(BASE_DIR / ".env")
except Exception:
    pass

# ── File-based SQLite ─────────────────────────────────────────────────────────
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": BASE_DIR / "e2e_test.sqlite3",
    }
}

DATABASE_ROUTERS = ["config.settings.e2e.E2ERouter"]


class E2ERouter:
    def db_for_read(self, model, **hints):   return "default"
    def db_for_write(self, model, **hints):  return "default"
    def allow_relation(self, obj1, obj2, **hints): return True
    def allow_migrate(self, db, app_label, model_name=None, **hints): return True


# ── Dev flags ─────────────────────────────────────────────────────────────────
DEBUG = True  # Required for OTP console logging + dev header support
ALLOWED_HOSTS = ["*"]

# withCredentials=true requires explicit origin, not wildcard
CORS_ALLOW_ALL_ORIGINS = False
CORS_ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]
CORS_ALLOW_CREDENTIALS = True
AUTH_PASSWORD_VALIDATORS = []
EMAIL_BACKEND = "django.core.mail.backends.console.EmailBackend"
TENANT_SLUG_DEV_HEADER = "HTTP_X_TENANT_SLUG"

CELERY_TASK_ALWAYS_EAGER = True
CELERY_TASK_EAGER_PROPAGATES = True

# ── E2E Tenant Middleware patch ────────────────────────────────────────────────
# Replace the real TenantMiddleware with a no-op version that always routes
# to the single SQLite "default" DB. This lets the whole API work without
# needing a real multi-DB tenant setup.
_mw = MIDDLEWARE  # noqa: F405
MIDDLEWARE = [
    m.replace(
        "core.middleware.TenantMiddleware",
        "config.settings.e2e.E2ETenantMiddleware"
    ) for m in _mw  # noqa: F405
]


class E2ETenantMiddleware:
    """E2E-only: always sets tenant DB alias to 'default'."""

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        from core.context import get_tenant_db_alias, set_tenant_db_alias, clear_tenant_context
        already_set = bool(get_tenant_db_alias())
        if not already_set:
            set_tenant_db_alias("default")
        try:
            return self.get_response(request)
        finally:
            if not already_set:
                clear_tenant_context()
