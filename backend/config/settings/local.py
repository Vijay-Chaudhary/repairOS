from .base import *  # noqa: F401, F403

DEBUG = True

ALLOWED_HOSTS = ["*"]

CORS_ALLOW_ALL_ORIGINS = True

# Debug toolbar
INSTALLED_APPS += ["debug_toolbar"]  # noqa: F405
MIDDLEWARE = ["debug_toolbar.middleware.DebugToolbarMiddleware"] + MIDDLEWARE  # noqa: F405
INTERNAL_IPS = ["127.0.0.1"]

# Disable password strength in dev for easier seeding
AUTH_PASSWORD_VALIDATORS = []

# Use console email backend
EMAIL_BACKEND = "django.core.mail.backends.console.EmailBackend"

# Local dev: allow X-Tenant-Slug header as fallback when no subdomain is present
TENANT_SLUG_DEV_HEADER = "HTTP_X_TENANT_SLUG"
