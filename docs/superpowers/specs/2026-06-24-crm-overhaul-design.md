# CRM Overhaul — Design Spec

**Date:** 2026-06-24
**Status:** Approved (pending implementation plans)
**Specs paired:** `docs/backend-spec/RepairOS-dev-spec/modules/01-crm.md`,
`docs/frontend-spec/RepairOS-frontend-spec/modules/01-crm-ui.md`

## Goal

Bring the CRM **frontend + navigation** up to the spec. The CRM backend is essentially
complete (leads convert/status/quote, customers merge/timeline, communications, tasks
complete, segments members/bulk-whatsapp all exist). This overhaul surfaces hidden
capabilities in the nav, adds a read-only **Overview hub**, and closes the
leads / customer-profile / segments / mobile gaps.

**Only one piece of net-new backend work exists** — the CRM Overview aggregation endpoint
(plus a small leads date-range filter). Everything else reuses existing APIs.

Work is split into **five independently-shippable phases**, each its own implementation plan
and PR, sequenced 1 → 5 — mirroring the proven Repair Overhaul pattern.

## Current state (baseline)

- **Nav (CRM group):** only **Customers** and **Leads** are surfaced.
- **Leads** `/leads`: kanban + list, search, **source** filter, drag-to-advance.
- **Customers** `/customers` + profile `/customers/[id]`: tabs = Repair · Timeline · Tasks ·
  Financial. Merge dialog, tag input, log-communication sheet present.
- **Tasks** `/tasks`: page exists but is **not in the CRM nav**.
- **Segments** `/settings/segments`: page exists but is buried under Settings, **not in CRM nav**.

### Verified dependencies
- `LeadViewSet.get_queryset` already supports `search`, `status`, `assigned_to`, `shop_id`
  filters — but **no date-range filter**.
- `pos/views.py` and `amc/views.py` already filter their list endpoints by `customer_id`.
- Frontend `posApi.listSales(...)` and `amcApi.listContracts(...)` exist; the profile Repair
  tab already uses the same pattern via `repairApi.listJobs({ customer_id })`.

---

## Phase 1 — Nav restructure + CRM Overview hub

*The only phase with backend work.*

### Nav
- `frontend/src/components/shared/AppShell.tsx` `NAV_ITEMS`: CRM group becomes
  **Overview · Customers · Leads · Tasks · Segments**.
  - Overview → `/crm`, gate `crm.customers.view` (read-only hub).
  - Tasks → `/tasks` (existing page), gate `crm.tasks.manage`.
  - Segments → `/crm/segments` (new home, see Phase 4), gate `crm.segments.manage`.
- Surfaces Tasks and Segments, which already exist but are unreachable from the CRM nav today.

### Backend — `GET /api/crm/overview/`
- Service-layer aggregation in `apps/crm/services.py`, shop-scoped, **no N+1** (a handful of
  aggregate queries), mirroring the Repair `overview` endpoint.
- Returns:
  - `pipeline`: lead counts by status (new/contacted/interested/quoted/converted/lost).
  - `tasks`: `due_today` count, `overdue` count.
  - `recent_conversions`: leads converted in the last 30 days (count + small list).
  - `new_customers`: count created in the last 30 days.
  - `needs_attention`: overdue tasks + unassigned `new` leads (small lists for the hub).
- DRF `APIView` (read-only) + serializer + `permission_classes`; pytest coverage
  (happy path + shop isolation + empty-tenant).

### Frontend — `/crm` page
- KPI tiles (pipeline totals, tasks due/overdue, new customers, recent conversions),
  a pipeline-by-status bar, and a "needs attention" list.
- Skeleton, empty, and error states; tiles/list deep-link into Leads / Tasks / Customers.
- React Query key `['crm','overview', shopFilter]`.

---

## Phase 2 — Leads filters + re-open verification

### Frontend `/leads`
- Add **assigned_to** filter (backend already supports it) — a user `Select`.
- Add **date-range** filter (created_at `date_from` / `date_to`).
- Render active filters as removable chips alongside the existing source filter; applies to
  both kanban (per-column queries) and list views via the shared `baseFilters`.

### Backend `LeadViewSet.get_queryset`
- Add `date_from` / `date_to` filtering on `created_at` (inclusive range) + a unit test.

### Lead re-open
- Verify (fix if needed) that re-opening a lost lead moves the board card to its **exact prior
  column** (`status_before_lost`), per `01-crm-ui.md` §10 — not always "interested". The
  backend `status` action already restores `status_before_lost`; this is a frontend board /
  query-invalidation check, with a Vitest assertion.

---

## Phase 3 — Customer profile: Sales + AMC tabs

### Frontend `/customers/[id]`
- Add a **Sales** tab — `posApi.listSales({ customer_id: id })`.
- Add an **AMC** tab — `amcApi.listContracts({ customer_id: id })`.
- Each is a lazy-loaded `DataTable` with its own skeleton / empty / error state, following the
  existing Repair-history tab pattern.
- Final tab order: **Repair · Sales · AMC · Timeline · Tasks · Financial** — matching
  `01-crm.md` §4.2.
- If `SaleFilters` / the contract filter type lack `customer_id`, add it (trivial type change;
  the backends already honor the param).

---

## Phase 4 — Segments → CRM + builder + bulk-WhatsApp

### Route move
- `/settings/segments` → `/crm/segments`. Leave a **redirect stub** at the old path (same
  approach used for the Fault Templates relocation). Remove the Settings nav entry for Segments.

### SegmentBuilder
- A rule editor over the `filter_rules` JSONB for **dynamic** segments: supported keys
  `tags`, `min_total_billed`, `customer_type`, `city`. **Static** segments remain an explicit
  member list. Reuses existing `/segments/` CRUD and `/segments/{id}/members/`.

### Bulk-WhatsApp
- Action calling the existing `POST /segments/{id}/bulk-whatsapp/`.
- Show the recipient count **with opt-out excluded**, surfaced to the user before send
  (`01-crm.md` §4.3; acceptance: "bulk WhatsApp respects opt-out").

---

## Phase 5 — Mobile affordances

- `tel:` (click-to-call) and `wa.me` (click-to-WhatsApp) links on phone numbers across
  `LeadCard`, the customer list, and `CustomerProfileHeader`.
- Quick **"log call"**: after tapping a number, offer to open the existing
  `LogCommunicationSheet` prefilled with `type=call` — no new component.

---

## Cross-cutting requirements

- **Testing:** every touched backend endpoint gets pytest coverage; every new/changed page
  gets Vitest tests and a clean `tsc --noEmit` (project rule: tests before merge).
- **Permissions:** nav leaves and actions gate on the **real seeded permissions**
  (`crm.tasks.manage`, `crm.segments.manage`, `crm.customers.view`, etc.) — verified against
  the seed, not the spec's wording.
- **Phasing:** each phase is an independent plan + PR; sequence 1 → 5. Phase 1 is the only one
  touching the backend beyond Phase 2's small filter addition.
- **No N+1:** Overview and any list changes use `select_related` / `prefetch_related` /
  aggregates.

## Non-goals

- No changes to the lead state machine, merge logic, or denormalized counters (backend already
  complete and tested).
- No new WhatsApp **templates** — bulk send reuses existing templates.
- GSTIN hard-block vs. soft-warning (OQ-09) stays as-is — out of scope.
- No segment **scheduling / automation**; bulk send is manual.
- No changes to the Repair / POS / AMC modules beyond consuming their existing
  `customer_id`-filtered list endpoints.

## Risks / notes

- **Route move (Phase 4)** — grep for any hardcoded link to `/settings/segments` before
  finalizing; the redirect stub covers external entry points.
- **Overview endpoint cost** — keep it to aggregate queries; it is read-on-load, so guard
  against per-row queries on the needs-attention lists.
- **Re-open board behavior (Phase 2)** — the only place spec acceptance has historically been
  ambiguous; assert the exact-prior-column behavior explicitly in tests.

## Verification (per phase)

```bash
# Backend (phases touching it)
cd backend
python manage.py makemigrations crm --check --dry-run    # if models/filters change
python -m pytest apps/crm/tests/ --no-cov 2>&1 | tail -12

# Frontend
cd frontend
npx vitest run <changed test files> 2>&1 | tail -15
npx tsc --noEmit 2>&1 | grep "error TS" || echo "OK no errors"
```
