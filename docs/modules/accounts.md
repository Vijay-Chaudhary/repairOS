# `accounts` — Module Debug & Status

_Last audited: 2026-07-12 · Backend app `apps/accounts/`_

## Purpose
Double-entry accounting core: Chart of Accounts, Journal Entries/Lines, auto-posting via AccountMapping. Foundation for financial statements (P&L / Balance Sheet).

## At a glance
| Metric | Value |
|---|---|
| Test cases | 59 |
| Test status (local) | 59/59 passing — ✅ all passing |
| Lines of code (non-migration) | ~2771 |
| API endpoints (approx) | 10 |
| `services.py` (business logic) | yes |
| `tasks.py` (Celery async) | no |

## Models
`Account`, `JournalEntry`, `JournalLine`, `AccountMapping`

## Debug findings
No code defects found. 59/59 tests pass locally.

Delivered in Phase 8a (core) + 8b (auto-posting). Financial statements (Phase 9) read from these ledgers.

## Conventions (per project CLAUDE.md)
Every endpoint has serializer + `permission_classes` + tests. Business logic stays in `services.py`
(never in views). Async work goes through Celery. Tenant isolation via the core DB router.
