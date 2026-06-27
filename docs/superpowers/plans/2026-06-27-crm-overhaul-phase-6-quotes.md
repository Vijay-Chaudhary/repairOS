# CRM Overhaul — Phase 6: Quotes worklist — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:test-driven-development. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** A cross-lead worklist of quotes sent to prospects. Today `LeadQuote` rows are only reachable per-lead via `GET /crm/leads/{id}/quotes/`; Phase 6 adds a flat, shop-scoped list at `GET /api/crm/quotes/` and a `/crm/quotes` page.

**Architecture:** Thin slice. Backend: a new read-only `LeadQuoteViewSet` (List only) registered at `quotes`, shop-scoped through `lead__shop` (quotes have no direct shop FK — same shape as Phase 5's comm-log scoping), `select_related("lead", "sent_by")`, ordered `-created_at`, filterable by lead status + date. `LeadQuoteSerializer` gains read-only `lead_id` / `lead_name` / `lead_status` so the worklist can show + deep-link the lead. Frontend: a `DataTable` worklist page + a CRM nav leaf.

**Tech Stack:** Django 5 + DRF (pytest); Next.js 14 + TS + React Query (Vitest).

**Source spec:** `docs/superpowers/specs/2026-06-24-crm-overhaul-design.md` (Phase 6).

---

## Key facts (verified against the codebase)

- `LeadQuote` (`models.py:82`) extends `BaseModel` (not soft-delete), FKs `lead` (→ `Lead.shop`) and `sent_by`; has `quote_number`, `items` (JSON), `total_amount`, `valid_until`, `notes`, `sent_via_whatsapp`, `created_at`. No direct `shop` FK → scope via `lead__shop_id`.
- Per-lead access today: `LeadViewSet.list_quotes` action (`views.py:187`) → `lead.quotes.select_related("sent_by").order_by("-created_at")`, no pagination. Keep as-is.
- `LeadQuoteSerializer` (`serializers.py:166`) exposes quote fields + `sent_by_name`, but **no lead info**. Add read-only `lead_id` (`source="lead.id"`), `lead_name` (`source="lead.name"`), `lead_status` (`source="lead.status"`) — additive, harmless to the per-lead action.
- `ShopScopedMixin._shop_filter()` returns `Q(shop_id__in=…)` (bare `shop_id`) — not usable on `LeadQuote`. Mirror its semantics inline through `lead__shop_id` (tenant-wide / platform-admin → no filter; else JWT `shop_ids`, empty → `.none()`), exactly like Phase 5's comm-log scoping.
- Router (`urls.py`) uses `DefaultRouter`; register `router.register("quotes", LeadQuoteViewSet, basename="quotes")`.
- Pagination: leads worklist uses `RepairOSPageNumberPagination` and the frontend `DataTable` consumes `meta.total_pages` / `meta.count` with `page` / `onPageChange`. Use the same for quotes (consistency with other worklists like Invoices).
- Permission gate: `crm.leads.view` (spec).
- Frontend: `DataTable` (`components/shared/DataTable.tsx`) takes `columns`, `data`, `loading`, `error`, `keyExtractor`, `onRowClick`, `emptyTitle/Description`, and page-number props. `StatusBadge` already maps every lead status; `money()` (`lib/format/money.ts`) formats `total_amount`; `formatDatetime` (`lib/format/date.ts`) formats `created_at`.
- API client: add `crmApi.listQuotes(filters)` → `{ items: LeadQuote[]; meta: PageMeta }`; extend `LeadQuote` TS type with `lead_id` / `lead_name` / `lead_status`; add `qk.quotes` list key.
- Nav: add a **Quotes** leaf to the CRM group in `AppShell.tsx`; `navItems.test.ts` enumerates CRM leaves and must be updated.

## File structure

```
backend/apps/crm/
  views.py                       # NEW LeadQuoteViewSet
  serializers.py                 # LeadQuoteSerializer + lead_id/lead_name/lead_status
  urls.py                        # register quotes route
  tests/test_quotes.py           # NEW — list + scoping + status/date filters
frontend/src/
  app/(app)/crm/quotes/page.tsx                  # NEW — worklist
  app/(app)/crm/quotes/__tests__/quotes.test.tsx # NEW
  components/shared/AppShell.tsx                  # + Quotes nav leaf
  components/shared/__tests__/navItems.test.ts   # update CRM leaves
  lib/api/crm.ts                                  # listQuotes + LeadQuote fields
  lib/query/keys.ts                              # qk.quotes
```

---

## Steps

- [x] **Step 1: Backend tests (red)** — new `backend/apps/crm/tests/test_quotes.py`:
  - `GET /api/v1/crm/quotes/` lists quotes across leads, ordered `-created_at`, with `lead_name` / `lead_status` populated.
  - `lead_status=quoted` filter narrows by the related lead's status.
  - `date_from` / `date_to` (inclusive) bound by `created_at`.
  - Shop-scoped user sees only quotes whose lead is in their shop; tenant-wide sees all.
  - `crm.leads.view` is required (403 without).

- [x] **Step 2: Backend implementation (green)**
  - `serializers.py`: add `lead_id`, `lead_name`, `lead_status` (all read-only) to `LeadQuoteSerializer` + `Meta.fields`.
  - `views.py`: `LeadQuoteViewSet(ListModelMixin, GenericViewSet)` — `serializer_class = LeadQuoteSerializer`, `pagination_class = RepairOSPageNumberPagination`, `get_permissions → crm.leads.view`; `get_queryset` = `select_related("lead", "sent_by")` + inline `lead__shop` scoping + `lead_status` filter (`lead__status`) + `date_from`/`date_to` (`created_at__date__…`) + `.order_by("-created_at")`.
  - `urls.py`: register `quotes`.
  - Run: `cd backend && python -m pytest apps/crm/tests/test_quotes.py --no-cov -q` → green; `makemigrations crm --check --dry-run` → `No changes detected`.

- [x] **Step 3: Frontend API + types** — `crm.ts`: add `lead_id?` / `lead_name?` / `lead_status?` to `LeadQuote`; add `listQuotes(filters)`; `keys.ts`: add `quotes: listKey('quotes')`.

- [x] **Step 4: Frontend page + nav**
  - `AppShell.tsx`: add `{ type: 'leaf', label: 'Quotes', href: '/crm/quotes', icon: FileText, permission: 'crm.leads.view' }` to the CRM group.
  - `navItems.test.ts`: add the Quotes leaf to CRM expectations.
  - New `/crm/quotes/page.tsx`: `DataTable` columns — lead name, amount (`money`), sent date (`formatDatetime`), sent_by, lead status (`StatusBadge`); row → `/leads/{lead_id}`; status + date filters; page-number pagination; skeleton/empty/error via `DataTable`; wrapped in `<Can permission="crm.leads.view">`.

- [x] **Step 5: Frontend tests + type-check**
  - New `quotes.test.tsx`: renders rows + deep-link, applies lead_status filter, shows empty + error states.
  - Run: `cd frontend && npx vitest run "src/app/(app)/crm/quotes/__tests__/quotes.test.tsx" src/components/shared/__tests__/navItems.test.ts 2>&1 | tail -6` → PASS.
  - Run: `npx tsc --noEmit 2>&1 | grep "error TS" | grep -v "Can.test.tsx" || echo OK` → `OK`.

- [x] **Step 6: Commit + PR** on branch `feat/crm-overhaul-phase-6-quotes`.

---

## Final verification

- [x] **Backend** — `cd backend && python -m pytest apps/crm/tests/ --no-cov -q` → 0 failed; `makemigrations crm --check --dry-run` → `No changes detected`.
- [x] **Frontend** — vitest (quotes + navItems) pass; `tsc --noEmit … || echo OK` → `OK`.
- [ ] **Manual smoke — live UI** (recommended; needs Docker): nav **CRM → Quotes** lands on `/crm/quotes`; filter by lead status + date; click a row → lands on the lead.

---

## Notes / risks

- **No migration** — model unchanged; serializer/queryset/route only.
- **Shop scoping** mirrors Phase 5 (comm logs): a flat list scoped through a related model's shop. Tenant-wide users unaffected.
- **`lead_id`/`lead_name`/`lead_status`** are additive read-only serializer fields; the per-lead `list_quotes` action reuses the same serializer and gains them harmlessly.
- Depends on nothing from the Phase 5 PR — different files (the only shared touch is `AppShell.tsx`/`navItems.test.ts`, which may need a trivial merge if Phase 5 lands first).
