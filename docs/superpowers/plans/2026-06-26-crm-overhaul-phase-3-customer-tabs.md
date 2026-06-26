# CRM Overhaul — Phase 3: Customer profile Sales + AMC tabs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:test-driven-development. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add **Sales** and **AMC** tabs to `/customers/[id]`, each a lazy-loaded `DataTable` with its own skeleton / empty / error state, and reorder the tab strip to the spec order **Repair · Sales · AMC · Timeline · Tasks · Financial**.

**Architecture:** Frontend-only. The page (`frontend/src/app/(app)/customers/[id]/page.tsx`) already follows a per-tab `useQuery(... enabled: !!customer)` pattern for Repair / Timeline / Tasks. Add two more queries — `posApi.listSales({ customer_id })` and `amcApi.listContracts({ customer_id })` — but make them **lazy** (enabled only once their tab is opened) via a controlled `Tabs value`, then render each as a `DataTable` mirroring the existing Repair-history `JOB_COLUMNS` block. Row click deep-links to `/sales/[id]` and `/amc/[id]` respectively.

**Tech Stack:** Next.js 14 + TypeScript + React Query + Radix Tabs (Vitest + Testing Library).

**Source spec:** `docs/superpowers/specs/2026-06-24-crm-overhaul-design.md` (Phase 3).

---

## Key facts (verified against the codebase)

- `SaleFilters` (`src/lib/api/pos.ts`) **already** has `customer_id?: string`; the amc `listContracts` filter object **already** has `customer_id?: string`. **No filter-type change is needed** (spec said "if they lack `customer_id`" — they don't).
- `posApi.listSales(filters)` → `{ items: Sale[]; meta: PageMeta }`. `amcApi.listContracts(filters)` → `{ items: AmcContract[]; meta: PageMeta }`.
- Detail routes exist: `/sales/[id]` and `/amc/[id]` — use them for row clicks.
- Query-key factories exist: `qk.posSales(...)` and `qk.amcContracts(...)` (both `listKey`-style, accept a filter object).
- Existing tabs are eager (`enabled: !!customer`). The default tab is `repairs`, so its data loads immediately; **Sales/AMC should be lazy** (don't fetch POS + AMC on every profile open) — gate on a controlled active-tab value.
- `Sale` fields for columns: `sale_number`, `sale_type` (`counter|job_linked|wholesale`), `status`, `grand_total`, `amount_outstanding`, `sale_date`.
- `AmcContract` fields for columns: `contract_number`, `title`, `status` (`active|expired|cancelled|pending_renewal`), `value`, `end_date`, `next_visit_date`.
- Reusable bits already imported in the page: `DataTable`/`Column`, `StatusBadge`, `Money`, `formatDate`, `RetryBanner` (local). Will add `posApi`, `amcApi`, and their item types to imports.
- No existing test for this page — Task 2 creates one.

## File structure

| File | Responsibility | Change |
|---|---|---|
| `frontend/src/app/(app)/customers/[id]/page.tsx` | add Sales + AMC tabs, reorder strip, controlled lazy tabs | Modify |
| `frontend/src/app/(app)/customers/[id]/__tests__/page.test.tsx` | tab render + lazy-fetch assertions | Create |

---

## Task 1: Sales + AMC tabs + reorder (TDD)

**Files:**
- Modify: `frontend/src/app/(app)/customers/[id]/page.tsx`
- Create: `frontend/src/app/(app)/customers/[id]/__tests__/page.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/app/(app)/customers/[id]/__tests__/page.test.tsx`. Mock:
- `next/navigation` → `useParams` returns `{ id: 'cust-1' }`, `useRouter` returns `{ push: vi.fn(), back: vi.fn() }`.
- `@/lib/api/crm` (partial) → `crmApi.getCustomer` resolves a minimal customer (`id`, `shop_id`, `name`, `phone`, `total_jobs`, `total_billed`, `total_outstanding`, `credit_limit`); `getCustomerTimeline`/`listTasks` resolve `{ items: [], meta: {} }`.
- `@/lib/api/repair` (partial) → `repairApi.listJobs` resolves `{ items: [], meta: {} }`.
- `@/lib/api/pos` (partial) → capture `posApi.listSales` (`const listSales = vi.fn()`).
- `@/lib/api/amc` (partial) → capture `amcApi.listContracts` (`const listContracts = vi.fn()`).
- `@/lib/stores/authStore` → `hasPermission: () => true`.

Add the Radix pointer polyfills in `beforeAll` (same as the leads page test: `scrollIntoView`, `hasPointerCapture`, `releasePointerCapture` = `vi.fn()`).

Assertions:
```typescript
it('renders the spec tab order', async () => {
  renderPage();
  const tabs = await screen.findAllByRole('tab');
  expect(tabs.map(t => t.textContent)).toEqual(
    ['Repair History', 'Sales', 'AMC', 'Timeline', 'Tasks', 'Financial']
  );
});

it('lazily loads Sales by customer_id only when the Sales tab is opened', async () => {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  renderPage();
  await screen.findByRole('tab', { name: 'Sales' });
  expect(listSales).not.toHaveBeenCalled();            // lazy: not fetched on mount
  await user.click(screen.getByRole('tab', { name: 'Sales' }));
  await waitFor(() =>
    expect(listSales).toHaveBeenCalledWith(expect.objectContaining({ customer_id: 'cust-1' })),
  );
});

it('lazily loads AMC contracts when the AMC tab is opened', async () => {
  const user = userEvent.setup({ pointerEventsCheck: 0 });
  renderPage();
  await user.click(await screen.findByRole('tab', { name: 'AMC' }));
  await waitFor(() =>
    expect(listContracts).toHaveBeenCalledWith(expect.objectContaining({ customer_id: 'cust-1' })),
  );
});
```

Run: `cd frontend && npx vitest run "src/app/(app)/customers/[id]/__tests__/page.test.tsx" 2>&1 | tail -10` → FAIL (tabs/queries don't exist yet).

- [ ] **Step 2: Make the tab strip controlled + add the two tab values**

In `page.tsx`:
1. Add `const [activeTab, setActiveTab] = useState('repairs');`.
2. Change `<Tabs defaultValue="repairs" …>` to `<Tabs value={activeTab} onValueChange={setActiveTab} …>`.
3. In the `TabsList` map array, change `['repairs', 'timeline', 'tasks', 'financial']` to `['repairs', 'sales', 'amc', 'timeline', 'tasks', 'financial']`.
4. In the trigger label expression, render `'sales' → 'Sales'`, `'amc' → 'AMC'` (the `repairs → 'Repair History'` special-case stays; `amc` must be uppercased explicitly, not title-cased).

- [ ] **Step 3: Add the two lazy queries**

Add imports: `import { posApi, type Sale } from '@/lib/api/pos';` and `import { amcApi, type AmcContract } from '@/lib/api/amc';`.

After the tasks query, add:
```typescript
  const {
    data: salesData, isLoading: salesLoading, error: salesError, refetch: refetchSales,
  } = useQuery({
    queryKey: qk.posSales({ customer_id: id }),
    queryFn: () => posApi.listSales({ customer_id: id }),
    staleTime: 60_000,
    enabled: !!customer && activeTab === 'sales',
  });

  const {
    data: contractsData, isLoading: contractsLoading, error: contractsError, refetch: refetchContracts,
  } = useQuery({
    queryKey: qk.amcContracts({ customer_id: id }),
    queryFn: () => amcApi.listContracts({ customer_id: id }),
    staleTime: 60_000,
    enabled: !!customer && activeTab === 'amc',
  });
```

- [ ] **Step 4: Define column sets + render the two `TabsContent` blocks**

Add module-level column definitions next to `JOB_COLUMNS`:
```typescript
const SALE_COLUMNS: Column<Sale>[] = [
  { key: 'sale_number', header: 'Sale #', cell: (r) => <span className="font-mono text-xs">{r.sale_number}</span> },
  { key: 'type', header: 'Type', cell: (r) => <span className="text-body-sm capitalize">{r.sale_type.replace('_', ' ')}</span> },
  { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
  { key: 'total', header: 'Total', cell: (r) => <Money amount={r.grand_total} className="text-body-sm" /> },
  { key: 'date', header: 'Date', cell: (r) => <span className="text-body-sm text-[var(--text-muted)]">{formatDate(r.sale_date)}</span> },
];

const CONTRACT_COLUMNS: Column<AmcContract>[] = [
  { key: 'contract_number', header: 'Contract #', cell: (r) => <span className="font-mono text-xs">{r.contract_number}</span> },
  { key: 'title', header: 'Title', cell: (r) => <span className="text-body-sm">{r.title}</span> },
  { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
  { key: 'value', header: 'Value', cell: (r) => <Money amount={r.value} className="text-body-sm" /> },
  { key: 'end', header: 'Ends', cell: (r) => <span className="text-body-sm text-[var(--text-muted)]">{formatDate(r.end_date)}</span> },
];
```

Insert two `TabsContent` blocks **between** the `repairs` block and the `timeline` block (to match the strip order), each mirroring the Repair-history block (DataTable + RetryBanner on error):
```tsx
<TabsContent value="sales" className="p-4 md:p-6 mt-0">
  <DataTable
    columns={SALE_COLUMNS}
    data={salesData?.items}
    loading={salesLoading}
    error={salesError instanceof Error ? salesError : null}
    keyExtractor={(r) => r.id}
    onRowClick={(r) => router.push(`/sales/${r.id}`)}
    emptyTitle="No sales"
    emptyDescription="No POS sales for this customer yet."
  />
  {salesError && <RetryBanner onRetry={() => refetchSales()} />}
</TabsContent>

<TabsContent value="amc" className="p-4 md:p-6 mt-0">
  <DataTable
    columns={CONTRACT_COLUMNS}
    data={contractsData?.items}
    loading={contractsLoading}
    error={contractsError instanceof Error ? contractsError : null}
    keyExtractor={(r) => r.id}
    onRowClick={(r) => router.push(`/amc/${r.id}`)}
    emptyTitle="No AMC contracts"
    emptyDescription="No annual maintenance contracts for this customer yet."
  />
  {contractsError && <RetryBanner onRetry={() => refetchContracts()} />}
</TabsContent>
```

- [ ] **Step 5: Run the test — confirm green; type-check**

Run: `cd frontend && npx vitest run "src/app/(app)/customers/[id]/__tests__/page.test.tsx" 2>&1 | tail -8` → PASS.
Run: `cd frontend && npx tsc --noEmit 2>&1 | grep "error TS" | grep -v "Can.test.tsx" || echo "OK"` → `OK`.

- [ ] **Step 6: Commit**

```bash
git add "frontend/src/app/(app)/customers/[id]/page.tsx" "frontend/src/app/(app)/customers/[id]/__tests__/page.test.tsx"
git commit -m "feat(crm): add Sales + AMC tabs to customer profile"
```

---

## Final verification

- [ ] **Frontend — new test + neighbours green, tsc clean**

Run: `cd frontend && npx vitest run "src/app/(app)/customers/[id]/__tests__/page.test.tsx" src/lib/api/__tests__/crm.test.ts 2>&1 | tail -8` → all pass.
Run: `cd frontend && npx tsc --noEmit 2>&1 | grep "error TS" | grep -v "Can.test.tsx" || echo "OK"` → `OK`.

- [ ] **Manual smoke — live UI** (demo tenant) — *recommended; needs the Docker stack*

1. Open a customer with POS sales → **Sales** tab lists them; row → `/sales/[id]`.
2. Open a customer with an AMC contract → **AMC** tab lists it; row → `/amc/[id]`.
3. A customer with neither shows the per-tab empty states; tab order reads Repair · Sales · AMC · Timeline · Tasks · Financial.

---

## Notes / risks

- **No backend change, no migration** — both list endpoints already honor `customer_id`.
- **Lazy gating** is the one behavioural deviation from the (eager) Repair tab: Sales/AMC fetch only on first open, by design (avoid POS+AMC fetches on every profile view). React Query caches once opened.
- **`StatusBadge`** is safe for both tabs — verified: its `STATUS_MAP` already covers all AMC statuses (`active`/`expired`/`cancelled`/`pending_renewal`) and most POS ones, and unknown values (e.g. `completed`) hit the graceful fallback at `StatusBadge.tsx:58` (raw label, muted style). No column-cell workaround needed.
