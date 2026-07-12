# `finance` — Module Debug & Status

_Last audited: 2026-07-12 · Backend app `apps/finance/`_

## Purpose
Operational finance: petty cash accounts + transactions, budget heads/allocations, expenses, and shop assets.

## At a glance
| Metric | Value |
|---|---|
| Test cases | 30 |
| Test status (local) | 30/30 passing — ✅ all passing |
| Lines of code (non-migration) | ~1773 |
| API endpoints (approx) | 8 |
| `services.py` (business logic) | yes |
| `tasks.py` (Celery async) | no |

## Models
`PettyCashAccount`, `PettyCashTransaction`, `BudgetHead`, `BudgetAllocation`, `Expense`, `ShopAsset`

## Debug findings
No code defects found. 30/30 tests pass locally.

No Celery tasks. Permission-slug drift with reports previously fixed (view/test slugs aligned to seed).

## Conventions (per project CLAUDE.md)
Every endpoint has serializer + `permission_classes` + tests. Business logic stays in `services.py`
(never in views). Async work goes through Celery. Tenant isolation via the core DB router.
