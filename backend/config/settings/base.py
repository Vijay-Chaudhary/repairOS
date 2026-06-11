import sys
from datetime import timedelta
from pathlib import Path

from celery.schedules import crontab

import environ

BASE_DIR = Path(__file__).resolve().parent.parent.parent

# Put apps/ on the path so app labels are importable without prefix
sys.path.insert(0, str(BASE_DIR / "apps"))

env = environ.Env()
environ.Env.read_env(BASE_DIR / ".env")

# ──────────────────────────────────────────────────────────────────────────────
# Core
# ──────────────────────────────────────────────────────────────────────────────
SECRET_KEY = env("SECRET_KEY")
DEBUG = env.bool("DEBUG", default=False)
ALLOWED_HOSTS = env.list("ALLOWED_HOSTS", default=[])

DJANGO_APPS = [
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
]

THIRD_PARTY_APPS = [
    "rest_framework",
    "rest_framework_simplejwt",
    "rest_framework_simplejwt.token_blacklist",
    "channels",
    "corsheaders",
    "django_celery_beat",
]

LOCAL_APPS = [
    "master",
    "core",
    "authentication",
    "crm",
    "repair",
    "pos",
    "amc",
    "inventory",
    "procurement",
    "billing",
    "commissions",
    "hr",
    "finance",
    "reports",
]

INSTALLED_APPS = DJANGO_APPS + THIRD_PARTY_APPS + LOCAL_APPS

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "core.middleware.TenantMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.debug",
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ]
        },
    }
]

# ──────────────────────────────────────────────────────────────────────────────
# Auth
# ──────────────────────────────────────────────────────────────────────────────
AUTH_USER_MODEL = "authentication.User"

AUTHENTICATION_BACKENDS = [
    "authentication.backends.EmailBackend",
]

PASSWORD_HASHERS = [
    "django.contrib.auth.hashers.BCryptSHA256PasswordHasher",
    "django.contrib.auth.hashers.PBKDF2PasswordHasher",
]

AUTH_PASSWORD_VALIDATORS = [
    {
        "NAME": "django.contrib.auth.password_validation.MinimumLengthValidator",
        "OPTIONS": {"min_length": 8},
    },
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

# ──────────────────────────────────────────────────────────────────────────────
# Database
# ──────────────────────────────────────────────────────────────────────────────
DATABASE_ROUTERS = ["core.routers.TenantDatabaseRouter"]

_master_db = env.db("MASTER_DATABASE_URL")
_master_db["CONN_MAX_AGE"] = 60
# connect_timeout only valid for PostgreSQL
if _master_db.get("ENGINE") == "django.db.backends.postgresql":
    _master_db.setdefault("OPTIONS", {})["connect_timeout"] = 10

DATABASES = {"default": _master_db}

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# ──────────────────────────────────────────────────────────────────────────────
# Cache / Redis
# ──────────────────────────────────────────────────────────────────────────────
REDIS_URL = env("REDIS_URL", default="redis://localhost:6379/0")

CACHES = {
    "default": {
        "BACKEND": "django.core.cache.backends.redis.RedisCache",
        "LOCATION": REDIS_URL,
        "TIMEOUT": 300,
    }
}

# ──────────────────────────────────────────────────────────────────────────────
# Channels (ASGI / WebSocket)
# ──────────────────────────────────────────────────────────────────────────────
CHANNEL_LAYERS = {
    "default": {
        "BACKEND": "channels_redis.core.RedisChannelLayer",
        "CONFIG": {"hosts": [REDIS_URL]},
    }
}

# ──────────────────────────────────────────────────────────────────────────────
# Celery
# ──────────────────────────────────────────────────────────────────────────────
CELERY_BROKER_URL = REDIS_URL
CELERY_RESULT_BACKEND = REDIS_URL
CELERY_ACCEPT_CONTENT = ["json"]
CELERY_TASK_SERIALIZER = "json"
CELERY_RESULT_SERIALIZER = "json"
CELERY_TIMEZONE = "Asia/Kolkata"
# ──────────────────────────────────────────────────────────────────────────────
# WhatsApp (Meta Cloud API)
# ──────────────────────────────────────────────────────────────────────────────
WHATSAPP_PHONE_NUMBER_ID = env("WHATSAPP_PHONE_NUMBER_ID", default="")
WHATSAPP_ACCESS_TOKEN = env("WHATSAPP_ACCESS_TOKEN", default="")
SMS_GATEWAY_KEY = env("SMS_GATEWAY_KEY", default="")

# ── Email ─────────────────────────────────────────────────────────────────────
# Dev: overridden to console backend in local.py / e2e.py
EMAIL_BACKEND = env("EMAIL_BACKEND", default="django.core.mail.backends.smtp.EmailBackend")
EMAIL_HOST = env("EMAIL_HOST", default="")
EMAIL_PORT = env.int("EMAIL_PORT", default=587)
EMAIL_HOST_USER = env("EMAIL_HOST_USER", default="")
EMAIL_HOST_PASSWORD = env("EMAIL_HOST_PASSWORD", default="")
EMAIL_USE_TLS = env.bool("EMAIL_USE_TLS", default=True)
DEFAULT_FROM_EMAIL = env("DEFAULT_FROM_EMAIL", default="noreply@repaiross.app")

CELERY_TASK_ROUTES = {
    "core.dispatch_whatsapp_message": {"queue": "high"},
    "core.dispatch_sms_fallback": {"queue": "high"},
    "core.dispatch_email_message": {"queue": "high"},
    "*.tasks.send_whatsapp_*": {"queue": "high"},
    "*.tasks.generate_pdf_*": {"queue": "high"},
    "*.tasks.generate_report_*": {"queue": "low"},
    "master.tasks.*": {"queue": "low"},
}
CELERY_BEAT_SCHEDULE = {
    # CRM
    "crm-mark-overdue-tasks": {
        "task": "crm.mark_overdue_tasks",
        "schedule": crontab(hour=0, minute=0),
    },
    "crm-send-task-daily-digest": {
        "task": "crm.send_task_daily_digest",
        "schedule": crontab(hour=8, minute=0),
    },
    # Repair
    "repair-send-warranty-expiry-reminders": {
        "task": "repair.send_warranty_expiry_reminders",
        "schedule": crontab(hour=6, minute=0),
    },
    # POS
    "pos-send-wholesale-payment-reminders": {
        "task": "pos.send_wholesale_payment_reminders",
        "schedule": crontab(hour=6, minute=30),
    },
    # AMC
    "amc-mark-missed-visits": {
        "task": "amc.mark_missed_visits",
        "schedule": crontab(hour=0, minute=30),
    },
    "amc-send-renewal-reminders": {
        "task": "amc.send_renewal_reminders",
        "schedule": crontab(hour=8, minute=0),
    },
    "amc-send-visit-reminders": {
        "task": "amc.send_visit_reminders",
        "schedule": crontab(hour=8, minute=15),
    },
    "amc-process-auto-renewals": {
        "task": "amc.process_auto_renewals",
        "schedule": crontab(hour=1, minute=0, day_of_month="1"),
    },
    # HR
    "hr-send-payroll-reminders": {
        "task": "hr.send_payroll_reminders",
        "schedule": crontab(hour=9, minute=0),
    },
    # Procurement
    "procurement-send-bill-due-reminders": {
        "task": "procurement.send_bill_due_reminders",
        "schedule": crontab(hour=7, minute=0),
    },
}

# ──────────────────────────────────────────────────────────────────────────────
# JWT (drf-simplejwt)
# ──────────────────────────────────────────────────────────────────────────────
SIMPLE_JWT = {
    "ACCESS_TOKEN_LIFETIME": timedelta(minutes=15),
    "REFRESH_TOKEN_LIFETIME": timedelta(days=30),
    "ROTATE_REFRESH_TOKENS": True,
    "BLACKLIST_AFTER_ROTATION": True,
    "UPDATE_LAST_LOGIN": True,
    "ALGORITHM": "HS256",
    "SIGNING_KEY": env("JWT_SIGNING_KEY", default=SECRET_KEY),
    "AUTH_HEADER_TYPES": ("Bearer",),
    "USER_ID_FIELD": "id",
    "USER_ID_CLAIM": "user_id",
    "TOKEN_OBTAIN_SERIALIZER": "authentication.tokens.TenantTokenObtainPairSerializer",
    "TOKEN_REFRESH_SERIALIZER": "authentication.tokens.TenantTokenRefreshSerializer",
}

# ──────────────────────────────────────────────────────────────────────────────
# DRF
# ──────────────────────────────────────────────────────────────────────────────
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": ["authentication.tokens.TenantJWTAuthentication"],
    "DEFAULT_PERMISSION_CLASSES": ["rest_framework.permissions.IsAuthenticated"],
    "DEFAULT_RENDERER_CLASSES": ["core.renderers.RepairOSRenderer"],
    "DEFAULT_PAGINATION_CLASS": "core.pagination.RepairOSCursorPagination",
    "PAGE_SIZE": 20,
    "EXCEPTION_HANDLER": "core.exceptions.repairosException_handler",
}

# ──────────────────────────────────────────────────────────────────────────────
# Localisation
# ──────────────────────────────────────────────────────────────────────────────
LANGUAGE_CODE = "en-us"
TIME_ZONE = "Asia/Kolkata"
USE_I18N = True
USE_TZ = True

STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
MEDIA_URL = "/media/"
MEDIA_ROOT = BASE_DIR / "media"

# ──────────────────────────────────────────────────────────────────────────────
# Tenant
# ──────────────────────────────────────────────────────────────────────────────
API_DOMAIN = env("API_DOMAIN", default="api.repaiross.app")
TENANT_CRED_ENCRYPTION_KEY = env("TENANT_CRED_ENCRYPTION_KEY", default="")
TENANT_CACHE_TTL = 300  # 5 min
TENANT_DB_CONN_MAX_AGE = 30
TENANT_DB_MAX_CONNS = 5  # PgBouncer limit per tenant DB
# Host stored in TenantDatabase for every provisioned tenant.
# In local dev set to "pgbouncer"; in prod this is the PgBouncer sidecar hostname.
# Master DB (MASTER_DATABASE_URL) connects directly to postgres so CREATE DATABASE DDL works.
TENANT_DB_HOST = env("TENANT_DB_HOST", default="")

# ──────────────────────────────────────────────────────────────────────────────
# OTP
# ──────────────────────────────────────────────────────────────────────────────
OTP_EXPIRY_SECONDS = 600
OTP_RATE_LIMIT = 3  # max sends per phone per 10 min
OTP_RATE_WINDOW = 600
MAX_OTP_ATTEMPTS = 5
DEV_OTP_ENABLED = env.bool("DEV_OTP_ENABLED", default=False)

# ──────────────────────────────────────────────────────────────────────────────
# Account lockout
# ──────────────────────────────────────────────────────────────────────────────
AUTH_MAX_FAILED_ATTEMPTS = 5
AUTH_LOCKOUT_DURATION_MINUTES = 15
