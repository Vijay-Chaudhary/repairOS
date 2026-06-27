# CRM Overhaul — Phase 7: Tasks Calendar view — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:test-driven-development. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add a **list ↔ calendar** view toggle on the Tasks page (no new nav leaf). The calendar renders tasks by `due_date` (+ `due_time`), colored by status/priority; clicking a day or a task opens the existing `TaskComposer` prefilled with that day's date.

**Architecture:** Frontend only. The `/crm/tasks` API already returns `due_date` and supports `due_from`/`due_to`, `status`, `assigned_to`, and `page_size` (≤200) filters — **no backend change**. Add a `TaskCalendar` month-grid component, a view toggle on the Tasks page (fetching the visible month via `due_from`/`due_to` + `page_size=200`), and a small optional `defaultDueDate` prop on `TaskComposer` so the calendar's "click a day" creates a task on that date. The list view is unchanged.

**Tech Stack:** Next.js 14 + TS + React Query (Vitest). `date-fns` already a dependency.

**Source spec:** `docs/superpowers/specs/2026-06-24-crm-overhaul-design.md` (Phase 7).

---

## Key facts (verified against the codebase)

- `TasksPage` (`app/(app)/tasks/page.tsx`) today: status pill filter + priority `Select`, paginated list of `TaskRow`s, a `New task` button, and a single `<TaskComposer>`. Uses `crmApi.listTasks(filters)` keyed by `qk.tasks(filters)`.
- `FollowUpTaskViewSet.get_queryset` (`backend/apps/crm/views.py`) already supports `status`, `assigned_to`, `due_from` (`due_date__gte`), `due_to` (`due_date__lte`). `RepairOSPageNumberPagination` supports `page_size` up to `max_page_size=200`. **All needed filters exist server-side.**
- `TaskFilters` (`lib/api/crm.ts`) currently lacks `due_from` / `due_to` / `page_size` — widen the type (client-only; the endpoint already honors them).
- `TaskComposer` (`components/crm/TaskComposer.tsx`) is **create-only**, props `{ open, onOpenChange, customerId?, leadId?, jobId? }`, react-hook-form with `due_date` required. Add optional `defaultDueDate?: string`; when the sheet opens, reset the form seeding `due_date` from it. Non-breaking.
- `Task` type has `due_date` (`YYYY-MM-DD`), `due_time?`, `status` (`pending|completed|cancelled|overdue`), `priority` (`low|normal|high`). Compare `due_date` as a string to avoid timezone drift.
- Date helpers: `lib/format/date.ts` exports `MONTHS_FULL`, `formatTime`; `date-fns` is available for month-grid math. `formatTime(task.due_time)` is already how the list renders times.
- Toggle pattern to mirror: the Leads page kanban/list toggle (a bordered button pair with lucide icons). Use `List` + `CalendarDays`.
- Colors: reuse CSS vars already used by `TaskRow` — overdue `--danger`, completed `--success` (muted/strikethrough), else by priority (high `--danger`, normal `--info`, low `--text-muted`).

## File structure

```
frontend/src/
  app/(app)/tasks/page.tsx                        # + view toggle, month state, calendar branch
  app/(app)/tasks/__tests__/tasksView.test.tsx    # NEW — toggle + calendar render + day click
  components/crm/TaskCalendar.tsx                  # NEW — month grid
  components/crm/__tests__/taskCalendar.test.tsx   # NEW
  components/crm/TaskComposer.tsx                  # + optional defaultDueDate
  lib/api/crm.ts                                   # TaskFilters += due_from/due_to/page_size
```

---

## Steps

- [x] **Step 1: TaskComposer `defaultDueDate` (TDD)**
  - Test (`taskComposer` or within tasksView): opening with `defaultDueDate="2026-07-15"` renders the due-date input with that value.
  - Impl: add `defaultDueDate?: string` prop; `useEffect` on `open` → `form.reset({...defaults, due_date: defaultDueDate ?? ''})`.

- [x] **Step 2: `TaskFilters` widening** — add `due_from?`, `due_to?`, `page_size?` to `TaskFilters` in `crm.ts`.

- [x] **Step 3: `TaskCalendar` component (TDD)**
  - Test (`taskCalendar.test.tsx`): given a fixed `month` + a few tasks, renders the month title, day cells, a chip for a task on its day, calls `onDayClick(dateStr)` when a day is clicked and `onTaskClick(task)` when a chip is clicked.
  - Impl: month grid (weeks Sun–Sat) from `month: Date`; per-day task chips filtered by `due_date` string; chip color by status→priority; prev/next/today handled by parent via `month` + callbacks (`onPrevMonth`/`onNextMonth`/`onToday`) or internal — keep nav in the component, expose `onDayClick` / `onTaskClick`.

- [x] **Step 4: Wire toggle into Tasks page (TDD)**
  - Test (`tasksView.test.tsx`): default list view shows rows; clicking the Calendar toggle renders the calendar (month title) and triggers a `listTasks` call carrying `due_from`/`due_to`/`page_size`; clicking a day opens the composer with that date prefilled.
  - Impl: `view: 'list' | 'calendar'` state (default `list`); `month` state (first of current month). In calendar mode, query with `due_from=monthStart`, `due_to=monthEnd`, `page_size: 200`, plus the existing status/priority filters; render `<TaskCalendar>`; day/task click → set `composerDefaultDate` + open composer. `New task` button opens composer with no default. Keep list mode exactly as-is.

- [x] **Step 5: Tests + type-check**
  - Run: `cd frontend && npx vitest run src/app/\(app\)/tasks/__tests__/tasksView.test.tsx src/components/crm/__tests__/taskCalendar.test.tsx 2>&1 | tail -8` → PASS.
  - Run: `npx tsc --noEmit 2>&1 | grep "error TS" | grep -v "Can.test.tsx" || echo OK` → `OK`.

- [x] **Step 6: Commit + PR** on branch `feat/crm-overhaul-phase-7-tasks-calendar` (commit only Phase 7 files; leave unrelated deployment WIP untouched).

---

## Final verification

- [x] **Frontend** — full `npx vitest run` green; `tsc --noEmit … || echo OK` → `OK`.
- [x] **No backend change** — confirm no edits under `backend/`.
- [ ] **Manual smoke — live UI** (recommended; needs Docker): Tasks page → toggle to Calendar → tasks appear on their due days, colored; click a day → composer opens with that date; create → task shows on that day after refetch.

---

## Notes / risks

- **No backend change** — the `/tasks` endpoint already supports `due_from`/`due_to`/`page_size`; only the TS filter type widens.
- **`page_size=200`** comfortably covers a month of tasks; if a month ever exceeds it, the calendar would truncate — acceptable for this worklist (the list view remains the paginated source of truth).
- **`defaultDueDate`** is additive and optional; every existing `<TaskComposer>` call site is unaffected.
- **`due_date` compared as a string** (`YYYY-MM-DD`) to dodge timezone off-by-one when bucketing tasks into day cells.
