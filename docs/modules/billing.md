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

### Invoice PDFs (2026-08-01)

`GET /api/v1/billing/repair-invoices/<id>/pdf/` returns the PDF **bytes**
(`application/pdf`), not `{"pdf_url": …}`. It streams the stored file when one
exists under `MEDIA_ROOT` and renders on demand otherwise, so a failed or
never-run `generate_invoice_pdf` task no longer produces a blank tab. Render
failures return 500 `PDF_RENDER_FAILED` in the standard envelope.

## Conventions (per project CLAUDE.md)
Every endpoint has serializer + `permission_classes` + tests. Business logic stays in `services.py`
(never in views). Async work goes through Celery. Tenant isolation via the core DB router.
