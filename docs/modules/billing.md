# `billing` — Module Debug & Status

_Last audited: 2026-07-12 · Backend app `apps/billing/`_

## Purpose
Repair invoicing + GST: invoices, line items, payments, tax rates, credit notes, refunds. Celery for PDF/WhatsApp dispatch.

## At a glance
| Metric | Value |
|---|---|
| Test cases | 40 |
| Test status (local) | 40/40 passing — ✅ all passing |
| Lines of code (non-migration) | ~2743 |
| API endpoints (approx) | 15 |
| `services.py` (business logic) | yes |
| `tasks.py` (Celery async) | yes |

## Models
`RepairInvoice`, `RepairInvoiceItem`, `Payment`, `TaxRate`, `CreditNote`, `Refund`

## Debug findings
No code defects found. 40/40 tests pass locally.

Duplicate-invoice now raises BusinessRuleViolation (422), not a bare 400.

## Conventions (per project CLAUDE.md)
Every endpoint has serializer + `permission_classes` + tests. Business logic stays in `services.py`
(never in views). Async work goes through Celery. Tenant isolation via the core DB router.
