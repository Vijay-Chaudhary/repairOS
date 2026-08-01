# `commissions` — Module Debug & Status

_Last audited: 2026-07-12 · Backend app `apps/commissions/`_

## Purpose
Technician commission engine: commission rules, computed per-technician commissions, and payouts with generated payout PDFs.

## At a glance
| Metric | Value |
|---|---|
| Test cases | 23 |
| Test status (local) | 16/23 passing — ❌ 7 failing (env only) |
| Lines of code (non-migration) | ~1322 |
| API endpoints (approx) | 4 |
| `services.py` (business logic) | yes |
| `tasks.py` (Celery async) | yes |

## Models
`CommissionRule`, `CommissionPayout`, `TechnicianCommission`

## Debug findings
**7 test(s) failing locally — root cause: missing `weasyprint` in the local env, NOT a code defect.**

- `weasyprint==69.0` is a declared dependency (`backend/requirements/base.txt:15`); it is installed in CI, where these tests pass.
- Test settings set `CELERY_TASK_ALWAYS_EAGER=True` + `CELERY_TASK_EAGER_PROPAGATES=True`, so `.delay()` runs the PDF task inline and its `ModuleNotFoundError` propagates into the API/service call as a 500.
- To reproduce green locally: install weasyprint and its native deps (cairo, pango, gdk-pixbuf), or deselect PDF tests.

7 local failures — ALL from the weasyprint env gap (see debug verdict). create_payout() fires generate_payout_pdf.delay(); under eager+propagate test settings the missing-weasyprint error surfaces as a 500. Green in CI where weasyprint is installed.

## Conventions (per project CLAUDE.md)
Every endpoint has serializer + `permission_classes` + tests. Business logic stays in `services.py`
(never in views). Async work goes through Celery. Tenant isolation via the core DB router.
