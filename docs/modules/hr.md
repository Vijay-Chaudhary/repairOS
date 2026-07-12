# `hr` — Module Debug & Status

_Last audited: 2026-07-12 · Backend app `apps/hr/`_

## Purpose
Human resources: employees, departments, attendance, leave requests, and salary slips with generated slip PDFs.

## At a glance
| Metric | Value |
|---|---|
| Test cases | 35 |
| Test status (local) | 34/35 passing — ❌ 1 failing (env only) |
| Lines of code (non-migration) | ~2407 |
| API endpoints (approx) | 12 |
| `services.py` (business logic) | yes |
| `tasks.py` (Celery async) | yes |

## Models
`Employee`, `Department`, `AttendanceRecord`, `LeaveRequest`, `SalarySlip`

## Debug findings
**1 test(s) failing locally — root cause: missing `weasyprint` in the local env, NOT a code defect.**

- `weasyprint==69.0` is a declared dependency (`backend/requirements/base.txt:15`); it is installed in CI, where these tests pass.
- Test settings set `CELERY_TASK_ALWAYS_EAGER=True` + `CELERY_TASK_EAGER_PROPAGATES=True`, so `.delay()` runs the PDF task inline and its `ModuleNotFoundError` propagates into the API/service call as a 500.
- To reproduce green locally: install weasyprint and its native deps (cairo, pango, gdk-pixbuf), or deselect PDF tests.

1 local failure — test_approve_slip: approving a slip triggers generate_salary_pdf, which hits the weasyprint env gap. Historic department_ref_id migration drift is a separate deployment issue, not a code bug.

## Conventions (per project CLAUDE.md)
Every endpoint has serializer + `permission_classes` + tests. Business logic stays in `services.py`
(never in views). Async work goes through Celery. Tenant isolation via the core DB router.
