# ERP/CRM Phase 6 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the existing `/tasks` page into the global Tasks module with four views — My / Team / Calendar / Kanban — built on the existing `crm.FollowUpTask`, adding only an `in_progress` status for the Kanban.

**Architecture:** Reuse `crm.FollowUpTask` + its `/crm/tasks/` endpoints (list/create/update/complete, gated `crm.tasks.manage`). One small backend change (a new status choice). Frontend: a new `TaskBoard` over the shared `KanbanBoard` (mirroring `DealBoard`), and the `/tasks` page expanded from List+Calendar to My/Team/Calendar/Kanban (reusing `TaskList`, `TaskCalendar`, `TaskComposer`).

**Tech Stack:** Django 4.2 + DRF, pytest; Next.js 14 App Router + TS strict, React Query, Tailwind, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-29-erp-crm-phase-6-design.md`

---

## Reference patterns (read before starting)

- `crm.FollowUpTask` model + `Status` choices: `apps/crm/models.py` (FollowUpTask). `FollowUpTaskViewSet` (list/create/`PATCH`/`complete`, gated `crm.tasks.manage`): `apps/crm/views.py`.
- Kanban board + a board wrapper to mirror: `frontend/src/components/shared/KanbanBoard.tsx`, `frontend/src/components/crm/DealBoard.tsx` (Phase 3) + the Deals page wiring `frontend/src/app/(app)/crm/deals/page.tsx`.
- Existing tasks page (List+Calendar toggle, filters, composer): `frontend/src/app/(app)/tasks/page.tsx`. Reusable parts: `components/crm/TaskList.tsx`, `TaskCalendar.tsx`, `TaskComposer.tsx`.
- `crmApi` task methods (`listTasks({ assigned_to, status })`, `updateTask(id, { status })`, `completeTask`), `TaskFilters`, `TaskStatus`, `TASK_PRIORITY_LABELS`: `frontend/src/lib/api/crm.ts`. `qk.tasks` (listKey): `frontend/src/lib/query/keys.ts`.
- Current user id: `useAuthStore().user?.id` (`frontend/src/lib/stores/authStore.ts`).
- Existing test to update: `frontend/src/app/(app)/tasks/__tests__/tasksView.test.tsx`.
- Response envelope `{success, data}`; backend tests read `.json()["data"]`. Reuse the `crm` test fixtures (`shop`, a user, JWT client) from `apps/crm/tests/` (e.g. `test_contacts_api.py` `client_with_perms`).

**Build order:** Task 1 (backend status) → Task 2 (TaskBoard component) → Task 3 (page wiring + test) → Task 4 (verify). Each task ends in a commit.

---

## Task 1: Backend — add `in_progress` status

**Files:** Modify `apps/crm/models.py`; migration; test `apps/crm/tests/test_task_in_progress.py`.

- [ ] **Step 1: Failing test** (reuse `shop` + a JWT `client_with_perms` like `apps/crm/tests/test_contacts_api.py`):

```python
import uuid
import pytest
from datetime import date
from rest_framework import status

# ... paste shop + client_with_perms fixtures (perms list, shop_ids) from test_contacts_api.py ...


def _task(shop, user, **kw):
    from crm.models import FollowUpTask
    defaults = dict(title="T", due_date=date.today(), assigned_to=user, status="pending")
    defaults.update(kw)
    return FollowUpTask.objects.create(**defaults)


@pytest.mark.django_db
def test_task_can_move_to_in_progress(shop, client_with_perms):
    from authentication.models import User
    me = User.objects.create_user(email="me@t.com", phone="+919800000123", full_name="Me", password="p")
    task = _task(shop, me)
    client = client_with_perms(shop, ["crm.tasks.manage"])

    resp = client.patch(f"/api/v1/crm/tasks/{task.id}/", {"status": "in_progress"}, format="json")
    assert resp.status_code == status.HTTP_200_OK, resp.content
    assert resp.json()["data"]["status"] == "in_progress"
```

> Confirm the `client_with_perms` signature used by the CRM tests (`(shop, perms)` returning the
> client). `FollowUpTask.assigned_to` is required; `customer`/`lead` are optional (standalone task OK).

- [ ] **Step 2: Run → FAIL** (400 — `in_progress` not a valid choice).
Run (from `backend/`): `python -m pytest apps/crm/tests/test_task_in_progress.py -p no:cacheprovider -o addopts="" --create-db -q`

- [ ] **Step 3: Add the status** — in `apps/crm/models.py`, `FollowUpTask.Status`:

```python
        PENDING = "pending", "Pending"
        IN_PROGRESS = "in_progress", "In Progress"
        COMPLETED = "completed", "Completed"
        CANCELLED = "cancelled", "Cancelled"
        OVERDUE = "overdue", "Overdue"
```

- [ ] **Step 4: Migration** — `python manage.py makemigrations crm` (a no-op `AlterField` on `status` choices).

- [ ] **Step 5: Run → PASS** + `python -m pytest apps/crm -p no:cacheprovider -o addopts="" --create-db -q` (no regressions).

> Note: local runs may need `--create-db` to pick up the new migration against the cached test DB.

- [ ] **Step 6: Commit**
```bash
git add backend/apps/crm/models.py backend/apps/crm/migrations/ backend/apps/crm/tests/test_task_in_progress.py
git commit -m "feat(tasks): add in_progress status to FollowUpTask"
```

---

## Task 2: Frontend — TaskCard + TaskBoard (Kanban)

**Files:** Modify `frontend/src/lib/api/crm.ts` (add `TASK_KANBAN_COLS` + ensure `in_progress` in `TaskStatus`); create `frontend/src/components/crm/TaskCard.tsx`, `frontend/src/components/crm/TaskBoard.tsx`.

- [ ] **Step 1: Types/constants** — in `crm.ts`:
  - Ensure `TaskStatus` includes `'in_progress'`:
    `export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled' | 'overdue';`
  - Add:
    ```typescript
    export const TASK_KANBAN_COLS: Array<{ status: TaskStatus; label: string }> = [
      { status: 'pending',     label: 'To-do' },
      { status: 'in_progress', label: 'In Progress' },
      { status: 'completed',   label: 'Done' },
      { status: 'cancelled',   label: 'Cancelled' },
    ];
    ```

- [ ] **Step 2: `TaskCard`** — create `frontend/src/components/crm/TaskCard.tsx`:

```tsx
import type { Task } from '@/lib/api/crm';
import { TASK_PRIORITY_LABELS } from '@/lib/api/crm';
import { formatDate } from '@/lib/format/date';

export function TaskCard({ task }: { task: Task }) {
  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-3 space-y-1">
      <p className="text-body-sm font-medium text-[var(--text)] truncate">{task.title}</p>
      <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
        <span>{task.assigned_to_name ?? '—'}</span>
        <span>{formatDate(task.due_date)}</span>
      </div>
      <span className="text-[10px] text-[var(--text-muted)]">{TASK_PRIORITY_LABELS[task.priority]}</span>
    </div>
  );
}
```

> Confirm `Task` field names (`assigned_to_name`, `due_date`, `priority`) and `TASK_PRIORITY_LABELS`
> key type in `crm.ts`. Adjust if different.

- [ ] **Step 3: `TaskBoard`** — create `frontend/src/components/crm/TaskBoard.tsx` (mirror `DealBoard.tsx`):

```tsx
'use client';

import { useCallback } from 'react';
import { KanbanBoard, type KanbanColumnDef, type KanbanCardBase } from '@/components/shared/KanbanBoard';
import { TaskCard } from './TaskCard';
import type { Task, TaskStatus } from '@/lib/api/crm';

export interface TaskColumnData {
  status: TaskStatus;
  tasks: Task[];
  isLoading: boolean;
  count: number;
}

const TASK_KANBAN_COLS: KanbanColumnDef[] = [
  { id: 'pending',     label: 'To-do',       colorToken: 'var(--accent)' },
  { id: 'in_progress', label: 'In Progress', colorToken: 'var(--status-progress)' },
  { id: 'completed',   label: 'Done',        colorToken: 'var(--success)' },
  { id: 'cancelled',   label: 'Cancelled',   colorToken: 'var(--danger)', collapsible: true, defaultCollapsed: true },
];

const TASK_VALID_TRANSITIONS: Record<string, string[]> = {
  pending:     ['in_progress', 'completed', 'cancelled'],
  in_progress: ['completed', 'cancelled', 'pending'],
  completed:   ['pending', 'in_progress'],
  cancelled:   ['pending'],
};

interface TaskKanbanCard extends KanbanCardBase {
  task: Task;
}

function toKanbanCards(columns: TaskColumnData[]): TaskKanbanCard[] {
  return columns.flatMap(({ status, tasks }) =>
    tasks.map((task) => ({ id: task.id, columnId: status, task })),
  );
}

interface TaskBoardProps {
  columns: TaskColumnData[];
  onCardMove: (taskId: string, fromStatus: TaskStatus, toStatus: TaskStatus) => Promise<void>;
}

export function TaskBoard({ columns, onCardMove }: TaskBoardProps) {
  const cards = toKanbanCards(columns);

  const handleCardMove = useCallback(
    async (cardId: string, fromCol: string, toCol: string) => {
      await onCardMove(cardId, fromCol as TaskStatus, toCol as TaskStatus);
    },
    [onCardMove],
  );

  const renderCard = useCallback((card: TaskKanbanCard) => <TaskCard task={card.task} />, []);
  const columnCounts = Object.fromEntries(columns.map((c) => [c.status, c.count]));
  const isLoadingMap = Object.fromEntries(columns.map((c) => [c.status, c.isLoading]));

  return (
    <KanbanBoard
      columns={TASK_KANBAN_COLS}
      cards={cards}
      validTransitions={TASK_VALID_TRANSITIONS}
      onCardMove={handleCardMove}
      onColumnReorder={() => {}}
      renderCard={renderCard}
      columnOrderStorageKey="repaiross-kanban-tasks-column-order"
      columnCounts={columnCounts}
      isLoadingMap={isLoadingMap}
      emptyLabel="No tasks in this stage"
    />
  );
}
```

- [ ] **Step 4: Verify** — from `frontend/`: `npx tsc --noEmit` (exit 0).

- [ ] **Step 5: Commit**
```bash
git add frontend/src/lib/api/crm.ts frontend/src/components/crm/TaskCard.tsx frontend/src/components/crm/TaskBoard.tsx
git commit -m "feat(tasks): TaskBoard kanban component + in_progress status"
```

---

## Task 3: Frontend — `/tasks` page → My/Team/Calendar/Kanban

**Files:** Modify `frontend/src/app/(app)/tasks/page.tsx`, `frontend/src/app/(app)/tasks/__tests__/tasksView.test.tsx`.

- [ ] **Step 1: Expand the view switch** — change the `TaskView` type to
`'my' | 'team' | 'calendar' | 'kanban'` (default `'my'`). Replace the two-button toggle with four
buttons (`aria-label`: "My tasks", "Team tasks", "Calendar view", "Kanban view"), each setting `view`.

- [ ] **Step 2: Wire the views:**
  - Determine `myId = useAuthStore((s) => s.user?.id)`.
  - **My**: existing list query, but `listFilters.assigned_to = myId` (enabled when `view === 'my'`).
  - **Team**: existing list query with no `assigned_to` (enabled when `view === 'team'`); render the
    assignee column (the existing `TaskList` already shows assignee, or pass a flag).
  - **Calendar**: unchanged (`view === 'calendar'`).
  - **Kanban**: per-column `useQueries` over `TASK_KANBAN_COLS` (mirror the Deals page), each
    `crmApi.listTasks({ status })` (+ `assigned_to: myId` only if you want "my" board — keep it the
    team board for parity with the rest, i.e. no assignee filter). Build `TaskColumnData[]`, render
    `<TaskBoard columns={...} onCardMove={...} />`. `onCardMove` calls
    `crmApi.updateTask(taskId, { status: toStatus })` then invalidates `qk.tasks()`.

Sketch for the kanban wiring (mirror `crm/deals/page.tsx`):

```tsx
const kanbanQueries = useQueries({
  queries: TASK_KANBAN_COLS.map(({ status }) => ({
    queryKey: qk.tasks({ status }),
    queryFn: () => crmApi.listTasks({ status }),
    staleTime: 30_000,
    enabled: view === 'kanban',
  })),
});
const kanbanColumns: TaskColumnData[] = TASK_KANBAN_COLS.map(({ status }, i) => ({
  status,
  tasks: kanbanQueries[i]?.data?.items ?? [],
  isLoading: kanbanQueries[i]?.isLoading ?? false,
  count: kanbanQueries[i]?.data?.meta?.count ?? (kanbanQueries[i]?.data?.items?.length ?? 0),
}));
const handleTaskMove = useCallback(async (taskId: string, _from: TaskStatus, to: TaskStatus) => {
  await crmApi.updateTask(taskId, { status: to });
  queryClient.invalidateQueries({ queryKey: qk.tasks() });
  toast.success('Task moved');
}, [queryClient]);
```

> Import `useQueries`, `useCallback`, `TASK_KANBAN_COLS` (from `crm.ts`), `TaskBoard`, `TaskColumnData`.
> Confirm `crmApi.listTasks` returns `{ items, meta }`. Keep the existing status/priority filters for
> the My/Team list views; they don't apply to the Kanban (which is grouped by status).

- [ ] **Step 3: Update the test** — `tasksView.test.tsx` currently exercises the List↔Calendar toggle.
Update it for the new buttons:
  - Default view is now **My** — assert task rows render (the mocked task title, e.g. "Call Ravi").
  - Update the calendar test to click the `"Calendar view"` button (unchanged label).
  - Add a check that clicking `"Kanban view"` renders the board (mock `@/components/crm/TaskBoard` to a
    stub `data-testid="task-board"` to avoid dnd-kit in jsdom — mirror the Deals page smoke test), or
    keep the test minimal and just assert the Kanban button exists.

- [ ] **Step 4: Verify** — from `frontend/`: `npx tsc --noEmit` (0); `npx vitest run` (all pass); `npm run lint -- --no-cache` (clean).

- [ ] **Step 5: Commit**
```bash
git add frontend/src/app/\(app\)/tasks/page.tsx frontend/src/app/\(app\)/tasks/__tests__/tasksView.test.tsx
git commit -m "feat(tasks): /tasks page — My/Team/Calendar/Kanban views"
```

---

## Task 4: Final verification

- [ ] **Step 1: Backend** — from `backend/`:
`python -m pytest apps/crm apps/authentication -p no:cacheprovider -o addopts="" --create-db -q` → PASS.

- [ ] **Step 2: Migration reversibility** — inside the backend container:
`docker compose exec -T backend sh -c "python manage.py showmigrations crm | tail -3"`, then migrate the
crm app down one and back up, confirming the `in_progress` `AlterField` migration applies/reverses cleanly.

- [ ] **Step 3: Frontend** — from `frontend/`: `npx tsc --noEmit`; `npx vitest run`; `npm run lint -- --no-cache` → all clean.

- [ ] **Step 4: Production build** — `docker compose exec -e NODE_ENV=production frontend sh -c "npm run build"` → exit 0; `/tasks` builds.

- [ ] **Step 5: CI deny-list** — from `backend/`: `grep -vc '^#\|^$' ci-known-failures.txt` → `0`.

---

## Notes for the implementer

- **No new model / app** — reuse `crm.FollowUpTask` and `/crm/tasks/` (gated `crm.tasks.manage`). The only backend change is the `in_progress` status choice.
- **`FollowUpTaskSerializer` is a ModelSerializer** — adding the model choice is enough; the `PATCH` accepts `status: "in_progress"` with no serializer change.
- **Team = all tasks**; **My = assigned_to current user**. Kanban groups by status (team-wide).
- **Standalone tasks** (no customer/lead) already work; `TaskComposer`'s `customerId`/`leadId`/`jobId` are optional.
- **No `any`, no `console.log`.** App Router pages export only the default component. React Query v5.
- Local backend test runs may need `--create-db` (new migration vs. cached test DB); CI runs fresh.
