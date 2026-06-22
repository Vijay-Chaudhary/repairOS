# Repair Overhaul — Phase 3: Spare Parts Management Page — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A cross-job Spare Parts worklist at `/repair/spare-parts` — list + filters, job-linked create, edit of pending requests, and the approve→order→receive status workflow — plus the Spare Parts sidebar leaf.

**Architecture:** The existing `SparePartRequestViewSet` only does PATCH-review today; this adds a shop-scoped `list`, a job-linked `create` (reusing `services.request_spare_part`), and field-edit for `requested` items (PATCH without `status`), keeping the existing review path (PATCH with `status`). The frontend adds an API client, a worklist page (`DataTable` + filters + inline status actions), a create/edit sheet with a job picker, and a nav leaf.

**Tech Stack:** Django 4.2 / DRF, pytest-django (backend); Next.js 14 App Router, TypeScript strict, Tailwind, React Query, Vitest + RTL (frontend).

**Spec:** `docs/superpowers/specs/2026-06-17-repair-module-overhaul-design.md` (Phase 3).

---

## Scope & decisions

- **Chosen scope:** worklist + status actions + **job-linked create** + **edit of pending (`requested`) items**. No DB migration — `JobSparePartRequest.job` stays required, so "create" picks a job (it is not job-less).
- **Permissions (real strings):** `repair.spare_parts.request` gates list / create / edit / nav; `repair.spare_parts.approve` gates the status workflow (approve/reject/order/receive). There is no `.view` permission.
- **Status state machine** (enforced server-side in `services.review_spare_part`, unchanged): `requested → approved | rejected`; `approved → ordered`; `ordered → received`. The UI only offers transitions valid for the current status.
- **Shop scoping:** spare-part requests have no direct shop; they are scoped via `job__shop`. Tenant-wide / platform-admin tokens see all.
- **`SparePartRequestSheet` reuse:** the existing sheet is bound to a single `jobId` (per-job create + review) and is **not** a cross-job component; Phase 3 adds a new `SparePartFormSheet` (job picker + create/edit). The existing per-job sheet stays as-is for the job-detail page.
- **Nav leaf** (deferred from Phase 1) is added here, gated on `repair.spare_parts.request`.
- **Branch:** off `master` (independent of the open Phase 1 / Phase 2 PRs — different files; only `AppShell.tsx` overlaps with Phase 1's nav, and Phase 1 only added the Overview leaf, so the merge is trivial).

## Cross-cutting UX acceptance criteria

- Worklist shows, per request: job # + customer, part, qty, urgent flag, status badge, requested date, requester. Numeric columns use `tabular-nums`.
- Status actions appear only when valid for the row's status and only for users with `repair.spare_parts.approve`; irreversible-feeling actions (reject/receive) use a confirm.
- Filter-aware empty state + skeleton loading (via `DataTable`); errors via `DataTable`/`ApiError`.
- Create/edit forms: visible labels, inline validation, loading→success/error, ≥44px targets, no `any`, no `console.log`.

---

## File Map

| File | Change |
|---|---|
| `backend/apps/repair/serializers.py` | Add `SparePartRequestListSerializer` (job context); add `SparePartCreateSerializer` |
| `backend/apps/repair/views.py` | `SparePartRequestViewSet`: add `list`, `create`, edit-in-`partial_update`, shop scoping, permission branching |
| `backend/apps/repair/tests/test_spare_parts.py` | New: list/scope/filters, create, edit-pending, review, permissions |
| `frontend/src/lib/api/repair.ts` | Add `SparePartListItem`, `SparePartFilters`, `listSpareParts`, `createSparePart`, `updateSparePart` |
| `frontend/src/lib/query/keys.ts` | Add `spareParts` key factory |
| `frontend/src/app/(app)/repair/spare-parts/page.tsx` | New worklist page (table + filters + status actions) |
| `frontend/src/app/(app)/repair/spare-parts/__tests__/page.test.tsx` | New page tests |
| `frontend/src/components/repair/SparePartFormSheet.tsx` | New create/edit sheet with job picker |
| `frontend/src/components/repair/__tests__/SparePartFormSheet.test.tsx` | New sheet tests |
| `frontend/src/components/shared/AppShell.tsx` | Add Spare Parts nav leaf to the Repair group |

---

## Task 1: Backend — list endpoint + list serializer + shop scoping + filters

**Files:**
- Modify: `backend/apps/repair/serializers.py`
- Modify: `backend/apps/repair/views.py`
- Test: `backend/apps/repair/tests/test_spare_parts.py` (new file)

Context: `SparePartRequestViewSet` currently is `GenericViewSet` with `http_method_names = ["patch", "head", "options"]`, `get_permissions` returning `repair.spare_parts.approve`, `get_queryset` returning `JobSparePartRequest.objects.all()` (unscoped), and a `partial_update` that reviews via `services.review_spare_part`. `ShopScopedMixin` (from `crm.views`) provides `_shop_filter()` (a `Q` on `shop_id`, suitable for `JobTicket`). `RepairOSPageNumberPagination` (from `core.pagination`) returns `{items, meta}`. The list endpoint path is `/api/v1/repair/spare-parts/` (router basename `spare-parts`). Test fixtures `shop`, `customer`, `admin_user`, `admin_client`, `tech_user`, `tech_client`, `api_client`, `job` live in `apps/repair/tests/test_jobs.py` — a new test file must redefine the ones it needs or import them; to follow the repo pattern, this plan's new test file **defines its own minimal fixtures** (shown below).

- [x] **Step 1: Write the failing test**

Create `backend/apps/repair/tests/test_spare_parts.py`:

```python
"""Spare Parts management endpoint — Phase 3."""
import pytest
from rest_framework.test import APIClient


@pytest.fixture
def api_client():
    return APIClient()


@pytest.fixture
def shop(db):
    from core.models import Shop
    return Shop.objects.create(
        name="Joy Computer", code="JOY", address="MG Road", city="Delhi",
        state="UP", state_code="09", phone="+919876543210",
    )


@pytest.fixture
def shop_b(db):
    from core.models import Shop
    return Shop.objects.create(
        name="Other Shop", code="OTH", address="Park St", city="Kolkata",
        state="WB", state_code="19", phone="+919812345678",
    )


@pytest.fixture
def customer(db, shop):
    from crm.models import Customer
    return Customer.objects.create(shop=shop, name="Ravi Kumar", phone="+919811100001")


def _user_with_perms(email, phone, role_name, perms):
    from authentication.models import Permission, Role, RolePermission, User, UserRole
    user = User.objects.create_user(email=email, phone=phone, full_name=role_name, password="Pass@1234")
    role, _ = Role.objects.get_or_create(name=role_name, defaults={"is_system_role": False})
    for codename in perms:
        perm, _ = Permission.objects.get_or_create(codename=codename, defaults={"module": "repair", "label": codename})
        RolePermission.objects.get_or_create(role=role, permission=perm)
    UserRole.objects.create(user=user, role=role, shop=None)
    return user


def _client(api_client, user):
    from authentication.tokens import _build_token_claims
    from rest_framework_simplejwt.tokens import RefreshToken
    access = RefreshToken.for_user(user).access_token
    for k, v in _build_token_claims(user, "test").items():
        access[k] = v
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {str(access)}")
    return api_client


@pytest.fixture
def admin_user(db):
    return _user_with_perms(
        "admin@sp.test", "+919000000020", "Tenant Admin",
        ["repair.spare_parts.request", "repair.spare_parts.approve", "repair.jobs.view"],
    )


@pytest.fixture
def admin_client(api_client, admin_user):
    return _client(api_client, admin_user)


def _make_job(shop, customer, user, **kwargs):
    from repair.services import create_job
    defaults = {"device_type": "Smartphone", "problem_description": "Screen broken.", "priority": "normal"}
    defaults.update(kwargs)
    return create_job(shop, customer, defaults, user)


def _make_request(job, user, **kwargs):
    from repair.models import JobSparePartRequest
    defaults = {"custom_part_name": "Screen", "quantity": 1, "is_urgent": False}
    defaults.update(kwargs)
    return JobSparePartRequest.objects.create(job=job, requested_by=user, **defaults)


@pytest.mark.django_db
class TestSparePartList:
    def test_list_returns_requests_with_job_context(self, admin_client, shop, customer, admin_user):
        job = _make_job(shop, customer, admin_user)
        req = _make_request(job, admin_user, custom_part_name="LCD")
        res = admin_client.get("/api/v1/repair/spare-parts/")
        assert res.status_code == 200
        assert res.data["meta"]["count"] == 1
        item = res.data["items"][0]
        assert item["id"] == str(req.id)
        assert item["job_number"] == job.job_number
        assert item["customer_name"] == customer.name
        assert item["custom_part_name"] == "LCD"

    def test_list_filters_by_status(self, admin_client, shop, customer, admin_user):
        job = _make_job(shop, customer, admin_user)
        _make_request(job, admin_user, custom_part_name="A")
        ordered = _make_request(job, admin_user, custom_part_name="B")
        from repair.models import JobSparePartRequest
        JobSparePartRequest.objects.filter(pk=ordered.pk).update(status="ordered")
        res = admin_client.get("/api/v1/repair/spare-parts/", {"status": "ordered"})
        assert {i["custom_part_name"] for i in res.data["items"]} == {"B"}

    def test_list_is_shop_scoped(self, api_client, shop, shop_b, customer, admin_user):
        # A user who can only see shop_b should not see shop_a's requests.
        from crm.models import Customer
        cust_b = Customer.objects.create(shop=shop_b, name="B Cust", phone="+919800000002")
        job_a = _make_job(shop, customer, admin_user)
        _make_request(job_a, admin_user, custom_part_name="ShopAPart")
        job_b = _make_job(shop_b, cust_b, admin_user)
        _make_request(job_b, admin_user, custom_part_name="ShopBPart")

        scoped = _user_with_perms("scoped@sp.test", "+919000000021", "ShopBStaff", ["repair.spare_parts.request"])
        from authentication.models import Role, UserRole
        # Re-scope the user to shop_b only (the helper created a shop=None role).
        UserRole.objects.filter(user=scoped).delete()
        UserRole.objects.create(user=scoped, role=Role.objects.get(name="ShopBStaff"), shop=shop_b)
        client = _client(api_client, scoped)
        res = client.get("/api/v1/repair/spare-parts/")
        names = {i["custom_part_name"] for i in res.data["items"]}
        assert "ShopBPart" in names
        assert "ShopAPart" not in names

    def test_list_requires_permission(self, api_client, shop, customer, admin_user):
        noperm = _user_with_perms("no@sp.test", "+919000000022", "NoPerm", ["crm.customers.view"])
        client = _client(api_client, noperm)
        res = client.get("/api/v1/repair/spare-parts/")
        assert res.status_code == 403
```

> The `test_list_is_shop_scoped` UserRole wiring is intentionally explicit. If the `UserRole`/`Role` relation lookup proves awkward in this codebase, simplify by fetching the role with `Role.objects.get(name="ShopBStaff")` and `UserRole.objects.create(user=scoped, role=role, shop=shop_b)` — the goal is a token whose `shop_ids` claim contains only `shop_b`. Verify `_build_token_claims` derives `shop_ids` from the user's `UserRole` rows before finalizing; adjust the fixture so the scoped user's claim includes only `shop_b.id`.

- [x] **Step 2: Run, confirm fail**

```bash
cd /home/appuser/workspace/projects/repairOS/backend
python -m pytest apps/repair/tests/test_spare_parts.py::TestSparePartList -v --no-cov 2>&1 | tail -25
```
Expected: failures (no `list` action / 405 or wrong shape).

- [x] **Step 3: Add the list serializer**

Append to `backend/apps/repair/serializers.py`:

```python
class SparePartRequestListSerializer(serializers.ModelSerializer):
    requested_by_name = serializers.CharField(source="requested_by.full_name", read_only=True)
    job_id = serializers.UUIDField(source="job.id", read_only=True)
    job_number = serializers.CharField(source="job.job_number", read_only=True)
    customer_name = serializers.CharField(source="job.customer.name", read_only=True)
    device_type = serializers.CharField(source="job.device_type", read_only=True)

    class Meta:
        model = JobSparePartRequest
        fields = [
            "id", "job_id", "job_number", "customer_name", "device_type",
            "variant_id", "custom_part_name", "quantity", "is_urgent", "status",
            "requested_by", "requested_by_name", "reviewed_by", "po_id", "created_at",
        ]
        read_only_fields = fields
```

- [x] **Step 4: Rewrite the viewset for list + scoping**

In `backend/apps/repair/views.py`, update the imports: add `SparePartRequestListSerializer` to the `.serializers` import block, add `RepairOSPageNumberPagination` if not already imported (it is imported at the top — verify), and ensure `ShopScopedMixin` is imported (it is). Replace the `SparePartRequestViewSet` class header + `get_permissions`/`get_queryset` and add `list`:

```python
class SparePartRequestViewSet(ShopScopedMixin, GenericViewSet):
    """
    GET    /spare-parts/        — cross-job worklist (shop-scoped; filters: status, shop_id, date_from, date_to)
    PATCH  /spare-parts/{id}/   — review (status) or edit a 'requested' item
    """

    pagination_class = RepairOSPageNumberPagination
    http_method_names = ["get", "patch", "head", "options"]

    def get_permissions(self):
        if self.action == "partial_update" and "status" in self.request.data:
            return [require_permission("repair.spare_parts.approve")()]
        return [require_permission("repair.spare_parts.request")()]

    def _scoped_qs(self):
        qs = JobSparePartRequest.objects.select_related("job", "job__customer", "requested_by")
        token = getattr(self.request, "auth", None)
        if token and not (token.get("is_tenant_wide") or token.get("is_platform_admin")):
            shop_ids = token.get("shop_ids", [])
            qs = qs.filter(job__shop_id__in=shop_ids) if shop_ids else qs.none()
        return qs

    def get_queryset(self):
        return self._scoped_qs()

    def list(self, request):
        qs = self._scoped_qs()
        qp = request.query_params
        if s := qp.get("status"):
            qs = qs.filter(status=s)
        if shop_id := qp.get("shop_id"):
            qs = qs.filter(job__shop_id=shop_id)
        if df := qp.get("date_from"):
            qs = qs.filter(created_at__date__gte=df)
        if dt := qp.get("date_to"):
            qs = qs.filter(created_at__date__lte=dt)
        qs = qs.order_by("-created_at")
        page = self.paginate_queryset(qs)
        serializer = SparePartRequestListSerializer(page if page is not None else qs, many=True)
        return self.get_paginated_response(serializer.data) if page is not None else Response(serializer.data)

    def partial_update(self, request, pk=None):
        from rest_framework.exceptions import NotFound
        try:
            req = self.get_queryset().get(pk=pk)
        except JobSparePartRequest.DoesNotExist:
            raise NotFound("Spare part request not found.")

        serializer = ReviewSparePartSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        vd = serializer.validated_data
        req = services.review_spare_part(req, vd["status"], request.user, vd.get("po_id"))
        return Response(SparePartRequestListSerializer(req).data)
```

> Note: `partial_update` now returns the richer list serializer (with job context) instead of `JobSparePartRequestSerializer`. The create + edit branches are added in Task 2; for now `partial_update` keeps doing review only. The previous `get_queryset` returning `.all()` is replaced by the shop-scoped version.

- [x] **Step 5: Run, confirm pass**

```bash
cd /home/appuser/workspace/projects/repairOS/backend
python -m pytest apps/repair/tests/test_spare_parts.py::TestSparePartList -v --no-cov 2>&1 | tail -20
```
Expected: 4 PASS.

- [x] **Step 6: Regression**

```bash
python -m pytest apps/repair/tests/ --no-cov 2>&1 | tail -8
```
Expected: all PASS (existing review tests still green; they may assert the response shape — if a pre-existing test asserted `JobSparePartRequestSerializer`-only fields on the PATCH response, update that assertion since the response now also includes job context fields, which is a superset).

- [x] **Step 7: Commit**

```bash
cd /home/appuser/workspace/projects/repairOS
git add backend/apps/repair/serializers.py backend/apps/repair/views.py backend/apps/repair/tests/test_spare_parts.py
git commit -m "feat(repair): add shop-scoped spare-parts list endpoint with filters

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Backend — job-linked create + edit-pending

**Files:**
- Modify: `backend/apps/repair/serializers.py`
- Modify: `backend/apps/repair/views.py`
- Test: `backend/apps/repair/tests/test_spare_parts.py` (append)

- [x] **Step 1: Write the failing tests**

Append to `backend/apps/repair/tests/test_spare_parts.py`:

```python
@pytest.mark.django_db
class TestSparePartCreate:
    def test_create_job_linked_request(self, admin_client, shop, customer, admin_user):
        job = _make_job(shop, customer, admin_user)
        res = admin_client.post("/api/v1/repair/spare-parts/", {
            "job_id": str(job.id), "custom_part_name": "Battery", "quantity": 2, "is_urgent": True,
        }, format="json")
        assert res.status_code == 201
        assert res.data["job_number"] == job.job_number
        assert res.data["custom_part_name"] == "Battery"
        assert res.data["status"] == "requested"

    def test_create_requires_job_id(self, admin_client, shop, customer, admin_user):
        res = admin_client.post("/api/v1/repair/spare-parts/", {
            "custom_part_name": "Battery", "quantity": 1,
        }, format="json")
        assert res.status_code == 400
        assert "job_id" in res.data

    def test_create_rejects_job_outside_shop_scope(self, api_client, shop, shop_b, customer, admin_user):
        job = _make_job(shop, customer, admin_user)
        scoped = _user_with_perms("scoped2@sp.test", "+919000000023", "ShopBStaff2", ["repair.spare_parts.request"])
        from authentication.models import Role, UserRole
        UserRole.objects.filter(user=scoped).delete()
        UserRole.objects.create(user=scoped, role=Role.objects.get(name="ShopBStaff2"), shop=shop_b)
        client = _client(api_client, scoped)
        res = client.post("/api/v1/repair/spare-parts/", {
            "job_id": str(job.id), "custom_part_name": "X", "quantity": 1,
        }, format="json")
        assert res.status_code in (400, 404)

    def test_create_requires_request_permission(self, api_client, shop, customer, admin_user):
        job = _make_job(shop, customer, admin_user)
        noperm = _user_with_perms("no2@sp.test", "+919000000024", "NoPerm2", ["crm.customers.view"])
        client = _client(api_client, noperm)
        res = client.post("/api/v1/repair/spare-parts/", {
            "job_id": str(job.id), "custom_part_name": "X", "quantity": 1,
        }, format="json")
        assert res.status_code == 403


@pytest.mark.django_db
class TestSparePartEdit:
    def test_edit_pending_fields(self, admin_client, shop, customer, admin_user):
        job = _make_job(shop, customer, admin_user)
        req = _make_request(job, admin_user, custom_part_name="Old", quantity=1)
        res = admin_client.patch(f"/api/v1/repair/spare-parts/{req.id}/", {
            "custom_part_name": "New", "quantity": 3,
        }, format="json")
        assert res.status_code == 200
        assert res.data["custom_part_name"] == "New"
        assert res.data["quantity"] == 3

    def test_edit_blocked_once_not_requested(self, admin_client, shop, customer, admin_user):
        job = _make_job(shop, customer, admin_user)
        req = _make_request(job, admin_user)
        from repair.models import JobSparePartRequest
        JobSparePartRequest.objects.filter(pk=req.pk).update(status="approved")
        res = admin_client.patch(f"/api/v1/repair/spare-parts/{req.id}/", {
            "quantity": 5,
        }, format="json")
        assert res.status_code == 400

    def test_review_still_works(self, admin_client, shop, customer, admin_user):
        job = _make_job(shop, customer, admin_user)
        req = _make_request(job, admin_user)
        res = admin_client.patch(f"/api/v1/repair/spare-parts/{req.id}/", {
            "status": "approved",
        }, format="json")
        assert res.status_code == 200
        assert res.data["status"] == "approved"

    def test_edit_requires_request_permission(self, api_client, shop, customer, admin_user):
        job = _make_job(shop, customer, admin_user)
        req = _make_request(job, admin_user)
        approver_only = _user_with_perms("appr@sp.test", "+919000000025", "ApproverOnly", ["repair.spare_parts.approve"])
        client = _client(api_client, approver_only)
        res = client.patch(f"/api/v1/repair/spare-parts/{req.id}/", {
            "quantity": 9,
        }, format="json")
        assert res.status_code == 403
```

- [x] **Step 2: Run, confirm fail**

```bash
cd /home/appuser/workspace/projects/repairOS/backend
python -m pytest apps/repair/tests/test_spare_parts.py::TestSparePartCreate apps/repair/tests/test_spare_parts.py::TestSparePartEdit -v --no-cov 2>&1 | tail -25
```
Expected: failures (no `create`; PATCH without `status` currently 400s on the review serializer; edit-permission not yet branched).

- [x] **Step 3: Add the create serializer**

Append to `backend/apps/repair/serializers.py`:

```python
class SparePartCreateSerializer(serializers.Serializer):
    job_id = serializers.UUIDField()
    variant_id = serializers.UUIDField(required=False, allow_null=True)
    custom_part_name = serializers.CharField(required=False, allow_blank=True, default="")
    quantity = serializers.IntegerField(min_value=1)
    is_urgent = serializers.BooleanField(default=False)

    def validate(self, attrs):
        if not attrs.get("variant_id") and not attrs.get("custom_part_name"):
            raise serializers.ValidationError("Provide either variant_id or custom_part_name.")
        return attrs
```

- [x] **Step 4: Add `create` + edit branch to the viewset**

In `backend/apps/repair/views.py`: add `"post"` to `http_method_names` and `SparePartCreateSerializer` to the serializers import. Add a `create` method and rework `partial_update` to branch on `status`:

```python
    http_method_names = ["get", "post", "patch", "head", "options"]
```

```python
    def create(self, request):
        from rest_framework.exceptions import ValidationError, NotFound
        serializer = SparePartCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        vd = dict(serializer.validated_data)
        job_id = vd.pop("job_id")
        try:
            job = JobTicket.objects.filter(self._shop_filter()).get(pk=job_id)
        except JobTicket.DoesNotExist:
            raise NotFound("Job not found in your shops.")
        req = services.request_spare_part(job, vd, request.user)
        return Response(SparePartRequestListSerializer(req).data, status=status.HTTP_201_CREATED)

    def partial_update(self, request, pk=None):
        from rest_framework.exceptions import NotFound, ValidationError
        try:
            req = self.get_queryset().get(pk=pk)
        except JobSparePartRequest.DoesNotExist:
            raise NotFound("Spare part request not found.")

        # Review (status transition)
        if "status" in request.data:
            serializer = ReviewSparePartSerializer(data=request.data)
            serializer.is_valid(raise_exception=True)
            vd = serializer.validated_data
            req = services.review_spare_part(req, vd["status"], request.user, vd.get("po_id"))
            return Response(SparePartRequestListSerializer(req).data)

        # Edit a still-'requested' item's fields
        if req.status != JobSparePartRequest.RequestStatus.REQUESTED:
            raise ValidationError("Only requested items can be edited.")
        editor = JobSparePartRequestSerializer(req, data=request.data, partial=True)
        editor.is_valid(raise_exception=True)
        for field in ("variant_id", "custom_part_name", "quantity", "is_urgent"):
            if field in editor.validated_data:
                setattr(req, field, editor.validated_data[field])
        req.save(update_fields=["variant_id", "custom_part_name", "quantity", "is_urgent", "updated_at"])
        return Response(SparePartRequestListSerializer(req).data)
```

`JobTicket` is already imported in `views.py` (used by `JobTicketViewSet`). `status` (the DRF module) is imported at the top.

- [x] **Step 5: Run, confirm pass**

```bash
cd /home/appuser/workspace/projects/repairOS/backend
python -m pytest apps/repair/tests/test_spare_parts.py -v --no-cov 2>&1 | tail -25
```
Expected: all classes PASS.

- [x] **Step 6: Regression**

```bash
python -m pytest apps/repair/tests/ --no-cov 2>&1 | tail -8
```
Expected: all PASS.

- [x] **Step 7: Commit**

```bash
cd /home/appuser/workspace/projects/repairOS
git add backend/apps/repair/serializers.py backend/apps/repair/views.py backend/apps/repair/tests/test_spare_parts.py
git commit -m "feat(repair): job-linked spare-part create and edit-pending on the worklist endpoint

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Frontend — types, API client, query key

**Files:**
- Modify: `frontend/src/lib/api/repair.ts`
- Modify: `frontend/src/lib/query/keys.ts`

- [x] **Step 1: Add types + client methods**

In `frontend/src/lib/api/repair.ts`, add the worklist item type and filters near the other interfaces (above `export const repairApi`):

```typescript
export interface SparePartListItem {
  id: string;
  job_id: string;
  job_number: string;
  customer_name: string;
  device_type: string;
  variant_id?: string | null;
  custom_part_name: string;
  quantity: number;
  is_urgent: boolean;
  status: SparePartStatus;
  requested_by: string;
  requested_by_name?: string;
  reviewed_by?: string | null;
  po_id?: string | null;
  created_at: string;
}

export interface SparePartFilters {
  status?: SparePartStatus;
  shop_id?: string;
  date_from?: string;
  date_to?: string;
  page?: number;
}

export interface SparePartListResponse {
  items: SparePartListItem[];
  meta: PageMeta;
}
```

Inside `repairApi`, add (after the existing `reviewSparePart`):

```typescript
  listSpareParts: (filters: SparePartFilters = {}) =>
    apiGet<SparePartListResponse>('/repair/spare-parts/', filters as Record<string, string | number | boolean | undefined>),

  createSparePart: (body: { job_id: string; custom_part_name?: string; variant_id?: string; quantity: number; is_urgent?: boolean }) =>
    apiPost<SparePartListItem>('/repair/spare-parts/', body),

  updateSparePart: (id: string, body: Partial<{ custom_part_name: string; quantity: number; is_urgent: boolean }>) =>
    apiPatch<SparePartListItem>(`/repair/spare-parts/${id}/`, body),
```

> `reviewSparePart` already exists and returns `SparePartRequest`; the backend now returns the richer list shape, but the existing callers only read `status`, so leave `reviewSparePart`'s return type as-is to avoid churn.

- [x] **Step 2: Add the query key**

In `frontend/src/lib/query/keys.ts`, add next to `repairOverview`:

```typescript
  spareParts: listKey('spare-parts'),
```
(`listKey` is the existing factory used by `jobs`, `customers`, etc.)

- [x] **Step 3: Typecheck + commit**

```bash
cd /home/appuser/workspace/projects/repairOS/frontend
npx tsc --noEmit 2>&1 | grep "error TS" | grep -v "Can.test.tsx" || echo "OK no errors"
```
Expected: `OK no errors`.

```bash
cd /home/appuser/workspace/projects/repairOS
git add frontend/src/lib/api/repair.ts frontend/src/lib/query/keys.ts
git commit -m "feat(repair): spare-parts list/create/update API client + query key

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Frontend — Spare Parts worklist page (list + filters + status actions)

**Files:**
- Create: `frontend/src/app/(app)/repair/spare-parts/page.tsx`
- Test: `frontend/src/app/(app)/repair/spare-parts/__tests__/page.test.tsx`

Context: reuse `DataTable` (`@/components/shared/DataTable`), `StatusBadge`, `Money` not needed here, `Can`, `Button`, `Select*`, `useActiveShopStore`, `qk`, `repairApi`, `formatDate`. Status transitions per row come from a small map. Actions call `repairApi.reviewSparePart(id, { status })` and invalidate `qk.spareParts()`. The page owns filter state (status + date range) and page number.

- [x] **Step 1: Write the failing test**

Create `frontend/src/app/(app)/repair/spare-parts/__tests__/page.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import SparePartsPage from '../page';

vi.mock('@/lib/stores/activeShopStore', () => ({
  useActiveShopStore: () => ({ activeShopId: 'shop-1', isAllShops: false }),
}));
vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: () => ({ hasPermission: () => true, hasAnyPermission: () => true }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const listSpareParts = vi.fn();
vi.mock('@/lib/api/repair', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/api/repair')>();
  return { ...actual, repairApi: { ...actual.repairApi, listSpareParts: (...a: unknown[]) => listSpareParts(...a) } };
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><SparePartsPage /></QueryClientProvider>);
}

const SAMPLE = {
  items: [{
    id: 'r1', job_id: 'j1', job_number: 'JOY-2026-0001', customer_name: 'Ravi Kumar',
    device_type: 'Smartphone', custom_part_name: 'LCD Screen', quantity: 2, is_urgent: true,
    status: 'requested', requested_by: 'u1', requested_by_name: 'Asha', created_at: '2026-06-10',
  }],
  meta: { count: 1, total_pages: 1, page: 1, page_size: 20 },
};

describe('SparePartsPage', () => {
  beforeEach(() => listSpareParts.mockReset());

  it('shows a loading skeleton then the request row', async () => {
    listSpareParts.mockResolvedValue(SAMPLE);
    renderPage();
    expect(await screen.findByText('LCD Screen')).toBeInTheDocument();
    expect(screen.getByText('JOY-2026-0001')).toBeInTheDocument();
    expect(screen.getByText('Ravi Kumar')).toBeInTheDocument();
  });

  it('renders an empty state when there are no requests', async () => {
    listSpareParts.mockResolvedValue({ items: [], meta: { count: 0, total_pages: 0, page: 1, page_size: 20 } });
    renderPage();
    expect(await screen.findByText(/no spare-part requests/i)).toBeInTheDocument();
  });
});
```

- [x] **Step 2: Run, confirm fail**

```bash
cd /home/appuser/workspace/projects/repairOS/frontend
npx vitest run "src/app/(app)/repair/spare-parts/__tests__/page.test.tsx" 2>&1 | tail -20
```
Expected: FAIL (module not found).

- [x] **Step 3: Implement the page**

Create `frontend/src/app/(app)/repair/spare-parts/page.tsx`:

```tsx
'use client';

import React, { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, AlertTriangle } from 'lucide-react';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Button } from '@/components/ui/button';
import { Can } from '@/components/shared/Can';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { SparePartFormSheet } from '@/components/repair/SparePartFormSheet';
import { repairApi, type SparePartListItem, type SparePartStatus } from '@/lib/api/repair';
import { qk } from '@/lib/query/keys';
import { useActiveShopStore } from '@/lib/stores/activeShopStore';
import { formatDate } from '@/lib/format/date';
import { ApiError } from '@/lib/api/client';

const STATUS_OPTIONS: Array<{ value: SparePartStatus | 'all'; label: string }> = [
  { value: 'all', label: 'All statuses' },
  { value: 'requested', label: 'Requested' },
  { value: 'approved', label: 'Approved' },
  { value: 'ordered', label: 'Ordered' },
  { value: 'received', label: 'Received' },
  { value: 'rejected', label: 'Rejected' },
];

// Allowed next actions per current status (mirrors the backend state machine)
const NEXT_ACTIONS: Partial<Record<SparePartStatus, Array<{ to: SparePartStatus; label: string }>>> = {
  requested: [{ to: 'approved', label: 'Approve' }, { to: 'rejected', label: 'Reject' }],
  approved: [{ to: 'ordered', label: 'Mark ordered' }],
  ordered: [{ to: 'received', label: 'Mark received' }],
};

export default function SparePartsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { activeShopId, isAllShops } = useActiveShopStore();
  const shopId = isAllShops ? undefined : activeShopId ?? undefined;

  const [status, setStatus] = useState<SparePartStatus | 'all'>('all');
  const [page, setPage] = useState(1);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<SparePartListItem | null>(null);

  const filters = useMemo(() => ({
    shop_id: shopId,
    status: status === 'all' ? undefined : status,
    page,
  }), [shopId, status, page]);

  React.useEffect(() => { setPage(1); }, [status, shopId]);

  const listQuery = useQuery({
    queryKey: qk.spareParts(filters),
    queryFn: () => repairApi.listSpareParts(filters),
    staleTime: 30_000,
  });

  const reviewMutation = useMutation({
    mutationFn: ({ id, to }: { id: string; to: SparePartStatus }) => repairApi.reviewSparePart(id, { status: to }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.spareParts() });
      toast.success('Updated');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Update failed'),
  });

  const columns: Column<SparePartListItem>[] = [
    {
      key: 'job', header: 'Job / Customer',
      cell: (r) => (
        <button
          className="text-left"
          onClick={(e) => { e.stopPropagation(); router.push(`/jobs/${r.job_id}`); }}
        >
          <span className="block text-body-sm font-medium text-[var(--accent)] hover:underline">{r.customer_name}</span>
          <span className="block text-xs font-mono text-[var(--text-muted)]">{r.job_number} · {r.device_type}</span>
        </button>
      ),
    },
    {
      key: 'part', header: 'Part',
      cell: (r) => (
        <span className="inline-flex items-center gap-1.5 text-body-sm text-[var(--text)]">
          {r.is_urgent && <AlertTriangle className="h-3.5 w-3.5 text-[var(--warning)] shrink-0" />}
          {r.custom_part_name || r.variant_id}
        </span>
      ),
    },
    { key: 'qty', header: 'Qty', headerClassName: 'w-[60px] text-right', className: 'text-right', cell: (r) => <span className="tabular-nums">{r.quantity}</span> },
    { key: 'status', header: 'Status', headerClassName: 'w-[130px]', cell: (r) => <StatusBadge status={r.status} /> },
    { key: 'requested_by', header: 'Requested by', cell: (r) => <span className="text-body-sm text-[var(--text-muted)]">{r.requested_by_name ?? '—'}</span> },
    { key: 'created', header: 'Requested', headerClassName: 'w-[110px]', cell: (r) => <span className="text-body-sm text-[var(--text-muted)] tabular-nums">{formatDate(r.created_at)}</span> },
    {
      key: 'actions', header: '', headerClassName: 'w-[200px]', className: 'text-right',
      cell: (r) => (
        <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
          {r.status === 'requested' && (
            <Can permission="repair.spare_parts.request">
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => { setEditTarget(r); setSheetOpen(true); }}>Edit</Button>
            </Can>
          )}
          <Can permission="repair.spare_parts.approve">
            {(NEXT_ACTIONS[r.status] ?? []).map((a) => (
              <Button
                key={a.to}
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                disabled={reviewMutation.isPending}
                onClick={() => reviewMutation.mutate({ id: r.id, to: a.to })}
              >
                {a.label}
              </Button>
            ))}
          </Can>
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border)] bg-[var(--surface)] flex-wrap">
        <h1 className="text-h1 text-[var(--text)] mr-2">Spare Parts</h1>
        <Select value={status} onValueChange={(v) => setStatus(v as SparePartStatus | 'all')}>
          <SelectTrigger className="h-9 w-[150px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="ml-auto">
          <Can permission="repair.spare_parts.request">
            <Button size="sm" className="h-9" onClick={() => { setEditTarget(null); setSheetOpen(true); }}>
              <Plus className="h-4 w-4" /><span className="hidden sm:inline">New request</span>
            </Button>
          </Can>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4 md:p-6">
        <DataTable
          columns={columns}
          data={listQuery.data?.items}
          loading={listQuery.isLoading}
          error={listQuery.error as Error | null}
          keyExtractor={(r) => r.id}
          emptyTitle="No spare-part requests"
          emptyDescription="Requests from jobs appear here. Create one with “New request”."
          page={page}
          totalPages={listQuery.data?.meta?.total_pages}
          onPageChange={setPage}
          totalCount={listQuery.data?.meta?.count}
        />
      </div>

      <SparePartFormSheet
        open={sheetOpen}
        onOpenChange={setSheetOpen}
        editTarget={editTarget}
      />
    </div>
  );
}
```

- [x] **Step 4: Run, confirm pass** (this depends on `SparePartFormSheet` from Task 5; if running before Task 5, create a minimal stub first — but the recommended order is Task 5 before Task 4's test run. If executing in order, run Task 4's test after Task 5 is implemented.)

```bash
cd /home/appuser/workspace/projects/repairOS/frontend
npx vitest run "src/app/(app)/repair/spare-parts/__tests__/page.test.tsx" 2>&1 | tail -20
```
Expected (after Task 5 exists): 2 PASS. The page test mocks `listSpareParts`; `SparePartFormSheet` renders closed (no job fetch).

> Execution note: Task 5 creates `SparePartFormSheet`. Because Task 4's page imports it, implement Task 5 immediately after Task 4's code step and before running Task 4's test — or temporarily import a stub. The two tasks are committed separately but their tests pass once both exist.

- [x] **Step 5: Typecheck + commit**

```bash
npx tsc --noEmit 2>&1 | grep "error TS" | grep -v "Can.test.tsx" || echo "OK no errors"
```

```bash
cd /home/appuser/workspace/projects/repairOS
git add "frontend/src/app/(app)/repair/spare-parts/page.tsx" "frontend/src/app/(app)/repair/spare-parts/__tests__/page.test.tsx"
git commit -m "feat(repair): spare-parts worklist page with filters and status actions

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Frontend — create/edit sheet with job picker

**Files:**
- Create: `frontend/src/components/repair/SparePartFormSheet.tsx`
- Test: `frontend/src/components/repair/__tests__/SparePartFormSheet.test.tsx`

Context: a `Sheet` (`@/components/ui/sheet`) with a react-hook-form + zod form (the repo uses `@hookform/resolvers/zod`, see `SparePartRequestSheet.tsx` for the exact import pattern). Two modes: **create** (job picker + part fields → `repairApi.createSparePart`) and **edit** (part fields only, job fixed → `repairApi.updateSparePart`). Job picker: a search input that queries `repairApi.listJobs({ search })` (debounced via the existing `useDebounce` hook) and lists results to pick. On success, invalidate `qk.spareParts()`.

- [x] **Step 1: Write the failing test**

Create `frontend/src/components/repair/__tests__/SparePartFormSheet.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SparePartFormSheet } from '../SparePartFormSheet';
import type { SparePartListItem } from '@/lib/api/repair';

const createSparePart = vi.fn();
const updateSparePart = vi.fn();
const listJobs = vi.fn();
vi.mock('@/lib/api/repair', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/api/repair')>();
  return {
    ...actual,
    repairApi: {
      ...actual.repairApi,
      createSparePart: (...a: unknown[]) => createSparePart(...a),
      updateSparePart: (...a: unknown[]) => updateSparePart(...a),
      listJobs: (...a: unknown[]) => listJobs(...a),
    },
  };
});

function wrap(ui: React.ReactNode) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}>{ui}</QueryClientProvider>);
}

const EDIT_TARGET: SparePartListItem = {
  id: 'r1', job_id: 'j1', job_number: 'JOY-2026-0001', customer_name: 'Ravi Kumar',
  device_type: 'Smartphone', custom_part_name: 'LCD', quantity: 2, is_urgent: false,
  status: 'requested', requested_by: 'u1', created_at: '2026-06-10',
};

describe('SparePartFormSheet', () => {
  beforeEach(() => { createSparePart.mockReset(); updateSparePart.mockReset(); listJobs.mockReset(); });

  it('edit mode pre-fills part fields and submits an update', async () => {
    const user = userEvent.setup();
    updateSparePart.mockResolvedValue({ ...EDIT_TARGET, quantity: 5 });
    wrap(<SparePartFormSheet open onOpenChange={() => {}} editTarget={EDIT_TARGET} />);
    const qty = screen.getByLabelText(/quantity/i);
    expect(qty).toHaveValue(2);
    await user.clear(qty);
    await user.type(qty, '5');
    await user.click(screen.getByRole('button', { name: /save/i }));
    expect(updateSparePart).toHaveBeenCalledWith('r1', expect.objectContaining({ quantity: 5 }));
  });

  it('create mode requires picking a job before submit', async () => {
    const user = userEvent.setup();
    wrap(<SparePartFormSheet open onOpenChange={() => {}} editTarget={null} />);
    await user.type(screen.getByLabelText(/part name/i), 'Battery');
    await user.click(screen.getByRole('button', { name: /create/i }));
    // No job selected → createSparePart not called, a validation message shows
    expect(createSparePart).not.toHaveBeenCalled();
    expect(await screen.findByText(/select a job/i)).toBeInTheDocument();
  });
});
```

- [x] **Step 2: Run, confirm fail**

```bash
cd /home/appuser/workspace/projects/repairOS/frontend
npx vitest run src/components/repair/__tests__/SparePartFormSheet.test.tsx 2>&1 | tail -20
```
Expected: FAIL (module not found).

- [x] **Step 3: Implement the sheet**

Create `frontend/src/components/repair/SparePartFormSheet.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Search } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { repairApi, type SparePartListItem } from '@/lib/api/repair';
import { qk } from '@/lib/query/keys';
import { ApiError } from '@/lib/api/client';
import { useDebounce } from '@/lib/hooks/useDebounce';
import { cn } from '@/lib/utils';

interface SparePartFormSheetProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editTarget: SparePartListItem | null;
}

export function SparePartFormSheet({ open, onOpenChange, editTarget }: SparePartFormSheetProps) {
  const queryClient = useQueryClient();
  const isEdit = editTarget !== null;

  const [partName, setPartName] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [isUrgent, setIsUrgent] = useState(false);
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobLabel, setJobLabel] = useState('');
  const [jobSearch, setJobSearch] = useState('');
  const [error, setError] = useState('');

  // Reset/prefill on open
  useEffect(() => {
    if (!open) return;
    setError('');
    if (editTarget) {
      setPartName(editTarget.custom_part_name);
      setQuantity(editTarget.quantity);
      setIsUrgent(editTarget.is_urgent);
      setJobId(editTarget.job_id);
      setJobLabel(`${editTarget.job_number} · ${editTarget.customer_name}`);
    } else {
      setPartName(''); setQuantity(1); setIsUrgent(false);
      setJobId(null); setJobLabel(''); setJobSearch('');
    }
  }, [open, editTarget]);

  const debouncedSearch = useDebounce(jobSearch, 300);
  const jobResults = useQuery({
    queryKey: qk.jobs({ search: debouncedSearch || undefined, page: 1, _picker: true }),
    queryFn: () => repairApi.listJobs({ search: debouncedSearch || undefined, page: 1 }),
    enabled: !isEdit && open && debouncedSearch.trim().length > 0,
    staleTime: 15_000,
  });

  const createMutation = useMutation({
    mutationFn: () => repairApi.createSparePart({ job_id: jobId!, custom_part_name: partName, quantity, is_urgent: isUrgent }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.spareParts() });
      toast.success('Request created');
      onOpenChange(false);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Create failed'),
  });

  const updateMutation = useMutation({
    mutationFn: () => repairApi.updateSparePart(editTarget!.id, { custom_part_name: partName, quantity, is_urgent: isUrgent }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.spareParts() });
      toast.success('Request updated');
      onOpenChange(false);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Update failed'),
  });

  function handleSubmit() {
    setError('');
    if (partName.trim().length < 2) { setError('Part name is required.'); return; }
    if (quantity < 1) { setError('Quantity must be at least 1.'); return; }
    if (isEdit) { updateMutation.mutate(); return; }
    if (!jobId) { setError('Select a job for this request.'); return; }
    createMutation.mutate();
  }

  const pending = createMutation.isPending || updateMutation.isPending;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md flex flex-col">
        <SheetHeader>
          <SheetTitle>{isEdit ? 'Edit spare-part request' : 'New spare-part request'}</SheetTitle>
        </SheetHeader>

        <div className="flex-1 overflow-auto space-y-4 py-4">
          {!isEdit && (
            <div>
              <label className="text-body-sm font-medium text-[var(--text)] block mb-1">Job</label>
              {jobId ? (
                <div className="flex items-center justify-between gap-2 rounded-md border border-[var(--border)] px-3 py-2 text-body-sm">
                  <span className="truncate">{jobLabel}</span>
                  <button className="text-xs text-[var(--accent)]" onClick={() => { setJobId(null); setJobLabel(''); }}>Change</button>
                </div>
              ) : (
                <>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-muted)]" />
                    <Input className="pl-9 h-9" placeholder="Search job # or customer…" value={jobSearch} onChange={(e) => setJobSearch(e.target.value)} />
                  </div>
                  {(jobResults.data?.items ?? []).length > 0 && (
                    <ul className="mt-1 max-h-48 overflow-auto rounded-md border border-[var(--border)] divide-y divide-[var(--border)]">
                      {jobResults.data!.items.map((j) => (
                        <li key={j.id}>
                          <button
                            className="w-full text-left px-3 py-2 hover:bg-[var(--surface-2)] min-h-[44px]"
                            onClick={() => { setJobId(j.id); setJobLabel(`${j.job_number} · ${j.customer_name}`); }}
                          >
                            <span className="block text-body-sm font-medium text-[var(--text)]">{j.customer_name}</span>
                            <span className="block text-xs font-mono text-[var(--text-muted)]">{j.job_number} · {j.device_type}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </div>
          )}

          <div>
            <label htmlFor="sp-part" className="text-body-sm font-medium text-[var(--text)] block mb-1">Part name</label>
            <Input id="sp-part" className="h-9" value={partName} onChange={(e) => setPartName(e.target.value)} placeholder="e.g. LCD Screen" />
          </div>

          <div>
            <label htmlFor="sp-qty" className="text-body-sm font-medium text-[var(--text)] block mb-1">Quantity</label>
            <Input id="sp-qty" type="number" min={1} className="h-9 w-28" value={quantity}
              onChange={(e) => setQuantity(Math.max(1, Number(e.target.value) || 1))} />
          </div>

          <label className="flex items-center justify-between gap-2">
            <span className="text-body-sm font-medium text-[var(--text)]">Urgent</span>
            <Switch checked={isUrgent} onCheckedChange={setIsUrgent} />
          </label>

          {error && <p className="text-body-sm text-[var(--danger)]" role="alert">{error}</p>}
        </div>

        <div className="flex gap-3 border-t border-[var(--border)] pt-4">
          <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)} disabled={pending}>Cancel</Button>
          <Button className={cn('flex-1')} onClick={handleSubmit} disabled={pending}>
            {isEdit ? 'Save' : 'Create'}
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}
```

> `qk.jobs(...)` accepts an arbitrary filters object; the `_picker: true` marker just keeps the picker's cache key distinct from the jobs page. If `JobListItem` lacks `device_type`/`customer_name` it does have them (confirmed in `repair.ts`).

- [x] **Step 4: Run, confirm pass**

```bash
npx vitest run src/components/repair/__tests__/SparePartFormSheet.test.tsx 2>&1 | tail -20
```
Expected: 2 PASS.

- [x] **Step 5: Typecheck + commit**

```bash
npx tsc --noEmit 2>&1 | grep "error TS" | grep -v "Can.test.tsx" || echo "OK no errors"
```

```bash
cd /home/appuser/workspace/projects/repairOS
git add frontend/src/components/repair/SparePartFormSheet.tsx frontend/src/components/repair/__tests__/SparePartFormSheet.test.tsx
git commit -m "feat(repair): spare-part create/edit sheet with job picker

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Frontend — Spare Parts nav leaf

**Files:**
- Modify: `frontend/src/components/shared/AppShell.tsx`
- Test: `frontend/src/components/shared/__tests__/navItems.test.ts` (extend if present)

Context: the Repair group currently (after Phase 1) has children Overview (`/repair`) + Jobs (`/jobs`). Add a Spare Parts leaf. If Phase 1 hasn't merged into this branch's `master` base, the Repair group may still have only Jobs — adapt to whatever is present, appending the Spare Parts child either way. A `Boxes`/`PackageSearch` icon from lucide fits; `Package` is already imported in `AppShell.tsx`.

- [x] **Step 1: Add the leaf**

In `frontend/src/components/shared/AppShell.tsx`, in the `Repair` group's `children` array, append:
```typescript
    { type: 'leaf', label: 'Spare Parts', href: '/repair/spare-parts', icon: Package, permission: 'repair.spare_parts.request' },
```
(`Package` is already imported. If it isn't in the current file, add it to the lucide import.)

- [x] **Step 2: Extend the nav test (if `navItems.test.ts` exists from Phase 1)**

If `frontend/src/components/shared/__tests__/navItems.test.ts` exists (it does once Phase 1 is in the base), add a case to the existing `describe('NAV_ITEMS — Repair group')`:
```ts
  it('includes the Spare Parts leaf gated on repair.spare_parts.request', () => {
    const sp = repair!.children.find((c) => c.href === '/repair/spare-parts');
    expect(sp).toBeDefined();
    expect(sp!.permission).toBe('repair.spare_parts.request');
  });
```
If the file does NOT exist on this branch's base (Phase 1 not merged), create it with the Phase-1 nav-shape test plus this case (use the same structure as the Phase 1 `navItems.test.ts`). `NAV_ITEMS` is exported from `AppShell.tsx` (Phase 1 exported it; if not exported on this base, add `export`).

- [x] **Step 3: Run + typecheck**

```bash
cd /home/appuser/workspace/projects/repairOS/frontend
npx vitest run src/components/shared/__tests__/navItems.test.ts 2>&1 | tail -12
npx tsc --noEmit 2>&1 | grep "error TS" | grep -v "Can.test.tsx" || echo "OK no errors"
```
Expected: nav tests pass; `OK no errors`.

- [x] **Step 4: Commit**

```bash
cd /home/appuser/workspace/projects/repairOS
git add frontend/src/components/shared/AppShell.tsx frontend/src/components/shared/__tests__/navItems.test.ts
git commit -m "feat(nav): add Spare Parts leaf to the Repair group

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 7: Verification

- [x] **Step 1: Backend**

```bash
cd /home/appuser/workspace/projects/repairOS/backend
python -m pytest apps/repair/tests/ --no-cov 2>&1 | tail -8
```
Expected: all PASS (including the new `test_spare_parts.py`).

- [x] **Step 2: Frontend**

```bash
cd /home/appuser/workspace/projects/repairOS/frontend
npx vitest run 2>&1 | tail -15
npx tsc --noEmit 2>&1 | grep "error TS" | grep -v "Can.test.tsx" || echo "OK no errors"
```
Expected: Phase 3 tests pass; `tsc` clean. (Pre-existing unrelated `crm.test.ts` failure may remain — don't fix here.)

- [ ] **Step 3: Manual smoke**

1. Sidebar → Repair → **Spare Parts** (visible only with `repair.spare_parts.request`). `/repair/spare-parts` lists requests across jobs, shop-scoped; clicking a row's customer/job opens the job.
2. Filter by status → list narrows; empty filter shows "No spare-part requests".
3. **New request** → search a job, pick it, enter part + qty + urgent → Create → row appears as `requested`.
4. On a `requested` row, **Edit** (qty/part/urgent) saves; **Approve** then **Mark ordered** then **Mark received** advance the status (each only when valid; only for `repair.spare_parts.approve` users).
5. A user without `repair.spare_parts.approve` sees no status-action buttons; a user without `repair.spare_parts.request` doesn't see the nav leaf or page actions.

- [x] **Step 4: Push**

```bash
cd /home/appuser/workspace/projects/repairOS
git push -u origin <branch>
```

---

## Self-Review Notes

- **Spec coverage (Phase 3):** worklist + filters → Tasks 1, 4; status workflow → Task 1 (review path) + Task 4 (actions); job-linked create → Task 2 + Task 5; edit-pending → Task 2 + Task 5; nav leaf → Task 6. Truly job-less standalone create is intentionally out of scope (model requires `job`; chosen option avoids a migration).
- **Permissions:** list/create/edit/nav → `repair.spare_parts.request`; status workflow → `repair.spare_parts.approve`. No `.view` invented.
- **Type consistency:** `SparePartListItem` (TS) mirrors `SparePartRequestListSerializer` (DRF) field-for-field; `listSpareParts`/`createSparePart`/`updateSparePart` ↔ the viewset's `list`/`create`/`partial_update`; `qk.spareParts` uses the shared `listKey` factory; status action map mirrors the backend state machine in `services.review_spare_part`.
- **Reuse note:** the existing per-job `SparePartRequestSheet` is left intact; the cross-job page uses the new `SparePartFormSheet` (its job-picker need makes the per-job sheet unsuitable for direct reuse).
- **Inter-task dependency:** Task 4 (page) imports `SparePartFormSheet` from Task 5 — implement Task 5's component before running Task 4's test (committed separately).
