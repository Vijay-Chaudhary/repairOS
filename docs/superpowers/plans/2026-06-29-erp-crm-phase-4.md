# ERP/CRM Phase 4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the four Phase-4 "repair depth" features from the approved spec — Estimates worklist, Warranty worklist, Serial/IMEI device history, and (net-new) Job attachments — filling the Phase-0 `/repair/estimates` and `/repair/warranty` stubs and deepening the job detail page.

**Architecture:** All in the `repair` app. Two read-only worklist endpoints over existing data (mirroring `crm.LeadQuoteViewSet`), one device-history endpoint + a one-line `global_search` extension, and one net-new `JobAttachment` model that makes the currently no-op `/attachments` action persist. Frontend fills the two stubs and adds Device-history + Attachments sections to the job detail page (reusing `PhotoUploader`).

**Tech Stack:** Django 4.2 + DRF, pytest; Next.js 14 App Router + TS strict, React Query, Tailwind, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-29-erp-crm-phase-4-design.md`

---

## Reference patterns (read before starting)

- repair uses `from crm.views import ShopScopedMixin` (so `_shop_filter()` returns `shop_id__in`; for `JobEstimate` filter on `job__shop_id__in` instead): `apps/repair/views.py:16`.
- Read-only worklist viewset: `crm.LeadQuoteViewSet(ListModelMixin, GenericViewSet)` (`apps/crm/views.py`).
- repair router registration: `apps/repair/urls.py`. Standalone APIView example: `RepairOverviewView`.
- `JobEstimate` model (status: draft/sent/approved/rejected/expired) + `JobEstimateSerializer`: `apps/repair/models.py:188`, `apps/repair/serializers.py:198`.
- `JobTicket` fields `serial_number`, `imei`, `warranty_expires_at`, `warranty_of_job`: `apps/repair/models.py:73-129`.
- The no-op attachments action to rework: `apps/repair/views.py:323`.
- `global_search` job block to extend: `apps/core/services.py:84-92`.
- Response envelope `{success, data}`; tests read `.json()["data"]`. JWT `client_with_perms` factory: reuse from `apps/billing/tests/test_outstanding.py`.
- `PhotoUploader` (`value: string[]`, `onChange(urls)`): `frontend/src/components/shared/PhotoUploader.tsx`. CRM quotes worklist page to mirror: `frontend/src/app/(app)/crm/quotes/page.tsx`. `repairApi` + `qk`: `frontend/src/lib/api/repair.ts`, `frontend/src/lib/query/keys.ts`. Job detail Tabs: `frontend/src/app/(app)/jobs/[id]/page.tsx`.

**Shared backend test fixtures** (paste where needed):

```python
import uuid
import pytest

@pytest.fixture
def shop(db):
    from core.models import Shop
    return Shop.objects.create(name="S", code="HTA", address="a", city="Delhi",
                               state="Delhi", state_code="07", phone="+919876543210")

@pytest.fixture
def client_with_perms(db):
    from authentication.models import User
    from rest_framework.test import APIClient
    from rest_framework_simplejwt.tokens import RefreshToken
    def _make(perms, shop_ids=None):
        s = uuid.uuid4().hex[:8]
        user = User.objects.create_user(email=f"u{s}@t.com", phone=f"+9190{uuid.uuid4().int % 100000000:08d}",
                                        full_name="T", password="Pass@123")
        access = RefreshToken.for_user(user).access_token
        access["permissions"] = perms
        if shop_ids is not None:
            access["shop_ids"] = [str(x) for x in shop_ids]
        c = APIClient(); c.credentials(HTTP_AUTHORIZATION=f"Bearer {str(access)}")
        return c, user
    return _make

def make_job(shop, **kw):
    """Create a JobTicket with the minimal required fields."""
    from decimal import Decimal
    from authentication.models import User
    from crm.models import Customer
    from repair.models import JobTicket
    cust = kw.pop("customer", None) or Customer.objects.create(shop=shop, name="C", phone=f"+9198{uuid.uuid4().int % 100000000:08d}")
    creator = kw.pop("created_by", None) or User.objects.create_user(
        email=f"j{uuid.uuid4().hex[:6]}@t.com", phone=f"+9197{uuid.uuid4().int % 100000000:08d}", full_name="J", password="p")
    defaults = dict(shop=shop, customer=cust, created_by=creator, job_number=f"HTA-{uuid.uuid4().hex[:6]}",
                    device_type="Laptop", device_brand="Dell", device_model="X",
                    problem_description="p", service_charge=Decimal("100"), status=JobTicket.Status.OPEN)
    defaults.update(kw)
    return JobTicket.objects.create(**defaults)
```

> **Shop-scope helper** (reused across worklist endpoints — JWT-based, scoping on `job__shop`):
> ```python
> def _scoped_job_ids_q(request, field="job__shop_id"):
>     """Return a Q filtering on the job's shop per the JWT, or Q() if tenant-wide."""
>     from django.db.models import Q
>     token = getattr(request, "auth", None) or {}
>     if token.get("is_tenant_wide") or token.get("is_platform_admin"):
>         return Q()
>     return Q(**{f"{field}__in": token.get("shop_ids", [])})
> ```
> Add this helper near the top of `apps/repair/views.py` (after imports) and reuse it in Tasks 1/3/5.

**Build order:** Tasks 1-2 (Estimates), 3-4 (Warranty), 5-6 (Serial/IMEI), 7-8 (Attachments), 9 (verify). Each task ends in a commit.

---

## Task 1: Estimates worklist — backend

**Files:** Modify `apps/repair/views.py`, `apps/repair/serializers.py`, `apps/repair/urls.py`; test `apps/repair/tests/test_estimates_worklist.py`.

- [ ] **Step 1: Failing test** (include shared fixtures + `make_job`):

```python
import pytest
from decimal import Decimal
from rest_framework import status


def _estimate(job, **kw):
    from repair.models import JobEstimate
    defaults = dict(estimate_number=f"EST-{job.job_number}", labor_charge=Decimal("100"),
                    parts_cost=Decimal("0"), total_estimate=Decimal("100"), status="sent")
    defaults.update(kw)
    return JobEstimate.objects.create(job=job, **defaults)


@pytest.mark.django_db
def test_estimates_worklist_lists_with_job_and_customer(shop, client_with_perms):
    job = make_job(shop)
    _estimate(job)
    client, _ = client_with_perms(["repair.estimates.view"], shop_ids=[shop.id])
    resp = client.get("/api/v1/repair/estimates/")
    assert resp.status_code == status.HTTP_200_OK
    items = resp.json()["data"]["items"]
    assert items and items[0]["job_number"] == job.job_number
    assert "customer_name" in items[0]


@pytest.mark.django_db
def test_estimates_worklist_status_filter_and_permission(shop, client_with_perms):
    job = make_job(shop)
    _estimate(job, status="sent")
    _estimate(job, estimate_number="EST-2", status="approved")
    client, _ = client_with_perms(["repair.estimates.view"], shop_ids=[shop.id])
    resp = client.get("/api/v1/repair/estimates/?status=approved")
    nums = {i["status"] for i in resp.json()["data"]["items"]}
    assert nums == {"approved"}

    nope, _ = client_with_perms([], shop_ids=[shop.id])
    assert nope.get("/api/v1/repair/estimates/").status_code == status.HTTP_403_FORBIDDEN
```

- [ ] **Step 2: Run → FAIL** (404). `python -m pytest apps/repair/tests/test_estimates_worklist.py -p no:cacheprovider -o addopts="" -q`

- [ ] **Step 3: Serializer** — append to `apps/repair/serializers.py`:

```python
class JobEstimateListSerializer(serializers.ModelSerializer):
    job_id = serializers.UUIDField(source="job.id", read_only=True)
    job_number = serializers.CharField(source="job.job_number", read_only=True)
    customer_name = serializers.CharField(source="job.customer.name", read_only=True)

    class Meta:
        model = JobEstimate
        fields = ["id", "job_id", "job_number", "customer_name", "estimate_number",
                  "labor_charge", "parts_cost", "total_estimate", "valid_until",
                  "status", "sent_at", "created_at"]
```

> Confirm `JobEstimate` is imported in `serializers.py` (it is — `JobEstimateSerializer` uses it).

- [ ] **Step 4: ViewSet** — add `ListModelMixin` to the viewsets import (`from rest_framework.mixins import ListModelMixin`) and append to `apps/repair/views.py`:

```python
class JobEstimateWorklistViewSet(ListModelMixin, GenericViewSet):
    """Cross-job estimate worklist. Per-job create lives at /jobs/{id}/estimate/."""

    pagination_class = RepairOSPageNumberPagination
    serializer_class = JobEstimateListSerializer

    def get_permissions(self):
        return [require_permission("repair.estimates.view")()]

    def get_queryset(self):
        from .models import JobEstimate
        qs = JobEstimate.objects.select_related("job", "job__customer").filter(_scoped_job_ids_q(self.request))
        if s := self.request.query_params.get("status"):
            qs = qs.filter(status=s)
        if df := self.request.query_params.get("date_from"):
            qs = qs.filter(created_at__date__gte=df)
        if dt := self.request.query_params.get("date_to"):
            qs = qs.filter(created_at__date__lte=dt)
        return qs.order_by("-created_at")
```

> Add `JobEstimateListSerializer` to the serializer imports in `views.py`.

- [ ] **Step 5: Route** — in `apps/repair/urls.py` import `JobEstimateWorklistViewSet` and
`router.register("estimates", JobEstimateWorklistViewSet, basename="estimates")`.

- [ ] **Step 6: Run → PASS.** Then `python -m pytest apps/repair -p no:cacheprovider -o addopts="" -q` (no regressions).

- [ ] **Step 7: Commit**
```bash
git add backend/apps/repair/views.py backend/apps/repair/serializers.py backend/apps/repair/urls.py backend/apps/repair/tests/test_estimates_worklist.py
git commit -m "feat(repair): cross-job estimates worklist endpoint"
```

---

## Task 2: Estimates worklist — frontend

**Files:** Modify `frontend/src/lib/api/repair.ts`, `frontend/src/lib/query/keys.ts`; replace `frontend/src/app/(app)/repair/estimates/page.tsx`.

- [ ] **Step 1: API client + type** — in `repair.ts` add:

```typescript
export type EstimateStatus = 'draft' | 'sent' | 'approved' | 'rejected' | 'expired';

export interface EstimateWorklistRow {
  id: string;
  job_id: string;
  job_number: string;
  customer_name: string;
  estimate_number: string;
  labor_charge: string;
  parts_cost: string;
  total_estimate: string;
  valid_until: string | null;
  status: EstimateStatus;
  sent_at: string | null;
  created_at: string;
}

// inside repairApi:
  listEstimates: (filters: { status?: EstimateStatus; date_from?: string; date_to?: string; page?: number } = {}) =>
    apiGet<{ items: EstimateWorklistRow[]; meta: PageMeta }>('/repair/estimates/', filters as Record<string, string | number | undefined>),
```

- [ ] **Step 2: Query key** — in `keys.ts`, inside `qk`:
```typescript
  estimates: (filters?: Record<string, unknown>) => ['repair', 'estimates', filters ?? {}] as const,
```

- [ ] **Step 3: Page** — replace `frontend/src/app/(app)/repair/estimates/page.tsx` with a React-Query
list (estimate #, job #, customer, total, status badge, sent date) linking rows to `/jobs/{job_id}`.
Mirror `frontend/src/app/(app)/crm/quotes/page.tsx` structure (read-only worklist with a status
filter). Use `repairApi.listEstimates`, `qk.estimates`, `EmptyState`, `Skeleton`, `formatDate`, and a
money helper `₹${Number(v).toLocaleString('en-IN')}`.

> Provide the full component following the quotes-page pattern; do not leave it as a sketch. Use
> `useRouter().push(`/jobs/${row.job_id}`)` on row click.

- [ ] **Step 4: Verify** — from `frontend/`: `npx tsc --noEmit` (0); `npx vitest run` (no regressions).

- [ ] **Step 5: Commit**
```bash
git add frontend/src/lib/api/repair.ts frontend/src/lib/query/keys.ts frontend/src/app/\(app\)/repair/estimates/page.tsx
git commit -m "feat(repair): Estimates worklist page (replaces stub)"
```

---

## Task 3: Warranty worklist — backend

**Files:** Modify `apps/repair/views.py`, `apps/repair/services.py`, `apps/repair/urls.py`; test `apps/repair/tests/test_warranty_worklist.py`.

- [ ] **Step 1: Failing test**:

```python
import pytest
from datetime import date, timedelta
from rest_framework import status


@pytest.mark.django_db
def test_warranty_lists_active_and_claims(shop, client_with_perms):
    from repair.models import JobTicket
    active = make_job(shop, warranty_expires_at=date.today() + timedelta(days=20))
    original = make_job(shop)
    claim = make_job(shop, warranty_of_job=original)

    client, _ = client_with_perms(["repair.warranty.view"], shop_ids=[shop.id])
    body = client.get("/api/v1/repair/warranty/").json()["data"]
    active_ids = {r["job_id"] for r in body["active"]}
    claim_ids = {r["job_id"] for r in body["claims"]}
    assert str(active.id) in active_ids
    assert str(claim.id) in claim_ids
    # days_remaining present on active rows
    assert all("days_remaining" in r for r in body["active"])


@pytest.mark.django_db
def test_warranty_requires_permission(shop, client_with_perms):
    client, _ = client_with_perms([], shop_ids=[shop.id])
    assert client.get("/api/v1/repair/warranty/").status_code == status.HTTP_403_FORBIDDEN
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Service** — append to `apps/repair/services.py`:

```python
def build_warranty_lists(job_filter) -> dict:
    """Active warranties (not yet expired) + warranty-claim jobs. `job_filter` is a Q on JobTicket."""
    from datetime import date
    from .models import JobTicket

    today = date.today()
    base = JobTicket.objects.filter(job_filter).select_related("customer", "warranty_of_job")

    active = base.filter(warranty_expires_at__gte=today).order_by("warranty_expires_at")
    claims = base.filter(warranty_of_job__isnull=False).order_by("-created_at")

    def _device(j):
        return f"{j.device_brand} {j.device_model}".strip() or j.device_type

    return {
        "active": [{
            "job_id": str(j.id), "job_number": j.job_number, "customer_name": j.customer.name,
            "device": _device(j), "warranty_expires_at": str(j.warranty_expires_at),
            "days_remaining": (j.warranty_expires_at - today).days,
        } for j in active],
        "claims": [{
            "job_id": str(j.id), "job_number": j.job_number, "customer_name": j.customer.name,
            "device": _device(j), "status": j.status,
            "original_job_id": str(j.warranty_of_job_id) if j.warranty_of_job_id else None,
            "original_job_number": j.warranty_of_job.job_number if j.warranty_of_job else None,
            "created_at": j.created_at.isoformat(),
        } for j in claims],
    }
```

- [ ] **Step 4: View** — append to `apps/repair/views.py` (the helper resolves shop scope on the job directly — pass `field="shop_id"`):

```python
class WarrantyWorklistView(APIView):
    permission_classes = [IsAuthenticated, require_permission("repair.warranty.view")]

    def get(self, request: Request) -> Response:
        job_filter = _scoped_job_ids_q(request, field="shop_id")
        return Response(services.build_warranty_lists(job_filter))
```

> Add `IsAuthenticated` and `Request` to the rest_framework imports in `views.py` if not present
> (`from rest_framework.permissions import IsAuthenticated`, `from rest_framework.request import Request`).

- [ ] **Step 5: Route** — in `apps/repair/urls.py` `urlpatterns`, add before the router include:
`path("warranty/", WarrantyWorklistView.as_view(), name="warranty")` (import `WarrantyWorklistView`).

> Declare `warranty/` as an explicit path (not a router route) so it doesn't collide with `jobs/`.

- [ ] **Step 6: Run → PASS** + `python -m pytest apps/repair -p no:cacheprovider -o addopts="" -q`.

- [ ] **Step 7: Commit**
```bash
git add backend/apps/repair/views.py backend/apps/repair/services.py backend/apps/repair/urls.py backend/apps/repair/tests/test_warranty_worklist.py
git commit -m "feat(repair): warranty worklist endpoint (active + claims)"
```

---

## Task 4: Warranty worklist — frontend

**Files:** Modify `frontend/src/lib/api/repair.ts`, `frontend/src/lib/query/keys.ts`; replace `frontend/src/app/(app)/repair/warranty/page.tsx`.

- [ ] **Step 1: API client + types**:

```typescript
export interface WarrantyActiveRow {
  job_id: string; job_number: string; customer_name: string; device: string;
  warranty_expires_at: string; days_remaining: number;
}
export interface WarrantyClaimRow {
  job_id: string; job_number: string; customer_name: string; device: string; status: string;
  original_job_id: string | null; original_job_number: string | null; created_at: string;
}
export interface WarrantyLists { active: WarrantyActiveRow[]; claims: WarrantyClaimRow[]; }

// inside repairApi:
  getWarranty: () => apiGet<WarrantyLists>('/repair/warranty/'),
```

- [ ] **Step 2: Query key** — `warranty: () => ['repair', 'warranty'] as const,`

- [ ] **Step 3: Page** — replace the `/repair/warranty` stub with a page that toggles **Active** /
**Claims** (local `useState` tab) over `repairApi.getWarranty()`. Active table: job #, customer,
device, expires, days remaining (highlight ≤7). Claims table: job #, customer, device, status,
original job. Rows link to `/jobs/{job_id}`. Full component (React Query + Skeleton + EmptyState).

- [ ] **Step 4: Verify** — `npx tsc --noEmit` (0); `npx vitest run`.

- [ ] **Step 5: Commit**
```bash
git add frontend/src/lib/api/repair.ts frontend/src/lib/query/keys.ts frontend/src/app/\(app\)/repair/warranty/page.tsx
git commit -m "feat(repair): Warranty worklist page (active + claims)"
```

---

## Task 5: Serial/IMEI — device-history endpoint + search extension

**Files:** Modify `apps/repair/views.py`, `apps/repair/urls.py`, `apps/core/services.py`; test `apps/repair/tests/test_device_history.py`, `apps/core/tests/test_search.py` (extend).

- [ ] **Step 1: Failing tests**:

```python
# apps/repair/tests/test_device_history.py
import pytest
from rest_framework import status


@pytest.mark.django_db
def test_device_history_matches_serial_and_imei(shop, client_with_perms):
    make_job(shop, serial_number="SN-123", job_number="HTA-A")
    make_job(shop, imei="IMEI-999", job_number="HTA-B")
    client, _ = client_with_perms(["repair.jobs.view"], shop_ids=[shop.id])

    by_serial = client.get("/api/v1/repair/device-history/?serial=SN-123").json()["data"]["items"]
    assert {r["job_number"] for r in by_serial} == {"HTA-A"}

    by_imei = client.get("/api/v1/repair/device-history/?imei=IMEI-999").json()["data"]["items"]
    assert {r["job_number"] for r in by_imei} == {"HTA-B"}

    # no query → empty
    assert client.get("/api/v1/repair/device-history/").json()["data"]["items"] == []
```

```python
# add to apps/core/tests/test_search.py
@pytest.mark.django_db
def test_search_finds_job_by_serial(shop, client_with_perms):
    from crm.models import Customer
    from authentication.models import User
    from repair.models import JobTicket
    from decimal import Decimal
    cust = Customer.objects.create(shop=shop, name="C", phone="+919811111111")
    u = User.objects.create_user(email="z@t.com", phone="+919800000044", full_name="Z", password="p")
    JobTicket.objects.create(shop=shop, customer=cust, created_by=u, job_number="HTA-Z",
                             device_type="Laptop", device_brand="Dell", device_model="X",
                             problem_description="p", service_charge=Decimal("1"),
                             status=JobTicket.Status.OPEN, serial_number="ZZZ-SERIAL")
    client, _ = client_with_perms(["repair.jobs.view"], shop_ids=[shop.id])
    body = client.get("/api/v1/search/?q=ZZZ-SERIAL").json()["data"]
    assert any(r["type"] == "job" for r in body["results"])
```

> The `apps/core/tests/test_search.py` `client_with_perms` already accepts `shop_ids`; reuse it.

- [ ] **Step 2: Run → FAIL** (both).

- [ ] **Step 3: Device-history view** — append to `apps/repair/views.py`:

```python
class DeviceHistoryView(APIView):
    permission_classes = [IsAuthenticated, require_permission("repair.jobs.view")]

    def get(self, request: Request) -> Response:
        from .models import JobTicket
        serial = (request.query_params.get("serial") or "").strip()
        imei = (request.query_params.get("imei") or "").strip()
        if not serial and not imei:
            return Response({"items": []})

        q = Q()
        if serial:
            q |= Q(serial_number__icontains=serial)
        if imei:
            q |= Q(imei__icontains=imei)
        jobs = (JobTicket.objects.filter(_scoped_job_ids_q(request, field="shop_id"))
                .filter(q).select_related("customer").order_by("-created_at")[:50])
        return Response({"items": [{
            "job_id": str(j.id), "job_number": j.job_number, "status": j.status,
            "device": f"{j.device_brand} {j.device_model}".strip() or j.device_type,
            "created_at": j.created_at.isoformat(),
        } for j in jobs]})
```

- [ ] **Step 4: Route** — in `apps/repair/urls.py` `urlpatterns` add
`path("device-history/", DeviceHistoryView.as_view(), name="device-history")` (import it).

- [ ] **Step 5: Extend global search** — in `apps/core/services.py`, the `job` block (~line 87), add
serial/imei to the `Q`:

```python
        qs = scoped(JobTicket.objects.select_related("customer").filter(
            Q(job_number__icontains=term) | Q(device_brand__icontains=term)
            | Q(device_model__icontains=term) | Q(customer__name__icontains=term)
            | Q(serial_number__icontains=term) | Q(imei__icontains=term)
        ))[:SEARCH_CAP]
```

- [ ] **Step 6: Run both tests → PASS.**

- [ ] **Step 7: Commit**
```bash
git add backend/apps/repair/views.py backend/apps/repair/urls.py backend/apps/core/services.py backend/apps/repair/tests/test_device_history.py backend/apps/core/tests/test_search.py
git commit -m "feat(repair): device-history endpoint + serial/IMEI global search"
```

---

## Task 6: Serial/IMEI — job-detail Device history section

**Files:** Modify `frontend/src/lib/api/repair.ts`, `frontend/src/lib/query/keys.ts`, `frontend/src/app/(app)/jobs/[id]/page.tsx`.

- [ ] **Step 1: API client + type**:

```typescript
export interface DeviceHistoryRow {
  job_id: string; job_number: string; status: string; device: string; created_at: string;
}
// inside repairApi:
  getDeviceHistory: (params: { serial?: string; imei?: string }) =>
    apiGet<{ items: DeviceHistoryRow[] }>('/repair/device-history/', params),
```

- [ ] **Step 2: Query key** — `deviceHistory: (params?: Record<string, unknown>) => ['repair', 'device-history', params ?? {}] as const,`

- [ ] **Step 3: Job-detail section** — in `jobs/[id]/page.tsx`, when the loaded job has a
`serial_number` or `imei`, query `getDeviceHistory({ serial, imei })` and render a **Device history**
section/tab listing other jobs for the same device (filter out the current job id), each linking to
`/jobs/{job_id}`. Mirror the page's existing tab/section pattern.

> **Plan-time confirmation:** the `JobDetail` type's field names for serial/imei (likely
> `serial_number`, `imei`) in `repair.ts`; confirm before reading them. If the job detail uses Tabs,
> add a "Device history" tab; otherwise a card section. Read-only.

- [ ] **Step 4: Verify** — `npx tsc --noEmit` (0); `npx vitest run`.

- [ ] **Step 5: Commit**
```bash
git add frontend/src/lib/api/repair.ts frontend/src/lib/query/keys.ts frontend/src/app/\(app\)/jobs/\[id\]/page.tsx
git commit -m "feat(repair): device-history section on job detail"
```

---

## Task 7: Job attachments — model + endpoints

**Files:** Modify `apps/repair/models.py`, migration, `apps/repair/serializers.py`, `apps/repair/views.py`; test `apps/repair/tests/test_attachments.py`.

- [ ] **Step 1: Failing test**:

```python
import pytest
from rest_framework import status


@pytest.mark.django_db
def test_attachment_persist_and_list(shop, client_with_perms):
    job = make_job(shop)
    editor, _ = client_with_perms(["repair.jobs.edit", "repair.jobs.view"], shop_ids=[shop.id])

    resp = editor.post(f"/api/v1/repair/jobs/{job.id}/attachments/",
                       {"url": "s3://bucket/a.jpg", "filename": "a.jpg", "kind": "before"}, format="json")
    assert resp.status_code == status.HTTP_201_CREATED, resp.content

    resp = editor.get(f"/api/v1/repair/jobs/{job.id}/attachments/")
    assert resp.status_code == status.HTTP_200_OK
    items = resp.json()["data"]
    assert any(a["filename"] == "a.jpg" and a["kind"] == "before" for a in items)


@pytest.mark.django_db
def test_attachment_create_requires_edit(shop, client_with_perms):
    job = make_job(shop)
    viewer, _ = client_with_perms(["repair.jobs.view"], shop_ids=[shop.id])
    resp = viewer.post(f"/api/v1/repair/jobs/{job.id}/attachments/", {"url": "x"}, format="json")
    assert resp.status_code == status.HTTP_403_FORBIDDEN
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Model** — append to `apps/repair/models.py`:

```python
class JobAttachment(BaseModel):
    class Kind(models.TextChoices):
        BEFORE = "before", "Before"
        AFTER = "after", "After"
        DOCUMENT = "document", "Document"

    job = models.ForeignKey(JobTicket, on_delete=models.CASCADE, related_name="attachments")
    url = models.CharField(max_length=500)
    filename = models.CharField(max_length=255, blank=True, default="")
    content_type = models.CharField(max_length=100, blank=True, default="")
    kind = models.CharField(max_length=20, choices=Kind.choices, default=Kind.DOCUMENT)
    uploaded_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True,
                                    on_delete=models.SET_NULL, related_name="job_attachments")

    class Meta:
        app_label = "repair"
        db_table = "job_attachments"
        indexes = [models.Index(fields=["job", "created_at"])]

    def __str__(self) -> str:
        return f"{self.filename or self.url} ({self.kind})"
```

> Confirm `settings` is imported in `models.py` (it is — `JobStage` uses `settings.AUTH_USER_MODEL`).

- [ ] **Step 4: Migration** — `python manage.py makemigrations repair`.

- [ ] **Step 5: Serializer** — append to `apps/repair/serializers.py`:

```python
class JobAttachmentSerializer(serializers.ModelSerializer):
    uploaded_by_name = serializers.CharField(source="uploaded_by.full_name", read_only=True, default=None)

    class Meta:
        model = JobAttachment
        fields = ["id", "url", "filename", "content_type", "kind", "uploaded_by_name", "created_at"]
        read_only_fields = ["id", "uploaded_by_name", "created_at"]
```

> Add `JobAttachment` to the model imports in `serializers.py`.

- [ ] **Step 6: Rework the action** — in `apps/repair/views.py`, replace the no-op `attachments`
action on `JobTicketViewSet` with persist + list (GET also allowed):

```python
    @action(detail=True, methods=["get", "post"], url_path="attachments")
    def attachments(self, request, pk=None):
        from .models import JobAttachment
        from .serializers import JobAttachmentSerializer
        job = self.get_object()
        if request.method == "GET":
            qs = job.attachments.select_related("uploaded_by").order_by("-created_at")
            return Response(JobAttachmentSerializer(qs, many=True).data)
        ser = JobAttachmentSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        ser.save(job=job, uploaded_by=request.user)
        return Response(ser.data, status=status.HTTP_201_CREATED)
```

> The action needs method-dependent permissions: GET → `repair.jobs.view`, POST → `repair.jobs.edit`.
> In `get_permissions`, add a branch for `self.action == "attachments"`:
> `return [require_permission("repair.jobs.view" if self.request.method == "GET" else "repair.jobs.edit")()]`.
> Confirm the existing `get_permissions` structure and slot this in without breaking other actions.

- [ ] **Step 7: Run → PASS** + `python -m pytest apps/repair -p no:cacheprovider -o addopts="" -q`.

- [ ] **Step 8: Commit**
```bash
git add backend/apps/repair/models.py backend/apps/repair/migrations/ backend/apps/repair/serializers.py backend/apps/repair/views.py backend/apps/repair/tests/test_attachments.py
git commit -m "feat(repair): JobAttachment model + persist/list attachments endpoint"
```

---

## Task 8: Job attachments — frontend

**Files:** Modify `frontend/src/lib/api/repair.ts`, `frontend/src/lib/query/keys.ts`, `frontend/src/app/(app)/jobs/[id]/page.tsx`.

- [ ] **Step 1: API client + types**:

```typescript
export type AttachmentKind = 'before' | 'after' | 'document';
export interface JobAttachment {
  id: string; url: string; filename: string; content_type: string;
  kind: AttachmentKind; uploaded_by_name: string | null; created_at: string;
}
// inside repairApi:
  listAttachments: (jobId: string) =>
    apiGet<JobAttachment[]>(`/repair/jobs/${jobId}/attachments/`),
  addAttachment: (jobId: string, body: { url: string; filename?: string; content_type?: string; kind?: AttachmentKind }) =>
    apiPost<JobAttachment>(`/repair/jobs/${jobId}/attachments/`, body),
```

- [ ] **Step 2: Query key** — `jobAttachments: (jobId: string) => ['repair', 'job', jobId, 'attachments'] as const,`

- [ ] **Step 3: Job-detail Attachments section** — add an **Attachments** section/tab to
`jobs/[id]/page.tsx`: list `listAttachments(id)` (link each `url`, show kind + filename) and add new
ones via `<PhotoUploader value={[]} onChange={(urls) => urls.forEach((u) => addMutation.mutate({ url: u }))} />`
(or collect then POST). Invalidate `qk.jobAttachments(id)` on success.

> Reuse `PhotoUploader` (`value: string[]`, `onChange(urls)`); each returned url → one `addAttachment`
> call (default `kind: 'document'`). Keep it simple; gate the add UI on `repair.jobs.edit` via the
> existing `<Can>` component if the page uses it.

- [ ] **Step 4: Verify** — `npx tsc --noEmit` (0); `npx vitest run`.

- [ ] **Step 5: Commit**
```bash
git add frontend/src/lib/api/repair.ts frontend/src/lib/query/keys.ts frontend/src/app/\(app\)/jobs/\[id\]/page.tsx
git commit -m "feat(repair): job attachments section on job detail"
```

---

## Task 9: Final verification

- [ ] **Step 1: Backend suites** — from `backend/`:
`python -m pytest apps/repair apps/core apps/authentication -p no:cacheprovider -o addopts="" -q` → PASS.

- [ ] **Step 2: JobAttachment migration reversibility** — inside the backend container:
```bash
docker compose exec -T backend sh -c "python manage.py showmigrations repair | tail -4"
# migrate repair <prev> then back to <latest> per the names shown
```

- [ ] **Step 3: Frontend** — from `frontend/`: `npx tsc --noEmit`; `npx vitest run`; `npm run lint -- --no-cache` → all clean.

- [ ] **Step 4: Production build** — `docker compose exec -e NODE_ENV=production frontend sh -c "npm run build"` → exit 0; `/repair/estimates` and `/repair/warranty` real (no ComingSoon).

- [ ] **Step 5: CI deny-list** — from `backend/`: `grep -vc '^#\|^$' ci-known-failures.txt` → `0`.

---

## Notes for the implementer

- **Response envelope** `{success, data}`; backend tests read `.json()["data"]` (lists → `.data.items` for paginated, `.data` for plain list responses).
- **Shop scoping for worklists** is on the **job's shop** (`JobEstimate` has no direct shop FK). Use the `_scoped_job_ids_q` helper; for `JobTicket` queries pass `field="shop_id"`, for `JobEstimate` use the default `job__shop_id`.
- **Permission slugs already exist** — no seed changes. `repair.estimates.view` / `repair.warranty.view` were seeded in Phase 0.
- **No `any`, no `console.log`.** App Router pages export only the default component. React Query v5.
- **Attachments upload** reuses `PhotoUploader` (client-side upload → object URL); the backend persists the URL reference only (no presigned-URL backend this pass).
