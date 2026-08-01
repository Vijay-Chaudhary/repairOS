# `repair` — Module Debug & Status

_Last audited: 2026-07-12 · Backend app `apps/repair/`_

## Purpose
Core repair workflow: fault templates + parts, job tickets, check-in conditions, estimates, stages, spare-part requests, and attachments.

## At a glance
| Metric | Value |
|---|---|
| Test cases | 94 |
| Test status (local) | 94/94 passing — ✅ all passing |
| Lines of code (non-migration) | ~4675 |
| API endpoints (approx) | 8 |
| `services.py` (business logic) | yes |
| `tasks.py` (Celery async) | yes |

## Models
`FaultTemplate`, `FaultTemplatePart`, `JobTicket`, `JobCheckinCondition`, `JobEstimate`, `JobStage`, `JobSparePartRequest`, `JobAttachment`

## Debug findings
No code defects found. 94/94 tests pass locally.

The heart of the product. Soft-delete list ordering warning on JobTicket (cosmetic).

## Conventions (per project CLAUDE.md)
Every endpoint has serializer + `permission_classes` + tests. Business logic stays in `services.py`
(never in views). Async work goes through Celery. Tenant isolation via the core DB router.
