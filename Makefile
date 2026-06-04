.PHONY: up down logs build migrate migrate-tenant seed-tenant shell test \
        pgbouncer-admin minio-console

# ── Lifecycle ────────────────────────────────────────────────────────────────

up:
	docker compose up -d

down:
	docker compose down

build:
	docker compose build --no-cache

# Follow logs for one or all services: make logs  OR  make logs s=backend
logs:
ifdef s
	docker compose logs -f $(s)
else
	docker compose logs -f
endif

# ── Database ─────────────────────────────────────────────────────────────────

# Run master migrations only
migrate:
	docker compose exec backend python manage.py migrate --database=default

# Run tenant migrations across all active tenants (arch §6)
migrate-tenants:
	docker compose exec backend python manage.py migrate_all_tenants

# Provision a new tenant from the command line.
# Usage: make seed-tenant SLUG=myshop NAME="My Shop" EMAIL=admin@my.com PHONE=+91XXXXXXXXXX PASS=secret123
seed-tenant:
ifndef SLUG
	$(error SLUG is required. Usage: make seed-tenant SLUG=myshop NAME="My Shop" EMAIL=admin@my.com PHONE=+91XXXXXXXXXX PASS=secret123)
endif
	docker compose exec backend python manage.py create_tenant \
		--slug "$(SLUG)" \
		--name "$(NAME)" \
		--email "$(EMAIL)" \
		--phone "$(PHONE)" \
		--admin-password "$(PASS)"

# ── Development utilities ────────────────────────────────────────────────────

# Django shell (backend container)
shell:
	docker compose exec backend python manage.py shell

# Run backend test suite
test:
	docker compose exec backend pytest $(ARGS)

# PgBouncer admin console (shows SHOW POOLS, SHOW STATS, RELOAD, etc.)
pgbouncer-admin:
	docker compose exec pgbouncer psql -h 127.0.0.1 -p 5432 -U pgbouncer_admin pgbouncer

# MinIO web console in your default browser
minio-console:
	@echo "MinIO console: http://localhost:9001"
	@echo "User: $$(grep MINIO_ROOT_USER .env | cut -d= -f2)"
