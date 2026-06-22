# Repair Module Overhaul — Design Spec

**Date:** 2026-06-17
**Status:** Approved (design); pending implementation plan
**Author:** Vijay Kumar (with Claude)

## Goal

Make the **Repair** area of RepairOS easier to understand and more capable. Today the
sidebar "Repair" group contains a single child ("Jobs"), the Jobs search is broken, filters
are sparse and split across the UI, and two existing backend features — Spare Part Requests
and Fault Templates — have no UI at all. This overhaul restructures the Repair navigation,
adds a Repair Overview hub, unifies and fixes Jobs filtering/search, polishes the Jobs page,
and surfaces Spare Parts and Fault Templates as full management pages.

The work is delivered in **four independently shippable phases**.

## Non-Goals

- No change to the underlying job/stage workflow or status model.
- No new design system: we reuse existing Tailwind tokens (`--accent`, `--surface`,
  `--border`, `--text`, `--text-muted`, `--success`, `--warning`, `--danger`), shadcn/ui
  primitives, and lucide-react icons. No new colors, fonts, or component libraries.
- No change to multi-tenant / database-per-tenant architecture.

## Tech Stack & Conventions

- **Backend:** Django 4.2+ / DRF, `apps/repair`. Every endpoint gets serializer +
  `permission_classes` + pytest-django tests. Business logic in `services.py`, not views.
  No N+1 (`select_related`/`prefetch_related`). No raw SQL.
- **Frontend:** Next.js 14 App Router, TypeScript strict (no `any`), Tailwind, React Query
  (server state), Zustand (`uiStore` for persisted UI prefs). Mobile-first PWA. No
  `console.log`. Vitest + React Testing Library for components.
- **Routing:** new pages live under `app/(app)/repair/...`.

## Cross-Cutting UX Standards (apply to all phases)

Derived from the project's mobile-first PWA constraints and standard accessibility rules.
These are acceptance criteria, not aspirations:

- **Contrast:** text/background pairs meet WCAG AA (4.5:1 normal, 3:1 large/glyphs). Never
  convey state by color alone — pair with icon or text (e.g. overdue = icon + red, not red
  only).
- **Touch targets:** interactive controls ≥ 44×44px (existing nav already uses
  `min-h-[44px]`); keep ≥ 8px spacing between adjacent targets.
- **Focus & keyboard:** visible focus rings on all interactive elements; tab order matches
  visual order; icon-only buttons have `aria-label`.
- **Loading:** any fetch expected > ~300ms shows a skeleton (not a blank region or bare
  spinner). Reserve space to avoid layout shift.
- **Empty states:** filter-aware messages with a recovery action (e.g. "No overdue jobs"
  with a "Clear filters" action), never a blank table.
- **Tables:** sortable columns expose `aria-sort`; numeric/currency/date columns use
  tabular figures (`tabular-nums`) to prevent column jitter.
- **Animation:** 150–300ms, transform/opacity only; respect `prefers-reduced-motion`.
- **Navigation:** active location is visually highlighted; nav items keep icon + label.

---

## Phase 1 — Navigation Restructure & Repair Overview

### 1a. Sidebar restructure

In `frontend/src/components/shared/AppShell.tsx`, the `Repair` `NavGroup` gains children and
a meaningful landing page (structure choice **B**: group + Overview hub):

```
Repair (group, icon: Wrench)
├── Overview         /repair             permission: repair.jobs.view
├── Jobs             /jobs               permission: repair.jobs.view
├── Spare Parts      /repair/spare-parts permission: repair.spare_parts.view
└── Fault Templates  /repair/fault-templates  permission: repair.fault_templates.view
```

- The group's expand/active logic already supports multiple children — no structural change
  to `NavGroupItem`, only the `NAV_ITEMS` data.
- Verify `repair.spare_parts.*` and `repair.fault_templates.*` permission strings exist in
  the backend permission registry; if missing, add them (and to the relevant default roles).
  Children the user lacks permission for are hidden by the existing `Can`/`hasPermission`
  gating, so a user with only `repair.jobs.view` still sees a sensible group.
- Mobile bottom-tab bar (`BOTTOM_TAB_ITEMS`) is unchanged (Jobs stays the repair entry).

### 1b. Repair Overview page

New route `app/(app)/repair/page.tsx` — a read-only dashboard hub.

**Layout (approved mockup):**
- **KPI tiles** (4): Open jobs, Overdue, Awaiting parts, Ready for pickup. Each tile is a
  link into the matching pre-filtered view (`/jobs?...` for the first three;
  `/repair/spare-parts?status=...` for Awaiting parts). Numbers use tabular figures.
- **Jobs by status**: horizontal bar breakdown across the kanban statuses; each row links to
  that status filter.
- **Needs attention**: short list (≤ ~8) of jobs that are overdue / unpaid / awaiting parts,
  each tagged and linking to the job detail.

**Backend:** new endpoint `GET /api/repair/overview/`.
- Returns `{ kpis: {...}, by_status: [{status, count}], needs_attention: [{...}] }`.
- Implemented in `apps/repair/services.py` as a single aggregated query set (annotate/
  `values().annotate(Count)`), scoped to the active shop (and respecting "all shops" for
  platform admins). No N+1.
- `RepairOverviewSerializer` + `permission_classes = [Has repair.jobs.view]`.
- Tests: counts correct per status; overdue excludes terminal statuses (delivered/closed/
  cancelled); shop scoping; permission denied without `repair.jobs.view`.

**Frontend states:** skeleton tiles while loading; per-shop empty state ("No jobs yet" with
"Create a job" action) when the shop has zero jobs; error state with retry. New query key
`qk.repair.overview(shopId)`.

---

## Phase 2 — Jobs Page: Search Fix, Unified Filters, UX Polish

### 2a. Backend search & filters

Adopts the existing approved plan in
`docs/superpowers/plans/2026-06-14-jobs-search-and-filters.md` (Task 1), with one change:
filters apply to **all** Jobs queries (kanban and list), not list-only.

In `JobTicketViewSet.get_queryset()`:
- **`search`** across `job_number`, `customer.name`, `customer.phone`, `imei`,
  `serial_number`, `problem_description` (case-insensitive `Q` OR, `.distinct()`).
- **`device_type`** — case-insensitive exact match.
- **`payment_status`** — annotate balance (`service_charge - advance_paid`) and filter
  `paid` (balance ≤ 0), `unpaid` (`advance_paid=0, service_charge>0`), `partial`
  (`advance_paid>0, balance>0`).
- Existing `status`, `shop_id`, `technician_id`, `priority`, `date_from`, `date_to` retained.
- Tests: the 7 cases from the existing plan (search by name/number, no-match,
  device_type, payment_status paid/partial/unpaid) + a regression run of the repair suite.

### 2b. Frontend API types

`frontend/src/lib/api/repair.ts` — add `device_type?: string` and
`payment_status?: 'paid' | 'partial' | 'unpaid'` to `JobFilters`.

### 2c. Unified filter panel + active chips (structure choice **A**)

Replaces the always-visible priority/technician selects and the draft plan's list-only
filter row with one consistent system in `app/(app)/jobs/page.tsx`:

- **Search** input stays in the top bar.
- A single **Filters** button (with active-count badge) opens a panel/popover containing
  **all** filters: Status, Technician, Priority, Device type, Payment status, Date range.
- **Active filters render as removable chips** below the bar, each with an "×"; a "Clear all"
  control resets every filter. Chips make current state obvious at a glance.
- Filters apply consistently to **both** kanban and list views (the existing per-column
  kanban queries and the list query both read the same `filters` object). Page/cursor resets
  when any filter changes.
- Device-type options reuse the existing intake device-type list (Smartphone, Feature Phone,
  Tablet, Laptop, Desktop, Smartwatch, Earbuds, Other) — source from a shared constant to
  avoid drift with the check-in form.

### 2d. Quick filters (presets)

A row of one-tap preset chips above the board/list: **Overdue**, **Unpaid**, **Due today**,
**My jobs** (current user as technician). Selecting a preset sets the corresponding
underlying filter(s) and reflects as active chips; presets are mutually non-exclusive where
sensible. Implemented purely as shortcuts over the same filter state — no new query params
beyond 2a.

### 2e. Clearer kanban cards

Refine `components/repair/JobCard.tsx` (already being edited in the working tree) so each
card surfaces, with icon + text (never color alone):
- Priority (normal/urgent/VIP) — existing icons, kept.
- Overdue indicator (days overdue) when past `expected_delivery_date` and non-terminal.
- Payment-due signal (balance > 0) vs Paid.
- Assigned technician.
Maintain ≥ 44px tap area and stable layout on press (no layout-shifting transforms).

### 2f. Empty & loading states

- Kanban columns and list show skeletons while loading.
- Empty states are filter-aware: e.g. with the Overdue preset and no results → "No overdue
  jobs"; with no jobs at all → "No jobs yet" + "New Job" action (existing behavior preserved).

### 2g. List density & column visibility

- A compact/comfortable **density toggle** and a **column show/hide** menu for the list view.
- Preferences persist in `uiStore` (Zustand) so they survive navigation/reload.
- Lowest-priority item in this phase; may be split into its own task if Phase 2 grows large.

---

## Phase 3 — Spare Parts Management Page

New route `app/(app)/repair/spare-parts/page.tsx` — a cross-job worklist with **full
management**.

- **List:** all spare-part requests across jobs, columns: request #/job, part, customer/job
  link, status (requested → approved → ordered → received), requested date, quantity.
  Sortable, paginated, `aria-sort`, tabular figures, skeleton + filter-aware empty states.
- **Filters:** status, shop, date range (same unified pattern as Jobs where practical).
- **Create:** standalone spare-part request (not only from within a job). Reuses
  `components/repair/SparePartRequestSheet.tsx`.
- **Edit + status workflow:** advance a request through its statuses with confirmation on
  state changes; destructive/irreversible actions use the danger color and are separated from
  primary actions.
- **Backend:** `SparePartRequestViewSet` already exists. Add any missing list filters
  (status/shop/date) and a standalone-create path if not present; add serializer/permission
  coverage and tests for new filters + create/edit/status transitions.

---

## Phase 4 — Fault Templates CRUD Page

New route `app/(app)/repair/fault-templates/page.tsx` — a Setup/admin page with **full
CRUD**.

- **List** fault templates with their linked parts count; search by name.
- **Create / Edit:** template fields + manage linked parts (`FaultTemplatePart`) inline.
- **Delete:** soft-delete (model is `SoftDeleteModel`) with confirmation; never hard-drop.
- Form UX: visible labels (not placeholder-only), inline validation on blur, errors below the
  field, focus moves to first invalid field on submit error, loading→success/error on save.
- **Backend:** `FaultTemplateViewSet` exists. Add/confirm create/edit/delete endpoints,
  serializer for nested parts, permissions, and tests (CRUD happy paths + validation +
  permission denial). Check-in form continues to consume templates unchanged.

---

## Data Flow & State

- **Server state:** React Query throughout. New/extended keys: `qk.repair.overview(shopId)`,
  `qk.spareParts(filters)`, `qk.faultTemplates(filters)`. Mutations invalidate the relevant
  keys (e.g. spare-part status change invalidates the worklist and any affected job).
- **Client/UI state:** filter selections live in page components; persisted UI prefs (list
  density, visible columns, nav group open/closed) live in `uiStore` (Zustand).
- **Shop scoping:** all queries respect `activeShopStore` (active shop vs "all shops" for
  platform admins), matching the existing Jobs behavior.

## Error Handling

- Reuse `DataTable` error rendering and the existing `ApiError` handling from `lib/api/client`.
- The Jobs offline banner pattern carries to new pages where create/edit needs a connection;
  disable create actions while offline with an explanatory tooltip (as Jobs already does).
- Every error state offers a recovery path (retry / edit / clear filters).

## Testing Strategy

- **Backend (pytest-django):** Jobs search + device_type + payment_status filters; Overview
  aggregation + scoping + permissions; Spare Parts list filters + create/edit/status; Fault
  Templates CRUD + validation + permissions. Run full `apps/repair` suite for regressions.
- **Frontend (Vitest + RTL):** filter panel open/close + chip add/remove + clear-all; quick
  filter presets set correct filters; JobCard renders priority/overdue/payment/technician;
  Overview tiles link correctly and render skeleton/empty/error; Spare Parts and Fault
  Templates list + form happy paths and validation.
- **Manual verification** per phase mirrors the existing plan's verification steps (search in
  kanban, filters compose with search, kanban/list parity, etc.).

## Rollout / Sequencing

Phases are independent and shippable in order:
1. **Phase 1** (nav + Overview) — immediate clarity win, low risk.
2. **Phase 2** (Jobs search/filters/UX) — highest daily-use impact; unblocks Overview deep
   links.
3. **Phase 3** (Spare Parts) — surfaces hidden feature.
4. **Phase 4** (Fault Templates) — setup/admin, lowest urgency.

Each phase will get its own implementation plan (or a single phased plan) via the
writing-plans step.

## Open Questions / Risks

- **Permission strings:** confirm `repair.spare_parts.*` and `repair.fault_templates.*` exist
  in the backend permission registry and default role grants; add if missing (Phase 1
  prerequisite).
- **Standalone spare-part create:** verify the backend supports creating a request not bound
  to a job, or scope Phase 3 create to job-linked only if it doesn't.
- **Overview "Awaiting parts" definition:** tie to spare-part requests in
  requested/approved/ordered states; confirm exact mapping during Phase 1.
