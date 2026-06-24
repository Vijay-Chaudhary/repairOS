# CRM Overhaul — Phase 1: Nav Restructure + CRM Overview Hub — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a read-only CRM Overview hub at `/crm` (new `GET /api/v1/crm/overview/` endpoint + page) and restructure the CRM sidebar group to surface the already-built Tasks and Segments pages.

**Architecture:** A service-layer aggregation function (`crm/services.py`) computes KPI counts, a lead-pipeline breakdown, and two short "needs attention" lists in a handful of aggregate queries (no N+1). A DRF `APIView` (`CrmOverviewView`) exposes it, mirroring the existing `RepairOverviewView`. The Next.js `/crm` page renders tiles/bars/lists with skeleton, empty, and error states. The sidebar `NAV_ITEMS` CRM group gains Overview, Tasks, and Segments leaves.

**Tech Stack:** Django 5 + DRF (backend, `pytest`), Next.js 14 App Router + TypeScript + React Query + Tailwind (frontend, Vitest + Testing Library).

**Source spec:** `docs/superpowers/specs/2026-06-24-crm-overhaul-design.md` (Phase 1).

---

## Key decisions (read before starting)

- **Shop scoping is asymmetric.** `Lead` and `Customer` have `shop_id` and are scoped via
  `ShopScopedMixin._shop_filter()` (a `Q`). `FollowUpTask` has **no `shop` field** and its
  existing viewset is **not** shop-scoped — tasks are tenant-wide today. Therefore the overview's
  **task metrics are tenant-wide** (matching existing behavior); **lead/customer metrics are
  shop-scoped**. Do **not** add a `shop_id` to `FollowUpTask` in this phase.
- **Segments nav leaf points at the existing `/settings/segments`** in this phase (the page
  lives there today). Phase 4 relocates it to `/crm/segments` with a redirect and repoints the
  leaf. This keeps the menu free of dead links now.
- **Overview route is `/crm`** (the CRM group's hub), mirroring Repair's `/repair`.
- **API base path is `/api/v1/`** (tests hit e.g. `/api/v1/crm/leads/`).

## File structure

| File | Responsibility | Change |
|---|---|---|
| `backend/apps/crm/services.py` | `get_crm_overview()` aggregation | Modify (append function) |
| `backend/apps/crm/serializers.py` | Overview response serializers | Modify (append classes) |
| `backend/apps/crm/views.py` | `CrmOverviewView` APIView | Modify (append class) |
| `backend/apps/crm/urls.py` | `overview/` route | Modify |
| `backend/apps/crm/tests/test_overview.py` | service unit + endpoint tests | Create |
| `frontend/src/lib/api/crm.ts` | `CrmOverview` type + `crmApi.getOverview` | Modify |
| `frontend/src/lib/query/keys.ts` | `qk.crmOverview` key | Modify |
| `frontend/src/components/shared/AppShell.tsx` | CRM nav group leaves | Modify |
| `frontend/src/components/shared/__tests__/navItems.test.ts` | CRM nav assertions | Modify (append) |
| `frontend/src/app/(app)/crm/page.tsx` | Overview page | Create |
| `frontend/src/app/(app)/crm/__tests__/page.test.tsx` | page test | Create |

---

## Task 1: CRM overview aggregation service

**Files:**
- Modify: `backend/apps/crm/services.py` (append at end of file)
- Test: `backend/apps/crm/tests/test_overview.py` (create)

- [ ] **Step 1: Write the failing test**

Create `backend/apps/crm/tests/test_overview.py`:

```python
"""
CRM — Overview aggregation service + endpoint tests.
Covers: KPI counts, pipeline breakdown, needs-attention lists, shop scoping, permission gate.
"""

import uuid
from datetime import timedelta

import pytest
from django.utils import timezone

from crm import services
from crm.models import Customer, FollowUpTask, Lead


@pytest.fixture
def shop(db):
    from core.models import Shop
    return Shop.objects.create(
        name="Joy Computer", code="JOY", address="MG Road", city="Delhi",
        state="Uttar Pradesh", state_code="09", phone="+919876543210",
    )


@pytest.fixture
def staff_user(db):
    from authentication.models import User
    return User.objects.create_user(
        email="staff@joy.com", phone="+919000000009", full_name="Staff User", password="Pass@123",
    )


def _shop_q(shop):
    from django.db.models import Q
    return Q(shop_id__in=[shop.id])


@pytest.mark.django_db
def test_get_crm_overview_counts(shop, staff_user):
    today = timezone.localdate()
    # Pipeline: 2 new (one unassigned), 1 contacted, 1 converted (within 30d)
    Lead.objects.create(shop=shop, name="A", phone="+9111", status="new")
    Lead.objects.create(shop=shop, name="B", phone="+9112", status="new", assigned_to=staff_user)
    Lead.objects.create(shop=shop, name="C", phone="+9113", status="contacted")
    conv = Lead.objects.create(shop=shop, name="D", phone="+9114", status="converted")
    conv.converted_at = timezone.now()
    conv.save(update_fields=["converted_at"])
    # New customer within 30d
    Customer.objects.create(shop=shop, name="Cust", phone="+9120")
    # Tasks: one overdue pending, one future pending
    FollowUpTask.objects.create(
        title="Overdue call", due_date=today - timedelta(days=1), status="pending", assigned_to=staff_user,
    )
    FollowUpTask.objects.create(
        title="Today call", due_date=today, status="pending", assigned_to=staff_user,
    )
    FollowUpTask.objects.create(
        title="Future call", due_date=today + timedelta(days=2), status="pending", assigned_to=staff_user,
    )

    data = services.get_crm_overview(_shop_q(shop), str(shop.id))

    assert data["kpis"]["new_leads"] == 2
    assert data["kpis"]["tasks_due_today"] == 1
    assert data["kpis"]["tasks_overdue"] == 1
    assert data["kpis"]["conversions_30d"] == 1
    assert data["kpis"]["new_customers_30d"] == 1
    pipeline = {row["status"]: row["count"] for row in data["pipeline"]}
    assert pipeline["new"] == 2 and pipeline["contacted"] == 1 and pipeline["converted"] == 1
    assert len(data["overdue_tasks"]) == 1
    assert data["overdue_tasks"][0]["title"] == "Overdue call"
    # Only the unassigned 'new' lead appears
    assert len(data["unassigned_leads"]) == 1
    assert data["unassigned_leads"][0]["name"] == "A"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest apps/crm/tests/test_overview.py::test_get_crm_overview_counts --no-cov -q`
Expected: FAIL with `AttributeError: module 'crm.services' has no attribute 'get_crm_overview'`.

- [ ] **Step 3: Implement the service**

Append to `backend/apps/crm/services.py`:

```python
def get_crm_overview(shop_filter, shop_id=None):
    """Aggregate CRM KPIs, the lead pipeline, and needs-attention lists for the Overview hub.

    Leads and customers are shop-scoped via `shop_filter` (a Q from ShopScopedMixin) plus an
    optional explicit `shop_id`. Tasks have no shop column and are tenant-wide today, so task
    metrics are NOT shop-filtered (matches the existing Tasks list behavior). A handful of
    aggregate queries — no N+1.
    """
    from datetime import timedelta

    from django.db.models import Count
    from django.utils import timezone

    from .models import Customer, FollowUpTask, Lead

    PIPELINE_ORDER = ["new", "contacted", "interested", "quoted", "converted", "lost"]
    today = timezone.localdate()
    since = timezone.now() - timedelta(days=30)

    leads = Lead.objects.filter(shop_filter)
    customers = Customer.objects.filter(shop_filter)
    if shop_id:
        leads = leads.filter(shop_id=shop_id)
        customers = customers.filter(shop_id=shop_id)

    status_counts = {row["status"]: row["count"] for row in leads.values("status").annotate(count=Count("id"))}

    tasks_due_today = FollowUpTask.objects.filter(status="pending", due_date=today).count()
    tasks_overdue = FollowUpTask.objects.filter(status="pending", due_date__lt=today).count()

    overdue_tasks = list(
        FollowUpTask.objects.filter(status="pending", due_date__lt=today)
        .select_related("assigned_to", "customer")
        .order_by("due_date")[:8]
    )
    unassigned_leads = list(
        leads.filter(status="new", assigned_to__isnull=True).order_by("-created_at")[:8]
    )

    return {
        "kpis": {
            "new_leads": status_counts.get("new", 0),
            "tasks_due_today": tasks_due_today,
            "tasks_overdue": tasks_overdue,
            "conversions_30d": leads.filter(converted_at__gte=since).count(),
            "new_customers_30d": customers.filter(created_at__gte=since).count(),
        },
        "pipeline": [{"status": s, "count": status_counts.get(s, 0)} for s in PIPELINE_ORDER],
        "overdue_tasks": overdue_tasks,
        "unassigned_leads": unassigned_leads,
    }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest apps/crm/tests/test_overview.py::test_get_crm_overview_counts --no-cov -q`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/apps/crm/services.py backend/apps/crm/tests/test_overview.py
git commit -m "feat(crm): add get_crm_overview aggregation service"
```

---

## Task 2: Overview serializers, view, and route

**Files:**
- Modify: `backend/apps/crm/serializers.py` (append classes)
- Modify: `backend/apps/crm/views.py` (append `CrmOverviewView`)
- Modify: `backend/apps/crm/urls.py` (add `overview/` path)
- Test: `backend/apps/crm/tests/test_overview.py` (append endpoint tests)

- [ ] **Step 1: Write the failing endpoint tests**

Append to `backend/apps/crm/tests/test_overview.py`:

```python
@pytest.fixture
def api_client():
    from rest_framework.test import APIClient
    return APIClient()


@pytest.fixture
def overview_client(api_client, shop, staff_user):
    """Authed client whose JWT carries crm.customers.view for `shop`."""
    from authentication.models import Permission, Role, RolePermission, UserRole
    from authentication.services import issue_tokens_for_user

    role, _ = Role.objects.get_or_create(name="CRM Viewer", defaults={"is_system_role": False})
    perm, _ = Permission.objects.get_or_create(code="crm.customers.view", defaults={"name": "View customers"})
    RolePermission.objects.get_or_create(role=role, permission=perm)
    UserRole.objects.get_or_create(user=staff_user, role=role, shop=shop)

    tokens = issue_tokens_for_user(staff_user)
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")
    return api_client


@pytest.mark.django_db
def test_overview_endpoint_returns_envelope(overview_client, shop, staff_user):
    Lead.objects.create(shop=shop, name="A", phone="+9111", status="new")
    res = overview_client.get(f"/api/v1/crm/overview/?shop_id={shop.id}")
    assert res.status_code == 200
    body = res.json()
    assert body["success"] is True
    assert body["data"]["kpis"]["new_leads"] == 1
    assert any(row["status"] == "new" for row in body["data"]["pipeline"])


@pytest.mark.django_db
def test_overview_requires_permission(api_client, shop, staff_user):
    from authentication.services import issue_tokens_for_user
    tokens = issue_tokens_for_user(staff_user)  # no CRM perms granted
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {tokens['access']}")
    res = api_client.get("/api/v1/crm/overview/")
    assert res.status_code == 403


@pytest.mark.django_db
def test_overview_unauthenticated(api_client):
    res = api_client.get("/api/v1/crm/overview/")
    assert res.status_code == 401
```

> **Note on the auth fixture:** mirror the token-issuing helper the other CRM tests use. If
> `authentication.services.issue_tokens_for_user` does not exist, copy the exact token-building
> block from `backend/apps/crm/tests/test_leads.py` (the `admin_client` fixture, lines ~56-66)
> and grant only `crm.customers.view`. Verify the helper name with
> `grep -rn "def issue_tokens_for_user\|access_token" backend/apps/authentication/` before writing.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest apps/crm/tests/test_overview.py -k "endpoint or permission or unauthenticated" --no-cov -q`
Expected: FAIL (404, because the route/view do not exist yet).

- [ ] **Step 3: Add the serializers**

Append to `backend/apps/crm/serializers.py`:

```python
class CrmOverviewKpisSerializer(serializers.Serializer):
    new_leads = serializers.IntegerField()
    tasks_due_today = serializers.IntegerField()
    tasks_overdue = serializers.IntegerField()
    conversions_30d = serializers.IntegerField()
    new_customers_30d = serializers.IntegerField()


class CrmPipelineCountSerializer(serializers.Serializer):
    status = serializers.CharField()
    count = serializers.IntegerField()


class CrmOverdueTaskSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    title = serializers.CharField()
    due_date = serializers.DateField()
    assigned_to_name = serializers.CharField(source="assigned_to.full_name", allow_null=True)
    customer_name = serializers.CharField(source="customer.name", allow_null=True, default=None)


class CrmUnassignedLeadSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    name = serializers.CharField()
    phone = serializers.CharField()
    source = serializers.CharField()
    created_at = serializers.DateTimeField()


class CrmOverviewSerializer(serializers.Serializer):
    kpis = CrmOverviewKpisSerializer()
    pipeline = CrmPipelineCountSerializer(many=True)
    overdue_tasks = CrmOverdueTaskSerializer(many=True)
    unassigned_leads = CrmUnassignedLeadSerializer(many=True)
```

- [ ] **Step 4: Add the view**

Append to `backend/apps/crm/views.py`. First confirm the imports at the top of the file already
include `APIView`, `Response`, `require_permission`, and `services` (they are used by the
existing viewsets); add `CrmOverviewSerializer` to the serializers import line. Then append:

```python
# ──────────────────────────────────────────────────────────────────────────────
# CRM overview  (read-only dashboard hub)
# ──────────────────────────────────────────────────────────────────────────────


class CrmOverviewView(ShopScopedMixin, APIView):
    """GET /crm/overview/ — KPI counts, lead pipeline, and needs-attention lists."""

    def get_permissions(self):
        return [require_permission("crm.customers.view")()]

    def get(self, request):
        shop_id = request.query_params.get("shop_id")
        data = services.get_crm_overview(self._shop_filter(), shop_id)
        return Response(CrmOverviewSerializer(data).data)
```

> Verify the view imports: run
> `grep -nE "from rest_framework.views import APIView|from rest_framework.response import Response|require_permission|from . import serializers|from .serializers import" backend/apps/crm/views.py`.
> If serializers are imported by name (`from .serializers import ...`), add `CrmOverviewSerializer`
> to that list; if imported as a module (`from . import serializers`), reference
> `serializers.CrmOverviewSerializer` instead. Mirror exactly what the existing viewsets do.

- [ ] **Step 5: Add the route**

In `backend/apps/crm/urls.py`, import the view and add the path **before** the router include:

```python
from .views import (
    CommunicationLogViewSet,
    CrmOverviewView,
    CustomerSegmentViewSet,
    CustomerViewSet,
    FollowUpTaskViewSet,
    LeadViewSet,
)

# ... router registrations unchanged ...

urlpatterns = [
    path("overview/", CrmOverviewView.as_view(), name="crm-overview"),
    path("", include(router.urls)),
]
```

- [ ] **Step 6: Run the overview tests to verify they pass**

Run: `cd backend && python -m pytest apps/crm/tests/test_overview.py --no-cov -q`
Expected: PASS (all 4 tests).

- [ ] **Step 7: Run the full CRM suite (regression)**

Run: `cd backend && python -m pytest apps/crm/tests/ --no-cov -q 2>&1 | tail -5`
Expected: all pass.

- [ ] **Step 8: Commit**

```bash
git add backend/apps/crm/serializers.py backend/apps/crm/views.py backend/apps/crm/urls.py backend/apps/crm/tests/test_overview.py
git commit -m "feat(crm): add CRM overview endpoint (serializers, view, route)"
```

---

## Task 3: Frontend API client + query key

**Files:**
- Modify: `frontend/src/lib/api/crm.ts` (add type + method)
- Modify: `frontend/src/lib/query/keys.ts` (add `crmOverview`)
- Test: `frontend/src/lib/api/__tests__/crm.test.ts` (append, if the file asserts request URLs)

- [ ] **Step 1: Add the `CrmOverview` type**

In `frontend/src/lib/api/crm.ts`, add near the other exported interfaces (after the `Lead`
types, so `LeadStatus` / `LeadSource` are in scope):

```typescript
export interface CrmOverview {
  kpis: {
    new_leads: number;
    tasks_due_today: number;
    tasks_overdue: number;
    conversions_30d: number;
    new_customers_30d: number;
  };
  pipeline: Array<{ status: LeadStatus; count: number }>;
  overdue_tasks: Array<{
    id: string;
    title: string;
    due_date: string;
    assigned_to_name: string | null;
    customer_name: string | null;
  }>;
  unassigned_leads: Array<{
    id: string;
    name: string;
    phone: string;
    source: LeadSource;
    created_at: string;
  }>;
}
```

- [ ] **Step 2: Add the `getOverview` method**

Inside the `export const crmApi = { ... }` object, add (place it first, before `listLeads`):

```typescript
  getOverview: (shopId?: string) =>
    apiGet<CrmOverview>('/crm/overview/', shopId ? { shop_id: shopId } : {}),
```

- [ ] **Step 3: Add the query key**

In `frontend/src/lib/query/keys.ts`, add to the `qk` object (next to `repairOverview`):

```typescript
  crmOverview: (shopId: string | null) => ['crm-overview', shopId] as const,
```

- [ ] **Step 4: Type-check**

Run: `cd frontend && npx tsc --noEmit 2>&1 | grep "error TS" || echo "OK no errors"`
Expected: `OK no errors`.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/api/crm.ts frontend/src/lib/query/keys.ts
git commit -m "feat(crm): add crmApi.getOverview client + query key"
```

---

## Task 4: Restructure the CRM sidebar nav

**Files:**
- Modify: `frontend/src/components/shared/AppShell.tsx` (CRM group + icon imports)
- Test: `frontend/src/components/shared/__tests__/navItems.test.ts` (append CRM assertions)

- [ ] **Step 1: Write the failing nav test**

Append to `frontend/src/components/shared/__tests__/navItems.test.ts`:

```typescript
function crmGroup() {
  const entry = NAV_ITEMS.find(
    (e: NavEntry) => e.type === 'group' && e.label === 'CRM',
  );
  if (!entry || entry.type !== 'group') throw new Error('CRM group not found');
  return entry;
}

describe('NAV_ITEMS — CRM group', () => {
  it('has the Overview leaf first, at /crm, gated on crm.customers.view', () => {
    const children = crmGroup().children;
    expect(children[0].href).toBe('/crm');
    expect(children[0].label).toBe('Overview');
    expect(children[0].permission).toBe('crm.customers.view');
  });

  it('surfaces Tasks gated on crm.tasks.manage', () => {
    const t = crmGroup().children.find((c) => c.href === '/tasks');
    expect(t).toBeDefined();
    expect(t!.permission).toBe('crm.tasks.manage');
  });

  it('surfaces Segments gated on crm.segments.manage', () => {
    const s = crmGroup().children.find((c) => c.href === '/settings/segments');
    expect(s).toBeDefined();
    expect(s!.label).toBe('Segments');
    expect(s!.permission).toBe('crm.segments.manage');
  });

  it('keeps Customers and Leads', () => {
    const hrefs = crmGroup().children.map((c) => c.href);
    expect(hrefs).toContain('/customers');
    expect(hrefs).toContain('/leads');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run src/components/shared/__tests__/navItems.test.ts 2>&1 | tail -8`
Expected: FAIL (Overview leaf at `/crm` not found).

- [ ] **Step 3: Add the icon imports**

In `frontend/src/components/shared/AppShell.tsx`, extend the lucide-react import (line ~9) to
include `ListChecks` and `Filter`:

```typescript
  Bell, Search, LogOut, User, UserCheck, Boxes, Receipt, ClipboardList, ListChecks, Filter,
```

- [ ] **Step 4: Replace the CRM group children**

Replace the CRM group block (currently Customers + Leads only) with:

```typescript
  { type: 'group', label: 'CRM', icon: UserCheck, children: [
    { type: 'leaf', label: 'Overview',  href: '/crm',               icon: LayoutDashboard, permission: 'crm.customers.view' },
    { type: 'leaf', label: 'Customers', href: '/customers',         icon: Users,           permission: 'crm.customers.view' },
    { type: 'leaf', label: 'Leads',     href: '/leads',             icon: Users,           permission: 'crm.leads.view' },
    { type: 'leaf', label: 'Tasks',     href: '/tasks',             icon: ListChecks,      permission: 'crm.tasks.manage' },
    { type: 'leaf', label: 'Segments',  href: '/settings/segments', icon: Filter,          permission: 'crm.segments.manage' },
  ]},
```

- [ ] **Step 5: Run the nav test to verify it passes**

Run: `cd frontend && npx vitest run src/components/shared/__tests__/navItems.test.ts 2>&1 | tail -8`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/shared/AppShell.tsx frontend/src/components/shared/__tests__/navItems.test.ts
git commit -m "feat(crm): surface Overview, Tasks, Segments in CRM sidebar group"
```

---

## Task 5: CRM Overview page

**Files:**
- Create: `frontend/src/app/(app)/crm/page.tsx`
- Test: `frontend/src/app/(app)/crm/__tests__/page.test.tsx`

- [ ] **Step 1: Write the failing page test**

Create `frontend/src/app/(app)/crm/__tests__/page.test.tsx`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import CrmOverviewPage from '../page';

vi.mock('@/lib/stores/activeShopStore', () => ({
  useActiveShopStore: () => ({ activeShopId: 'shop-1', isAllShops: false }),
}));
vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: () => ({ hasPermission: () => true, hasAnyPermission: () => true }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const getOverview = vi.fn();
vi.mock('@/lib/api/crm', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/api/crm')>();
  return { ...actual, crmApi: { ...actual.crmApi, getOverview: (...a: unknown[]) => getOverview(...a) } };
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><CrmOverviewPage /></QueryClientProvider>);
}

const SAMPLE = {
  kpis: { new_leads: 3, tasks_due_today: 5, tasks_overdue: 2, conversions_30d: 4, new_customers_30d: 6 },
  pipeline: [
    { status: 'new', count: 3 }, { status: 'contacted', count: 1 }, { status: 'interested', count: 0 },
    { status: 'quoted', count: 0 }, { status: 'converted', count: 4 }, { status: 'lost', count: 1 },
  ],
  overdue_tasks: [
    { id: 't1', title: 'Call Ravi', due_date: '2026-06-20', assigned_to_name: 'Asha', customer_name: 'Ravi Kumar' },
  ],
  unassigned_leads: [
    { id: 'l1', name: 'New Lead', phone: '+919812345678', source: 'walk_in', created_at: '2026-06-23' },
  ],
};

describe('CrmOverviewPage', () => {
  beforeEach(() => getOverview.mockReset());

  it('renders KPI values and needs-attention items', async () => {
    getOverview.mockResolvedValue(SAMPLE);
    renderPage();
    expect(await screen.findByText('Call Ravi')).toBeInTheDocument();
    expect(screen.getByText('New Lead')).toBeInTheDocument();
    // new_leads KPI value
    expect(screen.getAllByText('3').length).toBeGreaterThan(0);
  });

  it('shows an empty needs-attention state when lists are empty', async () => {
    getOverview.mockResolvedValue({ ...SAMPLE, overdue_tasks: [], unassigned_leads: [] });
    renderPage();
    expect(await screen.findByText(/All clear/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npx vitest run "src/app/(app)/crm/__tests__/page.test.tsx" 2>&1 | tail -8`
Expected: FAIL (`Cannot find module '../page'`).

- [ ] **Step 3: Implement the page**

Create `frontend/src/app/(app)/crm/page.tsx`:

```tsx
'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { UserPlus, ListChecks, AlertTriangle, TrendingUp, Users } from 'lucide-react';
import { crmApi, type CrmOverview } from '@/lib/api/crm';
import { qk } from '@/lib/query/keys';
import { useActiveShopStore } from '@/lib/stores/activeShopStore';

const PIPELINE_LABEL: Record<string, string> = {
  new: 'New', contacted: 'Contacted', interested: 'Interested',
  quoted: 'Quoted', converted: 'Converted', lost: 'Lost',
};

const KPI_DEFS: Array<{ key: keyof CrmOverview['kpis']; label: string; icon: React.ElementType; tone: string }> = [
  { key: 'new_leads',          label: 'New leads',         icon: UserPlus,      tone: 'text-[var(--text)]' },
  { key: 'tasks_due_today',    label: 'Tasks due today',   icon: ListChecks,    tone: 'text-[var(--text)]' },
  { key: 'tasks_overdue',      label: 'Overdue tasks',     icon: AlertTriangle, tone: 'text-[var(--danger)]' },
  { key: 'conversions_30d',    label: 'Conversions (30d)', icon: TrendingUp,    tone: 'text-[var(--success)]' },
  { key: 'new_customers_30d',  label: 'New customers (30d)', icon: Users,       tone: 'text-[var(--text)]' },
];

export default function CrmOverviewPage() {
  const { activeShopId, isAllShops } = useActiveShopStore();
  const shopId = isAllShops ? undefined : activeShopId ?? undefined;

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: qk.crmOverview(shopId ?? null),
    queryFn: () => crmApi.getOverview(shopId),
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <div className="p-4 md:p-6 space-y-4">
        <div className="h-7 w-40 bg-[var(--surface-2)] rounded animate-pulse" />
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {KPI_DEFS.map((k) => <div key={k.key} className="h-24 bg-[var(--surface-2)] rounded-lg animate-pulse" />)}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6">
        <p className="text-body-sm text-[var(--danger)] mb-3">Couldn’t load the CRM overview.</p>
        <button onClick={() => refetch()} className="text-body-sm underline">Retry</button>
      </div>
    );
  }

  const noAttention = data.overdue_tasks.length === 0 && data.unassigned_leads.length === 0;

  return (
    <div className="p-4 md:p-6 space-y-6">
      <h1 className="text-h2 font-semibold">CRM Overview</h1>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {KPI_DEFS.map(({ key, label, icon: Icon, tone }) => (
          <div key={key} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
            <Icon className={`h-4 w-4 mb-2 ${tone}`} />
            <div className="text-h3 font-semibold">{data.kpis[key]}</div>
            <div className="text-body-sm text-[var(--text-muted)]">{label}</div>
          </div>
        ))}
      </div>

      {/* Pipeline */}
      <section>
        <h2 className="text-body font-medium mb-2">Lead pipeline</h2>
        <div className="flex flex-wrap gap-2">
          {data.pipeline.map((p) => (
            <Link key={p.status} href={`/leads?status=${p.status}`}
              className="rounded-md border border-[var(--border)] px-3 py-2 text-body-sm hover:bg-[var(--surface-2)]">
              <span className="text-[var(--text-muted)]">{PIPELINE_LABEL[p.status] ?? p.status}</span>{' '}
              <span className="font-semibold">{p.count}</span>
            </Link>
          ))}
        </div>
      </section>

      {/* Needs attention */}
      <section>
        <h2 className="text-body font-medium mb-2">Needs attention</h2>
        {noAttention ? (
          <p className="text-body-sm text-[var(--text-muted)]">All clear — no overdue tasks or unassigned leads.</p>
        ) : (
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <h3 className="text-body-sm font-medium mb-1">Overdue tasks</h3>
              <ul className="space-y-1">
                {data.overdue_tasks.map((t) => (
                  <li key={t.id} className="text-body-sm flex justify-between border-b border-[var(--border)] py-1">
                    <span>{t.title}{t.customer_name ? ` · ${t.customer_name}` : ''}</span>
                    <span className="text-[var(--text-muted)]">{t.due_date}</span>
                  </li>
                ))}
                {data.overdue_tasks.length === 0 && <li className="text-body-sm text-[var(--text-muted)]">None</li>}
              </ul>
            </div>
            <div>
              <h3 className="text-body-sm font-medium mb-1">Unassigned new leads</h3>
              <ul className="space-y-1">
                {data.unassigned_leads.map((l) => (
                  <li key={l.id} className="text-body-sm flex justify-between border-b border-[var(--border)] py-1">
                    <Link href={`/leads/${l.id}`} className="hover:underline">{l.name}</Link>
                    <span className="text-[var(--text-muted)]">{l.phone}</span>
                  </li>
                ))}
                {data.unassigned_leads.length === 0 && <li className="text-body-sm text-[var(--text-muted)]">None</li>}
              </ul>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
```

- [ ] **Step 4: Run the page test to verify it passes**

Run: `cd frontend && npx vitest run "src/app/(app)/crm/__tests__/page.test.tsx" 2>&1 | tail -8`
Expected: PASS (both tests).

- [ ] **Step 5: Type-check**

Run: `cd frontend && npx tsc --noEmit 2>&1 | grep "error TS" || echo "OK no errors"`
Expected: `OK no errors` (ignore any pre-existing `Can.test.tsx` errors unrelated to this work).

- [ ] **Step 6: Commit**

```bash
git add "frontend/src/app/(app)/crm/page.tsx" "frontend/src/app/(app)/crm/__tests__/page.test.tsx"
git commit -m "feat(crm): add CRM Overview page at /crm"
```

---

## Final verification

- [ ] **Backend suite**

Run: `cd backend && python manage.py makemigrations crm --check --dry-run` → Expected: `No changes detected` (no model changes this phase).
Run: `cd backend && python -m pytest apps/crm/tests/ --no-cov -q 2>&1 | tail -5` → Expected: all pass.

- [ ] **Frontend suite**

Run: `cd frontend && npx vitest run src/components/shared/__tests__/navItems.test.ts "src/app/(app)/crm/__tests__/page.test.tsx" src/lib/api/__tests__/crm.test.ts 2>&1 | tail -10` → Expected: all pass.
Run: `cd frontend && npx tsc --noEmit 2>&1 | grep "error TS" || echo "OK no errors"` → Expected: only pre-existing unrelated errors, if any.

- [ ] **Manual smoke** (demo tenant, `X-Tenant-Slug: demo`)

1. Sidebar → CRM now lists **Overview · Customers · Leads · Tasks · Segments**.
2. CRM → Overview lands on `/crm`; KPI tiles, pipeline chips, and needs-attention lists render.
3. Pipeline chip → navigates to `/leads?status=…`. Unassigned-lead row → opens the lead.
4. A user lacking `crm.tasks.manage` / `crm.segments.manage` does **not** see those leaves.

---

## Notes / risks

- **No migration** in this phase — purely additive endpoint + frontend.
- **Auth fixture** is the one place to verify against the codebase (token helper name); the
  inline note in Task 2 Step 1 says exactly what to confirm and the fallback.
- **Tasks are tenant-wide** in the overview by design (no `shop_id` on `FollowUpTask`); revisit
  only if/when tasks gain shop scoping in a later phase.
- **`?status=` deep-link** on `/leads` must be honored by the leads page; it already reads a
  status from the kanban columns, but confirm the query-param is picked up — if not, this is a
  one-line addition handled in Phase 2 (leads filters), not a blocker here.
```
