# `authentication` — Module Debug & Status

_Last audited: 2026-07-12 · Backend app `apps/authentication/`_

## Purpose
RBAC and session auth: Roles, Permissions, per-shop access, audit logging, and JWT token families (rotation + blacklist).

## At a glance
| Metric | Value |
|---|---|
| Test cases | 56 |
| Test status (local) | 56/56 passing — ✅ all passing |
| Lines of code (non-migration) | ~2293 |
| API endpoints (approx) | 20 |
| `services.py` (business logic) | no |
| `tasks.py` (Celery async) | no |

## Models
`Role`, `Permission`, `RolePermission`, `UserRole`, `UserShopAccess`, `AuditLog`, `UserTokenFamily`

## Debug findings
No code defects found. 56/56 tests pass locally.

No services.py — auth logic lives in views/serializers. See simplejwt blacklist master-DB gap when verifying refresh tokens without tenant context.

## Conventions (per project CLAUDE.md)
Every endpoint has serializer + `permission_classes` + tests. Business logic stays in `services.py`
(never in views). Async work goes through Celery. Tenant isolation via the core DB router.
