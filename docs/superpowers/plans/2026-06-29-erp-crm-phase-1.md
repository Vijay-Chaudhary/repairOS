# ERP/CRM Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the four Phase-1 "quick wins" from the approved spec — fix the Reports permission-slug drift, add Billing › Outstanding, add Accounts › Cash Book, and add a Settings › Taxes (`TaxRate`) master + CRUD — all on existing data/infra.

**Architecture:** Three thin read endpoints + one small CRUD model, each mirroring the existing billing/finance/reports view patterns (`APIView` + `require_permission` + `_shop_ids_from_token` + logic in `services.py`). Frontend pages mirror the existing React-Query + (for Taxes) react-hook-form/zod CRUD pattern. The Reports fix is frontend-only.

**Tech Stack:** Django 4.2 + DRF, pytest; Next.js 14 App Router + TypeScript strict, React Query, Tailwind, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-29-erp-crm-phase-1-design.md`

---

## File Structure

**Reports fix (FE only)**
- Modify: `frontend/src/lib/api/reports.ts` — per-report `permission` + `MODULE_PERMISSIONS`.
- Modify: `frontend/src/app/(app)/reports/page.tsx` — `MODULE_PERMISSIONS` (mirror).
- Create: `frontend/src/lib/api/__tests__/reports.catalogue.test.ts` — permission guard.

**Outstanding**
- Modify: `backend/apps/billing/services.py` — aging helper + queryset/summary builders.
- Modify: `backend/apps/billing/serializers.py` — `OutstandingInvoiceSerializer`.
- Modify: `backend/apps/billing/views.py` — `OutstandingView`.
- Modify: `backend/apps/billing/urls.py` — `outstanding/` route.
- Create: `backend/apps/billing/tests/test_outstanding.py`.
- Modify: `frontend/src/lib/api/billing.ts` — `getOutstanding` + types.
- Modify: `frontend/src/lib/query/keys.ts` — `outstanding` key.
- Modify: `frontend/src/app/(app)/billing/outstanding/page.tsx` — real page (replaces ComingSoon).

**Cash Book**
- Modify: `backend/apps/finance/services.py` — `build_cash_book`.
- Modify: `backend/apps/finance/serializers.py` — `CashBookEntrySerializer`.
- Modify: `backend/apps/finance/views.py` — `CashBookView`.
- Modify: `backend/apps/finance/urls.py` — `cash-book/` route.
- Create: `backend/apps/finance/tests/test_cash_book.py`.
- Modify: `frontend/src/lib/api/finance.ts` — `getCashBook` + types.
- Modify: `frontend/src/lib/query/keys.ts` — `cashBook` key.
- Modify: `frontend/src/app/(app)/finance/layout.tsx` — add Cash Book tab.
- Create: `frontend/src/app/(app)/finance/cash-book/page.tsx`.

**Taxes**
- Modify: `backend/apps/billing/models.py` — `TaxRate` model.
- Create: `backend/apps/billing/migrations/0003_taxrate.py` — schema + seed slabs.
- Modify: `backend/apps/billing/serializers.py` — `TaxRateSerializer`.
- Modify: `backend/apps/billing/services.py` — tax-rate CRUD helpers.
- Modify: `backend/apps/billing/views.py` — `TaxRateView`, `TaxRateDetailView`.
- Modify: `backend/apps/billing/urls.py` — `tax-rates/` routes.
- Create: `backend/apps/billing/tests/test_tax_rates.py`.
- Modify: `frontend/src/lib/api/billing.ts` — tax-rate client + types.
- Modify: `frontend/src/lib/query/keys.ts` — `taxRates` key.
- Create: `frontend/src/app/(app)/settings/taxes/page.tsx`.
- Modify: `frontend/src/app/(app)/settings/layout.tsx` + `.../settings/page.tsx` — Taxes entry.

**Build order:** Task 1 (Reports) → Tasks 2-3 (Outstanding) → Tasks 4-5 (Cash Book) → Tasks 6-7 (Taxes) → Task 8 (verification). Each task ends in a commit.

> **Reference patterns to copy (read before starting):**
> - Billing view + `_shop_ids_from_token`: `backend/apps/billing/views.py:33-80`.
> - Finance view + `_shop_ids_from_token` (returns `(shop_ids, is_wide)`): `backend/apps/finance/views.py:35-95`.
> - Reports shop scoping: `backend/apps/reports/views.py:26-50`.
> - Settings CRUD page (rhf+zod+Dialog): `frontend/src/app/(app)/settings/commission-rules/page.tsx`.
> - Finance api client: `frontend/src/lib/api/finance.ts`.
> - pytest fixtures (`shop`, `customer_intra`): `backend/apps/billing/tests/test_billing.py:30-60`.

---

## Task 1: Reports permission-slug drift fix (frontend-only)

**Files:**
- Create: `frontend/src/lib/api/__tests__/reports.catalogue.test.ts`
- Modify: `frontend/src/lib/api/reports.ts`
- Modify: `frontend/src/app/(app)/reports/page.tsx`

- [ ] **Step 1: Write the failing guard test**

Create `frontend/src/lib/api/__tests__/reports.catalogue.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { REPORT_CATALOGUE } from '../reports';

// The six report permission slugs the backend ReportView actually enforces
// (apps/reports/views.py: perm = f"reports.{group}.view", group ∈ these).
const ENFORCED = new Set([
  'reports.revenue.view',
  'reports.inventory.view',
  'reports.repair.view',
  'reports.hr.view',
  'reports.crm.view',
  'reports.amc.view',
]);

describe('REPORT_CATALOGUE permissions', () => {
  it('every report gates on a backend-enforced reports.<group>.view slug', () => {
    const bad = REPORT_CATALOGUE.filter((r) => !ENFORCED.has(r.permission));
    expect(bad.map((r) => `${r.type}:${r.permission}`)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `frontend/`): `npx vitest run src/lib/api/__tests__/reports.catalogue.test.ts`
Expected: FAIL — entries listing `...:reports.billing.view` and `...:reports.erp.view`.

- [ ] **Step 3: Re-point each catalogue `permission` to its backend group slug**

In `frontend/src/lib/api/reports.ts`, set every `REPORT_CATALOGUE` entry's `permission` per this mapping (backend `REPORT_REGISTRY` group → `reports.<group>.view`):

- `reports.revenue.view`: `revenue-summary`, `outstanding-dues-repair`, `payment-collection-log`, `pl-summary`, `gstr-1`, `gstr-2`
- `reports.inventory.view`: `outstanding-dues-wholesale`, `inventory-valuation`, `stock-movement-ledger`, `supplier-payable`, `purchase-summary`, `expense-by-category`, `budget-vs-actual`
- `reports.repair.view`: `job-status-summary`, `job-turnaround-time`, `warranty-claims`, `fault-template-usage`, `technician-performance`
- `reports.hr.view`: `commission-ledger`, `hr-attendance-summary`, `salary-register`, `petty-cash-summary`
- `reports.crm.view`: `lead-conversion`, `customer-acquisition`, `customer-lifetime-value`
- `reports.amc.view`: `amc-contract-summary`, `amc-visit-compliance`, `amc-revenue`

For example, the Billing-module rows become:

```typescript
  { type: 'revenue-summary',            label: 'Revenue Summary',              module: 'Billing', permission: 'reports.revenue.view',   filters: ['date_range', 'shop'],                  exports: ['pdf', 'csv'] },
  { type: 'outstanding-dues-repair',    label: 'Outstanding Dues (Repair)',    module: 'Billing', permission: 'reports.revenue.view',   filters: ['overdue_days', 'shop'],               exports: ['pdf', 'csv'] },
  { type: 'outstanding-dues-wholesale', label: 'Outstanding Dues (Wholesale)', module: 'Billing', permission: 'reports.inventory.view', filters: ['overdue_days', 'shop'],               exports: ['pdf', 'csv'] },
  { type: 'payment-collection-log',     label: 'Payment Collection Log',       module: 'Billing', permission: 'reports.revenue.view',   filters: ['date_range', 'shop'],                  exports: ['csv'] },
  { type: 'pl-summary',                 label: 'P&L Summary',                  module: 'Billing', permission: 'reports.revenue.view',   filters: ['month_year', 'shop'],                  exports: ['pdf'] },
  { type: 'gstr-1',                     label: 'GSTR-1 (Outward Supplies)',    module: 'Billing', permission: 'reports.revenue.view',   filters: ['month_year', 'shop'],                  exports: ['csv'] },
  { type: 'gstr-2',                     label: 'GSTR-2 Proxy (Inward)',        module: 'Billing', permission: 'reports.revenue.view',   filters: ['month_year', 'shop'],                  exports: ['csv'] },
```

Apply the same `permission` change to every other module's rows per the mapping above (only the `permission` value changes; leave `type`/`label`/`module`/`filters`/`exports` untouched).

- [ ] **Step 4: Fix `MODULE_PERMISSIONS` in both files**

In **`frontend/src/lib/api/reports.ts`** — if a `MODULE_PERMISSIONS` map exists there, and in **`frontend/src/app/(app)/reports/page.tsx`**, replace the map with the `anyOf` sets derived from the per-report slugs:

```typescript
const MODULE_PERMISSIONS: Record<ReportModule, string[]> = {
  Billing: ['reports.revenue.view', 'reports.inventory.view'],
  Repair:  ['reports.repair.view', 'reports.hr.view'],
  CRM:     ['reports.crm.view'],
  AMC:     ['reports.amc.view'],
  ERP:     ['reports.inventory.view'],
  HR:      ['reports.hr.view'],
};
```

- [ ] **Step 5: Run the guard test + typecheck**

Run (from `frontend/`):
```bash
npx vitest run src/lib/api/__tests__/reports.catalogue.test.ts
npx tsc --noEmit
```
Expected: test PASS; tsc exit 0.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/api/reports.ts frontend/src/app/\(app\)/reports/page.tsx frontend/src/lib/api/__tests__/reports.catalogue.test.ts
git commit -m "fix(reports): align FE report permissions to backend-enforced reports.<group>.view slugs"
```

---

## Task 2: Billing › Outstanding — backend

**Files:**
- Modify: `backend/apps/billing/services.py`
- Modify: `backend/apps/billing/serializers.py`
- Modify: `backend/apps/billing/views.py`
- Modify: `backend/apps/billing/urls.py`
- Test: `backend/apps/billing/tests/test_outstanding.py`

- [ ] **Step 1: Write the failing test**

Create `backend/apps/billing/tests/test_outstanding.py`:

```python
"""Billing › Outstanding — aging report over RepairInvoice with amount_outstanding > 0."""
from datetime import timedelta
from decimal import Decimal

import pytest
from django.utils import timezone
from rest_framework import status


@pytest.fixture
def shop(db):
    from core.models import Shop
    return Shop.objects.create(
        name="Hotspot Repair", code="HTA", address="MG Road",
        city="Delhi", state="Delhi", state_code="07", phone="+919876543210",
    )


@pytest.fixture
def customer(db, shop):
    from crm.models import Customer
    return Customer.objects.create(shop=shop, name="Asha", phone="+919811111111")


def _invoice(shop, customer, *, number, outstanding, due_offset_days, status_val="partially_paid"):
    from billing.models import RepairInvoice
    today = timezone.now().date()
    return RepairInvoice.objects.create(
        shop=shop, customer=customer, invoice_number=number, status=status_val,
        subtotal=Decimal("1000"), grand_total=Decimal("1000"),
        amount_paid=Decimal("1000") - Decimal(outstanding),
        amount_outstanding=Decimal(outstanding),
        due_date=today + timedelta(days=due_offset_days),
    )


@pytest.mark.django_db
def test_outstanding_lists_only_unpaid_with_aging(shop, customer, auth_client_factory):
    # 3 invoices: not-due (current), 15 days overdue (1-30), 75 days overdue (61-90)
    _invoice(shop, customer, number="INV-1", outstanding="200", due_offset_days=10)
    _invoice(shop, customer, number="INV-2", outstanding="300", due_offset_days=-15)
    _invoice(shop, customer, number="INV-3", outstanding="500", due_offset_days=-75)
    # paid invoice must be excluded
    _invoice(shop, customer, number="INV-4", outstanding="0", due_offset_days=-5, status_val="paid")

    client = auth_client_factory(shop, ["billing.outstanding.view"])
    resp = client.get("/api/v1/billing/outstanding/")
    assert resp.status_code == status.HTTP_200_OK
    body = resp.json()
    assert body["summary"]["invoice_count"] == 3
    assert Decimal(body["summary"]["total_outstanding"]) == Decimal("1000")
    assert Decimal(body["summary"]["buckets"]["current"]) == Decimal("200")
    assert Decimal(body["summary"]["buckets"]["1-30"]) == Decimal("300")
    assert Decimal(body["summary"]["buckets"]["61-90"]) == Decimal("500")
    numbers = {r["invoice_number"] for r in body["results"]}
    assert numbers == {"INV-1", "INV-2", "INV-3"}


@pytest.mark.django_db
def test_outstanding_requires_permission(shop, customer, auth_client_factory):
    client = auth_client_factory(shop, [])  # no perms
    resp = client.get("/api/v1/billing/outstanding/")
    assert resp.status_code == status.HTTP_403_FORBIDDEN
```

> **Plan-time check:** confirm the auth-client fixture name/signature used by existing billing
> tests (`backend/apps/billing/tests/test_billing.py` / `conftest.py`). If it differs from
> `auth_client_factory(shop, perms)`, adapt these two tests to the existing fixture (issue a JWT
> whose `permissions` claim contains `billing.outstanding.view`). Do not invent a new auth scheme.

- [ ] **Step 2: Run the test to verify it fails**

Run (from `backend/`): `python -m pytest apps/billing/tests/test_outstanding.py -p no:cacheprovider -o addopts="" -q`
Expected: FAIL — 404 (route not defined) / endpoint missing.

- [ ] **Step 3: Add the aging helper + builders to `services.py`**

Append to `backend/apps/billing/services.py`:

```python
from datetime import date as _date, timedelta
from decimal import Decimal

from django.utils import timezone

from .models import RepairInvoice

OUTSTANDING_BUCKETS = ["current", "1-30", "31-60", "61-90", "90+"]


def aging_bucket(due_date, today: _date) -> tuple[str, int]:
    """Return (bucket_label, days_overdue) for an invoice due_date relative to today."""
    if due_date is None or due_date >= today:
        return "current", 0
    days = (today - due_date).days
    if days <= 30:
        return "1-30", days
    if days <= 60:
        return "31-60", days
    if days <= 90:
        return "61-90", days
    return "90+", days


def outstanding_queryset(shop_ids, *, overdue_days: int = 0, customer_id: str | None = None):
    """Repair invoices with money still due, optionally shop/customer/overdue filtered."""
    qs = (
        RepairInvoice.objects.select_related("customer", "shop")
        .filter(
            status__in=[RepairInvoice.Status.ISSUED, RepairInvoice.Status.PARTIALLY_PAID],
            amount_outstanding__gt=0,
        )
        .order_by("due_date", "created_at")
    )
    if shop_ids is not None:
        qs = qs.filter(shop_id__in=shop_ids)
    if customer_id:
        qs = qs.filter(customer_id=customer_id)
    if overdue_days and overdue_days > 0:
        cutoff = timezone.now().date() - timedelta(days=overdue_days)
        qs = qs.filter(due_date__lte=cutoff)
    return qs


def outstanding_summary(queryset) -> dict:
    """One-pass aging summary over an outstanding queryset."""
    today = timezone.now().date()
    buckets = {b: Decimal("0") for b in OUTSTANDING_BUCKETS}
    total = Decimal("0")
    count = 0
    for inv in queryset:
        bucket, _ = aging_bucket(inv.due_date, today)
        buckets[bucket] += inv.amount_outstanding
        total += inv.amount_outstanding
        count += 1
    return {
        "total_outstanding": str(total),
        "invoice_count": count,
        "buckets": {k: str(v) for k, v in buckets.items()},
    }
```

> Note: `RepairInvoice.Status` values are `issued` / `partially_paid` / `paid` / `draft`
> (`apps/billing/models.py:11-15`). Only ISSUED + PARTIALLY_PAID carry outstanding balances.

- [ ] **Step 4: Add the row serializer**

Append to `backend/apps/billing/serializers.py`:

```python
from django.utils import timezone

from .services import aging_bucket


class OutstandingInvoiceSerializer(serializers.ModelSerializer):
    customer_name = serializers.CharField(source="customer.name", read_only=True)
    customer_phone = serializers.CharField(source="customer.phone", read_only=True)
    days_overdue = serializers.SerializerMethodField()
    bucket = serializers.SerializerMethodField()

    class Meta:
        model = RepairInvoice
        fields = [
            "id", "invoice_number", "status", "customer_name", "customer_phone",
            "grand_total", "amount_paid", "amount_outstanding", "due_date",
            "days_overdue", "bucket",
        ]

    def _aging(self, obj) -> tuple[str, int]:
        return aging_bucket(obj.due_date, timezone.now().date())

    def get_days_overdue(self, obj) -> int:
        return self._aging(obj)[1]

    def get_bucket(self, obj) -> str:
        return self._aging(obj)[0]
```

- [ ] **Step 5: Add the view**

Append to `backend/apps/billing/views.py` (uses the existing module-level `_shop_ids_from_token`):

```python
from .serializers import OutstandingInvoiceSerializer  # add to existing serializer imports


class OutstandingView(APIView):
    permission_classes = [IsAuthenticated, require_permission("billing.outstanding.view")]

    def get(self, request: Request) -> Response:
        token = getattr(request, "auth", None)
        shop_ids = _shop_ids_from_token(token)
        if qp_shop := request.query_params.get("shop_id"):
            shop_ids = [qp_shop]

        try:
            overdue_days = int(request.query_params.get("overdue_days", 0))
        except ValueError:
            overdue_days = 0
        customer_id = request.query_params.get("customer_id")

        qs = services.outstanding_queryset(
            shop_ids, overdue_days=overdue_days, customer_id=customer_id
        )
        rows = list(qs)
        return Response({
            "summary": services.outstanding_summary(rows),
            "results": OutstandingInvoiceSerializer(rows, many=True).data,
        })
```

> `OutstandingInvoiceSerializer` is imported at module top alongside the other billing
> serializers. `services` and `require_permission` are already imported in `views.py`.

- [ ] **Step 6: Register the route**

In `backend/apps/billing/urls.py`, add inside `urlpatterns` (before the `payments/` lines is fine):

```python
    path("outstanding/", views.OutstandingView.as_view(), name="outstanding"),
```

- [ ] **Step 7: Run the tests to verify they pass**

Run (from `backend/`): `python -m pytest apps/billing/tests/test_outstanding.py -p no:cacheprovider -o addopts="" -q`
Expected: PASS (2 tests).

- [ ] **Step 8: Commit**

```bash
git add backend/apps/billing/services.py backend/apps/billing/serializers.py backend/apps/billing/views.py backend/apps/billing/urls.py backend/apps/billing/tests/test_outstanding.py
git commit -m "feat(billing): GET /billing/outstanding aging report over repair invoices"
```

---

## Task 3: Billing › Outstanding — frontend

**Files:**
- Modify: `frontend/src/lib/api/billing.ts`
- Modify: `frontend/src/lib/query/keys.ts`
- Modify: `frontend/src/app/(app)/billing/outstanding/page.tsx`

- [ ] **Step 1: Add the API client + types**

In `frontend/src/lib/api/billing.ts`, add the types and a client method (mirror the existing `apiGet` usage in that file):

```typescript
export type AgingBucket = 'current' | '1-30' | '31-60' | '61-90' | '90+';

export interface OutstandingInvoice {
  id: string;
  invoice_number: string;
  status: string;
  customer_name: string;
  customer_phone: string;
  grand_total: string;
  amount_paid: string;
  amount_outstanding: string;
  due_date: string | null;
  days_overdue: number;
  bucket: AgingBucket;
}

export interface OutstandingReport {
  summary: {
    total_outstanding: string;
    invoice_count: number;
    buckets: Record<AgingBucket, string>;
  };
  results: OutstandingInvoice[];
}

// add to the existing exported `billingApi` object:
//   getOutstanding: (params?: { shop_id?: string; overdue_days?: number; customer_id?: string }) =>
//     apiGet<OutstandingReport>('/billing/outstanding/', params),
```

> Use the exact `apiGet` signature already used in `billing.ts` (it imports from `./client`).
> If `apiGet` does not accept a params object in this codebase, build the query string the same
> way other methods in the file do.

- [ ] **Step 2: Add the query key**

In `frontend/src/lib/query/keys.ts`, inside the `qk` object, add:

```typescript
  outstanding: (params?: Record<string, unknown>) => ['billing', 'outstanding', params ?? {}] as const,
```

- [ ] **Step 3: Replace the ComingSoon stub with the real page**

Replace `frontend/src/app/(app)/billing/outstanding/page.tsx` with:

```tsx
'use client';

import { useQuery } from '@tanstack/react-query';
import { billingApi, type AgingBucket } from '@/lib/api/billing';
import { qk } from '@/lib/query/keys';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/EmptyState';
import { formatDate } from '@/lib/format/date';

const BUCKETS: AgingBucket[] = ['current', '1-30', '31-60', '61-90', '90+'];
const BUCKET_LABELS: Record<AgingBucket, string> = {
  current: 'Current', '1-30': '1–30d', '31-60': '31–60d', '61-90': '61–90d', '90+': '90d+',
};
const inr = (v: string) => `₹${Number(v).toLocaleString('en-IN')}`;

export default function OutstandingPage() {
  const { data, isLoading } = useQuery({
    queryKey: qk.outstanding(),
    queryFn: () => billingApi.getOutstanding(),
    staleTime: 60_000,
  });

  if (isLoading) return <div className="p-4 md:p-6"><Skeleton className="h-40 w-full" /></div>;

  const summary = data?.summary;
  const rows = data?.results ?? [];

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-h1 text-[var(--text)]">Outstanding</h1>
        <p className="text-body-sm text-[var(--text-muted)] mt-1">
          {summary?.invoice_count ?? 0} unpaid invoice{(summary?.invoice_count ?? 0) === 1 ? '' : 's'}
          {summary ? ` · ${inr(summary.total_outstanding)} due` : ''}
        </p>
      </div>

      {/* Aging strip */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {BUCKETS.map((b) => (
          <div key={b} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
            <p className="text-xs text-[var(--text-muted)]">{BUCKET_LABELS[b]}</p>
            <p className="text-body font-semibold text-[var(--text)] mt-1">
              {summary ? inr(summary.buckets[b]) : '—'}
            </p>
          </div>
        ))}
      </div>

      {rows.length === 0 ? (
        <EmptyState title="Nothing outstanding" description="All invoices are fully paid." />
      ) : (
        <div className="rounded-lg border border-[var(--border)] overflow-x-auto">
          <table className="w-full text-body-sm">
            <thead className="bg-[var(--surface-2)] text-[var(--text-muted)]">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Invoice</th>
                <th className="text-left px-4 py-2 font-medium">Customer</th>
                <th className="text-right px-4 py-2 font-medium">Total</th>
                <th className="text-right px-4 py-2 font-medium">Outstanding</th>
                <th className="text-left px-4 py-2 font-medium">Due</th>
                <th className="text-right px-4 py-2 font-medium">Overdue</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {rows.map((r) => (
                <tr key={r.id} className="bg-[var(--surface)]">
                  <td className="px-4 py-2 font-medium text-[var(--text)]">{r.invoice_number}</td>
                  <td className="px-4 py-2 text-[var(--text)]">{r.customer_name}</td>
                  <td className="px-4 py-2 text-right">{inr(r.grand_total)}</td>
                  <td className="px-4 py-2 text-right font-medium text-[var(--danger)]">{inr(r.amount_outstanding)}</td>
                  <td className="px-4 py-2">{r.due_date ? formatDate(r.due_date) : '—'}</td>
                  <td className="px-4 py-2 text-right">{r.days_overdue > 0 ? `${r.days_overdue}d` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
```

> If `EmptyState` or `formatDate` import paths differ, match the imports used in
> `frontend/src/app/(app)/settings/commission-rules/page.tsx` and other billing pages.

- [ ] **Step 2.5: Typecheck + test**

Run (from `frontend/`):
```bash
npx tsc --noEmit
npx vitest run
```
Expected: tsc exit 0; existing tests still pass.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/api/billing.ts frontend/src/lib/query/keys.ts frontend/src/app/\(app\)/billing/outstanding/page.tsx
git commit -m "feat(billing): Outstanding aging page (replaces ComingSoon stub)"
```

---

## Task 4: Accounts › Cash Book — backend

**Files:**
- Modify: `backend/apps/finance/services.py`
- Modify: `backend/apps/finance/serializers.py`
- Modify: `backend/apps/finance/views.py`
- Modify: `backend/apps/finance/urls.py`
- Test: `backend/apps/finance/tests/test_cash_book.py`

- [ ] **Step 1: Write the failing test**

Create `backend/apps/finance/tests/test_cash_book.py`:

```python
"""Accounts › Cash Book — read-only running ledger over PettyCashTransaction."""
from datetime import date
from decimal import Decimal

import pytest
from rest_framework import status


@pytest.fixture
def shop(db):
    from core.models import Shop
    return Shop.objects.create(
        name="Hotspot Repair", code="HTA", address="MG Road",
        city="Delhi", state="Delhi", state_code="07", phone="+919876543210",
    )


@pytest.fixture
def account(db, shop):
    from finance.models import PettyCashAccount
    return PettyCashAccount.objects.create(shop=shop, name="Petty Cash", current_balance=Decimal("0"))


def _txn(account, *, txn_type, amount, on, balance_after):
    from finance.models import PettyCashTransaction
    return PettyCashTransaction.objects.create(
        account=account, txn_type=txn_type, amount=Decimal(amount),
        date=on, balance_after=Decimal(balance_after),
    )


@pytest.mark.django_db
def test_cash_book_opening_closing_and_rows(shop, account, auth_client_factory):
    # Before the window: credit 1000 → balance 1000 (this is the opening balance)
    _txn(account, txn_type="credit", amount="1000", on=date(2026, 6, 1), balance_after="1000")
    # In window: debit 300 → 700, credit 200 → 900
    _txn(account, txn_type="debit", amount="300", on=date(2026, 6, 10), balance_after="700")
    _txn(account, txn_type="credit", amount="200", on=date(2026, 6, 12), balance_after="900")

    client = auth_client_factory(shop, ["accounts.cashbook.view"])
    resp = client.get("/api/v1/finance/cash-book/?date_from=2026-06-05&date_to=2026-06-30")
    assert resp.status_code == status.HTTP_200_OK
    body = resp.json()
    assert Decimal(body["opening_balance"]) == Decimal("1000")
    assert Decimal(body["closing_balance"]) == Decimal("900")
    assert Decimal(body["total_credit"]) == Decimal("200")
    assert Decimal(body["total_debit"]) == Decimal("300")
    assert len(body["results"]) == 2


@pytest.mark.django_db
def test_cash_book_requires_permission(shop, account, auth_client_factory):
    client = auth_client_factory(shop, [])
    resp = client.get("/api/v1/finance/cash-book/")
    assert resp.status_code == status.HTTP_403_FORBIDDEN
```

> **Plan-time check:** same auth-fixture confirmation as Task 2 Step 1 — adapt
> `auth_client_factory(shop, perms)` to the project's actual fixture if named differently.

- [ ] **Step 2: Run the test to verify it fails**

Run (from `backend/`): `python -m pytest apps/finance/tests/test_cash_book.py -p no:cacheprovider -o addopts="" -q`
Expected: FAIL — 404 / endpoint missing.

- [ ] **Step 3: Add the builder to `services.py`**

Append to `backend/apps/finance/services.py`:

```python
from datetime import date as _date
from decimal import Decimal

from .models import PettyCashAccount, PettyCashTransaction


def build_cash_book(shop_ids, *, date_from: _date | None, date_to: _date | None,
                    account_id: str | None = None) -> dict:
    """Running cash ledger over petty-cash transactions for the in-scope accounts."""
    accounts = PettyCashAccount.objects.all()
    if shop_ids is not None:
        accounts = accounts.filter(shop_id__in=shop_ids)
    if account_id:
        accounts = accounts.filter(id=account_id)
    account_ids = list(accounts.values_list("id", flat=True))

    txns = (
        PettyCashTransaction.objects.select_related("account", "recorded_by")
        .filter(account_id__in=account_ids)
        .order_by("date", "created_at")
    )

    # Opening balance = sum over accounts of the latest balance_after strictly before date_from.
    opening = Decimal("0")
    if date_from is not None:
        for aid in account_ids:
            last = (
                PettyCashTransaction.objects.filter(account_id=aid, date__lt=date_from)
                .order_by("date", "created_at")
                .last()
            )
            if last is not None:
                opening += last.balance_after
        txns = txns.filter(date__gte=date_from)
    if date_to is not None:
        txns = txns.filter(date__lte=date_to)

    rows = list(txns)
    total_credit = sum((t.amount for t in rows if t.txn_type == PettyCashTransaction.TxnType.CREDIT), Decimal("0"))
    total_debit = sum((t.amount for t in rows if t.txn_type == PettyCashTransaction.TxnType.DEBIT), Decimal("0"))
    closing = opening + total_credit - total_debit
    return {
        "opening_balance": str(opening),
        "closing_balance": str(closing),
        "total_credit": str(total_credit),
        "total_debit": str(total_debit),
        "results": rows,  # serialized by the view
    }
```

- [ ] **Step 4: Add the row serializer**

Append to `backend/apps/finance/serializers.py`:

```python
class CashBookEntrySerializer(serializers.ModelSerializer):
    account_name = serializers.CharField(source="account.name", read_only=True)
    recorded_by_name = serializers.SerializerMethodField()

    class Meta:
        model = PettyCashTransaction
        fields = [
            "id", "account_name", "txn_type", "amount", "category",
            "description", "date", "balance_after", "recorded_by_name",
        ]

    def get_recorded_by_name(self, obj) -> str:
        return (obj.recorded_by.full_name or "") if obj.recorded_by else ""
```

> Ensure `PettyCashTransaction` is imported at the top of `finance/serializers.py` (it almost
> certainly already is — confirm and add if missing).

- [ ] **Step 5: Add the view**

Append to `backend/apps/finance/views.py` (mirror the existing `_shop_ids_from_token` → `(shop_ids, is_wide)` usage in that file):

```python
from datetime import date as _date

from .serializers import CashBookEntrySerializer  # add to existing serializer imports


def _parse_date(value):
    if not value:
        return None
    try:
        return _date.fromisoformat(value)
    except ValueError:
        return None


class CashBookView(APIView):
    permission_classes = [IsAuthenticated, require_permission("accounts.cashbook.view")]

    def get(self, request: Request) -> Response:
        shop_ids, is_wide = _shop_ids_from_token(request)
        scope = None if is_wide else shop_ids
        data = services.build_cash_book(
            scope,
            date_from=_parse_date(request.query_params.get("date_from")),
            date_to=_parse_date(request.query_params.get("date_to")),
            account_id=request.query_params.get("account_id"),
        )
        data["results"] = CashBookEntrySerializer(data["results"], many=True).data
        return Response(data)
```

> **Plan-time check:** read `finance/views.py:35-42` to confirm whether `_shop_ids_from_token`
> returns `(shop_ids, is_wide)` and what `is_wide` means; pass `None` as the scope when the user
> is tenant-wide (no shop filter), matching how the other finance views use it.

- [ ] **Step 6: Register the route**

In `backend/apps/finance/urls.py`, add inside `urlpatterns`:

```python
    path("cash-book/", views.CashBookView.as_view(), name="cash-book"),
```

- [ ] **Step 7: Run the tests to verify they pass**

Run (from `backend/`): `python -m pytest apps/finance/tests/test_cash_book.py -p no:cacheprovider -o addopts="" -q`
Expected: PASS (2 tests).

- [ ] **Step 8: Commit**

```bash
git add backend/apps/finance/services.py backend/apps/finance/serializers.py backend/apps/finance/views.py backend/apps/finance/urls.py backend/apps/finance/tests/test_cash_book.py
git commit -m "feat(finance): GET /finance/cash-book read-only petty-cash ledger"
```

---

## Task 5: Accounts › Cash Book — frontend

**Files:**
- Modify: `frontend/src/lib/api/finance.ts`
- Modify: `frontend/src/lib/query/keys.ts`
- Modify: `frontend/src/app/(app)/finance/layout.tsx`
- Create: `frontend/src/app/(app)/finance/cash-book/page.tsx`

- [ ] **Step 1: Add the API client + types**

In `frontend/src/lib/api/finance.ts`, add:

```typescript
export interface CashBookEntry {
  id: string;
  account_name: string;
  txn_type: PettyCashType;   // 'credit' | 'debit' (already defined in this file)
  amount: number;
  category: string;
  description: string;
  date: string;
  balance_after: number;
  recorded_by_name?: string | null;
}

export interface CashBook {
  opening_balance: string;
  closing_balance: string;
  total_credit: string;
  total_debit: string;
  results: CashBookEntry[];
}

// add to the existing exported finance api object:
//   getCashBook: (params?: { date_from?: string; date_to?: string; shop_id?: string; account_id?: string }) =>
//     apiGet<CashBook>('/finance/cash-book/', params),
```

- [ ] **Step 2: Add the query key**

In `frontend/src/lib/query/keys.ts`, inside `qk`, add:

```typescript
  cashBook: (params?: Record<string, unknown>) => ['finance', 'cash-book', params ?? {}] as const,
```

- [ ] **Step 3: Add the Cash Book tab to the finance layout**

In `frontend/src/app/(app)/finance/layout.tsx`, add to the `TABS` array (after `Petty Cash`):

```typescript
  { label: 'Cash Book',  href: '/finance/cash-book' },
```

- [ ] **Step 4: Create the page**

Create `frontend/src/app/(app)/finance/cash-book/page.tsx`:

```tsx
'use client';

import { useQuery } from '@tanstack/react-query';
import { financeApi, type CashBookEntry } from '@/lib/api/finance';
import { qk } from '@/lib/query/keys';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/EmptyState';
import { formatDate } from '@/lib/format/date';

const inr = (v: number | string) => `₹${Number(v).toLocaleString('en-IN')}`;

export default function CashBookPage() {
  const { data, isLoading } = useQuery({
    queryKey: qk.cashBook(),
    queryFn: () => financeApi.getCashBook(),
    staleTime: 60_000,
  });

  if (isLoading) return <div className="p-4 md:p-6"><Skeleton className="h-40 w-full" /></div>;

  const rows: CashBookEntry[] = data?.results ?? [];

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <h2 className="text-h2 text-[var(--text)]">Cash Book</h2>
        <div className="text-body-sm text-[var(--text-muted)]">
          Closing: <span className="font-semibold text-[var(--text)]">{inr(data?.closing_balance ?? '0')}</span>
        </div>
      </div>

      <div className="rounded-lg border border-[var(--border)] overflow-x-auto">
        <table className="w-full text-body-sm">
          <thead className="bg-[var(--surface-2)] text-[var(--text-muted)]">
            <tr>
              <th className="text-left px-4 py-2 font-medium">Date</th>
              <th className="text-left px-4 py-2 font-medium">Particulars</th>
              <th className="text-right px-4 py-2 font-medium">Debit</th>
              <th className="text-right px-4 py-2 font-medium">Credit</th>
              <th className="text-right px-4 py-2 font-medium">Balance</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            <tr className="bg-[var(--surface-2)]/40">
              <td className="px-4 py-2 text-[var(--text-muted)]" colSpan={4}>Opening balance</td>
              <td className="px-4 py-2 text-right font-medium">{inr(data?.opening_balance ?? '0')}</td>
            </tr>
            {rows.map((r) => (
              <tr key={r.id} className="bg-[var(--surface)]">
                <td className="px-4 py-2">{formatDate(r.date)}</td>
                <td className="px-4 py-2 text-[var(--text)]">{r.category || r.description || '—'}</td>
                <td className="px-4 py-2 text-right text-[var(--danger)]">
                  {r.txn_type === 'debit' ? inr(r.amount) : ''}
                </td>
                <td className="px-4 py-2 text-right text-[var(--success)]">
                  {r.txn_type === 'credit' ? inr(r.amount) : ''}
                </td>
                <td className="px-4 py-2 text-right font-medium">{inr(r.balance_after)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <div className="p-6"><EmptyState title="No cash movements" description="No petty-cash transactions in range." /></div>
        )}
      </div>
    </div>
  );
}
```

> Confirm the exported finance api object name (`financeApi` vs `financeApi`/`pettyCashApi`) in
> `finance.ts` and use it consistently for `getCashBook`.

- [ ] **Step 5: Typecheck + build-safety + test**

Run (from `frontend/`):
```bash
npx tsc --noEmit
npx vitest run
```
Expected: tsc exit 0; tests pass.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/api/finance.ts frontend/src/lib/query/keys.ts frontend/src/app/\(app\)/finance/layout.tsx frontend/src/app/\(app\)/finance/cash-book/page.tsx
git commit -m "feat(finance): Cash Book ledger tab under Accounts"
```

---

## Task 6: Settings › Taxes — backend (`TaxRate` model + CRUD)

**Files:**
- Modify: `backend/apps/billing/models.py`
- Create: `backend/apps/billing/migrations/0003_taxrate.py`
- Modify: `backend/apps/billing/serializers.py`
- Modify: `backend/apps/billing/services.py`
- Modify: `backend/apps/billing/views.py`
- Modify: `backend/apps/billing/urls.py`
- Test: `backend/apps/billing/tests/test_tax_rates.py`

- [ ] **Step 1: Write the failing test**

Create `backend/apps/billing/tests/test_tax_rates.py`:

```python
"""Settings › Taxes — TaxRate master CRUD, gated on settings.taxes.manage."""
from decimal import Decimal

import pytest
from rest_framework import status


@pytest.fixture
def shop(db):
    from core.models import Shop
    return Shop.objects.create(
        name="Hotspot Repair", code="HTA", address="MG Road",
        city="Delhi", state="Delhi", state_code="07", phone="+919876543210",
    )


@pytest.mark.django_db
def test_seeded_slabs_present(db):
    from billing.models import TaxRate
    names = set(TaxRate.objects.values_list("name", flat=True))
    assert {"GST 0%", "GST 5%", "GST 12%", "GST 18%", "GST 28%"} <= names


@pytest.mark.django_db
def test_create_list_update_deactivate(shop, auth_client_factory):
    client = auth_client_factory(shop, ["settings.taxes.manage"])

    # create
    resp = client.post("/api/v1/billing/tax-rates/", {
        "name": "GST 3% (gold)", "rate": "3.00", "tax_type": "gst",
    }, format="json")
    assert resp.status_code == status.HTTP_201_CREATED
    rate_id = resp.json()["id"]

    # list includes it
    resp = client.get("/api/v1/billing/tax-rates/")
    assert resp.status_code == status.HTTP_200_OK
    assert any(r["name"] == "GST 3% (gold)" for r in resp.json())

    # update
    resp = client.patch(f"/api/v1/billing/tax-rates/{rate_id}/", {"rate": "3.50"}, format="json")
    assert resp.status_code == status.HTTP_200_OK
    assert Decimal(resp.json()["rate"]) == Decimal("3.50")

    # deactivate (DELETE = soft deactivate)
    resp = client.delete(f"/api/v1/billing/tax-rates/{rate_id}/")
    assert resp.status_code == status.HTTP_204_NO_CONTENT
    from billing.models import TaxRate
    assert TaxRate.objects.get(id=rate_id).is_active is False


@pytest.mark.django_db
def test_rate_validation_and_permission(shop, auth_client_factory):
    # invalid rate rejected
    client = auth_client_factory(shop, ["settings.taxes.manage"])
    resp = client.post("/api/v1/billing/tax-rates/", {
        "name": "Bad", "rate": "150.00", "tax_type": "gst",
    }, format="json")
    assert resp.status_code == status.HTTP_400_BAD_REQUEST

    # no permission rejected
    nope = auth_client_factory(shop, [])
    assert nope.get("/api/v1/billing/tax-rates/").status_code == status.HTTP_403_FORBIDDEN
```

- [ ] **Step 2: Run the test to verify it fails**

Run (from `backend/`): `python -m pytest apps/billing/tests/test_tax_rates.py -p no:cacheprovider -o addopts="" -q`
Expected: FAIL — `ImportError`/`OperationalError` (no `TaxRate` model/table).

- [ ] **Step 3: Add the `TaxRate` model**

Append to `backend/apps/billing/models.py` (uses the already-imported `BaseModel`):

```python
class TaxRate(BaseModel):
    """GST tax-rate slab master (config). One row per named slab per tenant DB."""

    class TaxType(models.TextChoices):
        GST = "gst", "GST (CGST + SGST)"
        IGST = "igst", "IGST (inter-state)"
        EXEMPT = "exempt", "Exempt"

    name = models.CharField(max_length=50, unique=True)
    rate = models.DecimalField(max_digits=5, decimal_places=2)
    tax_type = models.CharField(max_length=10, choices=TaxType.choices, default=TaxType.GST)
    is_active = models.BooleanField(default=True)

    class Meta:
        app_label = "billing"
        db_table = "tax_rates"
        ordering = ["rate"]

    def __str__(self) -> str:
        return f"{self.name} ({self.rate}%)"
```

- [ ] **Step 4: Generate + edit the migration to seed slabs**

Run (from `backend/`): `python manage.py makemigrations billing`
Expected: creates `apps/billing/migrations/0003_taxrate.py` with `CreateModel`.

Then edit that migration to append a reversible data step that seeds the standard slabs:

```python
GST_SLABS = [("GST 0%", "0"), ("GST 5%", "5"), ("GST 12%", "12"), ("GST 18%", "18"), ("GST 28%", "28")]


def seed_slabs(apps, schema_editor):
    TaxRate = apps.get_model("billing", "TaxRate")
    for name, rate in GST_SLABS:
        TaxRate.objects.get_or_create(name=name, defaults={"rate": rate, "tax_type": "gst"})


def unseed_slabs(apps, schema_editor):
    TaxRate = apps.get_model("billing", "TaxRate")
    TaxRate.objects.filter(name__in=[n for n, _ in GST_SLABS]).delete()


# add to the migration's operations list, after migrations.CreateModel(...):
#     migrations.RunPython(seed_slabs, unseed_slabs),
```

> Multi-tenant note: migrations run per tenant DB at provisioning (and when applied to existing
> tenant DBs), so this seeds every tenant idempotently. Do **not** also seed in `master.services`.

- [ ] **Step 5: Add the serializer**

Append to `backend/apps/billing/serializers.py`:

```python
from .models import TaxRate  # add to existing model imports


class TaxRateSerializer(serializers.ModelSerializer):
    class Meta:
        model = TaxRate
        fields = ["id", "name", "rate", "tax_type", "is_active", "created_at"]
        read_only_fields = ["id", "created_at"]

    def validate_rate(self, value):
        if value < 0 or value > 100:
            raise serializers.ValidationError("Rate must be between 0 and 100.")
        return value
```

- [ ] **Step 6: Add CRUD helpers to `services.py`**

Append to `backend/apps/billing/services.py`:

```python
from .models import TaxRate


def list_tax_rates(*, active_only: bool = False):
    qs = TaxRate.objects.all().order_by("rate")
    return qs.filter(is_active=True) if active_only else qs


def deactivate_tax_rate(tax_rate: TaxRate) -> None:
    tax_rate.is_active = False
    tax_rate.save(update_fields=["is_active", "updated_at"])
```

> If `BaseModel` does not define `updated_at`, drop it from `update_fields` (use `tax_rate.save()`).
> Confirm against `core.models.BaseModel`.

- [ ] **Step 7: Add the views**

Append to `backend/apps/billing/views.py`:

```python
from .models import TaxRate  # add to existing model imports
from .serializers import TaxRateSerializer  # add to existing serializer imports


class TaxRateView(APIView):
    permission_classes = [IsAuthenticated, require_permission("settings.taxes.manage")]

    def get(self, request: Request) -> Response:
        active_only = request.query_params.get("is_active", "").lower() == "true"
        rates = services.list_tax_rates(active_only=active_only)
        return Response(TaxRateSerializer(rates, many=True).data)

    def post(self, request: Request) -> Response:
        ser = TaxRateSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        ser.save()
        return Response(ser.data, status=status.HTTP_201_CREATED)


class TaxRateDetailView(APIView):
    permission_classes = [IsAuthenticated, require_permission("settings.taxes.manage")]

    def _get(self, tax_rate_id) -> TaxRate:
        from django.shortcuts import get_object_or_404
        return get_object_or_404(TaxRate, id=tax_rate_id)

    def get(self, request: Request, tax_rate_id) -> Response:
        return Response(TaxRateSerializer(self._get(tax_rate_id)).data)

    def patch(self, request: Request, tax_rate_id) -> Response:
        ser = TaxRateSerializer(self._get(tax_rate_id), data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        ser.save()
        return Response(ser.data)

    def delete(self, request: Request, tax_rate_id) -> Response:
        services.deactivate_tax_rate(self._get(tax_rate_id))
        return Response(status=status.HTTP_204_NO_CONTENT)
```

> `status` is already imported in `views.py` (`from rest_framework import status`).

- [ ] **Step 8: Register the routes**

In `backend/apps/billing/urls.py`, add inside `urlpatterns`:

```python
    path("tax-rates/", views.TaxRateView.as_view(), name="tax-rates"),
    path("tax-rates/<uuid:tax_rate_id>/", views.TaxRateDetailView.as_view(), name="tax-rate-detail"),
```

- [ ] **Step 9: Run the tests to verify they pass**

Run (from `backend/`): `python -m pytest apps/billing/tests/test_tax_rates.py -p no:cacheprovider -o addopts="" -q`
Expected: PASS (4 tests).

- [ ] **Step 10: Commit**

```bash
git add backend/apps/billing/models.py backend/apps/billing/migrations/0003_taxrate.py backend/apps/billing/serializers.py backend/apps/billing/services.py backend/apps/billing/views.py backend/apps/billing/urls.py backend/apps/billing/tests/test_tax_rates.py
git commit -m "feat(billing): TaxRate slab master + CRUD (Settings › Taxes), seed GST slabs"
```

---

## Task 7: Settings › Taxes — frontend

**Files:**
- Modify: `frontend/src/lib/api/billing.ts`
- Modify: `frontend/src/lib/query/keys.ts`
- Modify: `frontend/src/app/(app)/settings/layout.tsx`
- Modify: `frontend/src/app/(app)/settings/page.tsx`
- Create: `frontend/src/app/(app)/settings/taxes/page.tsx`

- [ ] **Step 1: Add the API client + types**

In `frontend/src/lib/api/billing.ts`, add:

```typescript
export type TaxType = 'gst' | 'igst' | 'exempt';

export interface TaxRate {
  id: string;
  name: string;
  rate: string;
  tax_type: TaxType;
  is_active: boolean;
  created_at: string;
}

export interface TaxRateInput {
  name: string;
  rate: number;
  tax_type: TaxType;
}

// add to the exported `billingApi` object:
//   listTaxRates: () => apiGet<TaxRate[]>('/billing/tax-rates/'),
//   createTaxRate: (body: TaxRateInput) => apiPost<TaxRate>('/billing/tax-rates/', body),
//   updateTaxRate: (id: string, body: Partial<TaxRateInput> & { is_active?: boolean }) =>
//     apiPatch<TaxRate>(`/billing/tax-rates/${id}/`, body),
//   deactivateTaxRate: (id: string) => apiDelete<void>(`/billing/tax-rates/${id}/`),
```

> Use whatever delete helper `billing.ts` already imports from `./client` (`apiDelete` or
> equivalent). If none exists, follow the pattern other delete calls in the codebase use.

- [ ] **Step 2: Add the query key**

In `frontend/src/lib/query/keys.ts`, inside `qk`, add:

```typescript
  taxRates: () => ['billing', 'tax-rates'] as const,
```

- [ ] **Step 3: Register the Settings tab + redirect entry**

In `frontend/src/app/(app)/settings/layout.tsx`, add to the `TABS` array:

```typescript
  { label: 'Taxes',             href: '/settings/taxes',            permission: 'settings.taxes.manage' },
```

In `frontend/src/app/(app)/settings/page.tsx`, add to the `ORDERED` array:

```typescript
  { href: '/settings/taxes',            permission: 'settings.taxes.manage' },
```

- [ ] **Step 4: Create the page**

Create `frontend/src/app/(app)/settings/taxes/page.tsx` (mirrors `settings/commission-rules/page.tsx`):

```tsx
'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Skeleton } from '@/components/ui/skeleton';
import { billingApi, type TaxRate, type TaxType } from '@/lib/api/billing';
import { qk } from '@/lib/query/keys';
import { ApiError } from '@/lib/api/client';

const schema = z.object({
  name: z.string().min(2, 'Name required'),
  rate: z.number().min(0).max(100),
  tax_type: z.enum(['gst', 'igst', 'exempt']),
});
type FormValues = z.infer<typeof schema>;

const TYPE_LABELS: Record<TaxType, string> = { gst: 'GST', igst: 'IGST', exempt: 'Exempt' };

export default function TaxesPage() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: qk.taxRates(),
    queryFn: () => billingApi.listTaxRates(),
    staleTime: 300_000,
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', rate: 18, tax_type: 'gst' },
  });

  const createMutation = useMutation({
    mutationFn: (values: FormValues) => billingApi.createTaxRate(values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.taxRates() });
      setOpen(false);
      form.reset();
      toast.success('Tax rate added');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to add tax rate'),
  });

  const toggleMutation = useMutation({
    mutationFn: (rate: TaxRate) => billingApi.updateTaxRate(rate.id, { is_active: !rate.is_active }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.taxRates() }),
    onError: () => toast.error('Failed to update'),
  });

  const rates = data ?? [];

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-3xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-h2 text-[var(--text)]">Taxes</h2>
          <p className="text-body-sm text-[var(--text-muted)] mt-1">GST tax-rate slabs.</p>
        </div>
        <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" /> Add slab</Button>
      </div>

      {isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <div className="rounded-lg border border-[var(--border)] divide-y divide-[var(--border)]">
          {rates.map((r) => (
            <div key={r.id} className="flex items-center justify-between px-4 py-3 bg-[var(--surface)]">
              <div>
                <p className="text-body-sm font-medium text-[var(--text)]">{r.name}</p>
                <p className="text-xs text-[var(--text-muted)]">{Number(r.rate)}% · {TYPE_LABELS[r.tax_type]}</p>
              </div>
              <Switch checked={r.is_active} onCheckedChange={() => toggleMutation.mutate(r)} />
            </div>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add tax slab</DialogTitle></DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit((v) => createMutation.mutate(v))} className="space-y-4">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem><FormLabel>Name</FormLabel><FormControl><Input placeholder="GST 18%" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="rate" render={({ field }) => (
                <FormItem><FormLabel>Rate (%)</FormLabel><FormControl>
                  <Input type="number" step="0.01" {...field} onChange={(e) => field.onChange(Number(e.target.value))} />
                </FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="tax_type" render={({ field }) => (
                <FormItem><FormLabel>Type</FormLabel><FormControl>
                  <select className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-body-sm" {...field}>
                    <option value="gst">GST (CGST + SGST)</option>
                    <option value="igst">IGST (inter-state)</option>
                    <option value="exempt">Exempt</option>
                  </select>
                </FormControl><FormMessage /></FormItem>
              )} />
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={createMutation.isPending}>Save</Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

> If `@/components/ui/switch` or the `<select>` styling differs from house style, mirror the
> exact components used by `settings/commission-rules/page.tsx`. Do not introduce `any`.

- [ ] **Step 5: Typecheck + test**

Run (from `frontend/`):
```bash
npx tsc --noEmit
npx vitest run
```
Expected: tsc exit 0; tests pass.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/api/billing.ts frontend/src/lib/query/keys.ts frontend/src/app/\(app\)/settings/layout.tsx frontend/src/app/\(app\)/settings/page.tsx frontend/src/app/\(app\)/settings/taxes/page.tsx
git commit -m "feat(settings): Taxes slab management page (TaxRate CRUD)"
```

---

## Task 8: Final verification

- [ ] **Step 1: Backend — Phase-1 app suites + regression**

Run (from `backend/`):
```bash
python -m pytest apps/billing apps/finance apps/reports apps/master apps/authentication -p no:cacheprovider -o addopts="" -q
```
Expected: PASS (incl. the new outstanding, cash-book, tax-rate tests).

- [ ] **Step 2: Migration reversibility check (TaxRate)**

Run (from `backend/`):
```bash
python manage.py migrate billing 0003 && python manage.py migrate billing 0002 && python manage.py migrate billing 0003
```
Expected: all three apply cleanly (forward → back → forward). Run against the default DB.

- [ ] **Step 3: Frontend — full suite + typecheck + lint**

Run (from `frontend/`):
```bash
npx tsc --noEmit
npx vitest run
npm run lint --no-cache
```
Expected: tsc exit 0; all Vitest tests pass (incl. reports-catalogue guard); lint clean.
(`--no-cache`: the dev container owns `.next/cache` — see Phase-0 build note.)

- [ ] **Step 4: Frontend — production build**

Run inside the frontend container (it owns `.next`; `NODE_ENV=production` is mandatory):
```bash
docker compose exec -e NODE_ENV=production frontend sh -c "npm run build"
```
Expected: build exit 0; `/billing/outstanding`, `/finance/cash-book`, `/settings/taxes` appear in
the route manifest (no longer ComingSoon).

- [ ] **Step 5: Confirm CI deny-list unaffected**

Run (from `backend/`): `grep -vc '^#\|^$' ci-known-failures.txt`
Expected: `0` (comments-only; this plan adds no known-failing tests).

---

## Notes for the implementer

- **Auth fixture:** Tasks 2/4/6 tests assume `auth_client_factory(shop, perms)`. Before writing
  them, open `backend/apps/billing/tests/test_billing.py` / `conftest.py` and use the project's
  real authenticated-client fixture (issue a JWT whose `permissions` claim includes the needed
  slug). This is the single most likely point of divergence — confirm it first.
- **`apiGet`/`apiPost`/`apiPatch`/delete signatures:** confirm in `frontend/src/lib/api/client.ts`
  and match exactly (param-object vs. query-string building) when adding client methods.
- **No `any`, no `console.log`** (project rules). App Router pages export only the default
  component (Phase-0 lesson). Keep zod schemas/helpers inline in the page or a sibling module.
- **Permissions already seeded** in Phase 0: `billing.outstanding.view`, `accounts.cashbook.view`,
  `settings.taxes.manage` — no seed changes needed here; Tenant Admin already has them.
