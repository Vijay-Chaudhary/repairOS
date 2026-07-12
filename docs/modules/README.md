# RepairOS Backend — Module Debug & Status Index

_Audited 2026-07-12 · Django app suite under `backend/apps/`_

This directory holds one debug/status document per backend module, produced by a systematic
debugging pass over the whole test suite. Each page records the module's purpose, models,
API surface, test status, and any findings.

## Debug verdict (whole backend)

**No genuine code defects found. Suite is healthy.**

- **834 / 844 tests pass** locally (full run, ~24s).
- **10 failures, single root cause:** `ModuleNotFoundError: No module named 'weasyprint'`.
  `weasyprint==69.0` is a **declared dependency** (`backend/requirements/base.txt:15`) that simply
  isn't installed in this local environment (it needs native libs: cairo, pango, gdk-pixbuf). It **is**
  installed in CI, so the suite is green there.
- Why a missing PDF lib fails *business-logic* tests: `config/settings/test.py` sets
  `CELERY_TASK_ALWAYS_EAGER=True` and `CELERY_TASK_EAGER_PROPAGATES=True`. So `generate_*_pdf.delay(...)`
  runs **inline** inside the request, and the render error propagates up as a 500. In production `.delay()`
  is truly asynchronous, so a PDF-render failure would not fail the originating API call.

The 10 failures span exactly three modules: **commissions (7), reports (2), hr (1)** — all PDF paths.

### To make the suite fully green locally
```bash
# install weasyprint + native deps, then:
cd backend && pytest
# — or skip the PDF paths:
cd backend && pytest -k "not pdf and not approve_slip and not payout_pdf"
```

### Latent robustness note (not a failing test, worth tracking)
`CELERY_TASK_EAGER_PROPAGATES=True` means any real PDF-render error (bad template, missing font)
would 500 the originating write. In async production the write succeeds but the PDF task can fail
after retries, leaving a record with no document. If PDF generation should never block the core
write, consider making the `.delay()` dispatch best-effort. Left as-is — changing it is a design
decision, not a bug fix, and out of scope for this debugging pass.

## Modules

| Module | Purpose | Tests | Status |
|---|---|---|---|
| [accounts](accounts.md) | Double-entry accounting core (CoA, journals, auto-posting) | 59 | ✅ |
| [amc](amc.md) | Annual maintenance contracts, visits, renewals | 21 | ✅ |
| [authentication](authentication.md) | RBAC, per-shop access, JWT token families, audit | 56 | ✅ |
| [billing](billing.md) | Repair invoicing + GST, payments, credit notes, refunds | 40 | ✅ |
| [commissions](commissions.md) | Commission rules, technician commissions, payouts | 23 | ⚠️ 7 env-only |
| [core](core.md) | Tenant infra, soft-delete, notifications, PDF entry point, seeding | 130 | ✅ |
| [crm](crm.md) | Leads, customers, campaigns, deals, follow-ups | 108 | ✅ |
| [finance](finance.md) | Petty cash, budgets, expenses, shop assets | 30 | ✅ |
| [hr](hr.md) | Employees, attendance, leave, salary slips | 35 | ⚠️ 1 env-only |
| [inventory](inventory.md) | Products, variants, stock, transactions | 26 | ✅ |
| [master](master.md) | Platform control-plane (tenants, subscriptions, admin) | 82 | ✅ |
| [pos](pos.md) | Point of sale, returns, credit notes | 43 | ✅ |
| [procurement](procurement.md) | Suppliers, POs, GRN, purchase invoices, returns | 39 | ✅ |
| [repair](repair.md) | Job tickets, fault templates, estimates, stages | 94 | ✅ |
| [reports](reports.md) | Dashboards, GSTR-1, async CSV/PDF exports | 49 | ⚠️ 2 env-only |

⚠️ = local-only failures from the weasyprint env gap; green in CI.

## Method
This audit followed the systematic-debugging discipline: gather evidence before proposing fixes.
Collection found zero import errors (844 tests). A full run isolated the 10 failures; reading the
tracebacks traced every one to a single environmental cause (missing `weasyprint`), confirmed against
the declared dependency and eager-Celery test settings. No speculative fixes were applied because the
root cause is environmental, not a code defect.
