# ERP/CRM Blueprint — Phase 6 Design (Global Tasks Module)

**Date:** 2026-06-29
**Status:** Approved design — ready for implementation planning
**Parent spec:** `docs/superpowers/specs/2026-06-29-erp-crm-navigation-design.md` (§2 Tasks leaf, §5 roadmap Phase 6)
**Predecessors:** Phases 0–5 (PRs #22–#27).

---

## 1. Scope

Turn the existing `/tasks` page into the blueprint's global Tasks module with four views —
**My / Team / Calendar / Kanban**. Built on the existing, already-global `crm.FollowUpTask`
(customer/lead optional, has a `job_id` link, `assigned_to`, `due_date`, `priority`, `status`) and
its endpoints (`/crm/tasks/` — list/create/update/complete, gated `crm.tasks.manage`). The page
already ships **List + Calendar**; Phase 6 reorganizes into the four blueprint views and adds Kanban.

**Locked decisions (from brainstorming):**
- **Reuse `FollowUpTask`** (no net-new model, no data migration).
- **Add an `in_progress` status** for a To-do → In Progress → Done Kanban.
- **Team = all tasks** (every assignee).
- **Permissions stay `crm.tasks.manage`** (the nav leaf already gates `anyOf['tasks.tasks.view','crm.tasks.manage']`).

**Out of scope:** a dedicated `tasks` Django app / `tasks.tasks.*` endpoints; task notification
producers; recurring tasks; subtasks; per-task comments.

---

## 2. Backend (small)

- Add **`IN_PROGRESS = "in_progress", "In Progress"`** to `crm.FollowUpTask.Status` (between
  `PENDING` and `COMPLETED`). Reversible migration (a no-op `AlterField` on the `status` choices —
  CharField, no schema change).
- Status transitions use the **existing** `PATCH /crm/tasks/{id}/` (`FollowUpTaskSerializer`, which
  is a `ModelSerializer` and derives `status` choices from the model — accepts the new value with no
  change). The `complete` action is unchanged.
- **Standalone tasks** (no customer/lead) are already supported by the model and the create path —
  no change needed (verify the create serializer does not require customer/lead).

---

## 3. Frontend — `/tasks` page → four views

Expand the page's view switch (`'list' | 'calendar'`) to **`'my' | 'team' | 'calendar' | 'kanban'`**:

- **My** — the existing task list filtered to `assigned_to = <current user id>` (from the auth
  store). Same filters (status/priority) + create composer.
- **Team** — the same list, **unfiltered** by assignee, with an assignee column shown.
- **Calendar** — the existing `TaskCalendar` (unchanged).
- **Kanban** — a new `TaskBoard` over the shared `KanbanBoard<T>` (the Leads/Deals pattern):
  - Columns: **To-do** (`pending`) → **In Progress** (`in_progress`) → **Done** (`completed`) +
    **Cancelled** (`cancelled`, collapsible).
  - Per-column React-Query queries by `status` (or one query grouped client-side).
  - Cards show: title, assignee, due date, priority badge.
  - Drag a card between columns → `crmApi.updateTask(id, { status })`; invalidate `qk.tasks()`.
- The create composer (`TaskComposer`) is reused as-is (already supports standalone tasks — its
  `customerId`/`leadId`/`jobId` props are optional).

New: `crmApi` already has `listTasks({ assigned_to })` and `updateTask(id, { status })`; reuse them.
Add a `TASK_KANBAN_COLS` constant + `qk.tasks` keys per status as needed. New components:
`components/crm/TaskBoard.tsx`, `components/crm/TaskCard.tsx` (or reuse an existing task card if present).

---

## 4. Cross-Cutting Requirements

- Per project rules: tests + permission gate reuse; React Query; reversible migration; TS strict, no `any`.
- **Tests (before merge):**
  - Backend: a task can transition to `in_progress` via `PATCH /crm/tasks/{id}/` (and to `completed`).
  - Frontend (Vitest): the four-view switch renders; Kanban groups tasks by status; My filters to the
    current user. Keep the Kanban test light (the shared `KanbanBoard` has its own tests) — mock the
    board if needed (mirror the Deals page smoke test).
- **Migration** reversible. **Production build** passes with `NODE_ENV=production`.

---

## 5. Build Order

1. Backend — add `in_progress` status + migration + test.
2. Frontend — `crmApi`/`qk` additions + `TaskCard` + `TaskBoard` (Kanban).
3. Frontend — `/tasks` page: My/Team/Calendar/Kanban view switch wiring + smoke test.
4. Final verification.

---

## 6. Verification (Phase-6 exit criteria)

- `tsc --noEmit` clean · lint clean · all Vitest pass (incl. updated tasks-view test).
- Backend `pytest apps/crm apps/authentication` passes (plus the in_progress transition test).
- The `in_progress` status migration applies and reverses cleanly.
- Production build (`NODE_ENV=production`) succeeds; `/tasks` shows My / Team / Calendar / Kanban.
- CI deny-list unchanged (comments-only).
