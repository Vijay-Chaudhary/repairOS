# Repair Overhaul — Phase 2 (Part 1): Jobs Search & Unified Filters — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix Jobs search and add a single unified filter system (panel + removable active-filter chips + quick presets) that applies consistently to both the kanban and list views.

**Architecture:** The backend `JobTicketViewSet.get_queryset()` already serves both the kanban (one query per status column) and the list, so adding filters there covers both views at once. The frontend centralizes filter state in one `JobFilterState` object with pure helper functions (testable without rendering), a presentational `JobFilterBar` (Filters button → popover panel → active chips), and a `JobQuickFilters` preset row. `jobs/page.tsx` owns the state and feeds it to both views.

**Tech Stack:** Django 4.2 / DRF, pytest-django (backend); Next.js 14 App Router, TypeScript strict, Tailwind, React Query, Zustand, Vitest + RTL (frontend).

**Spec:** `docs/superpowers/specs/2026-06-17-repair-module-overhaul-design.md` (Phase 2, items 2a–2d).

---

## Scope & decisions

- **Part 1 of 2.** This plan covers 2a (backend search + filters), 2b (frontend types), 2c (unified filter panel + chips), 2d (quick presets), and the page wiring. **Part 2** (2e kanban card payment signal, 2f empty/loading states, 2g list density/columns) ships in a separate plan.
- **Filters apply to all views.** Because `get_queryset()` is shared, the new filters affect kanban columns and the list identically. The always-visible Priority and Technician selects in the current top bar are **removed** and folded into the unified panel (spec choice A).
- **Reconciliation with the earlier draft** (`docs/superpowers/plans/2026-06-14-jobs-search-and-filters.md`): that draft's backend block (search, device_type, payment_status) is adopted in Task 1. Its frontend approach (list-only filter row, no chips) is **superseded** by the unified panel here. The draft also added `device_type`/`payment_status` to `JobFilters` — Task 2 adds those plus `overdue`/`due_on`.
- **`device_type` is free text** (intake uses a free-text field, not an enum), so the panel's Device control is a text input matching the backend's `device_type__iexact`, not a fixed dropdown.
- **Presets need backend support:** existing `date_from`/`date_to` filter `intake_date`. "Overdue" and "Due today" filter `expected_delivery_date`, so Task 1 adds `overdue=true` and `due_on=YYYY-MM-DD` params. "Unpaid" maps to `payment_status=unpaid`; "My jobs" maps to `technician_id=<current user>`.
- **Money fields are strings over the wire** (DRF `DecimalField`, `COERCE_DECIMAL_TO_STRING=True`) — relevant only to Part 2's card; not used in Part 1 logic.

## Cross-cutting UX acceptance criteria (apply throughout)

- Active filters are always visible as removable chips; one "Clear all" resets them (search is its own box and is left intact by Clear all).
- The "Filters" button shows a count badge equal to the number of active (non-search) filters.
- Controls meet 44px touch targets; popover and chips are keyboard-operable; icon-only buttons have `aria-label`.
- Changing any filter resets list pagination to page 1.
- No `any`, no `console.log`.

---

## File Map

| File | Change |
|---|---|
| `backend/apps/repair/views.py` | Add `search`, `device_type`, `payment_status`, `overdue`, `due_on` to `get_queryset()` |
| `backend/apps/repair/tests/test_jobs.py` | Append `TestJobListFilters` (search/device/payment/overdue/due_on) |
| `frontend/src/lib/api/repair.ts` | Add `device_type`, `payment_status`, `overdue`, `due_on` to `JobFilters` |
| `frontend/src/lib/repair/jobFilters.ts` | New: `JobFilterState`, defaults, `toBaseApiFilters`, chips, count, presets |
| `frontend/src/lib/repair/__tests__/jobFilters.test.ts` | New: unit tests for the helpers |
| `frontend/src/components/repair/JobFilterBar.tsx` | New: Filters button + popover panel + active chips |
| `frontend/src/components/repair/__tests__/JobFilterBar.test.tsx` | New: component tests |
| `frontend/src/components/repair/JobQuickFilters.tsx` | New: preset toggle row |
| `frontend/src/components/repair/__tests__/JobQuickFilters.test.tsx` | New: component tests |
| `frontend/src/app/(app)/jobs/page.tsx` | Consolidate filter state; apply to both views; mount new components; remove old selects |

---

## Task 1: Backend — search, device_type, payment_status, overdue, due_on filters

**Files:**
- Modify: `backend/apps/repair/views.py` (inside `get_queryset()`, after the existing `date_to` filter, before `return qs`)
- Test: `backend/apps/repair/tests/test_jobs.py` (append class)

Context: `get_queryset()` already handles `status`, `shop_id`, `technician_id`, `customer_id`, `priority`, `date_from`, `date_to`. `Q` is already imported at the top of `views.py`. The fixtures `admin_client`, `shop`, `customer`, `admin_user` exist at the top of `test_jobs.py`. The job model statuses include `open`, `delivered`, `closed`, `cancelled`; terminal = delivered/closed/cancelled.

- [x] **Step 1: Write the failing tests**

Append to the bottom of `backend/apps/repair/tests/test_jobs.py`:

```python
# ──────────────────────────────────────────────────────────────────────────────
# List / kanban query filters (Phase 2)
# ──────────────────────────────────────────────────────────────────────────────

@pytest.mark.django_db
class TestJobListFilters:
    """GET /api/v1/repair/jobs/ filter params (apply to list + kanban)."""

    def _make_job(self, shop, customer, admin_user, **kwargs):
        from repair.services import create_job
        defaults = {"device_type": "Smartphone", "problem_description": "Test.", "priority": "normal"}
        defaults.update(kwargs)
        return create_job(shop, customer, defaults, admin_user)

    def test_search_by_customer_name(self, admin_client, shop, customer, admin_user):
        self._make_job(shop, customer, admin_user)
        res = admin_client.get("/api/v1/repair/jobs/", {"search": customer.name[:4]})
        assert res.status_code == 200
        assert res.data["meta"]["count"] >= 1
        for item in res.data["items"]:
            assert customer.name[:4].lower() in item["customer_name"].lower()

    def test_search_by_job_number(self, admin_client, shop, customer, admin_user):
        job = self._make_job(shop, customer, admin_user)
        res = admin_client.get("/api/v1/repair/jobs/", {"search": job.job_number})
        assert res.status_code == 200
        assert res.data["meta"]["count"] == 1
        assert res.data["items"][0]["job_number"] == job.job_number

    def test_search_no_match_returns_empty(self, admin_client, shop, customer, admin_user):
        self._make_job(shop, customer, admin_user)
        res = admin_client.get("/api/v1/repair/jobs/", {"search": "ZZZNOMATCH999"})
        assert res.status_code == 200
        assert res.data["meta"]["count"] == 0

    def test_filter_device_type_case_insensitive(self, admin_client, shop, customer, admin_user):
        self._make_job(shop, customer, admin_user, device_type="Laptop")
        self._make_job(shop, customer, admin_user, device_type="Smartphone")
        res = admin_client.get("/api/v1/repair/jobs/", {"device_type": "laptop"})
        assert res.status_code == 200
        assert res.data["meta"]["count"] == 1
        assert res.data["items"][0]["device_type"].lower() == "laptop"

    def test_filter_payment_status(self, admin_client, shop, customer, admin_user):
        from repair.models import JobTicket
        unpaid = self._make_job(shop, customer, admin_user)
        JobTicket.objects.filter(pk=unpaid.pk).update(service_charge=500, advance_paid=0)
        partial = self._make_job(shop, customer, admin_user)
        JobTicket.objects.filter(pk=partial.pk).update(service_charge=500, advance_paid=200)
        paid = self._make_job(shop, customer, admin_user)
        JobTicket.objects.filter(pk=paid.pk).update(service_charge=500, advance_paid=500)

        r_unpaid = admin_client.get("/api/v1/repair/jobs/", {"payment_status": "unpaid"})
        assert {r["job_number"] for r in r_unpaid.data["results"]} == {unpaid.job_number}
        r_partial = admin_client.get("/api/v1/repair/jobs/", {"payment_status": "partial"})
        assert {r["job_number"] for r in r_partial.data["results"]} == {partial.job_number}
        r_paid = admin_client.get("/api/v1/repair/jobs/", {"payment_status": "paid"})
        assert paid.job_number in {r["job_number"] for r in r_paid.data["results"]}

    def test_filter_overdue_excludes_terminal(self, admin_client, shop, customer, admin_user):
        import datetime
        from repair.models import JobTicket
        yesterday = datetime.date.today() - datetime.timedelta(days=1)
        od = self._make_job(shop, customer, admin_user)
        JobTicket.objects.filter(pk=od.pk).update(status="open", expected_delivery_date=yesterday)
        done = self._make_job(shop, customer, admin_user)
        JobTicket.objects.filter(pk=done.pk).update(status="delivered", expected_delivery_date=yesterday)

        res = admin_client.get("/api/v1/repair/jobs/", {"overdue": "true"})
        assert res.status_code == 200
        nums = {r["job_number"] for r in res.data["items"]}
        assert od.job_number in nums
        assert done.job_number not in nums

    def test_filter_due_on(self, admin_client, shop, customer, admin_user):
        import datetime
        from repair.models import JobTicket
        today = datetime.date.today()
        due = self._make_job(shop, customer, admin_user)
        JobTicket.objects.filter(pk=due.pk).update(status="open", expected_delivery_date=today)
        other = self._make_job(shop, customer, admin_user)
        JobTicket.objects.filter(pk=other.pk).update(
            status="open", expected_delivery_date=today + datetime.timedelta(days=3)
        )
        res = admin_client.get("/api/v1/repair/jobs/", {"due_on": today.isoformat()})
        assert res.status_code == 200
        assert {r["job_number"] for r in res.data["items"]} == {due.job_number}
```

Note: the list endpoint uses `RepairOSPageNumberPagination`, which returns `{"items": [...], "meta": {"count", "total_pages", "page", "page_size"}}` (confirmed in `backend/apps/core/pagination.py`). Items are under `res.data["items"]`; the total is under `res.data["meta"]["count"]`.

- [x] **Step 2: Run tests to confirm they fail**

```bash
cd /home/appuser/workspace/projects/repairOS/backend
python -m pytest apps/repair/tests/test_jobs.py::TestJobListFilters -v --no-cov 2>&1 | tail -25
```
Expected: failures (filters not implemented yet — search/device/payment/overdue/due_on are ignored so counts won't match).

- [x] **Step 3: Implement the filters**

In `backend/apps/repair/views.py`, inside `get_queryset()`, immediately **after** the existing `if date_to := qp.get("date_to"):` block and **before** `return qs`, insert:

```python
        # Full-text-ish search across key fields
        if search := qp.get("search", "").strip():
            qs = qs.filter(
                Q(job_number__icontains=search)
                | Q(customer__name__icontains=search)
                | Q(customer__phone__icontains=search)
                | Q(imei__icontains=search)
                | Q(serial_number__icontains=search)
                | Q(problem_description__icontains=search)
            ).distinct()

        # Device type (free-text intake → case-insensitive exact match)
        if device_type := qp.get("device_type", "").strip():
            qs = qs.filter(device_type__iexact=device_type)

        # Payment status (derive balance = service_charge - advance_paid)
        if payment_status := qp.get("payment_status", "").strip():
            if payment_status in ("paid", "partial", "unpaid"):
                from django.db.models import DecimalField, ExpressionWrapper, F
                qs = qs.annotate(
                    _balance=ExpressionWrapper(
                        F("service_charge") - F("advance_paid"),
                        output_field=DecimalField(max_digits=12, decimal_places=2),
                    )
                )
                if payment_status == "paid":
                    qs = qs.filter(_balance__lte=0)
                elif payment_status == "unpaid":
                    qs = qs.filter(advance_paid=0, service_charge__gt=0)
                elif payment_status == "partial":
                    qs = qs.filter(advance_paid__gt=0, _balance__gt=0)

        # Overdue: expected delivery in the past and not in a terminal state
        if qp.get("overdue", "").strip().lower() == "true":
            from django.utils import timezone
            qs = qs.filter(expected_delivery_date__lt=timezone.localdate()).exclude(
                status__in=["delivered", "closed", "cancelled"]
            )

        # Due on a specific date (expected delivery date)
        if due_on := qp.get("due_on", "").strip():
            qs = qs.filter(expected_delivery_date=due_on)

        return qs
```

- [x] **Step 4: Run tests to confirm they pass**

```bash
cd /home/appuser/workspace/projects/repairOS/backend
python -m pytest apps/repair/tests/test_jobs.py::TestJobListFilters -v --no-cov 2>&1 | tail -20
```
Expected: 7 tests PASS.

- [x] **Step 5: Regression run**

```bash
python -m pytest apps/repair/tests/ --no-cov 2>&1 | tail -8
```
Expected: all PASS.

- [x] **Step 6: Commit**

```bash
cd /home/appuser/workspace/projects/repairOS
git add backend/apps/repair/views.py backend/apps/repair/tests/test_jobs.py
git commit -m "feat(repair): add search, device_type, payment_status, overdue, due_on job filters

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Frontend — extend `JobFilters` type

**Files:**
- Modify: `frontend/src/lib/api/repair.ts`

- [x] **Step 1: Add the new optional fields**

In `frontend/src/lib/api/repair.ts`, replace the `JobFilters` interface (currently fields `shop_id, status, technician_id, customer_id, priority, date_from, date_to, search, page`) with:

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
  page?: number;
  device_type?: string;
  payment_status?: 'paid' | 'partial' | 'unpaid';
  overdue?: boolean;
  due_on?: string;
}
```

- [x] **Step 2: Verify TypeScript compiles**

```bash
cd /home/appuser/workspace/projects/repairOS/frontend
npx tsc --noEmit 2>&1 | grep "error TS" | grep -v "Can.test.tsx" || echo "OK no errors"
```
Expected: `OK no errors`.

- [x] **Step 3: Commit**

```bash
cd /home/appuser/workspace/projects/repairOS
git add frontend/src/lib/api/repair.ts
git commit -m "feat(repair): extend JobFilters with device_type, payment_status, overdue, due_on

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Frontend — filter-state model & pure helpers

**Files:**
- Create: `frontend/src/lib/repair/jobFilters.ts`
- Test: `frontend/src/lib/repair/__tests__/jobFilters.test.ts`

This file holds all filter logic with no React, so it is unit-tested directly.

- [x] **Step 1: Write the failing test**

Create `frontend/src/lib/repair/__tests__/jobFilters.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  EMPTY_JOB_FILTERS,
  toBaseApiFilters,
  activeChips,
  activeFilterCount,
  clearChip,
  clearAll,
  applyPreset,
  isPresetActive,
  type JobFilterState,
} from '../jobFilters';

const TODAY = '2026-06-18';
const CTX = { todayIso: TODAY, currentUserId: 'u1', technicianName: (id: string) => (id === 'u1' ? 'Asha' : id) };

function state(overrides: Partial<JobFilterState> = {}): JobFilterState {
  return { ...EMPTY_JOB_FILTERS, ...overrides };
}

describe('toBaseApiFilters', () => {
  it('omits defaults and status (status is applied per view by the caller)', () => {
    expect(toBaseApiFilters(state(), CTX)).toEqual({});
  });

  it('maps active fields to API params, excluding status', () => {
    const f = toBaseApiFilters(
      state({ status: 'open', technicianId: 'u1', priority: 'urgent', deviceType: ' Laptop ', paymentStatus: 'unpaid', dateFrom: '2026-06-01', dateTo: '2026-06-10' }),
      CTX,
    );
    expect(f).toEqual({
      technician_id: 'u1',
      priority: 'urgent',
      device_type: 'Laptop',
      payment_status: 'unpaid',
      date_from: '2026-06-01',
      date_to: '2026-06-10',
    });
    expect('status' in f).toBe(false);
  });

  it('maps overdue and dueToday presets to backend params', () => {
    expect(toBaseApiFilters(state({ overdue: true }), CTX)).toEqual({ overdue: true });
    expect(toBaseApiFilters(state({ dueToday: true }), CTX)).toEqual({ due_on: TODAY });
  });
});

describe('chips & count', () => {
  it('produces a removable chip per active filter (search excluded)', () => {
    const s = state({ search: 'samsung', status: 'on_hold', paymentStatus: 'unpaid', overdue: true });
    const chips = activeChips(s, CTX);
    const keys = chips.map((c) => c.key);
    expect(keys).toContain('status');
    expect(keys).toContain('paymentStatus');
    expect(keys).toContain('overdue');
    expect(keys).not.toContain('search');
    expect(activeFilterCount(s)).toBe(chips.length);
  });

  it('renders a human label for the technician chip via ctx', () => {
    const chips = activeChips(state({ technicianId: 'u1' }), CTX);
    expect(chips.find((c) => c.key === 'technicianId')?.label).toBe('Tech: Asha');
  });

  it('clearChip resets one field to default, clearAll resets all but keeps search', () => {
    const s = state({ search: 'x', status: 'open', priority: 'vip' });
    expect(clearChip(s, 'status').status).toBe('all');
    expect(clearChip(s, 'status').priority).toBe('vip');
    const cleared = clearAll(s);
    expect(cleared.status).toBe('all');
    expect(cleared.priority).toBe('all');
    expect(cleared.search).toBe('x');
  });
});

describe('presets', () => {
  it('toggles a preset on and off', () => {
    const on = applyPreset(state(), 'unpaid', CTX);
    expect(on.paymentStatus).toBe('unpaid');
    expect(isPresetActive(on, 'unpaid', CTX)).toBe(true);
    const off = applyPreset(on, 'unpaid', CTX);
    expect(off.paymentStatus).toBe('all');
    expect(isPresetActive(off, 'unpaid', CTX)).toBe(false);
  });

  it('my_jobs maps to the current user, overdue/due_today set their flags', () => {
    expect(applyPreset(state(), 'my_jobs', CTX).technicianId).toBe('u1');
    expect(applyPreset(state(), 'overdue', CTX).overdue).toBe(true);
    expect(applyPreset(state(), 'due_today', CTX).dueToday).toBe(true);
    expect(isPresetActive(state({ technicianId: 'u1' }), 'my_jobs', CTX)).toBe(true);
  });
});
```

- [x] **Step 2: Run, confirm it fails**

```bash
cd /home/appuser/workspace/projects/repairOS/frontend
npx vitest run src/lib/repair/__tests__/jobFilters.test.ts 2>&1 | tail -15
```
Expected: FAIL (module not found).

- [x] **Step 3: Implement the helpers**

Create `frontend/src/lib/repair/jobFilters.ts`:

```ts
import type { JobFilters, JobStatus, JobPriority } from '@/lib/api/repair';

export type PaymentStatusFilter = 'paid' | 'partial' | 'unpaid';
export type QuickPreset = 'overdue' | 'unpaid' | 'due_today' | 'my_jobs';

export interface JobFilterState {
  search: string;
  status: JobStatus | 'all';
  technicianId: string | 'all';
  priority: JobPriority | 'all';
  deviceType: string;                       // free text; '' = any
  paymentStatus: PaymentStatusFilter | 'all';
  dateFrom: string;                         // 'YYYY-MM-DD' | ''  (intake date)
  dateTo: string;
  overdue: boolean;                         // expected_delivery_date < today, non-terminal
  dueToday: boolean;                        // expected_delivery_date == today
}

export const EMPTY_JOB_FILTERS: JobFilterState = {
  search: '',
  status: 'all',
  technicianId: 'all',
  priority: 'all',
  deviceType: '',
  paymentStatus: 'all',
  dateFrom: '',
  dateTo: '',
  overdue: false,
  dueToday: false,
};

export interface JobFilterCtx {
  todayIso: string;                         // 'YYYY-MM-DD' for due_today
  currentUserId: string;
  technicianName: (id: string) => string;   // resolve a tech id to a display name
}

/**
 * API params shared by every view. Excludes `status` because the kanban applies a
 * status per column and the list applies the chosen status filter separately.
 */
export function toBaseApiFilters(s: JobFilterState, ctx: JobFilterCtx): JobFilters {
  const f: JobFilters = {};
  if (s.technicianId !== 'all') f.technician_id = s.technicianId;
  if (s.priority !== 'all') f.priority = s.priority;
  const device = s.deviceType.trim();
  if (device) f.device_type = device;
  if (s.paymentStatus !== 'all') f.payment_status = s.paymentStatus;
  if (s.dateFrom) f.date_from = s.dateFrom;
  if (s.dateTo) f.date_to = s.dateTo;
  if (s.overdue) f.overdue = true;
  if (s.dueToday) f.due_on = ctx.todayIso;
  return f;
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft', open: 'Open', estimated: 'Estimated', estimate_sent: 'Estimate sent',
  estimate_approved: 'Estimate approved', estimate_rejected: 'Estimate rejected',
  in_progress: 'In progress', on_hold: 'On hold', ready_for_qc: 'Ready for QC',
  qc_failed: 'QC failed', ready_for_pickup: 'Ready for pickup', delivered: 'Delivered',
  closed: 'Closed', cancelled: 'Cancelled',
};
const PRIORITY_LABELS: Record<string, string> = { normal: 'Normal', urgent: 'Urgent', vip: 'VIP' };
const PAYMENT_LABELS: Record<string, string> = { paid: 'Paid', partial: 'Partial', unpaid: 'Unpaid' };

export interface FilterChip {
  key: keyof JobFilterState;
  label: string;
}

/** Every active filter (search excluded — it lives in its own input). */
export function activeChips(s: JobFilterState, ctx: JobFilterCtx): FilterChip[] {
  const chips: FilterChip[] = [];
  if (s.status !== 'all') chips.push({ key: 'status', label: STATUS_LABELS[s.status] ?? s.status });
  if (s.technicianId !== 'all') chips.push({ key: 'technicianId', label: `Tech: ${ctx.technicianName(s.technicianId)}` });
  if (s.priority !== 'all') chips.push({ key: 'priority', label: PRIORITY_LABELS[s.priority] ?? s.priority });
  if (s.deviceType.trim()) chips.push({ key: 'deviceType', label: `Device: ${s.deviceType.trim()}` });
  if (s.paymentStatus !== 'all') chips.push({ key: 'paymentStatus', label: PAYMENT_LABELS[s.paymentStatus] });
  if (s.dateFrom) chips.push({ key: 'dateFrom', label: `From ${s.dateFrom}` });
  if (s.dateTo) chips.push({ key: 'dateTo', label: `To ${s.dateTo}` });
  if (s.overdue) chips.push({ key: 'overdue', label: 'Overdue' });
  if (s.dueToday) chips.push({ key: 'dueToday', label: 'Due today' });
  return chips;
}

export function activeFilterCount(s: JobFilterState): number {
  // Same set as activeChips, but ctx-free (labels not needed for a count).
  let n = 0;
  if (s.status !== 'all') n++;
  if (s.technicianId !== 'all') n++;
  if (s.priority !== 'all') n++;
  if (s.deviceType.trim()) n++;
  if (s.paymentStatus !== 'all') n++;
  if (s.dateFrom) n++;
  if (s.dateTo) n++;
  if (s.overdue) n++;
  if (s.dueToday) n++;
  return n;
}

const DEFAULTS: Record<keyof JobFilterState, JobFilterState[keyof JobFilterState]> = EMPTY_JOB_FILTERS;

export function clearChip(s: JobFilterState, key: keyof JobFilterState): JobFilterState {
  return { ...s, [key]: DEFAULTS[key] };
}

/** Reset every filter but keep the search text. */
export function clearAll(s: JobFilterState): JobFilterState {
  return { ...EMPTY_JOB_FILTERS, search: s.search };
}

/** Toggle a quick preset on/off, returning new state. */
export function applyPreset(s: JobFilterState, preset: QuickPreset, ctx: JobFilterCtx): JobFilterState {
  const active = isPresetActive(s, preset, ctx);
  switch (preset) {
    case 'overdue':   return { ...s, overdue: !active };
    case 'due_today': return { ...s, dueToday: !active };
    case 'unpaid':    return { ...s, paymentStatus: active ? 'all' : 'unpaid' };
    case 'my_jobs':   return { ...s, technicianId: active ? 'all' : ctx.currentUserId };
  }
}

export function isPresetActive(s: JobFilterState, preset: QuickPreset, ctx: JobFilterCtx): boolean {
  switch (preset) {
    case 'overdue':   return s.overdue;
    case 'due_today': return s.dueToday;
    case 'unpaid':    return s.paymentStatus === 'unpaid';
    case 'my_jobs':   return s.technicianId === ctx.currentUserId;
  }
}

export const QUICK_PRESETS: Array<{ id: QuickPreset; label: string }> = [
  { id: 'overdue',   label: 'Overdue' },
  { id: 'unpaid',    label: 'Unpaid' },
  { id: 'due_today', label: 'Due today' },
  { id: 'my_jobs',   label: 'My jobs' },
];
```

- [x] **Step 4: Run, confirm pass**

```bash
npx vitest run src/lib/repair/__tests__/jobFilters.test.ts 2>&1 | tail -15
```
Expected: all tests PASS.

- [x] **Step 5: Typecheck**

```bash
npx tsc --noEmit 2>&1 | grep "error TS" | grep -v "Can.test.tsx" || echo "OK no errors"
```
Expected: `OK no errors`.

- [x] **Step 6: Commit**

```bash
cd /home/appuser/workspace/projects/repairOS
git add frontend/src/lib/repair/jobFilters.ts frontend/src/lib/repair/__tests__/jobFilters.test.ts
git commit -m "feat(jobs): add filter-state model and pure helpers

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Frontend — `JobFilterBar` (Filters button, popover panel, active chips)

**Files:**
- Create: `frontend/src/components/repair/JobFilterBar.tsx`
- Test: `frontend/src/components/repair/__tests__/JobFilterBar.test.tsx`

Context: shadcn primitives exist — `Popover`/`PopoverTrigger`/`PopoverContent` (`@/components/ui/popover`), `Select…` (`@/components/ui/select`), `Input` (`@/components/ui/input`), `Button` (`@/components/ui/button`), `Badge` (`@/components/ui/badge`). Icons from `lucide-react`. The component is **controlled**: it receives `filters` and an `onChange(next)` callback plus a `technicians` list for the technician select. It owns no filter state itself.

- [x] **Step 1: Write the failing test**

Create `frontend/src/components/repair/__tests__/JobFilterBar.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { JobFilterBar } from '../JobFilterBar';
import { EMPTY_JOB_FILTERS, type JobFilterState } from '@/lib/repair/jobFilters';

const CTX = { todayIso: '2026-06-18', currentUserId: 'u1', technicianName: (id: string) => (id === 'u1' ? 'Asha' : id) };
const TECHS = [{ id: 'u1', name: 'Asha' }, { id: 'u2', name: 'Ravi' }];

function setup(initial: Partial<JobFilterState> = {}) {
  const onChange = vi.fn();
  const filters = { ...EMPTY_JOB_FILTERS, ...initial };
  render(<JobFilterBar filters={filters} onChange={onChange} technicians={TECHS} ctx={CTX} />);
  return { onChange, filters };
}

describe('JobFilterBar', () => {
  it('shows the active-filter count on the Filters button', () => {
    setup({ status: 'open', paymentStatus: 'unpaid' });
    expect(screen.getByRole('button', { name: /filters/i })).toHaveTextContent('2');
  });

  it('renders a removable chip per active filter and removing one calls onChange with it reset', async () => {
    const user = userEvent.setup();
    const { onChange } = setup({ priority: 'vip' });
    const chip = screen.getByRole('button', { name: /remove VIP/i });
    await user.click(chip);
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ priority: 'all' }));
  });

  it('Clear all resets filters but keeps search', async () => {
    const user = userEvent.setup();
    const { onChange } = setup({ search: 'samsung', status: 'open', priority: 'vip' });
    await user.click(screen.getByRole('button', { name: /clear all/i }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ status: 'all', priority: 'all', search: 'samsung' }));
  });

  it('changing the priority select inside the panel calls onChange', async () => {
    const user = userEvent.setup();
    const { onChange } = setup();
    await user.click(screen.getByRole('button', { name: /filters/i }));
    // Radix Select renders a combobox trigger labelled by its current value; open Priority and pick Urgent
    await user.click(screen.getByLabelText(/priority/i));
    await user.click(await screen.findByRole('option', { name: 'Urgent' }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ priority: 'urgent' }));
  });
});
```

Note on the Radix Select interaction: Radix Select options render in a portal and may not behave under jsdom exactly as a native `<select>`. If the `option` query proves flaky in this environment, make the panel's selects **native `<select>` elements** styled with the existing input classes instead of the Radix `Select` (simpler and fully testable). Decide based on how the existing `jobs/page.tsx` Select behaves in tests; native `<select>` is an acceptable, accessible choice here. Keep the test asserting `onChange` with `{ priority: 'urgent' }` regardless of which control you use (adjust the query to match).

- [x] **Step 2: Run, confirm it fails**

```bash
npx vitest run src/components/repair/__tests__/JobFilterBar.test.tsx 2>&1 | tail -20
```
Expected: FAIL (module not found).

- [x] **Step 3: Implement `JobFilterBar`**

Create `frontend/src/components/repair/JobFilterBar.tsx`:

```tsx
'use client';

import { SlidersHorizontal, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  activeChips,
  activeFilterCount,
  clearAll,
  clearChip,
  type JobFilterState,
  type JobFilterCtx,
  type PaymentStatusFilter,
} from '@/lib/repair/jobFilters';
import type { JobPriority, JobStatus } from '@/lib/api/repair';
import { cn } from '@/lib/utils';

interface Technician { id: string; name: string }

interface JobFilterBarProps {
  filters: JobFilterState;
  onChange: (next: JobFilterState) => void;
  technicians: Technician[];
  ctx: JobFilterCtx;
}

const STATUS_OPTIONS: Array<{ value: JobStatus | 'all'; label: string }> = [
  { value: 'all', label: 'All statuses' },
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'on_hold', label: 'On hold' },
  { value: 'ready_for_qc', label: 'Ready for QC' },
  { value: 'ready_for_pickup', label: 'Ready for pickup' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'closed', label: 'Closed' },
  { value: 'cancelled', label: 'Cancelled' },
];
const PRIORITY_OPTIONS: Array<{ value: JobPriority | 'all'; label: string }> = [
  { value: 'all', label: 'All priorities' },
  { value: 'normal', label: 'Normal' },
  { value: 'urgent', label: 'Urgent' },
  { value: 'vip', label: 'VIP' },
];
const PAYMENT_OPTIONS: Array<{ value: PaymentStatusFilter | 'all'; label: string }> = [
  { value: 'all', label: 'All payments' },
  { value: 'paid', label: 'Paid' },
  { value: 'partial', label: 'Partial' },
  { value: 'unpaid', label: 'Unpaid' },
];

const selectClass =
  'h-9 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-body-sm text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]';
const fieldLabel = 'text-xs font-medium text-[var(--text-muted)] mb-1 block';

export function JobFilterBar({ filters, onChange, technicians, ctx }: JobFilterBarProps) {
  const count = activeFilterCount(filters);
  const chips = activeChips(filters, ctx);
  const set = <K extends keyof JobFilterState>(key: K, value: JobFilterState[K]) =>
    onChange({ ...filters, [key]: value });

  return (
    <div className="flex flex-col gap-2">
      <Popover>
        <PopoverTrigger asChild>
          <button
            className={cn(
              'h-9 px-3 inline-flex items-center gap-1.5 rounded-md border text-body-sm transition-colors min-h-[44px] sm:min-h-0',
              count > 0
                ? 'border-[var(--accent)] text-[var(--accent)] bg-[var(--accent)]/5'
                : 'border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-2)]',
            )}
          >
            <SlidersHorizontal className="h-4 w-4" />
            <span>Filters</span>
            {count > 0 && (
              <span className="ml-0.5 h-5 min-w-[20px] px-1 rounded-full bg-[var(--accent)] text-white text-xs inline-flex items-center justify-center tabular-nums">
                {count}
              </span>
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[320px] space-y-3">
          <div>
            <label className={fieldLabel} htmlFor="jf-status">Status</label>
            <select
              id="jf-status"
              aria-label="Status"
              className={selectClass}
              value={filters.status}
              onChange={(e) => set('status', e.target.value as JobStatus | 'all')}
            >
              {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          <div>
            <label className={fieldLabel} htmlFor="jf-tech">Technician</label>
            <select
              id="jf-tech"
              aria-label="Technician"
              className={selectClass}
              value={filters.technicianId}
              onChange={(e) => set('technicianId', e.target.value)}
            >
              <option value="all">All technicians</option>
              {technicians.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>

          <div>
            <label className={fieldLabel} htmlFor="jf-priority">Priority</label>
            <select
              id="jf-priority"
              aria-label="Priority"
              className={selectClass}
              value={filters.priority}
              onChange={(e) => set('priority', e.target.value as JobPriority | 'all')}
            >
              {PRIORITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          <div>
            <label className={fieldLabel} htmlFor="jf-device">Device type</label>
            <Input
              id="jf-device"
              className="h-9"
              placeholder="e.g. Laptop"
              value={filters.deviceType}
              onChange={(e) => set('deviceType', e.target.value)}
            />
          </div>

          <div>
            <label className={fieldLabel} htmlFor="jf-payment">Payment</label>
            <select
              id="jf-payment"
              aria-label="Payment"
              className={selectClass}
              value={filters.paymentStatus}
              onChange={(e) => set('paymentStatus', e.target.value as PaymentStatusFilter | 'all')}
            >
              {PAYMENT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className={fieldLabel} htmlFor="jf-from">Intake from</label>
              <input id="jf-from" type="date" className={selectClass} value={filters.dateFrom}
                onChange={(e) => set('dateFrom', e.target.value)} />
            </div>
            <div className="flex-1">
              <label className={fieldLabel} htmlFor="jf-to">Intake to</label>
              <input id="jf-to" type="date" className={selectClass} value={filters.dateTo}
                onChange={(e) => set('dateTo', e.target.value)} />
            </div>
          </div>
        </PopoverContent>
      </Popover>

      {chips.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {chips.map((chip) => (
            <span
              key={chip.key}
              className="inline-flex items-center gap-1 h-7 pl-2.5 pr-1 rounded-full border border-[var(--accent)]/40 bg-[var(--accent)]/5 text-[var(--accent)] text-xs"
            >
              {chip.label}
              <button
                aria-label={`Remove ${chip.label}`}
                className="h-5 w-5 inline-flex items-center justify-center rounded-full hover:bg-[var(--accent)]/15"
                onClick={() => onChange(clearChip(filters, chip.key))}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          <button
            className="h-7 px-2 text-xs text-[var(--danger)] hover:bg-[var(--danger)]/10 rounded-md transition-colors"
            onClick={() => onChange(clearAll(filters))}
          >
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}
```

- [x] **Step 4: Run, confirm pass**

```bash
npx vitest run src/components/repair/__tests__/JobFilterBar.test.tsx 2>&1 | tail -20
```
Expected: 4 tests PASS. (If the priority-select test is flaky due to portal/jsdom, the component already uses native `<select>` with `aria-label="Priority"`; query it with `screen.getByLabelText(/priority/i)` and fire a `change` event to `'urgent'` via `fireEvent.change`.)

- [x] **Step 5: Typecheck**

```bash
npx tsc --noEmit 2>&1 | grep "error TS" | grep -v "Can.test.tsx" || echo "OK no errors"
```
Expected: `OK no errors`.

- [x] **Step 6: Commit**

```bash
cd /home/appuser/workspace/projects/repairOS
git add frontend/src/components/repair/JobFilterBar.tsx frontend/src/components/repair/__tests__/JobFilterBar.test.tsx
git commit -m "feat(jobs): add JobFilterBar with popover panel and active chips

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Frontend — `JobQuickFilters` preset row

**Files:**
- Create: `frontend/src/components/repair/JobQuickFilters.tsx`
- Test: `frontend/src/components/repair/__tests__/JobQuickFilters.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/repair/__tests__/JobQuickFilters.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { JobQuickFilters } from '../JobQuickFilters';
import { EMPTY_JOB_FILTERS } from '@/lib/repair/jobFilters';

const CTX = { todayIso: '2026-06-18', currentUserId: 'u1', technicianName: (id: string) => id };

describe('JobQuickFilters', () => {
  it('renders the four presets', () => {
    render(<JobQuickFilters filters={EMPTY_JOB_FILTERS} onChange={() => {}} ctx={CTX} />);
    for (const label of ['Overdue', 'Unpaid', 'Due today', 'My jobs']) {
      expect(screen.getByRole('button', { name: label })).toBeInTheDocument();
    }
  });

  it('clicking a preset toggles it on via onChange', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<JobQuickFilters filters={EMPTY_JOB_FILTERS} onChange={onChange} ctx={CTX} />);
    await user.click(screen.getByRole('button', { name: 'Unpaid' }));
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ paymentStatus: 'unpaid' }));
  });

  it('marks an active preset as pressed', () => {
    render(<JobQuickFilters filters={{ ...EMPTY_JOB_FILTERS, overdue: true }} onChange={() => {}} ctx={CTX} />);
    expect(screen.getByRole('button', { name: 'Overdue' })).toHaveAttribute('aria-pressed', 'true');
  });
});
```

- [ ] **Step 2: Run, confirm it fails**

```bash
npx vitest run src/components/repair/__tests__/JobQuickFilters.test.tsx 2>&1 | tail -15
```
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `JobQuickFilters`**

Create `frontend/src/components/repair/JobQuickFilters.tsx`:

```tsx
'use client';

import {
  QUICK_PRESETS,
  applyPreset,
  isPresetActive,
  type JobFilterState,
  type JobFilterCtx,
} from '@/lib/repair/jobFilters';
import { cn } from '@/lib/utils';

interface JobQuickFiltersProps {
  filters: JobFilterState;
  onChange: (next: JobFilterState) => void;
  ctx: JobFilterCtx;
}

export function JobQuickFilters({ filters, onChange, ctx }: JobQuickFiltersProps) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {QUICK_PRESETS.map((preset) => {
        const active = isPresetActive(filters, preset.id, ctx);
        return (
          <button
            key={preset.id}
            aria-pressed={active}
            onClick={() => onChange(applyPreset(filters, preset.id, ctx))}
            className={cn(
              'h-8 px-3 rounded-full border text-xs transition-colors min-h-[44px] sm:min-h-0',
              active
                ? 'border-[var(--accent)] bg-[var(--accent)] text-white'
                : 'border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-2)]',
            )}
          >
            {preset.label}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 4: Run, confirm pass**

```bash
npx vitest run src/components/repair/__tests__/JobQuickFilters.test.tsx 2>&1 | tail -15
```
Expected: 3 tests PASS.

- [ ] **Step 5: Typecheck**

```bash
npx tsc --noEmit 2>&1 | grep "error TS" | grep -v "Can.test.tsx" || echo "OK no errors"
```
Expected: `OK no errors`.

- [ ] **Step 6: Commit**

```bash
cd /home/appuser/workspace/projects/repairOS
git add frontend/src/components/repair/JobQuickFilters.tsx frontend/src/components/repair/__tests__/JobQuickFilters.test.tsx
git commit -m "feat(jobs): add JobQuickFilters preset row

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Frontend — wire filters into `jobs/page.tsx` (both views)

**Files:**
- Modify: `frontend/src/app/(app)/jobs/page.tsx`

Context: the current page has separate `search`, `priority`, `technicianId` state, a `baseFilters` memo, kanban `useQueries` (one per `KANBAN_COLUMNS` status), a list `useQuery` (page-number paginated via `listPage`), and an always-visible Priority `Select` + Technician `Select` in the top bar. This task replaces the priority/technician selects with the unified `JobFilterBar` + `JobQuickFilters`, consolidates state into one `JobFilterState`, and feeds it to **both** views.

- [ ] **Step 1: Replace imports, state, and filter memos**

At the top of `jobs/page.tsx`, add the new imports (keep existing ones; remove `Filter` from lucide and the `PRIORITY_OPTIONS` constant + the Priority/Technician `Select` blocks in later steps):

```typescript
import { JobFilterBar } from '@/components/repair/JobFilterBar';
import { JobQuickFilters } from '@/components/repair/JobQuickFilters';
import { EMPTY_JOB_FILTERS, toBaseApiFilters, type JobFilterState, type JobFilterCtx } from '@/lib/repair/jobFilters';
import { useAuthStore } from '@/lib/stores/authStore';
```

Inside `JobsPage()`, replace the three state lines (`search`, `priority`, `technicianId`) and the `baseFilters` memo with one consolidated filter state plus derived API filters. Keep `view` and `listPage` state. Replace:

```typescript
  const [search, setSearch] = useState('');
  const [priority, setPriority] = useState<JobPriority | 'all'>('all');
  const [technicianId, setTechnicianId] = useState<string | 'all'>('all');
  const [listPage, setListPage] = useState(1);

  const debouncedSearch = useDebounce(search, 350);
  React.useEffect(() => { setListPage(1); }, [debouncedSearch, priority, technicianId]);
```

with:

```typescript
  const [filters, setFilters] = useState<JobFilterState>(EMPTY_JOB_FILTERS);
  const [listPage, setListPage] = useState(1);

  const { user } = useAuthStore();
  const debouncedSearch = useDebounce(filters.search, 350);

  // Reset to page 1 whenever any filter changes (search is debounced separately)
  const filterSignature = JSON.stringify({ ...filters, search: debouncedSearch });
  React.useEffect(() => { setListPage(1); }, [filterSignature]);
```

Then replace the `baseFilters` memo:

```typescript
  const baseFilters = useMemo(() => ({
    shop_id: isAllShops ? undefined : activeShopId ?? undefined,
    search: debouncedSearch || undefined,
    priority: priority === 'all' ? undefined : priority,
    technician_id: technicianId === 'all' ? undefined : technicianId,
  }), [isAllShops, activeShopId, debouncedSearch, priority, technicianId]);
```

with:

```typescript
  const filterCtx: JobFilterCtx = useMemo(() => ({
    todayIso: new Date().toISOString().slice(0, 10),
    currentUserId: user?.id ?? '',
    technicianName: (id) => usersData?.items.find((u) => u.id === id)?.full_name ?? id,
  }), [user?.id, usersData]);

  // Shared filters for every view (status excluded — applied per column / per list).
  const baseFilters = useMemo(() => ({
    shop_id: isAllShops ? undefined : activeShopId ?? undefined,
    search: debouncedSearch || undefined,
    ...toBaseApiFilters({ ...filters, search: debouncedSearch }, filterCtx),
  }), [isAllShops, activeShopId, debouncedSearch, filters, filterCtx]);
```

> `usersData` is the existing `useQuery` for technicians; it is declared above `baseFilters` in the current file, so `filterCtx` can reference it. If the declaration order causes a use-before-declare, move the `usersData` query above `filterCtx`.

- [ ] **Step 2: Apply status to the list query**

The kanban `useQueries` already spreads `baseFilters` and adds `status` per column — it needs no change (the new filters flow through `baseFilters`). For the **list** query, add the chosen status filter. Replace the list `useQuery` block:

```typescript
  const listQuery = useQuery({
    queryKey: qk.jobs({ ...baseFilters, page: listPage }),
    queryFn: () => repairApi.listJobs({ ...baseFilters, page: listPage }),
    staleTime: 30_000,
    enabled: view === 'list',
  });
```

with:

```typescript
  const listFilters = useMemo(
    () => ({ ...baseFilters, status: filters.status === 'all' ? undefined : filters.status, page: listPage }),
    [baseFilters, filters.status, listPage],
  );
  const listQuery = useQuery({
    queryKey: qk.jobs(listFilters),
    queryFn: () => repairApi.listJobs(listFilters),
    staleTime: 30_000,
    enabled: view === 'list',
  });
```

- [ ] **Step 3: Update the search input and remove the old Priority/Technician selects**

In the top-bar JSX: keep the search `Input` but bind it to the consolidated state — change `value={search}` / `onChange={(e) => setSearch(e.target.value)}` to:

```tsx
            value={filters.search}
            onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
```

Delete the entire Priority `Select` block (the `<Select value={priority} …>…</Select>`) and the Technician `Select` block (`{usersData?.items && … <Select value={technicianId} …>…</Select>}`). In their place, render the filter bar:

```tsx
        <JobFilterBar
          filters={filters}
          onChange={setFilters}
          technicians={(usersData?.items ?? []).map((u) => ({ id: u.id, name: u.full_name }))}
          ctx={filterCtx}
        />
```

Also remove the now-unused `PRIORITY_OPTIONS` constant and the `Filter` icon import, and drop `JobPriority` from imports if it is no longer referenced (the list columns may still use it — only remove if `tsc` reports it unused).

- [ ] **Step 4: Add the quick-filter row above the board/list**

Between the top bar `</div>` and the `{/* Board / List */}` content div, insert:

```tsx
      {/* Quick filters */}
      <div className="px-4 py-2 border-b border-[var(--border)] bg-[var(--surface)]">
        <JobQuickFilters filters={filters} onChange={setFilters} ctx={filterCtx} />
      </div>
```

- [ ] **Step 5: Make the kanban `onCardMove` invalidation use the active filters**

The existing `handleCardMove` invalidates `qk.jobs({ ...baseFilters, status: fromStatus })` and `toStatus`. Because `baseFilters` now includes the unified filters, this still composes correctly — no change needed. Verify it still references `baseFilters` (not the removed `priority`/`technicianId`).

- [ ] **Step 6: Typecheck and run the jobs-related tests**

```bash
cd /home/appuser/workspace/projects/repairOS/frontend
npx tsc --noEmit 2>&1 | grep "error TS" | grep -v "Can.test.tsx" || echo "OK no errors"
npx vitest run src/lib/repair src/components/repair/__tests__/JobFilterBar.test.tsx src/components/repair/__tests__/JobQuickFilters.test.tsx 2>&1 | tail -15
```
Expected: `OK no errors`; filter tests still PASS.

- [ ] **Step 7: Commit**

```bash
cd /home/appuser/workspace/projects/repairOS
git add "frontend/src/app/(app)/jobs/page.tsx"
git commit -m "feat(jobs): unify filters across kanban and list with panel + chips + presets

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Verification

- [ ] **Step 1: Backend repair suite**

```bash
cd /home/appuser/workspace/projects/repairOS/backend
python -m pytest apps/repair/tests/ --no-cov 2>&1 | tail -8
```
Expected: all PASS.

- [ ] **Step 2: Frontend Vitest + typecheck**

```bash
cd /home/appuser/workspace/projects/repairOS/frontend
npx vitest run 2>&1 | tail -15
npx tsc --noEmit 2>&1 | grep "error TS" | grep -v "Can.test.tsx" || echo "OK no errors"
```
Expected: all Phase 2 tests PASS; `OK no errors`. (A pre-existing, unrelated `src/lib/api/__tests__/crm.test.ts` failure may remain — note it, don't fix it here.)

- [ ] **Step 3: Manual smoke test**

1. Open `/jobs` (kanban). Type a customer name in search → columns narrow to matches; counts update.
2. Open **Filters** → set Status = On Hold, Payment = Unpaid, Device = "Laptop", a date range → chips appear; the Filters badge shows the count.
3. Switch to **list** → the same filters apply (status now narrows rows too).
4. Click chip "✕" → that filter clears; **Clear all** → all clear but the search text stays.
5. Quick filters: **Overdue** shows only past-due non-terminal jobs; **Due today** only today's expected deliveries; **Unpaid** matches the payment chip; **My jobs** filters to the logged-in technician. Each toggles off on second click.
6. Changing any filter resets the list to page 1.

- [ ] **Step 4: Push the branch**

```bash
cd /home/appuser/workspace/projects/repairOS
git push -u origin <branch>
```

---

## Self-Review Notes

- **Spec coverage (Part 1):** 2a → Task 1; 2b → Task 2; 2c (unified panel + chips, both views, replaces old selects) → Tasks 3/4/6; 2d (presets) → Tasks 3/5/6. 2e/2f/2g are Part 2 (separate plan).
- **Reconciliation:** draft backend block adopted (Task 1) and extended with `overdue`/`due_on`; draft's list-only frontend approach superseded by the unified, both-view panel.
- **Type consistency:** `JobFilterState` (Task 3) is consumed unchanged by `JobFilterBar`/`JobQuickFilters` (Tasks 4/5) and the page (Task 6); `toBaseApiFilters` excludes `status`, which the list adds explicitly and the kanban adds per column; new `JobFilters` keys (`device_type`, `payment_status`, `overdue`, `due_on`) match the backend query params from Task 1.
- **Open follow-ups (Part 2 / later):** device-type free-text could become a distinct-values dropdown; deep-links from the Repair Overview tiles can now target these filters once filter state is reflected in the URL (not done here — filters are in-memory).
