# `core` — Module Debug & Status

_Last audited: 2026-07-12 · Backend app `apps/core/`_

## Purpose
Shared infrastructure: tenant context + DB router, soft-delete base models, document counters, Shop/TenantSettings, WhatsApp + notification framework, and DB seeding.

## At a glance
| Metric | Value |
|---|---|
| Test cases | 130 |
| Test status (local) | 130/130 passing — ✅ all passing |
| Lines of code (non-migration) | ~5191 |
| API endpoints (approx) | 1 |
| `services.py` (business logic) | yes |
| `tasks.py` (Celery async) | yes |

## Models
`DocumentCounter`, `Shop`, `TenantSettings`, `WhatsAppConnection`, `NotificationTemplate`, `NotificationLog`, `Notification`, `SeedRun`

## Debug findings
No code defects found. 130/130 tests pass locally.

Largest test suite. Houses core/pdf.py::render_and_save_pdf — the single weasyprint entry point that all PDF-generating modules import.

## Conventions (per project CLAUDE.md)
Every endpoint has serializer + `permission_classes` + tests. Business logic stays in `services.py`
(never in views). Async work goes through Celery. Tenant isolation via the core DB router.
