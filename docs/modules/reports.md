# `reports` — Module Debug & Status

_Last audited: 2026-07-12 · Backend app `apps/reports/`_

## Purpose
Reporting: dashboards, revenue/outstanding/job-status summaries, GSTR-1, and async export jobs (CSV + PDF).

## At a glance
| Metric | Value |
|---|---|
| Test cases | 49 |
| Test status (local) | 47/49 passing — ❌ 2 failing (env only) |
| Lines of code (non-migration) | ~2497 |
| API endpoints (approx) | 6 |
| `services.py` (business logic) | yes |
| `tasks.py` (Celery async) | yes |

## Models
`ExportJob`

## Debug findings
**2 test(s) failing locally — root cause: missing `weasyprint` in the local env, NOT a code defect.**

- `weasyprint==69.0` is a declared dependency (`backend/requirements/base.txt:15`); it is installed in CI, where these tests pass.
- Test settings set `CELERY_TASK_ALWAYS_EAGER=True` + `CELERY_TASK_EAGER_PROPAGATES=True`, so `.delay()` runs the PDF task inline and its `ModuleNotFoundError` propagates into the API/service call as a 500.
- To reproduce green locally: install weasyprint and its native deps (cairo, pango, gdk-pixbuf), or deselect PDF tests.

2 local failures — PDF export tests hit the weasyprint env gap. CSV export + all data aggregation tests pass. Green in CI.

## Conventions (per project CLAUDE.md)
Every endpoint has serializer + `permission_classes` + tests. Business logic stays in `services.py`
(never in views). Async work goes through Celery. Tenant isolation via the core DB router.
