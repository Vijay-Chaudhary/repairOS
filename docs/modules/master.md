# `master` — Module Debug & Status

_Last audited: 2026-07-12 · Backend app `apps/master/`_

## Purpose
Platform control-plane (master DB): Tenant, TenantDatabase, subscription plans + subscriptions, master-level audit, and platform-admin token families.

## At a glance
| Metric | Value |
|---|---|
| Test cases | 82 |
| Test status (local) | 82/82 passing — ✅ all passing |
| Lines of code (non-migration) | ~3935 |
| API endpoints (approx) | 14 |
| `services.py` (business logic) | yes |
| `tasks.py` (Celery async) | yes |

## Models
`Tenant`, `TenantDatabase`, `SubscriptionPlan`, `TenantSubscription`, `AuditLogMaster`, `PlatformAdminTokenFamily`

## Debug findings
No code defects found. 82/82 tests pass locally.

Runs against the master DB, not per-tenant. create_tenant autocommit desync previously caused lost master-DB writes / stuck provisioning — verify set_session behaviour on changes here.

## Conventions (per project CLAUDE.md)
Every endpoint has serializer + `permission_classes` + tests. Business logic stays in `services.py`
(never in views). Async work goes through Celery. Tenant isolation via the core DB router.
