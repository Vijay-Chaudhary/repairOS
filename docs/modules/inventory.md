# `inventory` — Module Debug & Status

_Last audited: 2026-07-12 · Backend app `apps/inventory/`_

## Purpose
Inventory management: product categories, products, variants, stock levels, and inventory transactions (movements).

## At a glance
| Metric | Value |
|---|---|
| Test cases | 26 |
| Test status (local) | 26/26 passing — ✅ all passing |
| Lines of code (non-migration) | ~1777 |
| API endpoints (approx) | 11 |
| `services.py` (business logic) | yes |
| `tasks.py` (Celery async) | no |

## Models
`ProductCategory`, `Product`, `ProductVariant`, `InventoryStock`, `InventoryTransaction`

## Debug findings
No code defects found. 26/26 tests pass locally.

Soft-delete list ordering warning (cosmetic).

## Conventions (per project CLAUDE.md)
Every endpoint has serializer + `permission_classes` + tests. Business logic stays in `services.py`
(never in views). Async work goes through Celery. Tenant isolation via the core DB router.
