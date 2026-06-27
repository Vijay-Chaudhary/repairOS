# CRM Overhaul — Phase 8: Campaigns (bulk-WhatsApp history) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:test-driven-development. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Elevate the fire-and-forget segment bulk-send into a tracked **Campaigns** feature. Today `POST /segments/{id}/bulk-whatsapp/` queues messages and returns counts but **records nothing**. Phase 8 adds a `Campaign` model + endpoints and a `/crm/campaigns` page (history list + a "new campaign" flow). Send stays **manual** — no scheduling.

**Architecture:** Backend gains a `Campaign` model (tenant DB, soft-delete) and a `CampaignViewSet` (list / retrieve / create). Create reuses the existing `services.segment_recipient_ids` (single source of truth for opt-out exclusion) to compute `recipient_count` / `excluded_optout_count`, persists the campaign, then fires the existing `send_bulk_whatsapp_segment` Celery task. Business logic lives in a new `services.create_campaign` (project rule: logic in services, not views). Frontend adds a CRM nav leaf and a page mirroring the existing `BulkWhatsappDialog` recipient-count preview.

**Tech Stack:** Django 5 + DRF (pytest); Next.js 14 + TS + React Query (Vitest).

**Source spec:** `docs/superpowers/specs/2026-06-24-crm-overhaul-design.md` (Phase 8).

---

## Key facts (verified against the codebase)

- `services.segment_recipient_ids(segment)` (`services.py:319`) returns `(total_members, opted_in_ids)` for both dynamic and static segments — the same call the recipient-count preview and bulk-send already use. `recipient_count = len(ids)`, `excluded_optout_count = total - len(ids)`.
- `send_bulk_whatsapp_segment` (`tasks.py`) takes `customer_ids`, `template_name`, `variables`. Existing `bulk_whatsapp` view (`views.py:460`) shows the call shape. `CELERY_TASK_ALWAYS_EAGER=True` in `config/settings/test.py`, so `.delay()` runs inline in tests and would hit `send_whatsapp` — **patch `crm.tasks.send_bulk_whatsapp_segment.delay` in the create test** (mirrors `test_tasks.py`).
- Model bases (`models.py`): `SoftDeleteModel` (→ `BaseModel`: `id` UUID, `created_at`, `updated_at`; soft-delete adds `deleted_at`/`deleted_by`). `CustomerSegment` is `SoftDeleteModel`, `db_table="customer_segments"`. FK-to-user pattern: `LeadQuote.sent_by` / `CommunicationLog.logged_by` are `ForeignKey(settings.AUTH_USER_MODEL, on_delete=PROTECT)`.
- Audit: `services._write_audit(user_id, AuditLog.Action.CREATE, "ModelName", instance.id)` is how other creates record audit (e.g. `CommunicationLogViewSet.perform_create`).
- Segments viewset is **not** shop-scoped (`CustomerSegmentViewSet.get_queryset → CustomerSegment.objects.all()`), gated `crm.segments.manage`. Campaigns follow the same gate and (lack of) scoping for consistency.
- Migrations: numbered `000N_*.py`; `CreateModel` is auto-reversible. Latest is `0004_customer_last_visit.py` → new `0005_add_campaign.py`.
- Frontend: `crmApi.listSegments()` (`crm.ts:309`), `crmApi.getSegmentRecipientCount(id)` (`crm.ts:338`) already exist. `BulkWhatsappDialog` (`crm/segments/page.tsx:413`) is the template + recipient-count-preview pattern to mirror (template is a free-text input). `DataTable` + `StatusBadge` + `formatDatetime` for the history list.
- Nav: CRM group in `AppShell.tsx`; add **Campaigns** leaf gated `crm.segments.manage`. `navItems.test.ts` enumerates CRM leaves.

## File structure

```
backend/apps/crm/
  models.py                          # + Campaign
  migrations/0005_add_campaign.py    # NEW (generated)
  services.py                        # + create_campaign
  serializers.py                     # + CampaignSerializer, CampaignCreateSerializer
  views.py                           # + CampaignViewSet
  urls.py                            # register campaigns
  tests/test_campaigns.py            # NEW — create/list + opt-out counting
frontend/src/
  app/(app)/crm/campaigns/page.tsx                  # NEW — history + new-campaign flow
  app/(app)/crm/campaigns/__tests__/campaigns.test.tsx # NEW
  components/shared/AppShell.tsx                     # + Campaigns nav leaf
  components/shared/__tests__/navItems.test.ts      # update CRM leaves
  lib/api/crm.ts                                     # Campaign type + list/create
  lib/query/keys.ts                                 # qk.campaigns
```

---

## Steps

- [x] **Step 1: Campaign model + migration** — add `Campaign(SoftDeleteModel)`: `name` (CharField), `segment` (FK `CustomerSegment`, PROTECT, related_name `campaigns`), `template` (CharField), `status` (TextChoices draft/sending/sent/failed, default sent), `recipient_count` (IntegerField default 0), `excluded_optout_count` (IntegerField default 0), `sent_at` (DateTimeField null), `created_by` (FK user, PROTECT, related_name `created_campaigns`). `db_table="campaigns"`, `ordering=["-created_at"]`. `python manage.py makemigrations crm` → `0005_add_campaign.py`; `makemigrations crm --check` → clean.

- [x] **Step 2: Backend tests (red)** — new `tests/test_campaigns.py`:
  - `POST /api/v1/crm/campaigns/` with a dynamic segment (1 opted-in + 1 opted-out customer) → 201, persists `recipient_count=1`, `excluded_optout_count=1`, `status="sent"`, `sent_at` set, `segment_name` in payload; patches the send task's `.delay`.
  - The send task is queued with the opted-in customer ids only (assert on the patched mock).
  - `GET /api/v1/crm/campaigns/` lists created campaigns newest-first.
  - `GET /api/v1/crm/campaigns/{id}/` returns detail.
  - `crm.segments.manage` required (403 without).

- [x] **Step 3: Backend implementation (green)**
  - `services.create_campaign(segment, name, template, variables, user)`: compute `(total, ids)` via `segment_recipient_ids`; create `Campaign(status=SENT, sent_at=now, recipient_count=len(ids), excluded_optout_count=total-len(ids), created_by=user)`; if `ids`, fire `send_bulk_whatsapp_segment.delay(...)`; `_write_audit`; return campaign.
  - `serializers.py`: `CampaignSerializer` (read; `segment_name` from `segment.name`, `created_by_name`); `CampaignCreateSerializer` (input: `name`, `segment_id`, `template`, optional `variables`).
  - `views.py`: `CampaignViewSet(ListModelMixin, RetrieveModelMixin, CreateModelMixin, GenericViewSet)` — gate `crm.segments.manage`, `RepairOSPageNumberPagination`, `get_queryset` = `Campaign.objects.select_related("segment","created_by").order_by("-created_at")`, `create` resolves the segment (404 if missing) and delegates to `services.create_campaign`.
  - `urls.py`: register `campaigns`.
  - Run: `python -m pytest apps/crm/tests/test_campaigns.py --no-cov -q` → green; `makemigrations crm --check --dry-run` → clean.

- [x] **Step 4: Frontend API + types + nav** — `crm.ts`: `Campaign` type + `CampaignStatus`, `listCampaigns()`, `createCampaign(body)`; `keys.ts`: `qk.campaigns`. `AppShell.tsx`: Campaigns leaf gated `crm.segments.manage`; update `navItems.test.ts`.

- [x] **Step 5: Frontend page (TDD)** — `/crm/campaigns/page.tsx`: history `DataTable` (name, segment, recipients, excluded opt-outs, status badge, sent date) + "New campaign" dialog (pick segment → template free-text → recipient-count preview via `getSegmentRecipientCount` → send, disabled at 0 recipients); skeleton/empty/error; wrapped in `<Can permission="crm.segments.manage">`. New `campaigns.test.tsx`: renders history rows, opens the dialog, previews count, creates.

- [x] **Step 6: Tests + type-check** — `npx vitest run` (campaigns + navItems) PASS; `npx tsc --noEmit … || echo OK` → `OK`.

- [x] **Step 7: Commit + PR** on `feat/crm-overhaul-phase-8-campaigns` (commit only Phase 8 files; leave deployment WIP untouched).

---

## Final verification

- [x] **Backend** — `python -m pytest apps/crm/tests/ --no-cov -q` → 0 failed; `makemigrations crm --check --dry-run` → `No changes detected`; migration is reversible (`migrate crm 0004` then back, sanity).
- [x] **Frontend** — full `npx vitest run` green; `tsc --noEmit … || echo OK` → `OK`.
- [ ] **Manual smoke — live UI** (needs Docker): CRM → Campaigns → New campaign → pick segment → preview count (opt-out excluded) → send → row appears with status + counts.

---

## Notes / risks

- **Migration required** (first model addition in this overhaul). `CreateModel` is auto-reversible.
- **Status model** — send is fire-and-forget via Celery with no completion callback, so create sets `status="sent"` (the record means "this campaign was sent"). `draft`/`sending`/`failed` exist in the enum for future use; `failed` could later be set if the task chord reports errors.
- **`variables`** is accepted on create and passed to the send task but **not persisted** (spec's field list omits it). Add a column later if campaign re-inspection needs it.
- **No shop scoping** — mirrors the existing `CustomerSegmentViewSet` (segments aren't shop-scoped). Consistent with the gate `crm.segments.manage`.
- **Independent of PRs #13–#15** except the shared `AppShell.tsx` / `navItems.test.ts` (trivial merge if those land first).
