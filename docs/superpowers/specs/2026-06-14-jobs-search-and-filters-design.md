# Jobs Search Fix + Advanced Filters Design

**Date:** 2026-06-14  
**Status:** Approved

## Context

The Jobs page search field sends a `search` query param to the backend but the backend `JobTicketViewSet` ignores it — the param is never read in `get_queryset()`. Result: searching does nothing.

Additionally, the frontend only exposes Priority and Technician filters. The backend already supports `date_from`/`date_to` and `customer_id` but has no UI. Device type and payment status filters don't exist on either side yet.

This spec covers: fixing search, adding four new list-only filters (status, device type, payment status, date range), and the UI pattern for displaying them.

---

## Scope

- **List view only** — new filters narrow the paginated list table
- **Kanban view unaffected** — existing per-column status queries continue to use only `baseFilters` (search, priority, technician)
- Both backend and frontend changes required

---

## Backend Changes

**File:** `backend/apps/repair/views.py` — `JobTicketViewSet.get_queryset()`

### 1. Search (fix)

```python
from django.db.models import Q

search = self.request.query_params.get('search', '').strip()
if search:
    qs = qs.filter(
        Q(job_number__icontains=search) |
        Q(customer__name__icontains=search) |
        Q(customer__phone__icontains=search) |
        Q(device_imei__icontains=search) |
        Q(serial_number__icontains=search) |
        Q(problem_description__icontains=search)
    )
```

### 2. Device Type (new)

```python
device_type = self.request.query_params.get('device_type', '').strip()
if device_type:
    qs = qs.filter(device_type__iexact=device_type)
```

### 3. Payment Status (new)

```python
from django.db.models import DecimalField, ExpressionWrapper, F

payment_status = self.request.query_params.get('payment_status', '').strip()
if payment_status in ('paid', 'partial', 'unpaid'):
    qs = qs.annotate(
        _balance=ExpressionWrapper(
            F('service_charge') - F('advance_paid'),
            output_field=DecimalField()
        )
    )
    if payment_status == 'paid':
        qs = qs.filter(_balance__lte=0)
    elif payment_status == 'unpaid':
        qs = qs.filter(advance_paid=0, service_charge__gt=0)
    elif payment_status == 'partial':
        qs = qs.filter(advance_paid__gt=0, _balance__gt=0)
```

> `date_from`, `date_to`, and `status` are already handled — no backend changes needed for those.

---

## Frontend Changes

### `frontend/src/lib/api/repair.ts`

Add to `JobFilters` interface:

```typescript
device_type?: string;
payment_status?: 'paid' | 'partial' | 'unpaid';
```

(`status`, `date_from`, `date_to` already exist in `JobFilters`.)

---

### `frontend/src/app/(app)/jobs/page.tsx`

#### New state variables

```typescript
const [filterOpen, setFilterOpen]       = useState(false);
const [statusFilter, setStatusFilter]   = useState<JobStatus | 'all'>('all');
const [deviceType, setDeviceType]       = useState<string>('all');
const [paymentStatus, setPaymentStatus] = useState<'all' | 'paid' | 'partial' | 'unpaid'>('all');
const [dateFrom, setDateFrom]           = useState('');
const [dateTo, setDateTo]               = useState('');
```

#### Two-tier filter architecture

`baseFilters` (unchanged — shared by kanban + list):
```typescript
const baseFilters = useMemo(() => ({
  shop_id: ...,
  search: debouncedSearch || undefined,
  priority: priority === 'all' ? undefined : priority,
  technician_id: technicianId === 'all' ? undefined : technicianId,
}), [...]);
```

`listFilters` (list view only — extends baseFilters):
```typescript
const listFilters = useMemo(() => ({
  ...baseFilters,
  status:         statusFilter === 'all'    ? undefined : statusFilter,
  device_type:    deviceType   === 'all'    ? undefined : deviceType,
  payment_status: paymentStatus === 'all'   ? undefined : paymentStatus as 'paid' | 'partial' | 'unpaid' | undefined,
  date_from:      dateFrom || undefined,
  date_to:        dateTo   || undefined,
}), [baseFilters, statusFilter, deviceType, paymentStatus, dateFrom, dateTo]);
```

List query switches from `baseFilters` to `listFilters`:
```typescript
const listQuery = useQuery({
  queryKey: qk.jobs({ ...listFilters, cursor: listCursor }),
  queryFn:  () => repairApi.listJobs({ ...listFilters, cursor: listCursor }),
  ...
  enabled: view === 'list',
});
```

Cursor reset extended to cover all list filters:
```typescript
React.useEffect(() => {
  setListCursor(undefined);
}, [debouncedSearch, priority, technicianId, statusFilter, deviceType, paymentStatus, dateFrom, dateTo]);
```

#### Active filter count badge

```typescript
const activeListFilterCount = [
  statusFilter  !== 'all',
  deviceType    !== 'all',
  paymentStatus !== 'all',
  !!dateFrom,
  !!dateTo,
].filter(Boolean).length;
```

#### "Filters" button in top bar (list view only)

Shown between the technician select and the view toggle:

```tsx
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
    Filters
    {activeListFilterCount > 0 && (
      <span className="h-4 w-4 rounded-full bg-[var(--accent)] text-white text-[10px] flex items-center justify-center">
        {activeListFilterCount}
      </span>
    )}
  </button>
)}
```

#### Expandable filter row

Between the top bar and the table/board, rendered only when `view === 'list'`:

```tsx
<div className={cn(
  'overflow-hidden transition-all duration-200',
  filterOpen ? 'max-h-[56px]' : 'max-h-0',
)}>
  <div className="flex items-center gap-2 px-4 py-2 border-b border-[var(--border)] bg-[var(--surface-2)] flex-wrap">
    {/* Status select */}
    {/* Device type select */}
    {/* Payment status select */}
    {/* Date from input type="date" */}
    {/* Date to input type="date" */}
    {/* Clear all button — only when activeListFilterCount > 0 */}
  </div>
</div>
```

**Status options:** All, Open, In Progress, On Hold, Ready for QC, Ready for Pickup, Delivered, Cancelled, Closed

**Device type options (static):** All, Smartphone, Feature Phone, Tablet, Laptop, Desktop, Smartwatch, Earbuds, Other

**Payment status options:** All, Paid, Partial, Unpaid

---

## Data Flow Summary

```
User types search / sets list filter
        ↓
debouncedSearch / filter state updates
        ↓
listFilters memo recomputes          baseFilters memo recomputes
        ↓                                    ↓
listQuery re-fetches (list view)     columnQueries re-fetch (kanban view)
        ↓
listCursor reset → always page 1
```

---

## Testing

1. Backend: `pytest backend/apps/repair/tests/` — add test cases:
   - `search=john` returns jobs where customer name contains "john"
   - `search=JOB-001` returns that job number
   - `device_type=Laptop` returns only laptop jobs
   - `payment_status=unpaid` returns only jobs with advance_paid=0
   - `payment_status=paid` returns only fully paid jobs
   - `payment_status=partial` returns only partially paid jobs

2. Frontend: navigate to `/jobs` → list view → type in search → results filter
3. Open filter row → set Status = "On Hold" → only on-hold jobs shown
4. Clear all → all filters reset, full list returns
5. Kanban view: search still filters kanban columns; list-only filters have no effect on kanban
