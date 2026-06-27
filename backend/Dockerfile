FROM python:3.11-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
        libpq-dev \
        gcc \
        curl \
    && rm -rf /var/lib/apt/lists/*

# ── Dev stage ─────────────────────────────────────────────────────────────────
# Source code is mounted at runtime via volume — not copied here.
# Installs both base + local deps (pytest, ipython, debug-toolbar).
FROM base AS dev

ENV DJANGO_SETTINGS_MODULE=config.settings.local

COPY requirements/base.txt  requirements/base.txt
COPY requirements/local.txt requirements/local.txt
RUN pip install -r requirements/local.txt

EXPOSE 8000

# entrypoint.sh: runs master migrate → seeds demo tenants → starts daphne
CMD ["/app/entrypoint.sh"]

# ── Production stage ──────────────────────────────────────────────────────────
FROM base AS production

ENV DJANGO_SETTINGS_MODULE=config.settings.production

COPY requirements/base.txt requirements/base.txt
RUN pip install -r requirements/base.txt

COPY . .

# NOTE: collectstatic runs at container start (entrypoint.production.sh), not at
# build time — production settings require ALLOWED_HOSTS et al. from the
# environment, which is not available during `docker build`.

# Run as a non-root user (least privilege). Pre-create the writable dirs and own
# them so the mounted static_files volume inherits the right ownership on first
# creation; entrypoint runs collectstatic into /app/staticfiles as this user.
RUN groupadd -r appuser && useradd -r -g appuser appuser \
    && mkdir -p /app/staticfiles /app/media \
    && chown -R appuser:appuser /app
USER appuser

EXPOSE 8000

# Default command: the backend service overrides this with the prod entrypoint
# (migrate + collectstatic + daphne); celery services override it entirely.
CMD ["daphne", "-b", "0.0.0.0", "-p", "8000", "config.asgi:application"]
