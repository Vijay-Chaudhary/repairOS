# `procurement` — Module Debug & Status

_Last audited: 2026-07-12 · Backend app `apps/procurement/`_

## Purpose
Procurement: suppliers, purchase orders, goods receipt notes, purchase invoices + payments, purchase returns, and debit notes.

## At a glance
| Metric | Value |
|---|---|
| Test cases | 39 |
| Test status (local) | 39/39 passing — ✅ all passing |
| Lines of code (non-migration) | ~2771 |
| API endpoints (approx) | 10 |
| `services.py` (business logic) | yes |
| `tasks.py` (Celery async) | yes |

## Models
`Supplier`, `PurchaseOrder`, `PurchaseOrderItem`, `GoodsReceiptNote`, `GRNItem`, `PurchaseInvoice`, `PurchasePayment`, `PurchaseReturn`, `PurchaseReturnItem`, `DebitNote`

## Debug findings
No code defects found. 39/39 tests pass locally.

Feeds inventory stock on GRN receipt.

## Conventions (per project CLAUDE.md)
Every endpoint has serializer + `permission_classes` + tests. Business logic stays in `services.py`
(never in views). Async work goes through Celery. Tenant isolation via the core DB router.
