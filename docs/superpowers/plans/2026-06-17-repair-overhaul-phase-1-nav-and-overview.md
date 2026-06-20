# Repair Overhaul — Phase 1: Navigation & Repair Overview — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the sidebar "Repair" group to include a new read-only **Repair Overview** hub alongside Jobs, backed by a new `GET /api/repair/overview/` aggregation endpoint.

**Architecture:** A service-layer aggregation function computes KPI counts, a jobs-by-status breakdown, and a "needs attention" list in a handful of shop-scoped queries (no N+1). A DRF `APIView` exposes it; the Next.js Overview page renders tiles/bars/list with skeleton, empty, and error states and links into Jobs. The sidebar `NAV_ITEMS` data gains the Overview leaf.

**Tech Stack:** Django 4.2 / DRF, pytest-django (backend); Next.js 14 App Router, TypeScript, Tailwind, React Query, Vitest + React Testing Library (frontend).

**Spec:** `docs/superpowers/specs/2026-06-17-repair-module-overhaul-design.md` (Phase 1).

---

## Decisions locked in this plan (deviations from spec, with rationale)

1. **Permission strings.** The catalogue (`apps/master/services.py`) has **no** `repair.spare_parts.view` / `repair.fault_templates.view`. Real repair perms: `repair.jobs.view`, `...create`, `...edit`, `...change_status`, `...assign_tech`, `repair.estimates.send/approve`, `repair.templates.manage`, `repair.warranty.view`, `repair.spare_parts.request/approve`. **Overview endpoint and nav leaf gate on `repair.jobs.view`.** No catalogue changes in Phase 1.
2. **Nav scope.** To keep Phase 1 shippable with no broken links, only **Overview** (`/repair`, new) and **Jobs** (`/jobs`, existing) are added to the Repair group now. The **Spare Parts** and **Fault Templates** leaves ship in Phases 3 & 4 with their pages.
3. **Overview shop scoping** uses the shop filter only (via `ShopScopedMixin._shop_filter()` + optional `shop_id` query param), matching the Jobs list. It does **not** apply the technician "own jobs only" narrowing — Overview is a shop-wide management summary.
4. **Tile deep-links.** Jobs filters are component state until Phase 2, so Phase 1 KPI tiles and status rows link to `/jobs` (unfiltered) and "needs attention" rows link to `/jobs/{id}` (works today). Pre-filtered deep links are wired in Phase 2.

---

## File Map

| File | Change |
|---|---|
| `backend/apps/repair/services.py` | Add `get_repair_overview(shop_filter, shop_id)` aggregation function |
| `backend/apps/repair/serializers.py` | Add `RepairOverviewSerializer` (+ 3 nested serializers) |
| `backend/apps/repair/views.py` | Add `RepairOverviewView(ShopScopedMixin, APIView)` |
| `backend/apps/repair/urls.py` | Register `overview/` path before the router include |
| `backend/apps/repair/tests/test_jobs.py` | Append `TestRepairOverview` class (reuses existing fixtures) |
| `frontend/src/lib/api/repair.ts` | Add `RepairOverview` type + `repairApi.getOverview()` |
| `frontend/src/lib/query/keys.ts` | Add `repairOverview` key factory |
| `frontend/src/app/(app)/repair/page.tsx` | New Repair Overview page (Create) |
| `frontend/src/app/(app)/repair/__tests__/page.test.tsx` | New Vitest test (Create) |
| `frontend/src/components/shared/AppShell.tsx` | Add Overview leaf to Repair group; `export` NAV_ITEMS |
| `frontend/src/components/shared/__tests__/navItems.test.ts` | New Vitest test for NAV_ITEMS shape (Create) |

---

## Task 1: Backend — Overview aggregation service

**Files:**
- Modify: `backend/apps/repair/services.py`
- Test: `backend/apps/repair/tests/test_jobs.py` (append class)

- [x] **Step 1: Write the failing test**

Append to the bottom of `backend/apps/repair/tests/test_jobs.py`:

```python
# ──────────────────────────────────────────────────────────────────────────────
# Repair overview
# ──────────────────────────────────────────────────────────────────────────────

@pytest.mark.django_db
class TestRepairOverviewService:
    """services.get_repair_overview aggregation."""

    def _make_job(self, shop, customer, admin_user, **kwargs):
        from repair.services import create_job
        defaults = {"device_type": "Smartphone", "problem_description": "Test.", "priority": "normal"}
        defaults.update(kwargs)
        return create_job(shop, customer, defaults, admin_user)

    def test_counts_by_status_and_kpis(self, shop, customer, admin_user):
        from django.db.models import Q
        from repair.models import JobTicket
        from repair.services import get_repair_overview

        # one open, one ready_for_pickup, one delivered (terminal)
        j_open = self._make_job(shop, customer, admin_user)
        JobTicket.objects.filter(pk=j_open.pk).update(status="open")
        j_pickup = self._make_job(shop, customer, admin_user)
        JobTicket.objects.filter(pk=j_pickup.pk).update(status="ready_for_pickup")
        j_done = self._make_job(shop, customer, admin_user)
        JobTicket.objects.filter(pk=j_done.pk).update(status="delivered")

        data = get_repair_overview(Q(), None)

        assert data["kpis"]["open_jobs"] == 2          # open + ready_for_pickup (non-terminal)
        assert data["kpis"]["ready_for_pickup"] == 1
        by_status = {row["status"]: row["count"] for row in data["by_status"]}
        assert by_status["open"] == 1
        assert by_status["ready_for_pickup"] == 1
        assert by_status["delivered"] == 1

    def test_overdue_excludes_terminal(self, shop, customer, admin_user):
        import datetime
        from django.db.models import Q
        from repair.models import JobTicket
        from repair.services import get_repair_overview

        yesterday = datetime.date.today() - datetime.timedelta(days=1)
        j1 = self._make_job(shop, customer, admin_user)
        JobTicket.objects.filter(pk=j1.pk).update(status="open", expected_delivery_date=yesterday)
        j2 = self._make_job(shop, customer, admin_user)  # overdue date but delivered → not counted
        JobTicket.objects.filter(pk=j2.pk).update(status="delivered", expected_delivery_date=yesterday)

        data = get_repair_overview(Q(), None)
        assert data["kpis"]["overdue"] == 1

    def test_awaiting_parts_counts_distinct_jobs(self, shop, customer, admin_user):
        from django.db.models import Q
        from repair.models import JobSparePartRequest, JobTicket
        from repair.services import get_repair_overview

        j = self._make_job(shop, customer, admin_user)
        JobTicket.objects.filter(pk=j.pk).update(status="in_progress")
        # two requests on the SAME job → distinct job count = 1
        JobSparePartRequest.objects.create(
            job=j, requested_by=admin_user, custom_part_name="Screen", quantity=1, status="requested",
        )
        JobSparePartRequest.objects.create(
            job=j, requested_by=admin_user, custom_part_name="Battery", quantity=1, status="ordered",
        )
        data = get_repair_overview(Q(), None)
        assert data["kpis"]["awaiting_parts"] == 1

    def test_needs_attention_includes_unpaid_and_caps_at_eight(self, shop, customer, admin_user):
        from django.db.models import Q
        from repair.models import JobTicket
        from repair.services import get_repair_overview

        for _ in range(10):
            j = self._make_job(shop, customer, admin_user)
            JobTicket.objects.filter(pk=j.pk).update(status="open", service_charge=500, advance_paid=0)

        data = get_repair_overview(Q(), None)
        assert len(data["needs_attention"]) == 8
        assert data["needs_attention"][0]["customer"].name == customer.name
```

- [x] **Step 2: Run test to verify it fails**

```bash
cd /home/appuser/workspace/projects/repairOS/backend
python -m pytest apps/repair/tests/test_jobs.py::TestRepairOverviewService -v 2>&1 | tail -20
```
Expected: FAIL — `cannot import name 'get_repair_overview'`.

- [x] **Step 3: Implement the service**

Add to `backend/apps/repair/services.py` (bottom of file):

```python
def get_repair_overview(shop_filter, shop_id=None):
    """Aggregate KPIs, status breakdown, and a needs-attention list for the Repair Overview.

    Shop-wide summary: applies `shop_filter` (a Q from ShopScopedMixin) and an optional
    explicit `shop_id`. A handful of aggregate queries — no N+1.
    """
    from django.db.models import Count, Q
    from django.utils import timezone

    from .models import JobTicket

    TERMINAL = ["delivered", "closed", "cancelled"]
    AWAITING_PARTS = ["requested", "approved", "ordered"]
    STATUS_ORDER = ["open", "in_progress", "on_hold", "ready_for_qc", "ready_for_pickup", "delivered"]
    today = timezone.localdate()

    base = JobTicket.objects.filter(shop_filter)
    if shop_id:
        base = base.filter(shop_id=shop_id)

    status_counts = {row["status"]: row["count"] for row in base.values("status").annotate(count=Count("id"))}

    open_jobs = base.exclude(status__in=TERMINAL).count()
    overdue = base.exclude(status__in=TERMINAL).filter(expected_delivery_date__lt=today).count()
    ready_for_pickup = status_counts.get("ready_for_pickup", 0)
    awaiting_parts = (
        base.filter(spare_part_requests__status__in=AWAITING_PARTS).distinct().count()
    )

    needs_attention = list(
        base.exclude(status__in=TERMINAL)
        .filter(
            Q(expected_delivery_date__lt=today)
            | Q(advance_paid=0, service_charge__gt=0)
            | Q(spare_part_requests__status__in=AWAITING_PARTS)
        )
        .select_related("customer")
        .distinct()
        .order_by("expected_delivery_date", "intake_date")[:8]
    )

    return {
        "kpis": {
            "open_jobs": open_jobs,
            "overdue": overdue,
            "awaiting_parts": awaiting_parts,
            "ready_for_pickup": ready_for_pickup,
        },
        "by_status": [{"status": s, "count": status_counts.get(s, 0)} for s in STATUS_ORDER],
        "needs_attention": needs_attention,
    }
```

- [x] **Step 4: Run test to verify it passes**

```bash
cd /home/appuser/workspace/projects/repairOS/backend
python -m pytest apps/repair/tests/test_jobs.py::TestRepairOverviewService -v 2>&1 | tail -15
```
Expected: 4 tests PASS.

- [x] **Step 5: Commit**

```bash
cd /home/appuser/workspace/projects/repairOS
git add backend/apps/repair/services.py backend/apps/repair/tests/test_jobs.py
git commit -m "feat(repair): add get_repair_overview aggregation service

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Backend — Overview serializer, view, URL

**Files:**
- Modify: `backend/apps/repair/serializers.py`
- Modify: `backend/apps/repair/views.py`
- Modify: `backend/apps/repair/urls.py`
- Test: `backend/apps/repair/tests/test_jobs.py` (append class)

- [x] **Step 1: Write the failing test**

Append to the bottom of `backend/apps/repair/tests/test_jobs.py`:

```python
@pytest.mark.django_db
class TestRepairOverviewEndpoint:
    """GET /api/repair/overview/."""

    def _make_job(self, shop, customer, admin_user, **kwargs):
        from repair.services import create_job
        defaults = {"device_type": "Smartphone", "problem_description": "Test.", "priority": "normal"}
        defaults.update(kwargs)
        return create_job(shop, customer, defaults, admin_user)

    def test_returns_shape(self, admin_client, shop, customer, admin_user):
        from repair.models import JobTicket
        j = self._make_job(shop, customer, admin_user)
        JobTicket.objects.filter(pk=j.pk).update(status="open", service_charge=500, advance_paid=0)

        res = admin_client.get("/api/repair/overview/")
        assert res.status_code == 200
        assert set(res.data["kpis"].keys()) == {"open_jobs", "overdue", "awaiting_parts", "ready_for_pickup"}
        assert isinstance(res.data["by_status"], list)
        assert res.data["by_status"][0]["status"] == "open"
        assert len(res.data["needs_attention"]) == 1
        item = res.data["needs_attention"][0]
        assert item["job_number"] == j.job_number
        assert item["customer_name"] == customer.name

    def test_requires_permission(self, api_client, shop, customer):
        from authentication.models import Permission, Role, RolePermission, User, UserRole
        from authentication.tokens import _build_token_claims
        from rest_framework_simplejwt.tokens import RefreshToken

        user = User.objects.create_user(
            email="noperm@repair.test", phone="+919000000099",
            full_name="No Perm", password="NoPerm@1",
        )
        role, _ = Role.objects.get_or_create(name="Empty", defaults={"is_system_role": False})
        # Give an unrelated permission so the token has a permissions claim but not repair.jobs.view
        perm, _ = Permission.objects.get_or_create(
            codename="crm.customers.view", defaults={"module": "crm", "label": "crm.customers.view"}
        )
        RolePermission.objects.get_or_create(role=role, permission=perm)
        UserRole.objects.create(user=user, role=role, shop=None)

        refresh = RefreshToken.for_user(user)
        access = refresh.access_token
        for k, v in _build_token_claims(user, "test").items():
            access[k] = v
        api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {str(access)}")

        res = api_client.get("/api/repair/overview/")
        assert res.status_code == 403
```

- [x] **Step 2: Run test to verify it fails**

```bash
cd /home/appuser/workspace/projects/repairOS/backend
python -m pytest apps/repair/tests/test_jobs.py::TestRepairOverviewEndpoint -v 2>&1 | tail -20
```
Expected: FAIL — 404 (URL not registered).

- [x] **Step 3: Add the serializers**

Add to `backend/apps/repair/serializers.py` (bottom of file; ensure `from rest_framework import serializers` is already imported at top — it is):

```python
class OverviewKpisSerializer(serializers.Serializer):
    open_jobs = serializers.IntegerField()
    overdue = serializers.IntegerField()
    awaiting_parts = serializers.IntegerField()
    ready_for_pickup = serializers.IntegerField()


class OverviewStatusCountSerializer(serializers.Serializer):
    status = serializers.CharField()
    count = serializers.IntegerField()


class OverviewNeedsAttentionSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    job_number = serializers.CharField()
    customer_name = serializers.CharField(source="customer.name")
    device_type = serializers.CharField()
    status = serializers.CharField()
    expected_delivery_date = serializers.DateField(allow_null=True)
    service_charge = serializers.DecimalField(max_digits=10, decimal_places=2)
    advance_paid = serializers.DecimalField(max_digits=10, decimal_places=2)


class RepairOverviewSerializer(serializers.Serializer):
    kpis = OverviewKpisSerializer()
    by_status = OverviewStatusCountSerializer(many=True)
    needs_attention = OverviewNeedsAttentionSerializer(many=True)
```

- [x] **Step 4: Add the view**

In `backend/apps/repair/views.py`:

Add `APIView` to the rest_framework imports near the top — change:
```python
from rest_framework.viewsets import GenericViewSet, ModelViewSet
```
to also import APIView (add this line with the other rest_framework imports):
```python
from rest_framework.views import APIView
```

Add `RepairOverviewSerializer` to the serializers import block:
```python
from .serializers import (
    AdvanceStageSerializer,
    CreateEstimateSerializer,
    EstimateResponseSerializer,
    FaultTemplateSerializer,
    JobCheckinConditionSerializer,
    JobSparePartRequestSerializer,
    JobStatusSerializer,
    JobTicketDetailSerializer,
    JobTicketListSerializer,
    JobTicketSerializer,
    RepairOverviewSerializer,
    ReviewSparePartSerializer,
    SetStagesSerializer,
)
```

Add the view at the bottom of `views.py`:

```python
# ──────────────────────────────────────────────────────────────────────────────
# Repair overview  (read-only dashboard hub)
# ──────────────────────────────────────────────────────────────────────────────


class RepairOverviewView(ShopScopedMixin, APIView):
    """GET /repair/overview/ — KPI counts, jobs-by-status, and a needs-attention list."""

    def get_permissions(self):
        return [require_permission("repair.jobs.view")()]

    def get(self, request):
        shop_id = request.query_params.get("shop_id")
        data = services.get_repair_overview(self._shop_filter(), shop_id)
        return Response(RepairOverviewSerializer(data).data)
```

- [x] **Step 5: Register the URL**

In `backend/apps/repair/urls.py`, import the view and add the path **before** the router include:

```python
from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    FaultTemplateViewSet,
    JobTicketViewSet,
    RepairOverviewView,
    SparePartRequestViewSet,
)

router = DefaultRouter(trailing_slash=True)
router.register("jobs", JobTicketViewSet, basename="jobs")
router.register("spare-parts", SparePartRequestViewSet, basename="spare-parts")
router.register("fault-templates", FaultTemplateViewSet, basename="fault-templates")

urlpatterns = [
    path("overview/", RepairOverviewView.as_view(), name="repair-overview"),
    path("", include(router.urls)),
]
```

- [x] **Step 6: Run test to verify it passes**

```bash
cd /home/appuser/workspace/projects/repairOS/backend
python -m pytest apps/repair/tests/test_jobs.py::TestRepairOverviewEndpoint -v 2>&1 | tail -15
```
Expected: 2 tests PASS.

- [x] **Step 7: Run the full repair suite for regressions**

```bash
cd /home/appuser/workspace/projects/repairOS/backend
python -m pytest apps/repair/tests/ 2>&1 | tail -15
```
Expected: all PASS.

- [x] **Step 8: Commit**

```bash
cd /home/appuser/workspace/projects/repairOS
git add backend/apps/repair/serializers.py backend/apps/repair/views.py backend/apps/repair/urls.py backend/apps/repair/tests/test_jobs.py
git commit -m "feat(repair): add GET /repair/overview/ endpoint

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Frontend — API type, client method, query key

**Files:**
- Modify: `frontend/src/lib/api/repair.ts`
- Modify: `frontend/src/lib/query/keys.ts`

- [ ] **Step 1: Add the `RepairOverview` type and API method**

In `frontend/src/lib/api/repair.ts`, add the type just above `export const repairApi = {`:

```typescript
export interface RepairOverview {
  kpis: {
    open_jobs: number;
    overdue: number;
    awaiting_parts: number;
    ready_for_pickup: number;
  };
  by_status: Array<{ status: JobStatus; count: number }>;
  needs_attention: Array<{
    id: string;
    job_number: string;
    customer_name: string;
    device_type: string;
    status: JobStatus;
    expected_delivery_date: string | null;
    service_charge: number;
    advance_paid: number;
  }>;
}
```

Inside the `repairApi` object, add this method right after the `listJobs` entry:

```typescript
  getOverview: (shopId?: string) =>
    apiGet<RepairOverview>('/repair/overview/', shopId ? { shop_id: shopId } : {}),
```

- [ ] **Step 2: Add the query key**

In `frontend/src/lib/query/keys.ts`, inside the `qk` object next to the other repair keys (after `repairTemplates`), add:

```typescript
  repairOverview:  (shopId: string | null) => ['repair-overview', shopId] as const,
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd /home/appuser/workspace/projects/repairOS/frontend
npx tsc --noEmit 2>&1 | grep "error TS" | grep -v "Can.test.tsx" || echo "OK no errors"
```
Expected: `OK no errors`.

- [ ] **Step 4: Commit**

```bash
cd /home/appuser/workspace/projects/repairOS
git add frontend/src/lib/api/repair.ts frontend/src/lib/query/keys.ts
git commit -m "feat(repair): add RepairOverview type, getOverview client, query key

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Frontend — Repair Overview page

**Files:**
- Create: `frontend/src/app/(app)/repair/page.tsx`
- Create: `frontend/src/app/(app)/repair/__tests__/page.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/app/(app)/repair/__tests__/page.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import RepairOverviewPage from '../page';

vi.mock('@/lib/stores/activeShopStore', () => ({
  useActiveShopStore: () => ({ activeShopId: 'shop-1', isAllShops: false }),
}));

const getOverview = vi.fn();
vi.mock('@/lib/api/repair', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/api/repair')>();
  return {
    ...actual,  // keep KANBAN_COLUMNS and other real exports the page imports
    repairApi: { ...actual.repairApi, getOverview: (...args: unknown[]) => getOverview(...args) },
  };
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <RepairOverviewPage />
    </QueryClientProvider>,
  );
}

const SAMPLE = {
  kpis: { open_jobs: 42, overdue: 7, awaiting_parts: 9, ready_for_pickup: 5 },
  by_status: [
    { status: 'open', count: 14 },
    { status: 'in_progress', count: 11 },
  ],
  needs_attention: [
    {
      id: 'j1', job_number: 'JOY-2026-0001', customer_name: 'Ravi Kumar',
      device_type: 'Smartphone', status: 'open',
      expected_delivery_date: null, service_charge: 500, advance_paid: 0,
    },
  ],
};

describe('RepairOverviewPage', () => {
  beforeEach(() => getOverview.mockReset());

  it('shows a loading skeleton while fetching', () => {
    getOverview.mockReturnValue(new Promise(() => {}));  // never resolves
    renderPage();
    expect(screen.getByTestId('overview-loading')).toBeInTheDocument();
  });

  it('renders KPI numbers and needs-attention rows when data loads', async () => {
    getOverview.mockResolvedValue(SAMPLE);
    renderPage();
    expect(await screen.findByText('42')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText('JOY-2026-0001')).toBeInTheDocument();
    expect(screen.getByText('Ravi Kumar')).toBeInTheDocument();
  });

  it('shows an empty state when there are no jobs', async () => {
    getOverview.mockResolvedValue({
      kpis: { open_jobs: 0, overdue: 0, awaiting_parts: 0, ready_for_pickup: 0 },
      by_status: [],
      needs_attention: [],
    });
    renderPage();
    expect(await screen.findByText(/no jobs yet/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /home/appuser/workspace/projects/repairOS/frontend
npx vitest run src/app/\(app\)/repair/__tests__/page.test.tsx 2>&1 | tail -20
```
Expected: FAIL — cannot resolve `../page`.

- [ ] **Step 3: Implement the page**

Create `frontend/src/app/(app)/repair/page.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Wrench, AlertTriangle, PackageSearch, CheckCircle2 } from 'lucide-react';
import { repairApi, KANBAN_COLUMNS, type RepairOverview } from '@/lib/api/repair';
import { qk } from '@/lib/query/keys';
import { useActiveShopStore } from '@/lib/stores/activeShopStore';
import { Money } from '@/components/shared/Money';
import { Button } from '@/components/ui/button';
import { Can } from '@/components/shared/Can';
import { cn } from '@/lib/utils';

const KPI_DEFS: Array<{
  key: keyof RepairOverview['kpis'];
  label: string;
  icon: React.ElementType;
  tone: string;
}> = [
  { key: 'open_jobs',        label: 'Open jobs',        icon: Wrench,        tone: 'text-[var(--text)]' },
  { key: 'overdue',          label: 'Overdue',          icon: AlertTriangle, tone: 'text-[var(--danger)]' },
  { key: 'awaiting_parts',   label: 'Awaiting parts',   icon: PackageSearch, tone: 'text-[var(--warning)]' },
  { key: 'ready_for_pickup', label: 'Ready for pickup', icon: CheckCircle2,  tone: 'text-[var(--success)]' },
];

const STATUS_LABEL: Record<string, string> = Object.fromEntries(
  KANBAN_COLUMNS.map((c) => [c.status, c.label]),
);

export default function RepairOverviewPage() {
  const { activeShopId, isAllShops } = useActiveShopStore();
  const shopId = isAllShops ? undefined : activeShopId ?? undefined;

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: qk.repairOverview(shopId ?? null),
    queryFn: () => repairApi.getOverview(shopId),
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <div data-testid="overview-loading" className="p-4 md:p-6 space-y-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 rounded-lg bg-[var(--surface-2)] animate-pulse" />
          ))}
        </div>
        <div className="grid lg:grid-cols-2 gap-3">
          <div className="h-56 rounded-lg bg-[var(--surface-2)] animate-pulse" />
          <div className="h-56 rounded-lg bg-[var(--surface-2)] animate-pulse" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 flex flex-col items-center justify-center gap-3 text-center">
        <p className="text-body text-[var(--text-muted)]">Couldn’t load the repair overview.</p>
        <Button size="sm" onClick={() => refetch()}>Retry</Button>
      </div>
    );
  }

  if (!data) return null;

  const isEmpty =
    data.by_status.every((r) => r.count === 0) &&
    data.needs_attention.length === 0 &&
    data.kpis.open_jobs === 0;

  if (isEmpty) {
    return (
      <div className="p-6 flex flex-col items-center justify-center gap-3 text-center min-h-[50vh]">
        <Wrench className="h-10 w-10 text-[var(--text-muted)]" />
        <h2 className="text-h2 text-[var(--text)]">No jobs yet</h2>
        <p className="text-body-sm text-[var(--text-muted)]">Create your first job to get started.</p>
        <Can permission="repair.jobs.create">
          <Button asChild size="sm"><Link href="/jobs/new">New Job</Link></Button>
        </Can>
      </div>
    );
  }

  const maxStatus = Math.max(1, ...data.by_status.map((r) => r.count));

  return (
    <div className="p-4 md:p-6 space-y-4">
      <h1 className="text-h1 text-[var(--text)]">Repair Overview</h1>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {KPI_DEFS.map((kpi) => (
          <Link
            key={kpi.key}
            href="/jobs"
            className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 hover:bg-[var(--surface-2)] transition-colors min-h-[44px]"
          >
            <div className="flex items-center gap-2 text-[var(--text-muted)]">
              <kpi.icon className="h-4 w-4 shrink-0" />
              <span className="text-body-sm">{kpi.label}</span>
            </div>
            <div className={cn('mt-1 text-2xl font-semibold tabular-nums', kpi.tone)}>
              {data.kpis[kpi.key]}
            </div>
          </Link>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-3">
        {/* Jobs by status */}
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
          <h2 className="text-h2 text-[var(--text)] mb-3">Jobs by status</h2>
          <div className="space-y-2">
            {data.by_status.map((row) => (
              <Link key={row.status} href="/jobs" className="flex items-center gap-3 group">
                <span className="w-32 shrink-0 text-body-sm text-[var(--text-muted)] truncate">
                  {STATUS_LABEL[row.status] ?? row.status}
                </span>
                <span className="flex-1 h-2 rounded-full bg-[var(--surface-2)] overflow-hidden">
                  <span
                    className="block h-full bg-[var(--accent)]"
                    style={{ width: `${(row.count / maxStatus) * 100}%` }}
                  />
                </span>
                <span className="w-8 text-right text-body-sm tabular-nums text-[var(--text)]">{row.count}</span>
              </Link>
            ))}
          </div>
        </div>

        {/* Needs attention */}
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
          <h2 className="text-h2 text-[var(--text)] mb-3">Needs attention</h2>
          {data.needs_attention.length === 0 ? (
            <p className="text-body-sm text-[var(--text-muted)]">Nothing needs attention right now.</p>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {data.needs_attention.map((j) => {
                const unpaid = j.service_charge - j.advance_paid > 0;
                return (
                  <li key={j.id}>
                    <Link
                      href={`/jobs/${j.id}`}
                      className="flex items-center justify-between gap-2 py-2.5 hover:bg-[var(--surface-2)] -mx-2 px-2 rounded-md transition-colors min-h-[44px]"
                    >
                      <span className="min-w-0">
                        <span className="block text-body-sm font-medium text-[var(--text)] truncate">
                          {j.customer_name}
                        </span>
                        <span className="block text-xs font-mono text-[var(--text-muted)]">
                          {j.job_number} · {j.device_type}
                        </span>
                      </span>
                      <span className="shrink-0 flex items-center gap-2">
                        {unpaid && (
                          <span className="text-xs font-medium text-[var(--warning)]">
                            <Money amount={j.service_charge - j.advance_paid} />
                          </span>
                        )}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
```

> Note: `Money` lives at `frontend/src/components/shared/Money.tsx` (used by the Jobs list). Verify the import path resolves; if `Money` does not accept a `className`, drop it.

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /home/appuser/workspace/projects/repairOS/frontend
npx vitest run src/app/\(app\)/repair/__tests__/page.test.tsx 2>&1 | tail -20
```
Expected: 3 tests PASS.

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd /home/appuser/workspace/projects/repairOS/frontend
npx tsc --noEmit 2>&1 | grep "error TS" | grep -v "Can.test.tsx" || echo "OK no errors"
```
Expected: `OK no errors`.

- [ ] **Step 6: Commit**

```bash
cd /home/appuser/workspace/projects/repairOS
git add "frontend/src/app/(app)/repair/page.tsx" "frontend/src/app/(app)/repair/__tests__/page.test.tsx"
git commit -m "feat(repair): add Repair Overview page with KPIs, status bars, needs-attention

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Frontend — Nav restructure (add Overview leaf)

**Files:**
- Modify: `frontend/src/components/shared/AppShell.tsx`
- Create: `frontend/src/components/shared/__tests__/navItems.test.ts`

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/shared/__tests__/navItems.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { NAV_ITEMS } from '../AppShell';

describe('NAV_ITEMS — Repair group', () => {
  const repair = NAV_ITEMS.find(
    (e): e is Extract<typeof e, { type: 'group' }> => e.type === 'group' && e.label === 'Repair',
  );

  it('exists and is a group', () => {
    expect(repair).toBeDefined();
  });

  it('has Overview and Jobs children with correct hrefs', () => {
    const hrefs = repair!.children.map((c) => c.href);
    expect(hrefs).toContain('/repair');
    expect(hrefs).toContain('/jobs');
    // Overview must come first (it is the group landing page)
    expect(repair!.children[0].href).toBe('/repair');
  });

  it('gates Overview and Jobs on repair.jobs.view', () => {
    for (const child of repair!.children) {
      expect(child.permission).toBe('repair.jobs.view');
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /home/appuser/workspace/projects/repairOS/frontend
npx vitest run src/components/shared/__tests__/navItems.test.ts 2>&1 | tail -20
```
Expected: FAIL — `NAV_ITEMS` is not exported.

- [ ] **Step 3: Export NAV_ITEMS and add the Overview leaf**

In `frontend/src/components/shared/AppShell.tsx`:

(a) Export the constant — change:
```typescript
const NAV_ITEMS: NavEntry[] = [
```
to:
```typescript
export const NAV_ITEMS: NavEntry[] = [
```

(b) Replace the Repair group block:
```typescript
  { type: 'group', label: 'Repair', icon: Wrench, children: [
    { type: 'leaf', label: 'Jobs', href: '/jobs', icon: Wrench, permission: 'repair.jobs.view' },
  ]},
```
with:
```typescript
  { type: 'group', label: 'Repair', icon: Wrench, children: [
    { type: 'leaf', label: 'Overview', href: '/repair', icon: LayoutDashboard, permission: 'repair.jobs.view' },
    { type: 'leaf', label: 'Jobs',     href: '/jobs',    icon: Wrench,          permission: 'repair.jobs.view' },
  ]},
```

`LayoutDashboard` is already imported at the top of `AppShell.tsx` (used by Dashboard) — no import change needed.

> Active-state highlighting: `NavLink`/`NavGroupItem` already mark a child active when `pathname === href || pathname.startsWith(href + '/')`. Because `/repair` is a prefix of nothing else in this group (Jobs is `/jobs`), the Overview leaf highlights only on `/repair`. No change needed.

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /home/appuser/workspace/projects/repairOS/frontend
npx vitest run src/components/shared/__tests__/navItems.test.ts 2>&1 | tail -15
```
Expected: 3 tests PASS.

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd /home/appuser/workspace/projects/repairOS/frontend
npx tsc --noEmit 2>&1 | grep "error TS" | grep -v "Can.test.tsx" || echo "OK no errors"
```
Expected: `OK no errors`.

- [ ] **Step 6: Commit**

```bash
cd /home/appuser/workspace/projects/repairOS
git add frontend/src/components/shared/AppShell.tsx frontend/src/components/shared/__tests__/navItems.test.ts
git commit -m "feat(nav): add Repair Overview leaf to sidebar Repair group

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Full verification

- [ ] **Step 1: Backend — full repair suite**

```bash
cd /home/appuser/workspace/projects/repairOS/backend
python -m pytest apps/repair/tests/ 2>&1 | tail -15
```
Expected: all PASS.

- [ ] **Step 2: Frontend — full Vitest run + typecheck**

```bash
cd /home/appuser/workspace/projects/repairOS/frontend
npx vitest run 2>&1 | tail -20
npx tsc --noEmit 2>&1 | grep "error TS" | grep -v "Can.test.tsx" || echo "OK no errors"
```
Expected: all tests PASS; `OK no errors`.

- [ ] **Step 3: Manual smoke test**

1. Run the app; log in as a user with `repair.jobs.view`.
2. Sidebar: the **Repair** group expands to **Overview** + **Jobs**. The active item highlights correctly on each route.
3. Visit `/repair`: KPI tiles show numbers (tabular-aligned), "Jobs by status" bars render, "Needs attention" lists overdue/unpaid/awaiting-parts jobs.
4. Clicking a KPI tile or status row navigates to `/jobs`; clicking a needs-attention row opens that job's detail.
5. On a tenant with zero jobs, `/repair` shows the "No jobs yet" empty state with a "New Job" button (only if the user has `repair.jobs.create`).
6. Throttle the network: a skeleton appears before data loads.

- [ ] **Step 4: Push**

```bash
cd /home/appuser/workspace/projects/repairOS
git push origin master
```

---

## Self-Review Notes

- **Spec coverage (Phase 1):** nav restructure → Task 5; Overview page (KPI tiles, by-status, needs-attention) → Task 4; `/repair/overview/` endpoint with service aggregation, serializer, permission, shop scoping, no N+1 → Tasks 1–2; backend tests → Tasks 1–2; frontend tests → Tasks 4–5; UX criteria (skeleton, filter-aware/zero empty state, tabular figures, nav active-state, 44px targets) → Task 4 & 5. Spare Parts / Fault Templates nav leaves are intentionally deferred (see Decisions §2).
- **Permission reality:** uses `repair.jobs.view` (exists). No catalogue migration in Phase 1.
- **Type consistency:** `RepairOverview` (TS) mirrors `RepairOverviewSerializer` (DRF) field-for-field; `getOverview(shopId?)` ↔ `qk.repairOverview(shopId | null)` ↔ endpoint `shop_id` param.
