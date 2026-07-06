# Shop-Aware Registration + Multi-Shop Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a tenant admin name their shop during registration (instead of getting a placeholder), and let tenant admins add further shops later from Settings, subject to their plan's shop limit.

**Architecture:** Backend: thread an optional `shop_name` through the existing 2-step registration/provisioning flow into the already-existing `_create_default_shop()`; add a `POST /api/v1/shops/` action (on the existing `ShopListView`) gated by the already-seeded-but-unused `settings.branches.manage` permission, enforcing the already-existing-but-unused `SubscriptionPlan.max_shops`. Frontend: one new field on the registration form; a new Settings → Shops list page (replacing the single-shop settings page) with an "Add shop" dialog, and a per-shop detail route for editing.

**Tech Stack:** Django 4.2 + DRF (backend), pytest + pytest-django (backend tests), Next.js 14 App Router + TypeScript + React Hook Form + Zod + TanStack Query (frontend), Vitest + React Testing Library (frontend tests).

**Design doc:** `docs/superpowers/specs/2026-07-06-shop-registration-multi-shop-design.md`

---

## Task 1: Backend — add `PlanShopLimitExceeded` and `DuplicateShopCode` exceptions

**Files:**
- Modify: `backend/apps/core/exceptions.py`
- Test: `backend/apps/core/tests/test_exceptions.py`

- [ ] **Step 1: Write the failing test**

```python
# backend/apps/core/tests/test_exceptions.py
"""Unit tests for the new shop-related APIException subclasses."""

from rest_framework import status


def test_plan_shop_limit_exceeded_shape():
    from core.exceptions import PlanShopLimitExceeded

    exc = PlanShopLimitExceeded(max_shops=1)
    assert exc.status_code == status.HTTP_403_FORBIDDEN
    assert exc.default_code == "PLAN_SHOP_LIMIT_EXCEEDED"
    assert "1 shop(s)" in str(exc.detail)


def test_duplicate_shop_code_shape():
    from core.exceptions import DuplicateShopCode

    exc = DuplicateShopCode(code="MAIN")
    assert exc.status_code == status.HTTP_409_CONFLICT
    assert exc.default_code == "DUPLICATE_SHOP_CODE"
    assert "MAIN" in str(exc.detail)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest apps/core/tests/test_exceptions.py -v`
Expected: FAIL with `ImportError: cannot import name 'PlanShopLimitExceeded'`

- [ ] **Step 3: Add the two exception classes**

In `backend/apps/core/exceptions.py`, add after the existing `OTPRateLimit` class (before the "Custom exception handler" section):

```python
class PlanShopLimitExceeded(APIException):
    status_code = status.HTTP_403_FORBIDDEN
    default_code = "PLAN_SHOP_LIMIT_EXCEEDED"

    def __init__(self, max_shops: int):
        super().__init__(
            detail=f"Your plan allows {max_shops} shop(s). Upgrade to add more.",
            code=self.default_code,
        )


class DuplicateShopCode(APIException):
    status_code = status.HTTP_409_CONFLICT
    default_code = "DUPLICATE_SHOP_CODE"

    def __init__(self, code: str):
        super().__init__(
            detail=f"Shop code '{code}' is already in use.",
            code=self.default_code,
        )
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest apps/core/tests/test_exceptions.py -v`
Expected: PASS (2 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/apps/core/exceptions.py backend/apps/core/tests/test_exceptions.py
git commit -m "feat(core): add PlanShopLimitExceeded and DuplicateShopCode exceptions"
```

---

## Task 2: Backend — `get_tenant_max_shops()` helper

**Files:**
- Modify: `backend/apps/core/services.py`
- Test: `backend/apps/core/tests/test_get_tenant_max_shops.py`

- [ ] **Step 1: Write the failing test**

```python
# backend/apps/core/tests/test_get_tenant_max_shops.py
"""Unit tests for core.services.get_tenant_max_shops()."""

import datetime
from decimal import Decimal

import pytest


@pytest.fixture
def tenant_with_plan(db):
    from master.models import SubscriptionPlan, Tenant, TenantSubscription

    plan = SubscriptionPlan.objects.create(
        name="Starter Test", max_shops=2, max_users=5, max_products=200,
        max_jobs_per_month=200, price_monthly_inr=Decimal("999.00"),
    )
    tenant = Tenant.objects.create(
        name="Max Shops Co", slug="maxshopsco", status=Tenant.Status.ACTIVE,
        owner_email="owner@maxshopsco.com", owner_phone="+919900300001",
    )
    TenantSubscription.objects.create(
        tenant=tenant, plan=plan, status=TenantSubscription.Status.ACTIVE,
        current_period_start=datetime.date(2026, 1, 1),
        current_period_end=datetime.date(2026, 12, 31),
    )
    return tenant


def test_returns_plan_max_shops(db, tenant_with_plan):
    from core.services import get_tenant_max_shops

    assert get_tenant_max_shops("maxshopsco") == 2


def test_returns_none_for_unlimited_plan(db, tenant_with_plan):
    from core.services import get_tenant_max_shops

    sub = tenant_with_plan.subscriptions.first()
    sub.plan.max_shops = None
    sub.plan.save()

    assert get_tenant_max_shops("maxshopsco") is None


def test_returns_none_for_unknown_slug(db):
    from core.services import get_tenant_max_shops

    assert get_tenant_max_shops("no-such-tenant") is None


def test_caches_result(db, tenant_with_plan):
    from django.core.cache import cache
    from core.services import get_tenant_max_shops

    get_tenant_max_shops("maxshopsco")

    assert cache.get("tenant_max_shops:maxshopsco") == 2
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && python -m pytest apps/core/tests/test_get_tenant_max_shops.py -v`
Expected: FAIL with `ImportError: cannot import name 'get_tenant_max_shops'`

- [ ] **Step 3: Implement the helper**

In `backend/apps/core/services.py`, add at the end of the file:

```python
# ──────────────────────────────────────────────────────────────────────────────
# Tenant plan limits (used by ShopCreateView)
# ──────────────────────────────────────────────────────────────────────────────

_UNLIMITED_SENTINEL = "unlimited"


def get_tenant_max_shops(slug: str) -> int | None:
    """
    Look up the tenant's current plan's max_shops limit from the master DB.

    Returns None if the plan has no cap (or the tenant/subscription can't be
    found — fail-open, since an unrelated master-DB hiccup shouldn't block
    shop creation for tenants on unlimited plans anyway).

    Cached in Redis for TENANT_CACHE_TTL seconds, same pattern as
    TenantMiddleware._load_db_config.
    """
    from django.conf import settings
    from django.core.cache import cache

    cache_key = f"tenant_max_shops:{slug}"
    cached = cache.get(cache_key)
    if cached is not None:
        return None if cached == _UNLIMITED_SENTINEL else cached

    from master.models import TenantSubscription

    sub = (
        TenantSubscription.objects.using("default")
        .select_related("plan")
        .filter(tenant__slug=slug)
        .order_by("-created_at")
        .first()
    )
    max_shops = sub.plan.max_shops if sub else None
    cache.set(
        cache_key,
        _UNLIMITED_SENTINEL if max_shops is None else max_shops,
        timeout=settings.TENANT_CACHE_TTL,
    )
    return max_shops
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && python -m pytest apps/core/tests/test_get_tenant_max_shops.py -v`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add backend/apps/core/services.py backend/apps/core/tests/test_get_tenant_max_shops.py
git commit -m "feat(core): add get_tenant_max_shops plan-limit lookup helper"
```

---

## Task 3: Backend — `ShopCreateSerializer`

**Files:**
- Modify: `backend/apps/core/serializers.py`

- [ ] **Step 1: Add the serializer**

`backend/apps/core/serializers.py` currently only has `NotificationSerializer`. Replace the full file contents with:

```python
from rest_framework import serializers

from .models import Notification


class NotificationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Notification
        fields = ["id", "type", "title", "body", "route", "read_at", "created_at"]


class ShopCreateSerializer(serializers.Serializer):
    """POST /shops/ payload — full shop details, unlike the minimal registration form."""

    name = serializers.CharField(max_length=200)
    code = serializers.CharField(max_length=10, required=False, allow_blank=True)
    address = serializers.CharField()
    city = serializers.CharField(max_length=100)
    state = serializers.CharField(max_length=100)
    state_code = serializers.RegexField(
        regex=r"^[0-9]{2}$",
        error_messages={"invalid": "State code must be exactly 2 digits."},
    )
    phone = serializers.CharField(max_length=20)
```

No test for this step in isolation — it's exercised end-to-end by Task 4's `ShopCreateView` tests (a bare serializer with no custom `.validate()` has no independent behavior worth unit-testing).

- [ ] **Step 2: Commit**

```bash
git add backend/apps/core/serializers.py
git commit -m "feat(core): add ShopCreateSerializer"
```

---

## Task 4: Backend — `POST /shops/` on `ShopCreateView`

**Files:**
- Modify: `backend/apps/core/views.py`
- Test: `backend/apps/core/tests/test_shop_create.py`

- [ ] **Step 1: Write the failing tests**

```python
# backend/apps/core/tests/test_shop_create.py
"""Tests for POST /api/v1/shops/ — creating additional shops for an existing tenant."""

import pytest
from rest_framework import status
from rest_framework.test import APIClient


def _make_client(email, permission_codenames):
    """Authenticated tenant-wide APIClient (shop=None) with the given permissions."""
    from authentication.models import Permission, Role, RolePermission, User, UserRole
    from authentication.tokens import _build_token_claims
    from rest_framework_simplejwt.tokens import RefreshToken

    user = User.objects.create_user(
        email=email, phone="+919900200001", full_name="Admin User", password="Pass@123",
    )
    role, _ = Role.objects.get_or_create(name=f"Role_{email}")
    for codename in permission_codenames:
        perm, _ = Permission.objects.get_or_create(
            codename=codename, defaults={"module": codename.split(".")[0], "label": codename},
        )
        RolePermission.objects.get_or_create(role=role, permission=perm)
    UserRole.objects.create(user=user, role=role, shop=None)

    client = APIClient()
    refresh = RefreshToken.for_user(user)
    access = refresh.access_token
    for k, v in _build_token_claims(user, "test").items():
        access[k] = v
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {str(access)}")
    return client


@pytest.fixture
def admin_client(db):
    return _make_client("admin@shoptest.com", ["settings.branches.manage"])


@pytest.fixture
def non_admin_client(db):
    return _make_client("staff@shoptest.com", ["repair.jobs.view"])


VALID_PAYLOAD = {
    "name": "Sunrise Repairs - Whitefield",
    "address": "12 Whitefield Main Road",
    "city": "Bengaluru",
    "state": "Karnataka",
    "state_code": "29",
    "phone": "+919900200002",
}


class TestShopCreate:
    url = "/api/v1/shops/"

    def test_admin_can_create_shop(self, admin_client):
        res = admin_client.post(self.url, VALID_PAYLOAD, format="json")
        assert res.status_code == status.HTTP_201_CREATED
        assert res.data["name"] == "Sunrise Repairs - Whitefield"
        assert res.data["code"]  # auto-derived, non-empty
        assert res.data["is_active"] is True

    def test_non_admin_rejected(self, non_admin_client):
        res = non_admin_client.post(self.url, VALID_PAYLOAD, format="json")
        assert res.status_code == status.HTTP_403_FORBIDDEN

    def test_code_auto_derived_from_name(self, admin_client):
        res = admin_client.post(self.url, VALID_PAYLOAD, format="json")
        assert res.status_code == status.HTTP_201_CREATED
        assert res.data["code"] == "SRW"

    def test_explicit_code_used_when_provided(self, admin_client):
        payload = {**VALID_PAYLOAD, "code": "WHITE"}
        res = admin_client.post(self.url, payload, format="json")
        assert res.status_code == status.HTTP_201_CREATED
        assert res.data["code"] == "WHITE"

    def test_duplicate_code_returns_409(self, admin_client):
        admin_client.post(self.url, {**VALID_PAYLOAD, "code": "DUPE"}, format="json")
        res = admin_client.post(
            self.url, {**VALID_PAYLOAD, "name": "Second Shop", "code": "DUPE"}, format="json"
        )
        assert res.status_code == status.HTTP_409_CONFLICT
        assert res.data["code"] == "DUPLICATE_SHOP_CODE"

    def test_plan_limit_enforced(self, admin_client, monkeypatch):
        from core import views as core_views

        monkeypatch.setattr(core_views, "get_tenant_max_shops", lambda slug: 0)
        res = admin_client.post(self.url, VALID_PAYLOAD, format="json")
        assert res.status_code == status.HTTP_403_FORBIDDEN
        assert res.data["code"] == "PLAN_SHOP_LIMIT_EXCEEDED"

    def test_missing_required_field_returns_400(self, admin_client):
        payload = {**VALID_PAYLOAD}
        del payload["phone"]
        res = admin_client.post(self.url, payload, format="json")
        assert res.status_code == status.HTTP_400_BAD_REQUEST

    def test_list_still_works_for_any_authenticated_user(self, non_admin_client, admin_client):
        admin_client.post(self.url, VALID_PAYLOAD, format="json")
        res = non_admin_client.get(self.url)
        assert res.status_code == status.HTTP_200_OK
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest apps/core/tests/test_shop_create.py -v`
Expected: FAIL — `POST` currently returns 405 (no `post` method on `ShopListView`)

- [ ] **Step 3: Implement `POST` on `ShopListView`**

Replace the full contents of `backend/apps/core/views.py` with:

```python
import re

from django.db import IntegrityError
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from authentication.permissions import require_permission

from .exceptions import DuplicateShopCode, PlanShopLimitExceeded
from .models import Shop
from .serializers import ShopCreateSerializer
from .services import get_tenant_max_shops
from .settings_views import _shop_to_dict


def _derive_shop_code(name: str) -> str:
    """Initials of each word in `name`, capped at 6 chars (e.g. 'Sunrise Repairs - Whitefield' -> 'SRW')."""
    words = [w for w in re.split(r"[^A-Za-z0-9]+", name) if w]
    code = "".join(w[0].upper() for w in words)[:6]
    return code or name[:6].upper()


class ShopListView(APIView):
    """
    GET  /api/v1/shops/  — shops accessible to the authenticated user.
    POST /api/v1/shops/  — create a new shop (Tenant Admin only, plan-limited).
    """

    def get_permissions(self):
        if self.request.method == "POST":
            return [require_permission("settings.branches.manage")()]
        return [IsAuthenticated()]

    def get(self, request: Request) -> Response:
        token = getattr(request, "auth", None)
        is_tenant_wide = token and (token.get("is_tenant_wide") or token.get("is_platform_admin"))

        if is_tenant_wide:
            shops = Shop.objects.filter(is_active=True).order_by("name")
        else:
            shop_ids = token.get("shop_ids", []) if token else []
            shops = Shop.objects.filter(id__in=shop_ids, is_active=True).order_by("name")

        return Response([
            {"id": str(s.id), "name": s.name, "code": s.code, "address": s.address, "city": s.city}
            for s in shops
        ])

    def post(self, request: Request) -> Response:
        serializer = ShopCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        tenant_slug = (getattr(request, "auth", None) or {}).get("tenant_slug", "")
        max_shops = get_tenant_max_shops(tenant_slug)
        if max_shops is not None and Shop.objects.count() >= max_shops:
            raise PlanShopLimitExceeded(max_shops)

        code = data.get("code") or _derive_shop_code(data["name"])
        if Shop.objects.filter(code=code).exists():
            raise DuplicateShopCode(code)

        try:
            shop = Shop.objects.create(
                name=data["name"],
                code=code,
                address=data["address"],
                city=data["city"],
                state=data["state"],
                state_code=data["state_code"],
                phone=data["phone"],
                is_active=True,
            )
        except IntegrityError:
            raise DuplicateShopCode(code)

        return Response(_shop_to_dict(shop), status=status.HTTP_201_CREATED)
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd backend && python -m pytest apps/core/tests/test_shop_create.py -v`
Expected: PASS (8 tests)

- [ ] **Step 5: Run the full core test suite to check for regressions**

Run: `cd backend && python -m pytest apps/core/ -v`
Expected: PASS (no regressions in existing `test_shop_isolation.py` etc.)

- [ ] **Step 6: Commit**

```bash
git add backend/apps/core/views.py backend/apps/core/tests/test_shop_create.py
git commit -m "feat(core): add POST /shops/ to create additional shops, plan-limited"
```

---

## Task 5: Backend — capture `shop_name` at registration

**Files:**
- Modify: `backend/apps/master/serializers.py:110` (`RegisterTenantSerializer`)
- Modify: `backend/apps/master/services.py` (`register_tenant`, `do_provision_tenant`, `_create_default_shop`)
- Test: `backend/apps/master/tests/test_platform_admin.py`

- [ ] **Step 1: Write the failing tests**

Add these methods to the existing `TestVerification` class in `backend/apps/master/tests/test_platform_admin.py` (near `test_verify_stores_credentials_in_cache`):

```python
    def test_verify_stores_shop_name_falls_back_to_business_name(self, db, starter_plan):
        from unittest.mock import patch
        from django.core import signing
        from django.core.cache import cache
        client, phone_otp, email_code = self._do_init(starter_plan, slug="shopnameshop", phone="+919811200107")
        with patch("master.tasks.provision_tenant.delay"):
            res = client.post(self.verify_url, {
                "slug": "shopnameshop", "phone_otp": phone_otp, "email_code": email_code,
            }, format="json")
        tenant_id = res.data["tenant_id"]
        data = signing.loads(cache.get(f"tenant_init:{tenant_id}"))
        assert data["shop_name"] == "Verify Shop"  # _do_init's business_name, no shop_name sent

    def test_verify_stores_explicit_shop_name(self, db, starter_plan):
        from unittest.mock import patch
        from django.core import signing
        from django.core.cache import cache
        from rest_framework.test import APIClient
        client = APIClient()
        with patch("master.services._send_registration_otp", return_value=True), \
             patch("master.services._send_registration_email_code"):
            client.post(self.init_url, {
                "business_name": "Verify Shop Co", "slug": "explicitshop",
                "shop_name": "Verify Shop - Main Branch",
                "owner_name": "Verify Owner", "phone": "+919811200108",
                "email": "owner@explicitshop.com", "password": "SecurePass123!",
                "plan_id": str(starter_plan.id),
            }, format="json")
        pending = cache.get("reg_pending:explicitshop")
        with patch("master.tasks.provision_tenant.delay"):
            res = client.post(self.verify_url, {
                "slug": "explicitshop",
                "phone_otp": pending["phone_otp"], "email_code": pending["email_code"],
            }, format="json")
        tenant_id = res.data["tenant_id"]
        data = signing.loads(cache.get(f"tenant_init:{tenant_id}"))
        assert data["shop_name"] == "Verify Shop - Main Branch"
```

Add these methods to the existing `TestProvisioning` class (near `test_do_provision_tenant_writes_audit_log`):

```python
    def test_do_provision_tenant_creates_shop_with_registration_name(self, db, provisioning_tenant):
        from django.core import signing
        from django.core.cache import cache
        from master.services import do_provision_tenant
        from core.models import Shop

        payload = signing.dumps({
            "owner_name": "Prov Owner", "password": "Pass@123!",
            "shop_name": "Prov Corp Main Branch",
        })
        cache.set(f"tenant_init:{provisioning_tenant.id}", payload, timeout=3600)

        with self._patch_infra():
            do_provision_tenant(str(provisioning_tenant.id))

        assert Shop.objects.get().name == "Prov Corp Main Branch"

    def test_do_provision_tenant_shop_name_falls_back_to_tenant_name(self, db, provisioning_tenant):
        from django.core import signing
        from django.core.cache import cache
        from master.services import do_provision_tenant
        from core.models import Shop

        payload = signing.dumps({"owner_name": "Prov Owner", "password": "Pass@123!"})
        cache.set(f"tenant_init:{provisioning_tenant.id}", payload, timeout=3600)

        with self._patch_infra():
            do_provision_tenant(str(provisioning_tenant.id))

        assert Shop.objects.get().name == "Prov Corp"
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && python -m pytest apps/master/tests/test_platform_admin.py -v -k "shop_name or ProvisionTenantCreatesShop or ShopNameFallsBack"`
Expected: FAIL — `shop_name` key not present in cache payload (KeyError/assertion failure)

- [ ] **Step 3: Add `shop_name` to `RegisterTenantSerializer`**

In `backend/apps/master/serializers.py`, in `RegisterTenantSerializer` (line 110), add after `business_name`:

```python
class RegisterTenantSerializer(serializers.Serializer):
    business_name = serializers.CharField(max_length=200)
    shop_name = serializers.CharField(max_length=200, required=False, allow_blank=True)
    slug = serializers.RegexField(
        regex=r"^[a-z0-9_]{3,50}$",
        error_messages={"invalid": "Slug must be 3–50 lowercase letters, digits, or underscores."},
    )
    owner_name = serializers.CharField(max_length=200)
    phone = serializers.CharField(max_length=20)
    email = serializers.EmailField()
    password = serializers.CharField(min_length=8, write_only=True)
    plan_id = serializers.UUIDField(required=False, allow_null=True)
```

- [ ] **Step 4: Thread `shop_name` through `register_tenant()`**

In `backend/apps/master/services.py`, in `register_tenant()`, change:

```python
    # Store owner credentials for the provisioning task (signed, 1-hour TTL).
    init_payload = signing.dumps({
        "owner_name": data.get("owner_name", ""),
        "password": data["password"],
    })
    cache.set(f"tenant_init:{tenant.id}", init_payload, timeout=3600)
```

to:

```python
    # Store owner credentials + first-shop name for the provisioning task (signed, 1-hour TTL).
    init_payload = signing.dumps({
        "owner_name": data.get("owner_name", ""),
        "password": data["password"],
        "shop_name": data.get("shop_name") or data["business_name"],
    })
    cache.set(f"tenant_init:{tenant.id}", init_payload, timeout=3600)
```

- [ ] **Step 5: Rename `_create_default_shop`'s first param and use it**

In `backend/apps/master/services.py`, change:

```python
def _create_default_shop(tenant_name: str, tenant_slug: str, phone: str, email: str) -> None:
    """Create a default shop so new tenants can use CRM/Repair immediately."""
    import re as _re
    from core.models import Shop

    # Derive a short unique code from the slug (e.g. "vijay_test" → "VT")
    words = [w for w in tenant_slug.split("_") if w]
    code = "".join(w[0].upper() for w in words)[:4] or tenant_slug[:4].upper()

    Shop.objects.create(
        name=tenant_name,
        code=code,
        address="TBD",       # owner updates via Settings → Shop
        city="TBD",
        state="Karnataka",
        state_code="29",
        phone=phone,
        email=email or None,
        is_active=True,
    )
```

to:

```python
def _create_default_shop(shop_name: str, tenant_slug: str, phone: str, email: str) -> None:
    """Create the tenant's first shop, using the name captured at registration."""
    from core.models import Shop

    # Derive a short unique code from the slug (e.g. "vijay_test" → "VT")
    words = [w for w in tenant_slug.split("_") if w]
    code = "".join(w[0].upper() for w in words)[:4] or tenant_slug[:4].upper()

    Shop.objects.create(
        name=shop_name,
        code=code,
        address="TBD",       # owner updates via Settings → Shops
        city="TBD",
        state="Karnataka",
        state_code="29",
        phone=phone,
        email=email or None,
        is_active=True,
    )
```

- [ ] **Step 6: Extract `shop_name` in `do_provision_tenant()` and pass it through**

In `backend/apps/master/services.py`, in `do_provision_tenant()`, change:

```python
        init_raw = cache.get(f"tenant_init:{tenant_id}")
        if init_raw:
            try:
                init_data = signing.loads(init_raw)
                owner_name = init_data.get("owner_name") or tenant.name
                password = init_data["password"]
            except signing.BadSignature:
                logger.warning(
                    "Bad signature on tenant_init cache for %s; using random password.", tenant.slug
                )
                owner_name = tenant.name
                password = _random_password()
            cache.delete(f"tenant_init:{tenant_id}")
        else:
            logger.warning("No tenant_init cache entry for %s; using random password.", tenant.slug)
            owner_name = tenant.name
            password = _random_password()

        _create_admin_user(
            name=owner_name,
            email=tenant.owner_email,
            phone=tenant.owner_phone,
            password=password,
        )
        _create_default_shop(
            tenant_name=tenant.name,
            tenant_slug=tenant.slug,
            phone=tenant.owner_phone,
            email=tenant.owner_email,
        )
```

to:

```python
        init_raw = cache.get(f"tenant_init:{tenant_id}")
        if init_raw:
            try:
                init_data = signing.loads(init_raw)
                owner_name = init_data.get("owner_name") or tenant.name
                password = init_data["password"]
                shop_name = init_data.get("shop_name") or tenant.name
            except signing.BadSignature:
                logger.warning(
                    "Bad signature on tenant_init cache for %s; using random password.", tenant.slug
                )
                owner_name = tenant.name
                password = _random_password()
                shop_name = tenant.name
            cache.delete(f"tenant_init:{tenant_id}")
        else:
            logger.warning("No tenant_init cache entry for %s; using random password.", tenant.slug)
            owner_name = tenant.name
            password = _random_password()
            shop_name = tenant.name

        _create_admin_user(
            name=owner_name,
            email=tenant.owner_email,
            phone=tenant.owner_phone,
            password=password,
        )
        _create_default_shop(
            shop_name=shop_name,
            tenant_slug=tenant.slug,
            phone=tenant.owner_phone,
            email=tenant.owner_email,
        )
```

- [ ] **Step 7: Run tests to verify they pass**

Run: `cd backend && python -m pytest apps/master/tests/test_platform_admin.py -v`
Expected: PASS (all tests, including the 4 new ones)

- [ ] **Step 8: Run the full backend test suite to check for regressions**

Run: `cd backend && python -m pytest -v`
Expected: PASS (aside from the pre-existing weasyprint PDF-test gap, which is a known local-only environment issue, not something introduced by this change)

- [ ] **Step 9: Commit**

```bash
git add backend/apps/master/serializers.py backend/apps/master/services.py backend/apps/master/tests/test_platform_admin.py
git commit -m "feat(master): capture shop_name at registration and use it for the first shop"
```

---

## Task 6: Frontend — extract `INDIA_STATES` into a shared constant

**Files:**
- Create: `frontend/src/lib/constants/gstStates.ts`
- Modify: `frontend/src/app/(app)/settings/shop/page.tsx:22-28`

- [ ] **Step 1: Create the shared constant**

```typescript
// frontend/src/lib/constants/gstStates.ts
export const INDIA_STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat',
  'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh',
  'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab',
  'Rajasthan', 'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh',
  'Uttarakhand', 'West Bengal', 'Delhi', 'Jammu & Kashmir', 'Ladakh', 'Puducherry', 'Chandigarh',
];
```

- [ ] **Step 2: Remove the inline copy and import it instead**

In `frontend/src/app/(app)/settings/shop/page.tsx`, remove lines 22-28 (the local `const INDIA_STATES = [...]` block) and add to the imports at the top:

```typescript
import { INDIA_STATES } from '@/lib/constants/gstStates';
```

(This file is fully replaced/removed in Task 10, so this is a transitional step — but keeping the app buildable at every commit matters, and this page still exists until Task 10 lands.)

- [ ] **Step 3: Verify the frontend still builds and the shop settings page still works**

Run: `cd frontend && npx tsc --noEmit`
Expected: no new type errors

- [ ] **Step 4: Commit**

```bash
git add frontend/src/lib/constants/gstStates.ts "frontend/src/app/(app)/settings/shop/page.tsx"
git commit -m "refactor(frontend): extract INDIA_STATES into a shared constant"
```

---

## Task 7: Frontend — `settingsApi.createShop`

**Files:**
- Modify: `frontend/src/lib/api/settings.ts`

- [ ] **Step 1: Add `createShop`**

In `frontend/src/lib/api/settings.ts`, in the `settingsApi` object, add after `updateShop`:

```typescript
  createShop: (body: { name: string; code?: string; address: string; city: string; state: string; state_code: string; phone: string }) =>
    apiPost<Shop>('/shops/', body),
```

- [ ] **Step 2: Verify types compile**

Run: `cd frontend && npx tsc --noEmit`
Expected: no new type errors

- [ ] **Step 3: Commit**

```bash
git add frontend/src/lib/api/settings.ts
git commit -m "feat(frontend): add settingsApi.createShop"
```

---

## Task 8: Frontend — `shop_name` field on the registration form

**Files:**
- Modify: `frontend/src/app/(marketing)/register/page.tsx`
- Test: `frontend/src/app/(marketing)/register/__tests__/page.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/app/(marketing)/register/__tests__/page.test.tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RegisterPage from '../page';

const apiFetchMock = vi.fn();
vi.mock('@/lib/api/client', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/api/client')>();
  return { ...actual, apiFetch: (...a: unknown[]) => apiFetchMock(...a) };
});

vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: () => ({ setAccessToken: vi.fn(), setUser: vi.fn() }),
}));
vi.mock('@/lib/stores/activeShopStore', () => ({
  useActiveShopStore: Object.assign(
    () => ({ setShops: vi.fn() }),
    { getState: () => ({ activeShopId: null }) },
  ),
}));

function renderPage() {
  return render(<RegisterPage />);
}

describe('RegisterPage — shop name field', () => {
  beforeEach(() => {
    apiFetchMock.mockReset().mockResolvedValue({ slug: 'sunrise', phone_masked: '+91****1111', expires_in: 600 });
  });

  it('defaults the shop name field to the business name until manually edited', async () => {
    const user = userEvent.setup();
    renderPage();

    const businessNameInput = screen.getByPlaceholderText('Sunrise Repairs');
    await user.type(businessNameInput, 'Sunrise Repairs');

    const shopNameInput = screen.getByLabelText(/shop name/i) as HTMLInputElement;
    expect(shopNameInput.value).toBe('Sunrise Repairs');
  });

  it('stops auto-syncing once the shop name is manually edited', async () => {
    const user = userEvent.setup();
    renderPage();

    const businessNameInput = screen.getByPlaceholderText('Sunrise Repairs');
    await user.type(businessNameInput, 'Sunrise Repairs');

    const shopNameInput = screen.getByLabelText(/shop name/i) as HTMLInputElement;
    await user.clear(shopNameInput);
    await user.type(shopNameInput, 'Sunrise Repairs - Main');

    await user.type(businessNameInput, ' Co');

    expect(shopNameInput.value).toBe('Sunrise Repairs - Main');
  });

  it('includes shop_name in the /register/ POST body', async () => {
    const user = userEvent.setup();
    renderPage();

    await user.type(screen.getByPlaceholderText('Sunrise Repairs'), 'Sunrise Repairs');
    await user.type(screen.getByPlaceholderText('Ravi Kumar'), 'Ravi Kumar');
    await user.type(screen.getByPlaceholderText('+91XXXXXXXXXX'), '9876543210');
    await user.type(screen.getByPlaceholderText('you@company.com'), 'ravi@sunrise.com');
    await user.type(screen.getByLabelText(/^password/i), 'Passw0rd!');

    await user.click(screen.getByRole('button', { name: /continue/i }));

    expect(apiFetchMock).toHaveBeenCalledWith(
      '/register/',
      expect.objectContaining({
        body: expect.stringContaining('"shop_name":"Sunrise Repairs"'),
      }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/app/\(marketing\)/register/__tests__/page.test.tsx`
Expected: FAIL — no element with label matching `/shop name/i`

- [ ] **Step 3: Add `shop_name` to the schema, defaults, and auto-sync effect**

In `frontend/src/app/(marketing)/register/page.tsx`, change the schema (line 24):

```typescript
const schema = z.object({
  business_name: z.string().min(2, 'Required'),
  shop_name: z.string().min(2, 'Required'),
  slug: z
    .string()
    .min(3, 'Min 3 characters')
    .max(50, 'Max 50 characters')
    .regex(/^[a-z0-9_]{3,50}$/, 'Lowercase letters, numbers, underscores only'),
  owner_name: z.string().min(2, 'Required'),
  phone: z.string().regex(/^\+91[0-9]{10}$/, 'Enter valid Indian mobile (+91XXXXXXXXXX)'),
  email: z.string().email('Invalid email address'),
  password: z
    .string()
    .min(8, 'Min 8 characters')
    .regex(/[A-Z]/, 'Must contain uppercase letter')
    .regex(/[0-9]/, 'Must contain number')
    .regex(/[^A-Za-z0-9]/, 'Must contain special character'),
});
```

Update `defaultValues` (line ~322):

```typescript
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      business_name: '', shop_name: '', slug: '', owner_name: '',
      phone: '+91', email: '', password: '',
    },
  });
```

Add a `shopNameEdited` flag next to the existing `slugEdited` state (line ~317):

```typescript
  const [slugEdited, setSlugEdited] = useState(false);
  const [shopNameEdited, setShopNameEdited] = useState(false);
```

Add an auto-sync effect next to the existing slug-sync effect (line ~331), keeping both independent (each syncs from `business_name` until its own field is edited):

```typescript
  // Auto-sync shop name from business name until the user manually edits the field
  useEffect(() => {
    if (shopNameEdited) return;
    form.setValue('shop_name', businessName, { shouldValidate: true });
  }, [businessName, form, shopNameEdited]);
```

- [ ] **Step 4: Add the form field**

In the JSX, right after the "Business name" `FormField` block (line ~578, before the "Workspace URL" field), add:

```tsx
                {/* Shop name */}
                <FormField control={form.control} name="shop_name" render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-sm font-medium text-[var(--text)]">Shop name</FormLabel>
                    <FormControl>
                      <div className="relative">
                        <Building2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-muted)] pointer-events-none" strokeWidth={2} />
                        <Input
                          placeholder="Sunrise Repairs - Main"
                          className="h-11 pl-10"
                          {...field}
                          onChange={(e) => {
                            setShopNameEdited(true);
                            field.onChange(e);
                          }}
                        />
                      </div>
                    </FormControl>
                    <p className="text-xs text-[var(--text-muted)] mt-1">
                      Defaults to your business name — edit if this shop has a different name
                    </p>
                    <FormMessage />
                  </FormItem>
                )} />
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/app/\(marketing\)/register/__tests__/page.test.tsx`
Expected: PASS (3 tests)

- [ ] **Step 6: Commit**

```bash
git add "frontend/src/app/(marketing)/register/page.tsx" "frontend/src/app/(marketing)/register/__tests__/page.test.tsx"
git commit -m "feat(register): capture shop name during tenant registration"
```

---

## Task 9: Frontend — Settings → Shops list page (list + Add dialog + branding)

**Files:**
- Create: `frontend/src/app/(app)/settings/shops/page.tsx`
- Test: `frontend/src/app/(app)/settings/shops/__tests__/page.test.tsx`

- [ ] **Step 1: Write the failing test**

```tsx
// frontend/src/app/(app)/settings/shops/__tests__/page.test.tsx
import { describe, it, expect, vi, beforeEach, beforeAll } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ShopsPage from '../page';

beforeAll(() => {
  window.HTMLElement.prototype.scrollIntoView = vi.fn();
  window.HTMLElement.prototype.hasPointerCapture = vi.fn();
  window.HTMLElement.prototype.releasePointerCapture = vi.fn();
});

vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: () => ({ hasPermission: () => true, hasAnyPermission: () => true }),
}));

const setShops = vi.fn();
vi.mock('@/lib/stores/activeShopStore', () => ({
  useActiveShopStore: () => ({ setShops }),
}));

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const listShops = vi.fn();
const createShop = vi.fn();
const getTenantBranding = vi.fn();
vi.mock('@/lib/api/settings', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/api/settings')>();
  return {
    ...actual,
    settingsApi: {
      ...actual.settingsApi,
      listShops: (...a: unknown[]) => listShops(...a),
      createShop: (...a: unknown[]) => createShop(...a),
      getTenantBranding: (...a: unknown[]) => getTenantBranding(...a),
    },
  };
});

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={qc}><ShopsPage /></QueryClientProvider>);
}

describe('ShopsPage', () => {
  beforeEach(() => {
    listShops.mockReset().mockResolvedValue([
      { id: 's-1', name: 'Sunrise Main', code: 'SM', address: '1 Main Rd', city: 'Bengaluru' },
    ]);
    createShop.mockReset();
    getTenantBranding.mockReset().mockResolvedValue({});
    push.mockReset();
  });

  it('renders existing shops as cards', async () => {
    renderPage();
    expect(await screen.findByText('Sunrise Main')).toBeInTheDocument();
    expect(screen.getByText(/SM/)).toBeInTheDocument();
  });

  it('navigates to the shop detail route when a card is clicked', async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(await screen.findByText('Sunrise Main'));
    expect(push).toHaveBeenCalledWith('/settings/shops/s-1');
  });

  it('creates a shop and refreshes the store on success', async () => {
    createShop.mockResolvedValue({ id: 's-2', name: 'Second Shop', code: 'SS', address: 'A', city: 'B', state: 'Karnataka', state_code: '29', phone: '+919900000000', is_active: true });
    listShops.mockResolvedValueOnce([
      { id: 's-1', name: 'Sunrise Main', code: 'SM', address: '1 Main Rd', city: 'Bengaluru' },
    ]).mockResolvedValueOnce([
      { id: 's-1', name: 'Sunrise Main', code: 'SM', address: '1 Main Rd', city: 'Bengaluru' },
      { id: 's-2', name: 'Second Shop', code: 'SS', address: 'A', city: 'B' },
    ]);

    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Sunrise Main');

    await user.click(screen.getByRole('button', { name: /add shop/i }));
    await user.type(screen.getByLabelText(/shop name/i), 'Second Shop');
    await user.type(screen.getByLabelText(/^address/i), 'A');
    await user.type(screen.getByLabelText(/^city/i), 'B');
    await user.type(screen.getByLabelText(/gst state code/i), '29');
    await user.type(screen.getByLabelText(/^phone/i), '+919900000000');
    await user.click(screen.getByRole('button', { name: /create shop/i }));

    await waitFor(() => expect(createShop).toHaveBeenCalled());
    await waitFor(() => expect(setShops).toHaveBeenCalled());
  });

  it('shows the create error inline in the dialog, not as a toast', async () => {
    const { ApiError } = await import('@/lib/api/client');
    createShop.mockRejectedValue(new ApiError('PLAN_SHOP_LIMIT_EXCEEDED', 'Your plan allows 1 shop(s). Upgrade to add more.', 403));

    const user = userEvent.setup();
    renderPage();
    await screen.findByText('Sunrise Main');

    await user.click(screen.getByRole('button', { name: /add shop/i }));
    await user.type(screen.getByLabelText(/shop name/i), 'Second Shop');
    await user.type(screen.getByLabelText(/^address/i), 'A');
    await user.type(screen.getByLabelText(/^city/i), 'B');
    await user.type(screen.getByLabelText(/gst state code/i), '29');
    await user.type(screen.getByLabelText(/^phone/i), '+919900000000');
    await user.click(screen.getByRole('button', { name: /create shop/i }));

    expect(await screen.findByText(/upgrade to add more/i)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npx vitest run src/app/\(app\)/settings/shops/__tests__/page.test.tsx`
Expected: FAIL — `Cannot find module '../page'`

- [ ] **Step 3: Implement the page**

```tsx
// frontend/src/app/(app)/settings/shops/page.tsx
'use client';

import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Plus, Building2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Can } from '@/components/shared/Can';
import { ForbiddenPage } from '@/components/shared/ForbiddenPage';
import { settingsApi } from '@/lib/api/settings';
import { qk } from '@/lib/query/keys';
import { useActiveShopStore } from '@/lib/stores/activeShopStore';
import { ApiError } from '@/lib/api/client';
import { useAuthStore } from '@/lib/stores/authStore';
import { INDIA_STATES } from '@/lib/constants/gstStates';

const createShopSchema = z.object({
  name:       z.string().min(2, 'Required'),
  code:       z.string().max(10, 'Max 10 characters').optional(),
  address:    z.string().min(3, 'Required'),
  city:       z.string().min(2, 'Required'),
  state:      z.string().min(2, 'Required'),
  state_code: z.string().min(2).max(2, 'Must be 2 digits'),
  phone:      z.string().regex(/^\+91[0-9]{10}$/, '+91XXXXXXXXXX'),
});
type CreateShopForm = z.infer<typeof createShopSchema>;

const brandingSchema = z.object({
  logo_url:            z.string().url('Invalid URL').or(z.literal('')).optional(),
  invoice_footer:      z.string().max(200).optional(),
  bank_name:           z.string().optional(),
  bank_account_number: z.string().optional(),
  bank_ifsc:           z.string().regex(/^[A-Z]{4}0[A-Z0-9]{6}$/, 'Invalid IFSC').or(z.literal('')).optional(),
});
type BrandForm = z.infer<typeof brandingSchema>;

const EMPTY_CREATE_FORM: CreateShopForm = {
  name: '', code: '', address: '', city: '', state: '', state_code: '', phone: '+91',
};

export default function ShopsPage() {
  const { hasPermission } = useAuthStore();
  if (!hasPermission('settings.shop.edit')) return <ForbiddenPage />;
  return <ShopsPageInner />;
}

function ShopsPageInner() {
  const qc = useQueryClient();
  const router = useRouter();
  const { setShops } = useActiveShopStore();
  const [addOpen, setAddOpen] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);

  const { data: shops, isLoading } = useQuery({
    queryKey: qk.shops(),
    queryFn: () => settingsApi.listShops(),
    staleTime: 30_000,
  });

  const { data: branding, isLoading: brandLoading } = useQuery({
    queryKey: qk.tenantBranding(),
    queryFn: () => settingsApi.getTenantBranding(),
    staleTime: 60_000,
  });

  const form = useForm<CreateShopForm>({
    resolver: zodResolver(createShopSchema),
    defaultValues: EMPTY_CREATE_FORM,
  });

  const brandForm = useForm<BrandForm>({ resolver: zodResolver(brandingSchema) });

  useEffect(() => {
    if (branding) brandForm.reset({
      logo_url:            branding.logo_url ?? '',
      invoice_footer:      branding.invoice_footer ?? '',
      bank_name:           branding.bank_name ?? '',
      bank_account_number: branding.bank_account_number ?? '',
      bank_ifsc:           branding.bank_ifsc ?? '',
    });
  }, [branding]); // eslint-disable-line react-hooks/exhaustive-deps

  const createMutation = useMutation({
    mutationFn: (v: CreateShopForm) => settingsApi.createShop({ ...v, code: v.code || undefined }),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: qk.shops() });
      const allShops = await settingsApi.listShops();
      setShops(allShops);
      toast.success('Shop created');
      form.reset(EMPTY_CREATE_FORM);
      setDialogError(null);
      setAddOpen(false);
    },
    onError: (e) => setDialogError(e instanceof ApiError ? e.message : 'Failed to create shop.'),
  });

  const brandMutation = useMutation({
    mutationFn: (v: BrandForm) => settingsApi.updateTenantBranding({
      logo_url:            v.logo_url || undefined,
      invoice_footer:      v.invoice_footer || undefined,
      bank_name:           v.bank_name || undefined,
      bank_account_number: v.bank_account_number || undefined,
      bank_ifsc:           v.bank_ifsc || undefined,
    }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: qk.tenantBranding() });
      toast.success('Branding saved');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });

  return (
    <div className="flex-1 overflow-auto p-4 md:p-6 space-y-8 max-w-2xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-h1 text-[var(--text)]">Shops</h1>
          <p className="text-body-sm text-[var(--text-muted)] mt-0.5">
            Each shop has its own job/invoice numbering and GST details.
          </p>
        </div>
        <Can permission="settings.branches.manage">
          <Button size="sm" onClick={() => { setDialogError(null); setAddOpen(true); }}>
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">Add shop</span>
          </Button>
        </Can>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[1, 2].map((i) => <Skeleton key={i} className="h-16" />)}</div>
      ) : (
        <div className="space-y-2">
          {(shops ?? []).map((shop) => (
            <button
              key={shop.id}
              type="button"
              onClick={() => router.push(`/settings/shops/${shop.id}`)}
              className="w-full flex items-center gap-3 rounded-lg border border-[var(--border)] px-4 py-3 text-left hover:bg-[var(--surface-2)] transition-colors"
            >
              <Building2 className="h-5 w-5 text-[var(--text-muted)] shrink-0" />
              <div>
                <p className="font-medium text-[var(--text)]">{shop.name}</p>
                <p className="text-xs text-[var(--text-muted)]">{shop.code} · {shop.city}</p>
              </div>
            </button>
          ))}
        </div>
      )}

      <hr className="border-[var(--border)]" />

      <section>
        <h2 className="text-body font-semibold text-[var(--text)] mb-4">Branding & bank details</h2>
        {brandLoading ? (
          <div className="space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-10" />)}</div>
        ) : (
          <Form {...brandForm}>
            <form onSubmit={brandForm.handleSubmit((v) => brandMutation.mutate(v))} className="space-y-4">
              <FormField control={brandForm.control} name="logo_url" render={({ field }) => (
                <FormItem>
                  <FormLabel>Logo URL</FormLabel>
                  <FormControl><Input type="url" placeholder="https://…/logo.png" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={brandForm.control} name="invoice_footer" render={({ field }) => (
                <FormItem>
                  <FormLabel>Invoice footer note</FormLabel>
                  <FormControl><Input placeholder="Thank you for your business!" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <FormField control={brandForm.control} name="bank_name" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Bank name</FormLabel>
                    <FormControl><Input placeholder="HDFC Bank" {...field} /></FormControl>
                  </FormItem>
                )} />
                <FormField control={brandForm.control} name="bank_account_number" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Account number</FormLabel>
                    <FormControl><Input className="font-mono" {...field} /></FormControl>
                  </FormItem>
                )} />
                <FormField control={brandForm.control} name="bank_ifsc" render={({ field }) => (
                  <FormItem>
                    <FormLabel>IFSC</FormLabel>
                    <FormControl><Input className="font-mono uppercase" {...field} onChange={(e) => field.onChange(e.target.value.toUpperCase())} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
              <Can permission="settings.shop.edit">
                <Button type="submit" disabled={brandMutation.isPending}>
                  {brandMutation.isPending ? 'Saving…' : 'Save branding'}
                </Button>
              </Can>
            </form>
          </Form>
        )}
      </section>

      <Dialog open={addOpen} onOpenChange={setAddOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Add shop</DialogTitle></DialogHeader>
          {dialogError && (
            <p className="text-body-sm text-[var(--danger)] bg-[var(--danger)]/10 border border-[var(--danger)]/25 rounded-md px-3 py-2">
              {dialogError}
            </p>
          )}
          <Form {...form}>
            <form onSubmit={form.handleSubmit((v) => createMutation.mutate(v))} className="space-y-4">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem>
                  <FormLabel>Shop name *</FormLabel>
                  <FormControl><Input placeholder="Sunrise Repairs - Whitefield" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="code" render={({ field }) => (
                <FormItem>
                  <FormLabel>Code</FormLabel>
                  <FormControl><Input placeholder="Auto-generated if left blank" className="font-mono uppercase" {...field} onChange={(e) => field.onChange(e.target.value.toUpperCase())} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="address" render={({ field }) => (
                <FormItem>
                  <FormLabel>Address *</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <div className="grid grid-cols-2 gap-3">
                <FormField control={form.control} name="city" render={({ field }) => (
                  <FormItem>
                    <FormLabel>City *</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="phone" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Phone *</FormLabel>
                    <FormControl><Input {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <FormField control={form.control} name="state" render={({ field }) => (
                  <FormItem>
                    <FormLabel>State *</FormLabel>
                    <FormControl>
                      <Select value={field.value} onValueChange={field.onChange}>
                        <SelectTrigger><SelectValue placeholder="Select state…" /></SelectTrigger>
                        <SelectContent>
                          {INDIA_STATES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="state_code" render={({ field }) => (
                  <FormItem>
                    <FormLabel>GST state code *</FormLabel>
                    <FormControl><Input maxLength={2} className="font-mono" placeholder="29" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
              </div>
              <div className="flex gap-3">
                <Button type="button" variant="outline" className="flex-1" onClick={() => setAddOpen(false)}>Cancel</Button>
                <Button type="submit" className="flex-1" disabled={createMutation.isPending}>
                  {createMutation.isPending ? 'Creating…' : 'Create shop'}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npx vitest run src/app/\(app\)/settings/shops/__tests__/page.test.tsx`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add "frontend/src/app/(app)/settings/shops/page.tsx" "frontend/src/app/(app)/settings/shops/__tests__/page.test.tsx"
git commit -m "feat(settings): add Shops list page with Add-shop dialog"
```

---

## Task 10: Frontend — Settings → Shops/[id] detail page (replaces `/settings/shop`)

**Files:**
- Create: `frontend/src/app/(app)/settings/shops/[id]/page.tsx`
- Delete: `frontend/src/app/(app)/settings/shop/page.tsx`

- [ ] **Step 1: Create the per-shop detail page**

```tsx
// frontend/src/app/(app)/settings/shops/[id]/page.tsx
'use client';

import { useEffect } from 'react';
import { useParams } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Can } from '@/components/shared/Can';
import { ForbiddenPage } from '@/components/shared/ForbiddenPage';
import { settingsApi } from '@/lib/api/settings';
import { qk } from '@/lib/query/keys';
import { ApiError } from '@/lib/api/client';
import { useAuthStore } from '@/lib/stores/authStore';
import { INDIA_STATES } from '@/lib/constants/gstStates';

const shopSchema = z.object({
  name:       z.string().min(2, 'Required'),
  address:    z.string().min(3, 'Required'),
  city:       z.string().min(2, 'Required'),
  state:      z.string().min(2, 'Required'),
  state_code: z.string().min(2).max(2, 'Must be 2 digits'),
  phone:      z.string().regex(/^\+91[0-9]{10}$/, '+91XXXXXXXXXX'),
  email:      z.string().email('Invalid email').or(z.literal('')).optional(),
  gstin:      z.string().regex(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/, 'Invalid GSTIN').or(z.literal('')).optional(),
});
type ShopForm = z.infer<typeof shopSchema>;

export default function ShopDetailPage() {
  const { hasPermission } = useAuthStore();
  if (!hasPermission('settings.shop.edit')) return <ForbiddenPage />;
  return <ShopDetailInner />;
}

function ShopDetailInner() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();

  const { data: shop, isLoading } = useQuery({
    queryKey: qk.shop(id),
    queryFn: () => settingsApi.getShop(id),
    staleTime: 60_000,
  });

  const form = useForm<ShopForm>({ resolver: zodResolver(shopSchema) });

  useEffect(() => {
    if (shop) form.reset({
      name:       shop.name,
      address:    shop.address,
      city:       shop.city,
      state:      shop.state,
      state_code: shop.state_code,
      phone:      shop.phone,
      email:      shop.email ?? '',
      gstin:      shop.gstin ?? '',
    });
  }, [shop]); // eslint-disable-line react-hooks/exhaustive-deps

  const mutation = useMutation({
    mutationFn: (v: ShopForm) => settingsApi.updateShop(id, {
      ...v,
      email: v.email || undefined,
      gstin: v.gstin || undefined,
    }),
    onSuccess: (updated) => {
      qc.setQueryData(qk.shop(id), updated);
      qc.invalidateQueries({ queryKey: qk.shops() });
      toast.success('Shop profile saved');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });

  return (
    <div className="flex-1 overflow-auto p-4 md:p-6 space-y-6 max-w-2xl mx-auto">
      <div>
        <h1 className="text-h1 text-[var(--text)]">{shop?.name ?? 'Shop'}</h1>
        <p className="text-body-sm text-[var(--text-muted)] mt-0.5">
          Affects job/invoice numbering, GST calculations, and customer-facing details.
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-3">{[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-10" />)}</div>
      ) : (
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem className="sm:col-span-2">
                  <FormLabel>Shop name *</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="address" render={({ field }) => (
                <FormItem className="sm:col-span-2">
                  <FormLabel>Address *</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="city" render={({ field }) => (
                <FormItem>
                  <FormLabel>City *</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="state" render={({ field }) => (
                <FormItem>
                  <FormLabel>State *</FormLabel>
                  <FormControl>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <SelectTrigger><SelectValue placeholder="Select state…" /></SelectTrigger>
                      <SelectContent>
                        {INDIA_STATES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="state_code" render={({ field }) => (
                <FormItem>
                  <FormLabel>GST state code *</FormLabel>
                  <FormControl><Input maxLength={2} className="font-mono" placeholder="29" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="gstin" render={({ field }) => (
                <FormItem>
                  <FormLabel>GSTIN</FormLabel>
                  <FormControl><Input className="font-mono uppercase" placeholder="29AAAAA0000A1Z5" {...field} onChange={(e) => field.onChange(e.target.value.toUpperCase())} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="phone" render={({ field }) => (
                <FormItem>
                  <FormLabel>Phone *</FormLabel>
                  <FormControl><Input {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="email" render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl><Input type="email" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <Can permission="settings.shop.edit">
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? 'Saving…' : 'Save shop details'}
              </Button>
            </Can>
          </form>
        </Form>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Delete the old single-shop settings page**

```bash
git rm "frontend/src/app/(app)/settings/shop/page.tsx"
```

- [ ] **Step 3: Verify the frontend still builds**

Run: `cd frontend && npx tsc --noEmit`
Expected: no new type errors (the old page's imports of `INDIA_STATES` etc. are gone along with the file)

- [ ] **Step 4: Commit**

```bash
git add "frontend/src/app/(app)/settings/shops/[id]/page.tsx"
git commit -m "feat(settings): add per-shop detail page, replacing the single-shop settings page"
```

---

## Task 11: Frontend — update Settings nav to point at Shops

**Files:**
- Modify: `frontend/src/app/(app)/settings/layout.tsx:15`
- Modify: `frontend/src/app/(app)/settings/page.tsx:8`

- [ ] **Step 1: Update the tab definition**

In `frontend/src/app/(app)/settings/layout.tsx`, change:

```typescript
  { label: 'Shop',              href: '/settings/shop',             permission: 'settings.shop.edit' },
```

to:

```typescript
  { label: 'Shops',             href: '/settings/shops',            permission: 'settings.shop.edit' },
```

- [ ] **Step 2: Update the redirect order**

In `frontend/src/app/(app)/settings/page.tsx`, change:

```typescript
  { href: '/settings/shop',             permission: 'settings.shop.edit' },
```

to:

```typescript
  { href: '/settings/shops',            permission: 'settings.shop.edit' },
```

- [ ] **Step 3: Run the existing nav test suite to check for regressions**

Run: `cd frontend && npx vitest run src/components/shared/__tests__/navItems.test.ts`
Expected: PASS (this test covers `AppShell` nav items, not the Settings tabs — confirms nothing else references the old `/settings/shop` path)

- [ ] **Step 4: Search for any other reference to the old path**

Run: `cd frontend && grep -rn "'/settings/shop'" src`
Expected: no output (all references now say `/settings/shops`)

- [ ] **Step 5: Commit**

```bash
git add "frontend/src/app/(app)/settings/layout.tsx" "frontend/src/app/(app)/settings/page.tsx"
git commit -m "feat(settings): point Shop nav tab at the new Shops list page"
```

---

## Task 12: Full-suite verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full backend test suite**

Run: `cd backend && python -m pytest -v`
Expected: PASS (aside from the known local-only weasyprint PDF-test gap)

- [ ] **Step 2: Run the full frontend test suite**

Run: `cd frontend && npx vitest run`
Expected: PASS

- [ ] **Step 3: Type-check the frontend**

Run: `cd frontend && npx tsc --noEmit`
Expected: no errors

- [ ] **Step 4: Manually verify the registration flow end-to-end**

Using the `/register` page in a browser (or Playwright, per this project's established E2E pattern — driving the real UI, not the API directly): fill in a business name, confirm the new Shop name field defaults to it, edit both, complete OTP verification, and confirm in Django admin / `manage.py shell` that the created `Shop.name` matches what was entered (not the business name, if edited separately).

- [ ] **Step 5: Manually verify Settings → Shops**

As a Tenant Admin: navigate to Settings → Shops, confirm the existing shop(s) render as cards, click "Add shop", fill the dialog, submit, and confirm the new shop appears in both the list and the header shop switcher without a page reload. As a non-admin user (no `settings.branches.manage` permission), confirm the "Add shop" button is hidden.

---

## Self-review notes

- **Spec coverage:** Registration capturing shop name (Task 8, backend in Task 5) ✓; Settings → Shops list + Add dialog (Task 9) ✓; per-shop edit route (Task 10) ✓; Tenant Admin-only creation (Task 4, via `settings.branches.manage`) ✓; plan `max_shops` enforcement (Tasks 2 & 4) ✓; code auto-derivation + uniqueness (Task 4) ✓; error handling table from the design doc — duplicate code (409), plan limit (403), non-admin (403), concurrent race via `IntegrityError` — all covered in Task 4's tests ✓.
- **No placeholders:** every step above contains complete, runnable code — no "add error handling here" or "similar to Task N" shorthand.
- **Type/name consistency checked:** `_create_default_shop`'s renamed `shop_name` param (Task 5) matches its one call site in the same task; `ShopCreateSerializer` field names match `ShopCreateView`'s `data[...]` accesses and the frontend `createShop` body shape (Task 7 ↔ Task 4); `qk.shop(id)` / `qk.shops()` reused as-is from the existing `frontend/src/lib/query/keys.ts` (no new query-key names invented).
