# `amc` — Module Debug & Status

_Last audited: 2026-07-12 · Backend app `apps/amc/`_

## Purpose
Annual Maintenance Contracts: contract lifecycle, scheduled service visits, and renewal invoicing. Celery tasks drive renewal reminders.

## At a glance
| Metric | Value |
|---|---|
| Test cases | 21 |
| Test status (local) | 21/21 passing — ✅ all passing |
| Lines of code (non-migration) | ~1528 |
| API endpoints (approx) | 3 |
| `services.py` (business logic) | yes |
| `tasks.py` (Celery async) | yes |

## Models
`AMCContract`, `AMCVisit`, `AMCRenewalInvoice`

## Debug findings
No code defects found. 21/21 tests pass locally.

Soft-delete list ordering emits an UnorderedObjectListWarning (pagination) — cosmetic, not a failure.

## Conventions (per project CLAUDE.md)
Every endpoint has serializer + `permission_classes` + tests. Business logic stays in `services.py`
(never in views). Async work goes through Celery. Tenant isolation via the core DB router.
