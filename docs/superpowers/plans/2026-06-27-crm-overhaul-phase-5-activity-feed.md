# CRM Overhaul — Phase 5: Activity feed (cross-CRM communication timeline) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:test-driven-development. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** A CRM-wide chronological feed of every communication (call / WhatsApp / visit / email / SMS / note) — the read-only companion to the per-profile timelines. Lives at `/crm/activity`, filterable by type + date, with rows that deep-link to the related customer or lead.

**Architecture:** Thin slice. Backend: harden the existing `CommunicationLogViewSet.get_queryset` (it currently has neither shop scoping nor a stable order) by adding shop scoping, a `type` filter, a `date_from`/`date_to` range, and `order_by("-logged_at")`. Cursor pagination is already wired. Comm logs have **no direct `shop` FK** — they hang off `customer` or `lead`, so scoping goes through `customer__shop` / `lead__shop`. Add read-only `customer_name` / `lead_name` to the serializer so rows can render + deep-link. Frontend: a new CRM nav leaf and an `/crm/activity` page reusing the `EntityTimeline` visual pattern with deep-linked rows.

**Tech Stack:** Django 5 + DRF (pytest); Next.js 14 + TS + React Query (Vitest).

**Source spec:** `docs/superpowers/specs/2026-06-24-crm-overhaul-design.md` (Phase 5).

---

## Key facts (verified against the codebase)

- `CommunicationLogViewSet` (`backend/apps/crm/views.py:312`) is `Create+List`, gated `crm.communications.log`, with `RepairOSCursorPagination`. `get_queryset` currently filters only by `customer_id` / `lead_id` and applies **no shop scoping and no `order_by`** — cursor pagination relies on the model `Meta.ordering = ["-logged_at"]`, but the spec wants it explicit on the queryset.
- `CommunicationLog` (`models.py:172`) has **no `shop` field**; it FKs `customer` and/or `lead`, each of which FKs `core.Shop`. So shop scoping must use `Q(customer__shop_id__in=…) | Q(lead__shop_id__in=…)`.
- `ShopScopedMixin._shop_filter()` (`views.py:65`) returns `Q(shop_id__in=…)` (bare `shop_id`) — **cannot be reused directly** on comm logs. Mirror its semantics inline: tenant-wide / platform-admin → no filter; else scope to JWT `shop_ids` (empty → `.none()`).
- `CommunicationLogSerializer` (`serializers.py:113`) exposes `customer` / `lead` (FK ids) and `logged_by_name` / `actor` / `description`, but **not** the customer/lead display names. Add `customer_name` (`source="customer.name"`) and `lead_name` (`source="lead.name"`), read-only — additive, harmless to the existing per-profile timeline.
- Date-range convention (from Phase 2 leads, `views.py:131`): `…__date__gte` / `…__date__lte` so a plain `YYYY-MM-DD` is inclusive. Use `logged_at__date__gte` / `logged_at__date__lte`.
- Nav: CRM group in `AppShell.tsx:62-68`. Add an **Activity** leaf gated `crm.communications.log`. `navItems.test.ts` enumerates CRM leaves and must be updated.
- API client: `crmApi.listCommunications` (`crm.ts:305`) already hits `/crm/communications/` and returns `{ items, meta }`; extend its filter type with `type` / `date_from` / `date_to`. `CommunicationLog` TS type (`crm.ts:54`) needs `customer_name` / `lead_name`.
- `EntityTimeline` (`components/shared/EntityTimeline.tsx`) is the visual pattern but takes generic `TimelineEvent[]` with **no row links** — the activity page renders its own deep-linked rows in the same timeline style rather than forcing the component.
- Test fixtures: `_make_scoped_client` (`tests/test_leads.py:253`) builds a non-tenant-wide client for shop-scoping assertions; `admin_client` (tenant-wide) for filter assertions.

## File structure

```
backend/apps/crm/
  views.py                         # CommunicationLogViewSet.get_queryset — scope + filters + order
  serializers.py                   # CommunicationLogSerializer — + customer_name / lead_name
  tests/test_communications.py     # NEW — scoping + type + date filters + ordering
frontend/src/
  app/(app)/crm/activity/page.tsx               # NEW — feed page
  app/(app)/crm/activity/__tests__/activity.test.tsx  # NEW
  components/shared/AppShell.tsx                 # + Activity nav leaf
  components/shared/__tests__/navItems.test.ts  # update CRM leaves
  lib/api/crm.ts                                 # listCommunications filter type + CommunicationLog type
```

---

## Steps

- [x] **Step 1: Backend tests (red)** — new `backend/apps/crm/tests/test_communications.py`:
  - `GET /api/v1/crm/communications/` returns logs ordered `-logged_at`.
  - `type=call` filter returns only calls.
  - `date_from` / `date_to` (inclusive) bound results by `logged_at`.
  - Shop-scoped user (`_make_scoped_client`) sees only comm logs whose customer/lead belongs to their shop; tenant-wide sees all.
  - Existing `customer_id` / `lead_id` filters still work.

- [x] **Step 2: Backend implementation (green)**
  - `serializers.py`: add `customer_name = CharField(source="customer.name", read_only=True, default=None)` and `lead_name = CharField(source="lead.name", read_only=True, default=None)`; add both to `Meta.fields`.
  - `views.py` `CommunicationLogViewSet.get_queryset`: keep `select_related("logged_by", "customer", "lead")`; apply inline shop scoping (mirror `_shop_filter` semantics via `customer__shop_id` / `lead__shop_id`); keep `customer_id` / `lead_id`; add `type`, `date_from` (`logged_at__date__gte`), `date_to` (`logged_at__date__lte`); end with `.order_by("-logged_at")`.
  - Run: `cd backend && python -m pytest apps/crm/tests/test_communications.py --no-cov -q` → green.
  - Run: `python manage.py makemigrations crm --check --dry-run` → `No changes detected`.

- [x] **Step 3: Frontend API + types**
  - `crm.ts`: add `customer_name?: string | null` and `lead_name?: string | null` to `CommunicationLog`; widen `listCommunications` filter type with `type?`, `date_from?`, `date_to?`.

- [x] **Step 4: Frontend page + nav**
  - `AppShell.tsx`: add `{ type: 'leaf', label: 'Activity', href: '/crm/activity', icon: Activity, permission: 'crm.communications.log' }` to the CRM group (import `Activity` from lucide).
  - `navItems.test.ts`: add the Activity leaf to the CRM expectations.
  - New `/crm/activity/page.tsx`: React Query `listCommunications` with `type` + date filters; timeline-style rows (reusing `EntityTimeline`'s look) where each row deep-links to `/customers/{customer_id}` or `/leads/{lead_id}`; skeleton / empty / error states; wrapped in `<Can permission="crm.communications.log">`.

- [x] **Step 5: Frontend tests + type-check**
  - New `activity.test.tsx`: renders rows, applies type filter, shows empty + error states.
  - Run: `cd frontend && npx vitest run "src/app/(app)/crm/activity/__tests__/activity.test.tsx" src/components/shared/__tests__/navItems.test.ts 2>&1 | tail -6` → PASS.
  - Run: `npx tsc --noEmit 2>&1 | grep "error TS" | grep -v "Can.test.tsx" || echo OK` → `OK`.

- [x] **Step 6: Commit** on branch `feat/crm-overhaul-phase-5-activity-feed`.

---

## Final verification

- [x] **Backend** — `cd backend && python -m pytest apps/crm/tests/ --no-cov -q` → 0 failed; `makemigrations crm --check --dry-run` → `No changes detected`.
- [x] **Frontend** — vitest (activity + navItems) pass; `tsc --noEmit … || echo OK` → `OK`.
- [ ] **Manual smoke — live UI** (recommended; needs Docker): nav **CRM → Activity** lands on `/crm/activity`; filter by type + date; click a row → lands on the related customer/lead.

---

## Notes / risks

- **No migration** — model unchanged; serializer/queryset only.
- **Shop scoping is new behaviour** for this endpoint — a previously unscoped list now hides other shops' comm logs for shop-scoped users. Intentional per spec; tenant-wide users are unaffected.
- **`customer_name` / `lead_name`** are additive read-only fields; the per-profile timeline (`CustomerViewSet.timeline`) reuses the same serializer and simply gains two harmless fields.
- The `FollowUpTask` list is similarly unscoped today — **out of scope** for Phase 5; note for a later pass.
