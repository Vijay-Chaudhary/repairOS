# Jobs Search Fix + Advanced Filters Implementation Plan

> ⚠️ **SUPERSEDED (2026-06-19).** This is an early draft. Its frontend approach
> (list-only filter row, no chips) was replaced by the unified panel in
> `2026-06-18-repair-overhaul-phase-2a-jobs-search-and-filters.md`, which is the
> plan that was actually implemented (filters apply to both kanban and list,
> with a popover panel + removable chips + quick presets, plus `overdue`/`due_on`
> backend params). Kept for history only — do not implement from this file.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Fix the broken Jobs search (backend ignores `search` param) and add four new list-view-only filters: Status, Device Type, Payment Status, and Date Range.

**Architecture:** Backend gets three new filter blocks in `JobTicketViewSet.get_queryset()`. Frontend splits into `baseFilters` (kanban + list) and `listFilters` (list only), with an expandable filter row toggled by a "Filters" button in the top bar.

**Tech Stack:** Django/DRF (backend), Next.js 14 App Router + TypeScript + Tailwind + React Query (frontend), pytest-django (tests)

---

## File Map

| File | Change |
|---|---|
| `backend/apps/repair/views.py` | Add `search`, `device_type`, `payment_status` filter blocks to `get_queryset()` |
| `backend/apps/repair/tests/test_jobs.py` | Add `TestJobListFilters` class with 6 new test cases |
| `frontend/src/lib/api/repair.ts` | Add `device_type` and `payment_status` to `JobFilters` interface |
| `frontend/src/app/(app)/jobs/page.tsx` | New state, `listFilters` memo, Filters button, expandable filter row |

---

## Task 1: Fix Backend Search

**Files:**
- Modify: `backend/apps/repair/views.py` (inside `get_queryset()`, after line 125)
- Test: `backend/apps/repair/tests/test_jobs.py`

- [x] **Step 1: Write failing tests**

Add this class at the bottom of `backend/apps/repair/tests/test_jobs.py`:

```python
# ──────────────────────────────────────────────────────────────────────────────
# List filters
# ──────────────────────────────────────────────────────────────────────────────

@pytest.mark.django_db
class TestJobListFilters:
    """GET /repair/jobs/ filter params."""

    def _make_job(self, shop, customer, admin_user, **kwargs):
        from repair.services import create_job
        defaults = {"device_type": "Smartphone", "problem_description": "Test.", "priority": "normal"}
        defaults.update(kwargs)
        return create_job(shop, customer, defaults, admin_user)

    def test_search_by_customer_name(self, admin_client, shop, customer, admin_user):
        self._make_job(shop, customer, admin_user)
        res = admin_client.get("/api/repair/jobs/", {"search": customer.name[:4]})
        assert res.status_code == 200
        assert res.data["count"] >= 1
        for item in res.data["results"]:
            assert customer.name[:4].lower() in item["customer_name"].lower()

    def test_search_by_job_number(self, admin_client, shop, customer, admin_user):
        job = self._make_job(shop, customer, admin_user)
        res = admin_client.get("/api/repair/jobs/", {"search": job.job_number})
        assert res.status_code == 200
        assert res.data["count"] == 1
        assert res.data["results"][0]["job_number"] == job.job_number

    def test_search_no_match_returns_empty(self, admin_client, shop, customer, admin_user):
        self._make_job(shop, customer, admin_user)
        res = admin_client.get("/api/repair/jobs/", {"search": "ZZZNOMATCH999"})
        assert res.status_code == 200
        assert res.data["count"] == 0

    def test_filter_device_type(self, admin_client, shop, customer, admin_user):
        self._make_job(shop, customer, admin_user, device_type="Laptop")
        self._make_job(shop, customer, admin_user, device_type="Smartphone")
        res = admin_client.get("/api/repair/jobs/", {"device_type": "Laptop"})
        assert res.status_code == 200
        for item in res.data["results"]:
            assert item["device_type"].lower() == "laptop"

    def test_filter_payment_status_unpaid(self, admin_client, shop, customer, admin_user):
        from repair.models import JobTicket
        job = self._make_job(shop, customer, admin_user)
        JobTicket.objects.filter(pk=job.pk).update(service_charge=500, advance_paid=0)
        res = admin_client.get("/api/repair/jobs/", {"payment_status": "unpaid"})
        assert res.status_code == 200
        assert any(r["job_number"] == job.job_number for r in res.data["results"])

    def test_filter_payment_status_paid(self, admin_client, shop, customer, admin_user):
        from repair.models import JobTicket
        job = self._make_job(shop, customer, admin_user)
        JobTicket.objects.filter(pk=job.pk).update(service_charge=500, advance_paid=500)
        res = admin_client.get("/api/repair/jobs/", {"payment_status": "paid"})
        assert res.status_code == 200
        assert any(r["job_number"] == job.job_number for r in res.data["results"])

    def test_filter_payment_status_partial(self, admin_client, shop, customer, admin_user):
        from repair.models import JobTicket
        job = self._make_job(shop, customer, admin_user)
        JobTicket.objects.filter(pk=job.pk).update(service_charge=500, advance_paid=200)
        res = admin_client.get("/api/repair/jobs/", {"payment_status": "partial"})
        assert res.status_code == 200
        assert any(r["job_number"] == job.job_number for r in res.data["results"])
```

- [x] **Step 2: Run tests to confirm they fail**

```bash
cd /home/appuser/workspace/projects/repairOS/backend
python -m pytest apps/repair/tests/test_jobs.py::TestJobListFilters -v 2>&1 | tail -20
```

Expected: All 7 tests FAIL (filters not yet implemented).

- [x] **Step 3: Implement search, device_type, and payment_status in `get_queryset()`**

In `backend/apps/repair/views.py`, replace the `# Query filters` block (lines 110–127) with:

```python
        # Query filters
        qp = self.request.query_params
        if s := qp.get("status"):
            qs = qs.filter(status=s)
        if shop_id := qp.get("shop_id"):
            qs = qs.filter(shop_id=shop_id)
        if tech_id := qp.get("technician_id"):
            qs = qs.filter(stages__assigned_technician_id=tech_id).distinct()
        if cust_id := qp.get("customer_id"):
            qs = qs.filter(customer_id=cust_id)
        if priority := qp.get("priority"):
            qs = qs.filter(priority=priority)
        if date_from := qp.get("date_from"):
            qs = qs.filter(intake_date__date__gte=date_from)
        if date_to := qp.get("date_to"):
            qs = qs.filter(intake_date__date__lte=date_to)

        # Search across key fields
        if search := qp.get("search", "").strip():
            qs = qs.filter(
                Q(job_number__icontains=search)
                | Q(customer__name__icontains=search)
                | Q(customer__phone__icontains=search)
                | Q(imei__icontains=search)
                | Q(serial_number__icontains=search)
                | Q(problem_description__icontains=search)
            ).distinct()

        # Device type
        if device_type := qp.get("device_type", "").strip():
            qs = qs.filter(device_type__iexact=device_type)

        # Payment status
        if payment_status := qp.get("payment_status", "").strip():
            if payment_status in ("paid", "partial", "unpaid"):
                from django.db.models import DecimalField, ExpressionWrapper, F
                qs = qs.annotate(
                    _balance=ExpressionWrapper(
                        F("service_charge") - F("advance_paid"),
                        output_field=DecimalField(),
                    )
                )
                if payment_status == "paid":
                    qs = qs.filter(_balance__lte=0)
                elif payment_status == "unpaid":
                    qs = qs.filter(advance_paid=0, service_charge__gt=0)
                elif payment_status == "partial":
                    qs = qs.filter(advance_paid__gt=0, _balance__gt=0)

        return qs
```

Note: `Q` is already imported at the top of `views.py` from the existing technician visibility filter.

- [x] **Step 4: Run tests — all should pass**

```bash
cd /home/appuser/workspace/projects/repairOS/backend
python -m pytest apps/repair/tests/test_jobs.py::TestJobListFilters -v 2>&1 | tail -15
```

Expected: 7 tests PASS.

- [x] **Step 5: Run full repair test suite to check for regressions**

```bash
cd /home/appuser/workspace/projects/repairOS/backend
python -m pytest apps/repair/tests/ -v 2>&1 | tail -20
```

Expected: All existing tests still PASS.

- [x] **Step 6: Commit**

```bash
cd /home/appuser/workspace/projects/repairOS
git add backend/apps/repair/views.py backend/apps/repair/tests/test_jobs.py
git commit -m "fix(repair): add search, device_type, payment_status filters to job list API

- search queries job_number, customer name/phone, imei, serial_number, problem_description
- device_type does case-insensitive match
- payment_status annotates balance and filters paid/partial/unpaid

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 2: Update Frontend API Types

**Files:**
- Modify: `frontend/src/lib/api/repair.ts`

- [x] **Step 1: Add `device_type` and `payment_status` to `JobFilters`**

In `frontend/src/lib/api/repair.ts`, find the `JobFilters` interface and add the two new fields:

```typescript
export interface JobFilters {
  shop_id?: string;
  status?: JobStatus;
  technician_id?: string;
  customer_id?: string;
  priority?: JobPriority;
  date_from?: string;
  date_to?: string;
  search?: string;
  cursor?: string;
  device_type?: string;
  payment_status?: 'paid' | 'partial' | 'unpaid';
}
```

- [x] **Step 2: Verify TypeScript compiles**

```bash
cd /home/appuser/workspace/projects/repairOS/frontend
npx tsc --noEmit 2>&1 | grep "error TS" | grep -v "Can.test.tsx"
```

Expected: No output (zero errors).

- [x] **Step 3: Commit**

```bash
cd /home/appuser/workspace/projects/repairOS
git add frontend/src/lib/api/repair.ts
git commit -m "feat(repair): add device_type and payment_status to JobFilters type

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 3: Frontend — Filter State, listFilters, and Cursor Reset

**Files:**
- Modify: `frontend/src/app/(app)/jobs/page.tsx`

- [x] **Step 1: Add new imports and state variables**

At the top of `jobs/page.tsx`, add `SlidersHorizontal` to the lucide-react import:

```typescript
import { Plus, Search, LayoutGrid, List, WifiOff, Filter, Phone, AlertTriangle, Star, CalendarClock, SlidersHorizontal } from 'lucide-react';
```

Inside `JobsPage()`, after the existing state declarations, add:

```typescript
const [filterOpen, setFilterOpen]       = useState(false);
const [statusFilter, setStatusFilter]   = useState<JobStatus | 'all'>('all');
const [deviceType, setDeviceType]       = useState<string>('all');
const [paymentStatus, setPaymentStatus] = useState<'all' | 'paid' | 'partial' | 'unpaid'>('all');
const [dateFrom, setDateFrom]           = useState('');
const [dateTo, setDateTo]               = useState('');
```

- [x] **Step 2: Add `listFilters` memo and `activeListFilterCount`**

After the existing `baseFilters` useMemo, add:

```typescript
const listFilters = useMemo(() => ({
  ...baseFilters,
  status:         statusFilter   === 'all' ? undefined : statusFilter,
  device_type:    deviceType     === 'all' ? undefined : deviceType,
  payment_status: paymentStatus  === 'all' ? undefined : paymentStatus as 'paid' | 'partial' | 'unpaid' | undefined,
  date_from:      dateFrom || undefined,
  date_to:        dateTo   || undefined,
}), [baseFilters, statusFilter, deviceType, paymentStatus, dateFrom, dateTo]);

const activeListFilterCount = [
  statusFilter  !== 'all',
  deviceType    !== 'all',
  paymentStatus !== 'all',
  !!dateFrom,
  !!dateTo,
].filter(Boolean).length;
```

- [x] **Step 3: Replace cursor reset effect**

Find the existing `React.useEffect` that calls `setListCursor(undefined)` and replace it with one that covers all filters:

```typescript
React.useEffect(() => {
  setListCursor(undefined);
}, [debouncedSearch, priority, technicianId, statusFilter, deviceType, paymentStatus, dateFrom, dateTo]);
```

- [x] **Step 4: Switch list query to use `listFilters`**

Find the `listQuery` `useQuery` call and change both `queryKey` and `queryFn` from `baseFilters` to `listFilters`:

```typescript
const listQuery = useQuery({
  queryKey: qk.jobs({ ...listFilters, cursor: listCursor }),
  queryFn: () => repairApi.listJobs({ ...listFilters, cursor: listCursor }),
  staleTime: 30_000,
  enabled: view === 'list',
});
```

- [x] **Step 5: Verify TypeScript compiles**

```bash
cd /home/appuser/workspace/projects/repairOS/frontend
npx tsc --noEmit 2>&1 | grep "error TS" | grep -v "Can.test.tsx"
```

Expected: No output.

- [x] **Step 6: Commit**

```bash
cd /home/appuser/workspace/projects/repairOS
git add frontend/src/app/(app)/jobs/page.tsx
git commit -m "feat(jobs): add listFilters tier and extended cursor reset

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 4: Frontend — Filters Button and Expandable Filter Row

**Files:**
- Modify: `frontend/src/app/(app)/jobs/page.tsx`

- [x] **Step 1: Add the "Filters" button to the top bar**

In the top bar JSX, find the section that renders the technician filter select and the view toggle group. Insert the Filters button between the technician select and the view toggle `<div>`:

```tsx
{/* Filters toggle — list view only */}
{view === 'list' && (
  <button
    onClick={() => setFilterOpen((v) => !v)}
    className={cn(
      'h-9 px-3 flex items-center gap-1.5 text-body-sm rounded-md border transition-colors',
      filterOpen || activeListFilterCount > 0
        ? 'border-[var(--accent)] text-[var(--accent)] bg-[var(--accent)]/5'
        : 'border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-2)]',
    )}
  >
    <SlidersHorizontal className="h-3.5 w-3.5" />
    <span className="hidden sm:inline">Filters</span>
    {activeListFilterCount > 0 && (
      <span className="h-4 w-4 rounded-full bg-[var(--accent)] text-white text-[10px] flex items-center justify-center leading-none">
        {activeListFilterCount}
      </span>
    )}
  </button>
)}
```

- [x] **Step 2: Add the expandable filter row**

In the JSX, between the top bar `<div>` and the board/list content `<div>`, add:

```tsx
{/* Expandable filter row — list view only */}
{view === 'list' && (
  <div className={cn(
    'overflow-hidden transition-all duration-200 ease-in-out',
    filterOpen ? 'max-h-[60px]' : 'max-h-0',
  )}>
    <div className="flex items-center gap-2 px-4 py-2 border-b border-[var(--border)] bg-[var(--surface-2)] flex-wrap">
      {/* Status */}
      <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as JobStatus | 'all')}>
        <SelectTrigger className="h-8 w-[150px] text-xs">
          <SelectValue placeholder="All statuses" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All statuses</SelectItem>
          <SelectItem value="open">Open</SelectItem>
          <SelectItem value="in_progress">In Progress</SelectItem>
          <SelectItem value="on_hold">On Hold</SelectItem>
          <SelectItem value="ready_for_qc">Ready for QC</SelectItem>
          <SelectItem value="ready_for_pickup">Ready for Pickup</SelectItem>
          <SelectItem value="delivered">Delivered</SelectItem>
          <SelectItem value="cancelled">Cancelled</SelectItem>
          <SelectItem value="closed">Closed</SelectItem>
        </SelectContent>
      </Select>

      {/* Device type */}
      <Select value={deviceType} onValueChange={setDeviceType}>
        <SelectTrigger className="h-8 w-[140px] text-xs">
          <SelectValue placeholder="All devices" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All devices</SelectItem>
          <SelectItem value="Smartphone">Smartphone</SelectItem>
          <SelectItem value="Feature Phone">Feature Phone</SelectItem>
          <SelectItem value="Tablet">Tablet</SelectItem>
          <SelectItem value="Laptop">Laptop</SelectItem>
          <SelectItem value="Desktop">Desktop</SelectItem>
          <SelectItem value="Smartwatch">Smartwatch</SelectItem>
          <SelectItem value="Earbuds">Earbuds</SelectItem>
          <SelectItem value="Other">Other</SelectItem>
        </SelectContent>
      </Select>

      {/* Payment status */}
      <Select value={paymentStatus} onValueChange={(v) => setPaymentStatus(v as 'all' | 'paid' | 'partial' | 'unpaid')}>
        <SelectTrigger className="h-8 w-[130px] text-xs">
          <SelectValue placeholder="Payment" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All payments</SelectItem>
          <SelectItem value="paid">Paid</SelectItem>
          <SelectItem value="partial">Partial</SelectItem>
          <SelectItem value="unpaid">Unpaid</SelectItem>
        </SelectContent>
      </Select>

      {/* Date from */}
      <input
        type="date"
        value={dateFrom}
        onChange={(e) => setDateFrom(e.target.value)}
        className="h-8 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-xs text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
        placeholder="From"
      />
      <span className="text-xs text-[var(--text-muted)]">—</span>
      {/* Date to */}
      <input
        type="date"
        value={dateTo}
        onChange={(e) => setDateTo(e.target.value)}
        className="h-8 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-xs text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]"
        placeholder="To"
      />

      {/* Clear all */}
      {activeListFilterCount > 0 && (
        <button
          onClick={() => {
            setStatusFilter('all');
            setDeviceType('all');
            setPaymentStatus('all');
            setDateFrom('');
            setDateTo('');
          }}
          className="h-8 px-2 text-xs text-[var(--danger)] hover:bg-[var(--danger)]/10 rounded-md transition-colors ml-auto"
        >
          Clear all
        </button>
      )}
    </div>
  </div>
)}
```

- [x] **Step 3: TypeScript check**

```bash
cd /home/appuser/workspace/projects/repairOS/frontend
npx tsc --noEmit 2>&1 | grep "error TS" | grep -v "Can.test.tsx"
```

Expected: No output.

- [x] **Step 4: Commit**

```bash
cd /home/appuser/workspace/projects/repairOS
git add frontend/src/app/(app)/jobs/page.tsx
git commit -m "feat(jobs): add expandable filter row with status, device type, payment, date range

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```

---

## Task 5: Push and Manual Verification

> **Implementation note (2026-06-19):** Tasks 1–4 implemented on branch
> `feat/repair-overhaul-phase-3`. The plan assumed cursor pagination
> (`listCursor`/`cursor`); the actual jobs page is page-number paginated
> (`listPage`/`page`), so the frontend tasks were adapted accordingly. Test
> URLs were also corrected to the `/api/v1/repair/jobs/` prefix and the
> `{items, meta:{count}}` response shape.

- [ ] **Step 1: Push to remote**

```bash
cd /home/appuser/workspace/projects/repairOS
# Feature branch — open a PR rather than pushing to master directly.
git push -u origin feat/repair-overhaul-phase-3
```

- [ ] **Step 2: Verify search works in kanban view**

1. Open `/jobs` (kanban view)
2. Type a customer name in the search box
3. Column counts update and matching jobs appear; non-matching jobs disappear from all columns

- [ ] **Step 3: Verify filters work in list view**

1. Switch to list view
2. Click "Filters" button — filter row expands with animation
3. Set Status = "On Hold" → only on-hold jobs shown
4. Set Device type = "Laptop" → only laptop jobs shown
5. Set Payment = "Unpaid" → only unpaid jobs shown
6. Set a date range → results narrow to that intake date range
7. Badge on "Filters" button shows count of active filters
8. Click "Clear all" → all filters reset, full list returns

- [ ] **Step 4: Verify kanban is unaffected by list filters**

1. Set Status filter to "On Hold" in list view
2. Switch to kanban view
3. All kanban columns still show (list-only filters not applied to kanban queries)

- [ ] **Step 5: Verify search + list filters compose correctly**

1. In list view, type "Samsung" in search AND set Device type = "Laptop"
2. Results show only Laptop jobs that also match "Samsung" somewhere
