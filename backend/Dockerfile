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

# seed.sh: runs master migrate → seeds demo tenants → starts daphne
CMD ["/app/infra/docker/seed.sh"]

# ── Production stage ──────────────────────────────────────────────────────────
FROM base AS production

ENV DJANGO_SETTINGS_MODULE=config.settings.production

COPY requirements/base.txt requirements/base.txt
RUN pip install -r requirements/base.txt

COPY . .

RUN python manage.py collectstatic --noinput

EXPOSE 8000

CMD ["daphne", "-b", "0.0.0.0", "-p", "8000", "config.asgi:application"]
