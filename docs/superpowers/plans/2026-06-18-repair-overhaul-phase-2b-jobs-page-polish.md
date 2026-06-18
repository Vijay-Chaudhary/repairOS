# Repair Overhaul — Phase 2 (Part 2): Jobs Page Polish — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Polish the Jobs page — a payment-due signal on kanban cards, filter-aware empty states, and a list density toggle + column show/hide persisted across sessions.

**Architecture:** Small, focused additions over existing components. `JobCard` gains a balance-derived payment row. Empty-state copy is computed from a pure helper (filters active vs not) and threaded into `DataTable` (list) and `JobBoard`→`KanbanBoard` (kanban) — both already render skeletons and a base empty state. List density + hidden columns live in `uiStore` (Zustand, persisted); `DataTable` gains a `density` prop and the page filters its columns.

**Tech Stack:** Next.js 14 App Router, TypeScript strict, Tailwind, Zustand, Vitest + RTL.

**Spec:** `docs/superpowers/specs/2026-06-17-repair-module-overhaul-design.md` (Phase 2, items 2e–2g).

---

## Scope & decisions

- **Part 2 of 2.** Part 1 (search + unified filters) is in PR #3. This part covers 2e (clearer kanban cards), 2f (filter-aware empty/loading states), 2g (list density + column visibility).
- **Branch off the Part 1 branch** (`feat/repair-overhaul-phase-2a`), not `master`: 2f relies on Part 1's `JobFilterState` in `jobs/page.tsx`, and both 2f and 2g edit `jobs/page.tsx` which Part 1 rewrote. Stacking avoids conflicts. (If Part 1 has already merged to `master` by execution time, branch off the updated `master` instead.)
- **Skeletons already exist** — `DataTable` renders skeleton rows on `loading`; `KanbanBoard` renders pulse blocks per column via `isLoadingMap`. So 2f adds only *filter-aware empty text*, no new skeleton work.
- **Money fields are strings at runtime** (DRF `DecimalField`, `COERCE_DECIMAL_TO_STRING=True`). `JobListItem` types `service_charge`/`advance_paid` as `number` but they arrive as strings. Use `sumMoney` (`@/lib/format/money`) for the balance, never raw `-` on the typed numbers in new code.
- **Essential columns stay visible:** `job_number` and `customer` are never hideable; the rest are toggleable.

## Prerequisite (handle before Task 1)

`git status` shows pre-existing **uncommitted** working-tree edits to `frontend/src/components/repair/JobCard.tsx` and `frontend/src/components/crm/LeadCard.tsx` (in-progress card-layout work, not part of this plan). Task 1 modifies `JobCard.tsx`, so its diff/commit would otherwise sweep these in.

**Before starting Task 1:** commit those pre-existing edits as their own commit so Task 1's change is isolated:

```bash
cd /home/appuser/workspace/projects/repairOS
git status --short   # confirm the two files are the only unexpected changes
git add frontend/src/components/repair/JobCard.tsx frontend/src/components/crm/LeadCard.tsx
git commit -m "chore(ui): commit in-progress LeadCard/JobCard layout edits"
```

(If the user wants these discarded instead, `git checkout -- <files>` — confirm with them. Do not silently fold them into a feature commit.)

---

## Cross-cutting UX acceptance criteria

- Payment signal uses icon **and** color/text (never color alone): "Paid" with a check, or the due amount with a warning tone.
- Empty states are filter-aware and offer a recovery path ("Clear filters" when filters are active; "New Job" when truly empty).
- Density + column prefs persist across reloads (Zustand `persist`).
- Tap targets ≥ 44px; menus keyboard-operable; no `any`; no `console.log`.

---

## File Map

| File | Change |
|---|---|
| `frontend/src/components/repair/JobCard.tsx` | Add payment-due / Paid row (balance via `sumMoney`) |
| `frontend/src/components/repair/__tests__/JobCard.test.tsx` | New: paid vs due rendering |
| `frontend/src/lib/repair/jobFilters.ts` | Add `hasActiveFilters` + `jobsEmptyCopy` helpers |
| `frontend/src/lib/repair/__tests__/jobFilters.test.ts` | Extend: empty-copy + active-filter tests |
| `frontend/src/components/repair/JobBoard.tsx` | Accept optional `emptyLabel` prop |
| `frontend/src/lib/stores/uiStore.ts` | Add `jobsListDensity`, `jobsHiddenColumns` + setters + persist |
| `frontend/src/lib/stores/__tests__/uiStore.test.ts` | New: density/column prefs |
| `frontend/src/components/shared/DataTable.tsx` | Add `density` prop |
| `frontend/src/app/(app)/jobs/page.tsx` | Filter-aware empty text; density toggle + Columns menu; pass density + visible columns |

---

## Task 1: Payment-due signal on JobCard (2e)

**Files:**
- Modify: `frontend/src/components/repair/JobCard.tsx`
- Test: `frontend/src/components/repair/__tests__/JobCard.test.tsx`

Context: `JobCard` renders a footer with intake date + `<Money amount={job.service_charge} />`. It imports `Money` and `cn`; `job` has `service_charge`/`advance_paid` (strings at runtime). It uses `useRouter` from `next/navigation`. We add a payment row: balance > 0 → due amount (warning); balance ≤ 0 with a positive charge → "Paid" (success); zero-charge job → show nothing extra.

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/repair/__tests__/JobCard.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { JobCard } from '../JobCard';
import type { JobListItem } from '@/lib/api/repair';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

function job(overrides: Partial<JobListItem> = {}): JobListItem {
  return {
    id: 'j1', job_number: 'JOY-2026-0001', customer_id: 'c1', customer_name: 'Ravi Kumar',
    device_type: 'Smartphone', status: 'open', priority: 'normal',
    service_charge: 500 as unknown as number, advance_paid: 0 as unknown as number,
    intake_date: '2026-06-10', shop_id: 's1',
    ...overrides,
  };
}

describe('JobCard payment signal', () => {
  it('shows the outstanding balance when unpaid (string money fields)', () => {
    // DRF sends decimals as strings at runtime
    render(<JobCard job={job({ service_charge: '500.00' as unknown as number, advance_paid: '100.00' as unknown as number })} />);
    expect(screen.getByText('Due')).toBeInTheDocument();
    expect(screen.getByText('₹400.00')).toBeInTheDocument();
  });

  it('shows Paid when fully paid', () => {
    render(<JobCard job={job({ service_charge: '500.00' as unknown as number, advance_paid: '500.00' as unknown as number })} />);
    expect(screen.getByText('Paid')).toBeInTheDocument();
  });

  it('shows neither Paid nor Due when there is no charge', () => {
    render(<JobCard job={job({ service_charge: '0.00' as unknown as number, advance_paid: '0.00' as unknown as number })} />);
    expect(screen.queryByText('Paid')).not.toBeInTheDocument();
    expect(screen.queryByText('Due')).not.toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run, confirm fail**

```bash
cd /home/appuser/workspace/projects/repairOS/frontend
npx vitest run src/components/repair/__tests__/JobCard.test.tsx 2>&1 | tail -20
```
Expected: FAIL (no "Paid"/"Due" text yet).

- [ ] **Step 3: Implement**

In `frontend/src/components/repair/JobCard.tsx`:

(a) Add imports near the existing ones (`Money` is already imported; add `sumMoney` and two icons):
```typescript
import { sumMoney } from '@/lib/format/money';
```
Add `CheckCircle2` and `IndianRupee` to the existing `lucide-react` import line.

(b) Inside `JobCard`, after the `overdueDays` computation, derive the balance:
```typescript
  const balance = sumMoney(job.service_charge) - sumMoney(job.advance_paid);
  const hasCharge = sumMoney(job.service_charge) > 0;
  const isPaid = hasCharge && balance <= 0;
  const isDue = balance > 0;
```

(c) In the `!compact` footer block, replace the existing charge line:
```tsx
          <div className="flex items-center justify-between mt-1">
            <div className="flex items-center gap-1 text-xs text-[var(--text-muted)]">
              <Clock className="h-3 w-3 shrink-0" />
              <span>{formatDate(job.intake_date)}</span>
            </div>
            <Money amount={job.service_charge} className="text-xs" />
          </div>
```
with:
```tsx
          <div className="flex items-center justify-between mt-1">
            <div className="flex items-center gap-1 text-xs text-[var(--text-muted)]">
              <Clock className="h-3 w-3 shrink-0" />
              <span>{formatDate(job.intake_date)}</span>
            </div>
            {isDue ? (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--warning)]">
                <IndianRupee className="h-3 w-3 shrink-0" />
                Due <Money amount={balance} className="text-xs" />
              </span>
            ) : isPaid ? (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--success)]">
                <CheckCircle2 className="h-3 w-3 shrink-0" />
                Paid
              </span>
            ) : (
              <Money amount={job.service_charge} className="text-xs text-[var(--text-muted)]" />
            )}
          </div>
```

> Note: the test renders the non-compact card (default), so the footer is present. `Money` renders the `₹400.00` text node; "Due" is a sibling text node, so `getByText('Due')` and `getByText('₹400.00')` both resolve.

- [ ] **Step 4: Run, confirm pass**

```bash
npx vitest run src/components/repair/__tests__/JobCard.test.tsx 2>&1 | tail -15
```
Expected: 3 PASS.

- [ ] **Step 5: Typecheck**

```bash
npx tsc --noEmit 2>&1 | grep "error TS" | grep -v "Can.test.tsx" || echo "OK no errors"
```
Expected: `OK no errors`.

- [ ] **Step 6: Commit**

```bash
cd /home/appuser/workspace/projects/repairOS
git add frontend/src/components/repair/JobCard.tsx frontend/src/components/repair/__tests__/JobCard.test.tsx
git commit -m "feat(jobs): show payment-due / Paid signal on job cards

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Filter-aware empty states (2f)

**Files:**
- Modify: `frontend/src/lib/repair/jobFilters.ts`
- Test: `frontend/src/lib/repair/__tests__/jobFilters.test.ts`
- Modify: `frontend/src/components/repair/JobBoard.tsx`
- Modify: `frontend/src/app/(app)/jobs/page.tsx`

- [ ] **Step 1: Write the failing test**

Append to `frontend/src/lib/repair/__tests__/jobFilters.test.ts` (inside the file, add a new `describe`; keep existing imports and add `hasActiveFilters, jobsEmptyCopy` to the import list from `../jobFilters`):

```ts
describe('hasActiveFilters & jobsEmptyCopy', () => {
  it('detects no active filters on empty state', () => {
    expect(hasActiveFilters(state())).toBe(false);
  });

  it('counts search and any filter as active', () => {
    expect(hasActiveFilters(state({ search: 'x' }))).toBe(true);
    expect(hasActiveFilters(state({ status: 'open' }))).toBe(true);
    expect(hasActiveFilters(state({ overdue: true }))).toBe(true);
  });

  it('returns filter-aware copy', () => {
    const empty = jobsEmptyCopy(false);
    expect(empty.title).toMatch(/no jobs yet/i);
    expect(empty.kanbanLabel).toMatch(/no jobs in this stage/i);
    const filtered = jobsEmptyCopy(true);
    expect(filtered.title).toMatch(/no matching jobs/i);
    expect(filtered.kanbanLabel).toMatch(/no matches/i);
  });
});
```

- [ ] **Step 2: Run, confirm fail**

```bash
cd /home/appuser/workspace/projects/repairOS/frontend
npx vitest run src/lib/repair/__tests__/jobFilters.test.ts 2>&1 | tail -15
```
Expected: FAIL (`hasActiveFilters`/`jobsEmptyCopy` not exported).

- [ ] **Step 3: Implement the helpers**

Append to `frontend/src/lib/repair/jobFilters.ts`:

```ts
/** True when search text or any panel/preset filter is active. */
export function hasActiveFilters(s: JobFilterState): boolean {
  return s.search.trim().length > 0 || activeFilterCount(s) > 0;
}

export interface JobsEmptyCopy {
  title: string;
  description: string;
  kanbanLabel: string;
}

/** Empty-state copy that adapts to whether filters/search are narrowing the view. */
export function jobsEmptyCopy(filtersActive: boolean): JobsEmptyCopy {
  if (filtersActive) {
    return {
      title: 'No matching jobs',
      description: 'No jobs match the current search and filters. Try clearing them.',
      kanbanLabel: 'No matches',
    };
  }
  return {
    title: 'No jobs yet',
    description: 'Create your first job to get started.',
    kanbanLabel: 'No jobs in this stage',
  };
}
```

- [ ] **Step 4: Run, confirm pass**

```bash
npx vitest run src/lib/repair/__tests__/jobFilters.test.ts 2>&1 | tail -15
```
Expected: all PASS (the new describe + the existing ones).

- [ ] **Step 5: Thread `emptyLabel` through JobBoard**

In `frontend/src/components/repair/JobBoard.tsx`, add an optional prop and pass it to `KanbanBoard` (which already accepts `emptyLabel`). Change the `JobBoardProps` interface to add:
```typescript
  emptyLabel?: string;
```
Update the function signature `export function JobBoard({ columns, onCardMove }: JobBoardProps)` to `export function JobBoard({ columns, onCardMove, emptyLabel }: JobBoardProps)`. Then in the `<KanbanBoard ... />` JSX replace the hardcoded `emptyLabel="No jobs in this stage"` with:
```tsx
      emptyLabel={emptyLabel ?? 'No jobs in this stage'}
```

- [ ] **Step 6: Wire filter-aware copy into the page**

In `frontend/src/app/(app)/jobs/page.tsx`:

Add to the imports from `@/lib/repair/jobFilters` (extend the existing import): `hasActiveFilters`, `jobsEmptyCopy`.

Inside `JobsPage`, after `filters` is declared, derive the copy:
```typescript
  const emptyCopy = useMemo(() => jobsEmptyCopy(hasActiveFilters(filters)), [filters]);
```

In the kanban render, pass it to `JobBoard`:
```tsx
        <JobBoard columns={kanbanColumns} onCardMove={handleCardMove} emptyLabel={emptyCopy.kanbanLabel} />
```

In the list `DataTable`, replace the static empty props:
```tsx
            emptyTitle="No jobs yet"
            emptyDescription="Create your first job to get started."
```
with:
```tsx
            emptyTitle={emptyCopy.title}
            emptyDescription={emptyCopy.description}
```
Leave the existing `emptyAction` (New Job) as-is — it's a useful recovery path in both states.

- [ ] **Step 7: Typecheck + tests**

```bash
npx tsc --noEmit 2>&1 | grep "error TS" | grep -v "Can.test.tsx" || echo "OK no errors"
npx vitest run src/lib/repair 2>&1 | tail -10
```
Expected: `OK no errors`; filter tests pass.

- [ ] **Step 8: Commit**

```bash
cd /home/appuser/workspace/projects/repairOS
git add frontend/src/lib/repair/jobFilters.ts frontend/src/lib/repair/__tests__/jobFilters.test.ts frontend/src/components/repair/JobBoard.tsx "frontend/src/app/(app)/jobs/page.tsx"
git commit -m "feat(jobs): filter-aware empty states for list and kanban

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: List density + column visibility (2g)

**Files:**
- Modify: `frontend/src/lib/stores/uiStore.ts`
- Test: `frontend/src/lib/stores/__tests__/uiStore.test.ts`
- Modify: `frontend/src/components/shared/DataTable.tsx`
- Modify: `frontend/src/app/(app)/jobs/page.tsx`

### 3a — uiStore prefs

- [ ] **Step 1: Write the failing test**

Create `frontend/src/lib/stores/__tests__/uiStore.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { useUiStore } from '../uiStore';

describe('uiStore — jobs list prefs', () => {
  beforeEach(() => {
    useUiStore.setState({ jobsListDensity: 'comfortable', jobsHiddenColumns: [] });
  });

  it('defaults to comfortable density and no hidden columns', () => {
    const s = useUiStore.getState();
    expect(s.jobsListDensity).toBe('comfortable');
    expect(s.jobsHiddenColumns).toEqual([]);
  });

  it('sets density', () => {
    useUiStore.getState().setJobsListDensity('compact');
    expect(useUiStore.getState().jobsListDensity).toBe('compact');
  });

  it('toggles a column hidden then visible', () => {
    useUiStore.getState().toggleJobsColumn('charge');
    expect(useUiStore.getState().jobsHiddenColumns).toContain('charge');
    useUiStore.getState().toggleJobsColumn('charge');
    expect(useUiStore.getState().jobsHiddenColumns).not.toContain('charge');
  });
});
```

- [ ] **Step 2: Run, confirm fail**

```bash
cd /home/appuser/workspace/projects/repairOS/frontend
npx vitest run src/lib/stores/__tests__/uiStore.test.ts 2>&1 | tail -15
```
Expected: FAIL (`jobsListDensity` undefined / `setJobsListDensity` not a function).

- [ ] **Step 3: Implement store additions**

In `frontend/src/lib/stores/uiStore.ts`:

Add to the `UiState` interface (with the other state fields):
```typescript
  jobsListDensity: 'comfortable' | 'compact';
  jobsHiddenColumns: string[];
```
Add to the `UiState` interface (with the other actions):
```typescript
  setJobsListDensity: (d: 'comfortable' | 'compact') => void;
  toggleJobsColumn: (key: string) => void;
```
Add to the store initializer (with the other initial values):
```typescript
      jobsListDensity: 'comfortable' as const,
      jobsHiddenColumns: [],
```
Add the actions (with the other setters):
```typescript
      setJobsListDensity: (d) => set({ jobsListDensity: d }),
      toggleJobsColumn: (key) =>
        set((s) => ({
          jobsHiddenColumns: s.jobsHiddenColumns.includes(key)
            ? s.jobsHiddenColumns.filter((k) => k !== key)
            : [...s.jobsHiddenColumns, key],
        })),
```
Add both keys to `partialize` so they persist:
```typescript
      partialize: (state) => ({
        sidebarCollapsed: state.sidebarCollapsed,
        theme: state.theme,
        navGroupsOpen: state.navGroupsOpen,
        jobsListDensity: state.jobsListDensity,
        jobsHiddenColumns: state.jobsHiddenColumns,
      }),
```

- [ ] **Step 4: Run, confirm pass**

```bash
npx vitest run src/lib/stores/__tests__/uiStore.test.ts 2>&1 | tail -15
```
Expected: 3 PASS.

- [ ] **Step 5: Commit**

```bash
cd /home/appuser/workspace/projects/repairOS
git add frontend/src/lib/stores/uiStore.ts frontend/src/lib/stores/__tests__/uiStore.test.ts
git commit -m "feat(ui): persist jobs list density and hidden columns in uiStore

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### 3b — DataTable density prop

- [ ] **Step 6: Add the `density` prop**

In `frontend/src/components/shared/DataTable.tsx`:

Add to `DataTableProps<T>`:
```typescript
  density?: 'comfortable' | 'compact';
```
Add `density = 'comfortable'` to the destructured props (alongside `className`). Then compute a class and apply it to the `<Table>`:
```typescript
  const densityClass = density === 'compact' ? '[&_td]:py-1' : '[&_td]:py-2.5';
```
Change the `<Table>` opening tag to:
```tsx
        <Table className={densityClass}>
```
(The `Table` primitive already forwards `className` to the `<table>` element, and the `td` selector overrides the default cell padding.)

- [ ] **Step 7: Typecheck**

```bash
cd /home/appuser/workspace/projects/repairOS/frontend
npx tsc --noEmit 2>&1 | grep "error TS" | grep -v "Can.test.tsx" || echo "OK no errors"
```
Expected: `OK no errors`.

- [ ] **Step 8: Commit**

```bash
cd /home/appuser/workspace/projects/repairOS
git add frontend/src/components/shared/DataTable.tsx
git commit -m "feat(table): add density prop to DataTable

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

### 3c — List controls in jobs/page.tsx

- [ ] **Step 9: Add density toggle + Columns menu and apply prefs**

In `frontend/src/app/(app)/jobs/page.tsx`:

Add imports:
```typescript
import { useUiStore } from '@/lib/stores/uiStore';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, DropdownMenuCheckboxItem } from '@/components/ui/dropdown-menu';
import { Rows3, Rows2, Columns3 } from 'lucide-react';
```

Add a constant near `LIST_COLUMNS` listing which columns may be hidden (job_number + customer are essential and omitted):
```typescript
const TOGGLEABLE_COLUMNS: Array<{ key: string; label: string }> = [
  { key: 'device', label: 'Device' },
  { key: 'status', label: 'Status' },
  { key: 'due', label: 'Due Date' },
  { key: 'technician', label: 'Technician' },
  { key: 'charge', label: 'Charge' },
  { key: 'balance', label: 'Balance' },
  { key: 'intake', label: 'Intake' },
];
```

Inside `JobsPage`, read the prefs from the store:
```typescript
  const { jobsListDensity, jobsHiddenColumns, setJobsListDensity, toggleJobsColumn } = useUiStore();

  const visibleColumns = useMemo(
    () => LIST_COLUMNS.filter((c) => !jobsHiddenColumns.includes(c.key)),
    [jobsHiddenColumns],
  );
```

In the list-view branch, render a small toolbar directly above the `DataTable` (inside the `view === 'list'` block, wrapping the table). Replace:
```tsx
        ) : (
          <DataTable
            columns={LIST_COLUMNS}
```
with:
```tsx
        ) : (
          <div className="flex flex-col h-full gap-2">
            <div className="flex items-center justify-end gap-1">
              <div className="flex rounded-md border border-[var(--border)] overflow-hidden">
                <button
                  onClick={() => setJobsListDensity('comfortable')}
                  className={cn('h-8 w-8 flex items-center justify-center', jobsListDensity === 'comfortable' ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-muted)] hover:bg-[var(--surface-2)]')}
                  title="Comfortable rows"
                  aria-label="Comfortable row density"
                >
                  <Rows3 className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setJobsListDensity('compact')}
                  className={cn('h-8 w-8 flex items-center justify-center', jobsListDensity === 'compact' ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-muted)] hover:bg-[var(--surface-2)]')}
                  title="Compact rows"
                  aria-label="Compact row density"
                >
                  <Rows2 className="h-4 w-4" />
                </button>
              </div>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="h-8 px-2 inline-flex items-center gap-1.5 rounded-md border border-[var(--border)] text-body-sm text-[var(--text-muted)] hover:bg-[var(--surface-2)]"
                    aria-label="Choose columns"
                  >
                    <Columns3 className="h-4 w-4" />
                    <span className="hidden sm:inline">Columns</span>
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {TOGGLEABLE_COLUMNS.map((col) => (
                    <DropdownMenuCheckboxItem
                      key={col.key}
                      checked={!jobsHiddenColumns.includes(col.key)}
                      onCheckedChange={() => toggleJobsColumn(col.key)}
                      onSelect={(e) => e.preventDefault()}
                    >
                      {col.label}
                    </DropdownMenuCheckboxItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <DataTable
              columns={visibleColumns}
              density={jobsListDensity}
```
Then continue with the EXISTING `DataTable` props (`data`, `loading`, `error`, `keyExtractor`, `onRowClick`, `emptyTitle`, `emptyDescription`, `emptyAction`, `page`, `totalPages`, `onPageChange`, `totalCount`) unchanged, and CLOSE the new wrapper `</div>` after the `/>` of `DataTable`. Carefully preserve the existing closing tags: the `DataTable` self-closes, then add one extra `</div>` before the `)}` that ends the ternary.

> `DropdownMenuCheckboxItem` is already exported from `@/components/ui/dropdown-menu` (confirmed) and all lucide icons used here (`Rows3`, `Rows2`, `Columns3`) exist in the installed `lucide-react` — no primitive changes needed.

- [ ] **Step 10: Typecheck + targeted tests**

```bash
cd /home/appuser/workspace/projects/repairOS/frontend
npx tsc --noEmit 2>&1 | grep "error TS" | grep -v "Can.test.tsx" || echo "OK no errors"
npx vitest run src/lib/stores/__tests__/uiStore.test.ts 2>&1 | tail -8
```
Expected: `OK no errors`; uiStore tests pass.

- [ ] **Step 11: Commit**

```bash
cd /home/appuser/workspace/projects/repairOS
git add "frontend/src/app/(app)/jobs/page.tsx"
git commit -m "feat(jobs): list density toggle and column show/hide

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Verification

- [ ] **Step 1: Frontend Vitest + typecheck**

```bash
cd /home/appuser/workspace/projects/repairOS/frontend
npx vitest run 2>&1 | tail -15
npx tsc --noEmit 2>&1 | grep "error TS" | grep -v "Can.test.tsx" || echo "OK no errors"
```
Expected: all Phase 2 tests pass (JobCard 3, jobFilters extended, uiStore 3); `tsc` clean. A pre-existing unrelated `src/lib/api/__tests__/crm.test.ts` failure may remain — note it, don't fix it here.

- [ ] **Step 2: Manual smoke test**

1. `/jobs` kanban: a job with a balance shows "Due ₹X" (warning); a fully-paid job shows "Paid" (success); a zero-charge job shows neither.
2. Apply a filter that matches nothing → list shows "No matching jobs / …clearing them"; an empty kanban stage shows "No matches". Clear filters → "No jobs yet" copy returns on a truly empty shop.
3. List view: toggle density (comfortable/compact) → row height changes; hide "Charge" + "Balance" via Columns → they disappear; reload the page → density and hidden columns persist.

- [ ] **Step 3: Push the branch**

```bash
cd /home/appuser/workspace/projects/repairOS
git push -u origin <branch>
```

---

## Self-Review Notes

- **Spec coverage (Part 2):** 2e → Task 1; 2f → Task 2 (skeletons already existed; this adds filter-aware copy for list + kanban); 2g → Task 3 (uiStore prefs + DataTable density + page controls).
- **Type consistency:** `hasActiveFilters`/`jobsEmptyCopy` (Task 2) build on `activeFilterCount` from Part 1; `JobsEmptyCopy.kanbanLabel` flows page → `JobBoard.emptyLabel` → `KanbanBoard.emptyLabel`; `density: 'comfortable' | 'compact'` is identical in `uiStore`, `DataTable`, and the page; `toggleJobsColumn`/`jobsHiddenColumns` keys match `TOGGLEABLE_COLUMNS` and `LIST_COLUMNS` keys.
- **Money correctness:** balance uses `sumMoney` (string-safe), avoiding the DRF-decimal-as-string trap; the test feeds string money values to mirror runtime.
- **Prerequisite:** pre-existing uncommitted `JobCard`/`LeadCard` edits must be committed (or discarded with user consent) before Task 1 so the feature commit stays isolated.
