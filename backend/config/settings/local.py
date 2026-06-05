from .base import *  # noqa: F401, F403

DEBUG = True

ALLOWED_HOSTS = ["*"]

# credentials: 'include' requires an explicit origin, not the wildcard '*'
CORS_ALLOW_ALL_ORIGINS = False
CORS_ALLOWED_ORIGINS = [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
]
CORS_ALLOW_CREDENTIALS = True

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

from corsheaders.defaults import default_headers  # noqa: E402
CORS_ALLOW_HEADERS = list(default_headers) + ["x-tenant-slug"]
