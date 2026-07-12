# `pos` — Module Debug & Status

_Last audited: 2026-07-12 · Backend app `apps/pos/`_

## Purpose
Point of sale: sales, sale items, sale payments, sales returns, and POS credit notes.

## At a glance
| Metric | Value |
|---|---|
| Test cases | 43 |
| Test status (local) | 43/43 passing — ✅ all passing |
| Lines of code (non-migration) | ~2468 |
| API endpoints (approx) | 4 |
| `services.py` (business logic) | yes |
| `tasks.py` (Celery async) | yes |

## Models
`Sale`, `SaleItem`, `SalePayment`, `SalesReturn`, `SalesReturnItem`, `CreditNote`

## Debug findings
No code defects found. 43/43 tests pass locally.

Soft-delete list ordering warning (cosmetic).

## Conventions (per project CLAUDE.md)
Every endpoint has serializer + `permission_classes` + tests. Business logic stays in `services.py`
(never in views). Async work goes through Celery. Tenant isolation via the core DB router.
