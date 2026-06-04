Build the RepairOS backend from the spec. This is a multi-tenant (database-per-tenant)
Django + DRF platform.

SPECS (read before writing any code):
- docs/backend-spec/RepairOS-dev-spec/ — read 00-INDEX.md, then ALL of foundation/
  (01-architecture, 02-auth-rbac, 03-conventions). These define isolation, routing,
  the response envelope, error registry, numbering, GST, soft-delete and idempotency
  — everything the modules depend on.
- Then build per module from modules/01-crm.md … 12-platform-admin.md. Each module file
  is self-contained: schema, business rules/state machine, permissions, endpoints with
  example payloads, events, notifications, reports, acceptance criteria, tests.

STACK: Django 5.1 + DRF 3.15, PostgreSQL 16, Celery + Redis, Channels (ASGI/Daphne),
drf-simplejwt, PgBouncer. Master DB + dedicated DB per tenant.

NON-NEGOTIABLE RULES (from foundation):
- DB-per-tenant isolation. NO tenant_id column anywhere in tenant DBs — the connection
  is the tenant context (AD-05). TenantDatabaseRouter + TenantMiddleware resolve the DB
  from the JWT tenant_slug claim.
- Async-safe context: thread-local for WSGI, contextvars.ContextVar for Channels (AD-07).
- Every response uses the envelope in 03-conventions §2; every error uses the registry §3.
- Document numbering generated atomically per shop (03-conventions §4).
- GST per 03-conventions §5 (same-state CGST+SGST / inter-state IGST; SAC labor / HSN goods).
- Soft-delete + idempotency_keys + webhook_events tables from 03-conventions §6–7 are real
  and used.
- Tenant-isolation test (architecture §11) runs on EVERY module — zero cross-tenant leakage
  is a release blocker.

HONOUR THE 🔧 PROPOSED decisions already in the spec unless I say otherwise (SC↔estimate
money flow, soft-delete, idempotency tables, spare-parts table + stage fields, commission
split, module reconciliation).

BUILD ORDER:
1. Project scaffold + settings (master DATABASES, routers, middleware), provisioning
   command, migrate_all_tenants command — all from foundation/01.
2. Auth & RBAC (foundation/02): users/roles/permissions, JWT w/ tenant_slug, seed system
   roles. 12-platform-admin (master DB, tenant registry, provisioning) so tenants exist.
3. Modules: 01-crm, 02-repair, 05-inventory, 06-procurement, 03-pos, 07-billing,
   08-commissions, 04-amc, 09-hr-payroll, 10-finance, 11-reports.

PROCESS:
- First, output a concise build plan (Django apps + ordered task list) and WAIT for my "go".
- Then ONE module at a time. After each: write + run its tests (incl. the isolation test),
  `python manage.py makemigrations --check`, tick off its Acceptance Criteria, and make a
  single commit. Then pause for review.
- If anything in a module contradicts foundation, foundation wins — flag it, don't guess.
- Never weaken tenant isolation for convenience. Ask before adding any cross-tenant query.