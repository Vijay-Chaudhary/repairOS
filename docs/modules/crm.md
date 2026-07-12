# `crm` — Module Debug & Status

_Last audited: 2026-07-12 · Backend app `apps/crm/`_

## Purpose
Customer relationship management: leads, quotes, customers, communication logs, follow-up tasks, segments, campaigns, contacts, and deals.

## At a glance
| Metric | Value |
|---|---|
| Test cases | 108 |
| Test status (local) | 108/108 passing — ✅ all passing |
| Lines of code (non-migration) | ~4920 |
| API endpoints (approx) | 11 |
| `services.py` (business logic) | yes |
| `tasks.py` (Celery async) | yes |

## Models
`Lead`, `LeadQuote`, `Customer`, `CommunicationLog`, `FollowUpTask`, `CustomerSegment`, `CustomerSegmentMember`, `Campaign`, `Contact`, `Deal`

## Debug findings
No code defects found. 108/108 tests pass locally.

Quick-create customer from /jobs/new requires shop_id (fixed in #41).

## Conventions (per project CLAUDE.md)
Every endpoint has serializer + `permission_classes` + tests. Business logic stays in `services.py`
(never in views). Async work goes through Celery. Tenant isolation via the core DB router.
