# Configurable Lists Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Per-tenant configurable dropdown lists (`core.ConfigOption` + code registry) with seeded Indian defaults, a settings UI, soft-bound form adoption, the roles/permissions healer + starter-segments seeders, the master-DB `seed_plans` gap-fix, and the shared India-states constant — per spec `docs/superpowers/specs/2026-07-06-configurable-lists-design.md`.

**Architecture:** One `ConfigOption` model whose list types live in `core/config_lists.py` (`LIST_REGISTRY`); a small DRF API under `/api/v1/config/`; three reference-tier seeders on the seeding framework from the migration/seeding overhaul; a `ConfigSelect` combobox adopted by the free-text forms (values still stored as text).

**Tech Stack:** Django/DRF + pytest; Next.js/TS + React Query + Vitest/RTL.

**⚠ Prerequisite:** the migration & seeding overhaul plan (`2026-07-06-migration-seeding-overhaul.md`) must be implemented and merged first — Tasks 3–4 here use `core.seeding` (Seeder/register/runner) and append to `core/seeds.py` / `crm/seeds.py` files that plan creates. Core migration numbering assumes its `0009_seedrun` exists.

**Environment notes:**
- Branch: `feature/configurable-lists` off `master` (after the overhaul PR merges).
- Backend tests: `cd backend && python3 -m pytest <path> --no-cov`. Frontend: `cd frontend && npx vitest run <path>`.
- Facts (do not re-derive): settings endpoints live in `core/settings_views.py`/`settings_urls.py`, gated via `require_permission("settings.<x>.manage")`; settings nav tabs are hardcoded in `frontend/src/app/(app)/settings/layout.tsx:15-21`; `create_tenant` resolves plans with `SubscriptionPlan.objects.get(name__iexact=plan_slug)` for slugs starter/professional/enterprise; `BaseModel` gives uuid pk + created/updated.

---

### Task 1: `LIST_REGISTRY` + `ConfigOption` model

**Files:**
- Create: `backend/apps/core/config_lists.py`
- Modify: `backend/apps/core/models.py` (append)
- Create: `backend/apps/core/migrations/0010_configoption.py` (via makemigrations)
- Test: `backend/apps/core/tests/test_config_lists.py` (new)

- [ ] **Step 1: Write the failing tests**

Create `backend/apps/core/tests/test_config_lists.py`:

```python
"""core › ConfigOption model + LIST_REGISTRY."""
import pytest
from django.db import IntegrityError


def test_registry_has_the_five_lists_with_defaults():
    from core.config_lists import LIST_REGISTRY

    assert set(LIST_REGISTRY) == {
        "device_types", "device_brands", "expense_categories",
        "asset_categories", "customer_tags",
    }
    for key, entry in LIST_REGISTRY.items():
        assert entry["label"]
        assert len(entry["defaults"]) >= 5, key
    assert "Mobile" in LIST_REGISTRY["device_types"]["defaults"]
    assert "Xiaomi" in LIST_REGISTRY["device_brands"]["defaults"]
    assert "Spare Parts Purchase" in LIST_REGISTRY["expense_categories"]["defaults"]


@pytest.mark.django_db
def test_config_option_unique_per_list_and_ordering():
    from core.models import ConfigOption

    ConfigOption.objects.create(list_key="device_types", value="Mobile", sort_order=2)
    ConfigOption.objects.create(list_key="device_types", value="Laptop", sort_order=1)
    # Same value under a different list is fine:
    ConfigOption.objects.create(list_key="customer_tags", value="Mobile")
    with pytest.raises(IntegrityError):
        ConfigOption.objects.create(list_key="device_types", value="Mobile")


@pytest.mark.django_db
def test_default_ordering_is_sort_order_then_value():
    from core.models import ConfigOption

    ConfigOption.objects.create(list_key="device_types", value="Zeta", sort_order=1)
    ConfigOption.objects.create(list_key="device_types", value="Alpha", sort_order=1)
    ConfigOption.objects.create(list_key="device_types", value="First", sort_order=0)
    assert list(ConfigOption.objects.values_list("value", flat=True)) == ["First", "Alpha", "Zeta"]
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && python3 -m pytest apps/core/tests/test_config_lists.py --no-cov -v`
Expected: FAIL — no module `core.config_lists`.

- [ ] **Step 3: Implement**

Create `backend/apps/core/config_lists.py`:

```python
"""The definitive catalog of tenant-configurable dropdown lists.

Tenants manage ENTRIES (ConfigOption rows); the set of list types is code.
Adding a list type = one entry here (no migration). `defaults` are seeded as
is_system rows in registry order by the core.config_options reference seeder.
"""

LIST_REGISTRY: dict[str, dict] = {
    "device_types": {
        "label": "Device Types",
        "defaults": [
            "Mobile", "Laptop", "Desktop", "Tablet", "TV", "AC", "Refrigerator",
            "Washing Machine", "Printer", "Smartwatch", "Speaker", "Camera", "Other",
        ],
    },
    "device_brands": {
        "label": "Device Brands",
        "defaults": [
            "Samsung", "Apple", "Xiaomi", "Vivo", "Oppo", "Realme", "OnePlus",
            "Motorola", "HP", "Dell", "Lenovo", "Asus", "Acer", "LG", "Sony",
            "Whirlpool", "Godrej", "Voltas", "Haier", "Canon", "Epson", "Other",
        ],
    },
    "expense_categories": {
        "label": "Expense Categories",
        "defaults": [
            "Rent", "Salaries", "Electricity", "Internet & Phone",
            "Spare Parts Purchase", "Tools & Equipment", "Transport & Fuel",
            "Marketing", "Stationery", "Refreshments", "Repairs & Maintenance",
            "Bank Charges", "Miscellaneous",
        ],
    },
    "asset_categories": {
        "label": "Asset Categories",
        "defaults": ["Furniture", "Tools & Equipment", "Electronics", "Computers", "Vehicles"],
    },
    "customer_tags": {
        "label": "Customer Tags",
        "defaults": ["VIP", "Regular", "Wholesale", "Corporate", "AMC", "Warranty", "Referral"],
    },
}

LIST_KEY_CHOICES = [(key, entry["label"]) for key, entry in LIST_REGISTRY.items()]
```

Append to `backend/apps/core/models.py`:

```python
class ConfigOption(BaseModel):
    """One entry of a tenant-configurable dropdown list (soft-bound: consuming
    fields store the text value, not an FK). List types live in core.config_lists."""

    list_key = models.CharField(max_length=40)
    value = models.CharField(max_length=120)
    sort_order = models.PositiveSmallIntegerField(default=0)
    is_active = models.BooleanField(default=True)   # deactivate ≠ delete
    is_system = models.BooleanField(default=False)  # seeded default; not deletable

    class Meta:
        unique_together = (("list_key", "value"),)
        ordering = ["list_key", "sort_order", "value"]
        indexes = [models.Index(fields=["list_key", "is_active"])]

    def __str__(self) -> str:
        return f"{self.list_key}: {self.value}"
```

(`list_key` deliberately has no `choices=` — the API validates against `LIST_REGISTRY` so adding a list type never needs a migration.)

Run: `cd backend && python3 manage.py makemigrations core --name configoption`
Expected: `backend/apps/core/migrations/0010_configoption.py` (plain reversible `CreateModel`).

- [ ] **Step 4: Run to verify pass**

Run: `cd backend && python3 -m pytest apps/core/tests/test_config_lists.py --no-cov -v` — all PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/apps/core/config_lists.py backend/apps/core/models.py backend/apps/core/migrations/0010_configoption.py backend/apps/core/tests/test_config_lists.py
git commit -m "feat(core): ConfigOption model + LIST_REGISTRY catalog"
```

---

### Task 2: Config API + `settings.lists.manage` permission

**Files:**
- Create: `backend/apps/core/config_views.py`, `backend/apps/core/config_urls.py`
- Modify: `backend/config/urls.py` (add `path("api/v1/config/", include("core.config_urls")),` next to the `core.settings_urls` include at line 13)
- Modify: `backend/apps/master/services.py` (`_seed_roles_and_permissions` catalogue: add `("settings.lists.manage", "settings")` beside the other settings permissions; include it wherever the existing grant block grants the other `settings.*` permissions to Tenant Admin)
- Test: `backend/apps/core/tests/test_config_api.py` (new)

- [ ] **Step 1: Write the failing tests**

Create `backend/apps/core/tests/test_config_api.py`:

```python
"""core › /api/v1/config/lists/ API."""
import uuid

import pytest
from rest_framework import status

LISTS_URL = "/api/v1/config/lists/"


@pytest.fixture
def client_with_perms(db):
    from authentication.models import User
    from rest_framework.test import APIClient
    from rest_framework_simplejwt.tokens import RefreshToken

    def _make(perms):
        suffix = uuid.uuid4().hex[:8]
        user = User.objects.create_user(
            email=f"u{suffix}@t.com", phone=f"+9191{uuid.uuid4().int % 100000000:08d}",
            full_name="Tester", password="Pass@123",
        )
        refresh = RefreshToken.for_user(user)
        access = refresh.access_token
        access["permissions"] = perms
        access["shop_ids"] = []
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {str(access)}")
        return client

    return _make


@pytest.fixture
def options(db):
    from core.models import ConfigOption
    return {
        "active": ConfigOption.objects.create(
            list_key="device_types", value="Mobile", sort_order=0, is_system=True
        ),
        "inactive": ConfigOption.objects.create(
            list_key="device_types", value="Pager", sort_order=1, is_active=False
        ),
    }


@pytest.mark.django_db
def test_get_lists_returns_active_options_grouped(options, client_with_perms):
    client = client_with_perms([])  # any authenticated user
    resp = client.get(LISTS_URL)
    assert resp.status_code == status.HTTP_200_OK, resp.content
    lists = resp.json()["data"]["lists"]
    device_types = next(l for l in lists if l["list_key"] == "device_types")
    values = [o["value"] for o in device_types["options"]]
    assert "Mobile" in values and "Pager" not in values  # inactive hidden
    assert {l["list_key"] for l in lists} == {
        "device_types", "device_brands", "expense_categories",
        "asset_categories", "customer_tags",
    }


@pytest.mark.django_db
def test_create_requires_manage_permission(client_with_perms):
    denied = client_with_perms([])
    resp = denied.post(f"{LISTS_URL}device_types/options/", {"value": "Drone"})
    assert resp.status_code == status.HTTP_403_FORBIDDEN

    allowed = client_with_perms(["settings.lists.manage"])
    resp = allowed.post(f"{LISTS_URL}device_types/options/", {"value": "Drone"})
    assert resp.status_code == status.HTTP_201_CREATED, resp.content


@pytest.mark.django_db
def test_unknown_list_key_404_and_duplicate_422(options, client_with_perms):
    client = client_with_perms(["settings.lists.manage"])
    assert client.post(f"{LISTS_URL}nope/options/", {"value": "X"}).status_code == status.HTTP_404_NOT_FOUND
    resp = client.post(f"{LISTS_URL}device_types/options/", {"value": "Mobile"})
    assert resp.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY


@pytest.mark.django_db
def test_patch_and_system_delete_guard(options, client_with_perms):
    client = client_with_perms(["settings.lists.manage"])
    opt = options["inactive"]
    resp = client.patch(f"/api/v1/config/options/{opt.id}/", {"is_active": True, "sort_order": 5})
    assert resp.status_code == status.HTTP_200_OK, resp.content
    opt.refresh_from_db()
    assert opt.is_active is True and opt.sort_order == 5

    # System rows cannot be deleted (deactivate instead) …
    assert client.delete(f"/api/v1/config/options/{options['active'].id}/").status_code \
        == status.HTTP_422_UNPROCESSABLE_ENTITY
    # …non-system rows can.
    assert client.delete(f"/api/v1/config/options/{opt.id}/").status_code == status.HTTP_204_NO_CONTENT
```

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && python3 -m pytest apps/core/tests/test_config_api.py --no-cov -v`
Expected: FAIL — 404 on `/api/v1/config/lists/` (no route).

- [ ] **Step 3: Implement**

Create `backend/apps/core/config_views.py`:

```python
"""Tenant-configurable dropdown lists (spec: configurable-lists design §3)."""
from rest_framework import serializers, status
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from authentication.permissions import require_permission

from .config_lists import LIST_REGISTRY
from .models import ConfigOption


class ConfigOptionSerializer(serializers.ModelSerializer):
    class Meta:
        model = ConfigOption
        fields = ["id", "list_key", "value", "sort_order", "is_active", "is_system"]
        read_only_fields = ["id", "list_key", "is_system"]


class ConfigListsView(APIView):
    """GET: every registered list with its ACTIVE options, one response."""

    permission_classes = [IsAuthenticated]

    def get(self, request: Request) -> Response:
        by_key: dict[str, list] = {key: [] for key in LIST_REGISTRY}
        for opt in ConfigOption.objects.filter(is_active=True):
            if opt.list_key in by_key:
                by_key[opt.list_key].append(opt)
        return Response({
            "lists": [
                {
                    "list_key": key,
                    "label": entry["label"],
                    "options": ConfigOptionSerializer(by_key[key], many=True).data,
                }
                for key, entry in LIST_REGISTRY.items()
            ]
        })


class ConfigOptionCreateView(APIView):
    permission_classes = [IsAuthenticated, require_permission("settings.lists.manage")]

    def post(self, request: Request, list_key: str) -> Response:
        if list_key not in LIST_REGISTRY:
            return Response({"detail": "Unknown list."}, status=status.HTTP_404_NOT_FOUND)
        serializer = ConfigOptionSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        value = serializer.validated_data["value"].strip()
        if ConfigOption.objects.filter(list_key=list_key, value__iexact=value).exists():
            return Response(
                {"code": "DUPLICATE_OPTION", "detail": "This value already exists."},
                status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            )
        option = ConfigOption.objects.create(
            list_key=list_key, value=value,
            sort_order=serializer.validated_data.get("sort_order", 0),
        )
        return Response(ConfigOptionSerializer(option).data, status=status.HTTP_201_CREATED)


class ConfigOptionDetailView(APIView):
    permission_classes = [IsAuthenticated, require_permission("settings.lists.manage")]

    def _get_or_404(self, option_id):
        return ConfigOption.objects.filter(id=option_id).first()

    def patch(self, request: Request, option_id) -> Response:
        option = self._get_or_404(option_id)
        if option is None:
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        serializer = ConfigOptionSerializer(option, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        new_value = serializer.validated_data.get("value")
        if new_value and ConfigOption.objects.filter(
            list_key=option.list_key, value__iexact=new_value.strip()
        ).exclude(id=option.id).exists():
            return Response(
                {"code": "DUPLICATE_OPTION", "detail": "This value already exists."},
                status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            )
        serializer.save()
        return Response(serializer.data)

    def delete(self, request: Request, option_id) -> Response:
        option = self._get_or_404(option_id)
        if option is None:
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        if option.is_system:
            return Response(
                {"code": "SYSTEM_OPTION", "detail": "System defaults can be deactivated, not deleted."},
                status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            )
        option.delete()
        return Response(status=status.HTTP_204_NO_CONTENT)
```

Create `backend/apps/core/config_urls.py`:

```python
from django.urls import path

from .config_views import ConfigListsView, ConfigOptionCreateView, ConfigOptionDetailView

urlpatterns = [
    path("lists/", ConfigListsView.as_view(), name="config-lists"),
    path("lists/<str:list_key>/options/", ConfigOptionCreateView.as_view(), name="config-option-create"),
    path("options/<uuid:option_id>/", ConfigOptionDetailView.as_view(), name="config-option-detail"),
]
```

Add the include to `backend/config/urls.py` and the `("settings.lists.manage", "settings")` permission to the catalogue in `master/services.py` (plus the Tenant Admin grant, following how the neighbouring `settings.*` permissions are granted there).

- [ ] **Step 4: Run to verify pass**

Run: `cd backend && python3 -m pytest apps/core/tests/test_config_api.py apps/master --no-cov -q` — all PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/apps/core/config_views.py backend/apps/core/config_urls.py backend/config/urls.py backend/apps/master/services.py backend/apps/core/tests/test_config_api.py
git commit -m "feat(core): config lists API + settings.lists.manage permission"
```

---

### Task 3: Reference seeders — config options, roles/permissions healer, starter segments

**Files:**
- Modify: `backend/apps/core/seeds.py` (append — file created by the overhaul plan)
- Create: `backend/apps/authentication/seeds.py` (overhaul created it for demo users — append there instead if it exists)
- Modify: `backend/apps/crm/seeds.py` (append)
- Test: `backend/apps/core/tests/test_reference_seeders.py` (new)

- [ ] **Step 1: Write the failing tests**

Create `backend/apps/core/tests/test_reference_seeders.py`:

```python
"""Reference seeders: config options, roles/permissions healer, starter segments."""
import pytest

from core.seeding import SeedContext


@pytest.mark.django_db
def test_config_options_seeded_in_registry_order_and_idempotent():
    from core.config_lists import LIST_REGISTRY
    from core.models import ConfigOption
    from core.seeds import ConfigOptionsSeeder

    seeder = ConfigOptionsSeeder()
    seeder.run(SeedContext())
    total = sum(len(e["defaults"]) for e in LIST_REGISTRY.values())
    assert ConfigOption.objects.count() == total
    first = ConfigOption.objects.filter(list_key="device_types").first()
    assert first.value == "Mobile" and first.is_system and first.sort_order == 0

    seeder.run(SeedContext())  # idempotent
    assert ConfigOption.objects.count() == total


@pytest.mark.django_db
def test_config_options_never_resurrect_deactivated():
    from core.models import ConfigOption
    from core.seeds import ConfigOptionsSeeder

    seeder = ConfigOptionsSeeder()
    seeder.run(SeedContext())
    ConfigOption.objects.filter(list_key="device_types", value="Pager").delete()  # not present anyway
    opt = ConfigOption.objects.get(list_key="device_types", value="TV")
    opt.is_active = False
    opt.save(update_fields=["is_active"])
    seeder.run(SeedContext())
    opt.refresh_from_db()
    assert opt.is_active is False


@pytest.mark.django_db
def test_roles_permissions_healer_adds_missing_permission():
    from authentication.models import Permission
    from authentication.seeds import RolesPermissionsSeeder

    RolesPermissionsSeeder().run(SeedContext())
    assert Permission.objects.filter(code="settings.lists.manage").exists()
    Permission.objects.filter(code="settings.lists.manage").delete()
    RolesPermissionsSeeder().run(SeedContext())  # healer restores it
    assert Permission.objects.filter(code="settings.lists.manage").exists()


@pytest.mark.django_db
def test_starter_segments_created_once():
    from crm.models import CustomerSegment
    from crm.seeds import StarterSegmentsSeeder

    seeder = StarterSegmentsSeeder()
    seeder.run(SeedContext())
    names = set(CustomerSegment.objects.values_list("name", flat=True))
    assert {"VIP Customers", "Business Customers", "High Value"} <= names

    CustomerSegment.objects.filter(name="High Value").delete()  # tenant deleted it
    count = CustomerSegment.objects.count()
    seeder.run(SeedContext())
    # get_or_create recreates deleted ones but never duplicates existing:
    assert CustomerSegment.objects.filter(name="VIP Customers").count() == 1
    assert CustomerSegment.objects.count() == count + 1
```

*(Note: `Permission.code` — verify the actual field name in `authentication/models.py` (`code` vs `name`) and adjust the healer test to match what `_seed_roles_and_permissions` writes.)*

- [ ] **Step 2: Run to verify failure**

Run: `cd backend && python3 -m pytest apps/core/tests/test_reference_seeders.py --no-cov -v`
Expected: FAIL — seeder classes don't exist.

- [ ] **Step 3: Implement**

Append to `backend/apps/core/seeds.py`:

```python
class ConfigOptionsSeeder(Seeder):
    """Reference: seed LIST_REGISTRY defaults as is_system rows, in registry order.
    Upsert by (list_key, value); existing rows are never touched, so a
    deactivated system row stays deactivated."""

    name = "core.config_options"
    scope = "reference"

    def run(self, ctx: SeedContext) -> None:
        from core.config_lists import LIST_REGISTRY
        from core.models import ConfigOption

        for list_key, entry in LIST_REGISTRY.items():
            for order, value in enumerate(entry["defaults"]):
                ConfigOption.objects.get_or_create(
                    list_key=list_key, value=value,
                    defaults={"sort_order": order, "is_system": True},
                )


register(ConfigOptionsSeeder)
```

Append to `backend/apps/authentication/seeds.py` (create the file with the standard imports if the overhaul didn't put demo users there):

```python
class RolesPermissionsSeeder(Seeder):
    """Reference healer: re-runs the idempotent role/permission catalogue so
    tenants provisioned before newer permissions were added get topped up."""

    name = "authentication.roles_permissions"
    scope = "reference"

    def run(self, ctx: SeedContext) -> None:
        from master.services import _seed_roles_and_permissions

        _seed_roles_and_permissions()


register(RolesPermissionsSeeder)
```

Append to `backend/apps/crm/seeds.py`:

```python
STARTER_SEGMENTS = [
    ("VIP Customers", "Customers tagged VIP", {"tags": ["VIP"]}),
    ("Business Customers", "Business-type customers", {"customer_type": "business"}),
    ("High Value", "Total billed ≥ ₹10,000", {"min_total_billed": 10000}),
]


class StarterSegmentsSeeder(Seeder):
    """Reference: three dynamic starter segments (ordinary deletable rows)."""

    name = "crm.starter_segments"
    scope = "reference"
    depends_on = ("core.config_options",)  # references the seeded VIP tag

    def run(self, ctx: SeedContext) -> None:
        from crm.models import CustomerSegment

        for name, description, rules in STARTER_SEGMENTS:
            CustomerSegment.objects.get_or_create(
                name=name,
                defaults={"description": description, "filter_rules": rules, "is_dynamic": True},
            )


register(StarterSegmentsSeeder)
```

- [ ] **Step 4: Run to verify pass**

Run: `cd backend && python3 -m pytest apps/core/tests/test_reference_seeders.py apps/core/tests/test_seeding_registry.py --no-cov -q` — all PASS (registry DAG still valid with the new seeders).

- [ ] **Step 5: Commit**

```bash
git add backend/apps/core/seeds.py backend/apps/authentication/seeds.py backend/apps/crm/seeds.py backend/apps/core/tests/test_reference_seeders.py
git commit -m "feat(seeding): config-options, roles-healer and starter-segment reference seeders"
```

---

### Task 4: `seed_plans` command (master DB) + entrypoint call

**Files:**
- Create: `backend/apps/master/management/commands/seed_plans.py`
- Modify: `backend/entrypoint.sh` (call before the `create_tenant` block)
- Modify: `backend/apps/master/management/commands/seed_demo.py` (`_seed_subscription` reuses the command's values via `call_command("seed_plans")` then `get(name="Professional")`)
- Test: `backend/apps/master/tests/test_seed_plans.py` (new)

- [ ] **Step 1: Write the failing tests**

Create `backend/apps/master/tests/test_seed_plans.py`:

```python
"""master › seed_plans — closes the fresh-install provisioning failure."""
import pytest
from django.core.management import call_command
from io import StringIO


@pytest.mark.django_db
def test_seeds_three_plans_idempotently():
    from master.models import SubscriptionPlan

    call_command("seed_plans", stdout=StringIO())
    names = set(SubscriptionPlan.objects.values_list("name", flat=True))
    assert {"Starter", "Professional", "Enterprise"} <= names
    count = SubscriptionPlan.objects.count()

    call_command("seed_plans", stdout=StringIO())
    assert SubscriptionPlan.objects.count() == count


@pytest.mark.django_db
def test_create_tenant_plan_lookup_matches():
    """create_tenant resolves plans via name__iexact on starter/professional/enterprise."""
    from master.models import SubscriptionPlan

    call_command("seed_plans", stdout=StringIO())
    for slug in ("starter", "professional", "enterprise"):
        assert SubscriptionPlan.objects.filter(name__iexact=slug).exists()
```

- [ ] **Step 2: Run to verify failure** — `cd backend && python3 -m pytest apps/master/tests/test_seed_plans.py --no-cov -v` → `Unknown command`.

- [ ] **Step 3: Implement**

Create `backend/apps/master/management/commands/seed_plans.py`:

```python
"""Idempotently seed the SaaS subscription-plan catalogue (master DB).

Without this, create_tenant fails on a fresh master DB ("Plan 'starter' not
found"). Run by the dev entrypoint; run once per environment in production.
"""
from decimal import Decimal

from django.core.management.base import BaseCommand

ALL_FEATURES = {
    "crm": True, "repair": True, "pos": True, "erp": True,
    "amc": True, "billing": True, "hr": True, "reports": True,
}

PLANS = [
    {"name": "Starter", "max_shops": 1, "max_users": 5,
     "price_monthly_inr": Decimal("999.00"),
     "features": {**ALL_FEATURES, "amc": False, "hr": False}},
    {"name": "Professional", "max_shops": 10, "max_users": 50,
     "price_monthly_inr": Decimal("2999.00"), "features": ALL_FEATURES},
    {"name": "Enterprise", "max_shops": None, "max_users": None,
     "price_monthly_inr": Decimal("9999.00"), "features": ALL_FEATURES},
]


class Command(BaseCommand):
    help = "Seed the subscription-plan catalogue on the master DB (idempotent)."

    def handle(self, *args, **options):
        from master.models import SubscriptionPlan

        for plan in PLANS:
            _, created = SubscriptionPlan.objects.using("default").get_or_create(
                name=plan["name"], defaults={k: v for k, v in plan.items() if k != "name"},
            )
            self.stdout.write(f"  {'✓ created' if created else '↷ exists'}: {plan['name']}")
```

In `backend/entrypoint.sh`, directly before the `create_tenant` block:

```bash
echo "==> [seed] Seeding subscription plans (idempotent)..."
python manage.py seed_plans
```

In `seed_demo.py::_seed_subscription`, replace the inline Professional `get_or_create` with:

```python
        from django.core.management import call_command
        call_command("seed_plans", stdout=self.stdout)
        plan = SubscriptionPlan.objects.using("default").get(name="Professional")
```

(keep the `TenantSubscription.update_or_create` part unchanged).

- [ ] **Step 4: Run to verify pass** — `cd backend && python3 -m pytest apps/master --no-cov -q` → all PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/apps/master/management/commands/seed_plans.py backend/entrypoint.sh backend/apps/master/management/commands/seed_demo.py backend/apps/master/tests/test_seed_plans.py
git commit -m "feat(master): seed_plans command — plans exist on fresh installs"
```

---

### Task 5: Frontend — config API client + `ConfigSelect`

**Files:**
- Create: `frontend/src/lib/api/config.ts`
- Create: `frontend/src/components/shared/ConfigSelect.tsx`
- Test: `frontend/src/components/shared/__tests__/ConfigSelect.test.tsx` (new)

- [ ] **Step 1: Write the failing test**

Create `frontend/src/components/shared/__tests__/ConfigSelect.test.tsx`:

```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConfigSelect } from '../ConfigSelect';

const authState = { hasPermission: () => true, hasAnyPermission: () => true, user: { id: 'u-1' } };
vi.mock('@/lib/stores/authStore', () => ({
  useAuthStore: (selector?: (s: typeof authState) => unknown) =>
    selector ? selector(authState) : authState,
}));

const getLists = vi.fn();
const createOption = vi.fn();
vi.mock('@/lib/api/config', async (importActual) => {
  const actual = await importActual<typeof import('@/lib/api/config')>();
  return {
    ...actual,
    configApi: {
      ...actual.configApi,
      getLists: (...a: unknown[]) => getLists(...a),
      createOption: (...a: unknown[]) => createOption(...a),
    },
  };
});

function renderSelect(props = {}) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onChange = vi.fn();
  render(
    <QueryClientProvider client={qc}>
      <ConfigSelect listKey="device_types" value="" onChange={onChange} placeholder="Device type" {...props} />
    </QueryClientProvider>,
  );
  return { onChange };
}

describe('ConfigSelect', () => {
  beforeEach(() => {
    getLists.mockReset().mockResolvedValue({
      lists: [{
        list_key: 'device_types', label: 'Device Types',
        options: [
          { id: 'o-1', list_key: 'device_types', value: 'Mobile', sort_order: 0, is_active: true, is_system: true },
          { id: 'o-2', list_key: 'device_types', value: 'Laptop', sort_order: 1, is_active: true, is_system: true },
        ],
      }],
    });
    createOption.mockReset().mockResolvedValue({ id: 'o-9', value: 'Drone' });
  });

  it('renders configured options for its list', async () => {
    renderSelect();
    fireEvent.focus(screen.getByPlaceholderText('Device type'));
    expect(await screen.findByText('Mobile')).toBeInTheDocument();
    expect(screen.getByText('Laptop')).toBeInTheDocument();
  });

  it('selecting an option calls onChange with its value', async () => {
    const { onChange } = renderSelect();
    fireEvent.focus(screen.getByPlaceholderText('Device type'));
    fireEvent.click(await screen.findByText('Mobile'));
    expect(onChange).toHaveBeenCalledWith('Mobile');
  });

  it('free typing still propagates (soft binding)', async () => {
    const { onChange } = renderSelect();
    fireEvent.change(screen.getByPlaceholderText('Device type'), { target: { value: 'Projector' } });
    expect(onChange).toHaveBeenCalledWith('Projector');
  });

  it('offers add-new which posts and selects', async () => {
    const { onChange } = renderSelect();
    fireEvent.change(screen.getByPlaceholderText('Device type'), { target: { value: 'Drone' } });
    fireEvent.click(await screen.findByText(/add “drone”/i));
    expect(createOption).toHaveBeenCalledWith('device_types', { value: 'Drone' });
    expect(onChange).toHaveBeenLastCalledWith('Drone');
  });
});
```

- [ ] **Step 2: Run to verify failure** — `cd frontend && npx vitest run src/components/shared/__tests__/ConfigSelect.test.tsx` → module not found.

- [ ] **Step 3: Implement**

Create `frontend/src/lib/api/config.ts`:

```ts
import { apiGet, apiPost, apiPatch, apiDelete } from './client';

export interface ConfigOption {
  id: string;
  list_key: string;
  value: string;
  sort_order: number;
  is_active: boolean;
  is_system: boolean;
}

export interface ConfigList {
  list_key: string;
  label: string;
  options: ConfigOption[];
}

export const configKeys = {
  lists: ['config', 'lists'] as const,
};

export const configApi = {
  getLists: () => apiGet<{ lists: ConfigList[] }>('/config/lists/'),
  createOption: (listKey: string, body: { value: string; sort_order?: number }) =>
    apiPost<ConfigOption>(`/config/lists/${listKey}/options/`, body),
  updateOption: (id: string, body: Partial<Pick<ConfigOption, 'value' | 'sort_order' | 'is_active'>>) =>
    apiPatch<ConfigOption>(`/config/options/${id}/`, body),
  deleteOption: (id: string) => apiDelete<void>(`/config/options/${id}/`),
};
```

Create `frontend/src/components/shared/ConfigSelect.tsx`:

```tsx
'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { configApi, configKeys } from '@/lib/api/config';
import { useAuthStore } from '@/lib/stores/authStore';

interface ConfigSelectProps {
  listKey: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
}

/** Combobox over a tenant-configurable list (soft binding: free text allowed;
 *  users with settings.lists.manage can add the typed value to the list). */
export function ConfigSelect({ listKey, value, onChange, placeholder, className }: ConfigSelectProps) {
  const [open, setOpen] = useState(false);
  const canManage = useAuthStore((s) => s.hasPermission('settings.lists.manage'));
  const qc = useQueryClient();

  const { data } = useQuery({ queryKey: configKeys.lists, queryFn: configApi.getLists, staleTime: 5 * 60_000 });
  const options = useMemo(
    () => data?.lists.find((l) => l.list_key === listKey)?.options ?? [],
    [data, listKey],
  );

  const addOption = useMutation({
    mutationFn: (v: string) => configApi.createOption(listKey, { value: v }),
    onSuccess: (_res, v) => {
      qc.invalidateQueries({ queryKey: configKeys.lists });
      onChange(v);
      setOpen(false);
    },
  });

  const filtered = value
    ? options.filter((o) => o.value.toLowerCase().includes(value.toLowerCase()))
    : options;
  const exactMatch = options.some((o) => o.value.toLowerCase() === value.toLowerCase());

  return (
    <div className={`relative ${className ?? ''}`}>
      <input
        type="text"
        value={value}
        placeholder={placeholder}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => { onChange(e.target.value); setOpen(true); }}
        className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-body-sm"
      />
      {open && (filtered.length > 0 || (canManage && value && !exactMatch)) && (
        <ul className="absolute z-20 mt-1 w-full max-h-56 overflow-auto rounded-md border border-[var(--border)] bg-[var(--surface)] shadow-lg">
          {filtered.map((o) => (
            <li key={o.id}>
              <button
                type="button"
                className="w-full px-3 py-2 text-left text-body-sm hover:bg-[var(--surface-2)]"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { onChange(o.value); setOpen(false); }}
              >
                {o.value}
              </button>
            </li>
          ))}
          {canManage && value && !exactMatch && (
            <li>
              <button
                type="button"
                className="w-full px-3 py-2 text-left text-body-sm text-[var(--primary)] hover:bg-[var(--surface-2)]"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => addOption.mutate(value)}
              >
                Add “{value}”…
              </button>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run to verify pass** — `cd frontend && npx vitest run src/components/shared/__tests__/ConfigSelect.test.tsx && npx tsc --noEmit` → PASS, no type errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/api/config.ts frontend/src/components/shared/ConfigSelect.tsx frontend/src/components/shared/__tests__/ConfigSelect.test.tsx
git commit -m "feat(frontend): config API client + ConfigSelect combobox"
```

---

### Task 6: Settings → Lists page + nav tab

**Files:**
- Create: `frontend/src/app/(app)/settings/lists/page.tsx`
- Modify: `frontend/src/app/(app)/settings/layout.tsx:15-21` (add tab)
- Test: `frontend/src/app/(app)/settings/lists/__tests__/lists.test.tsx` (new)

- [ ] **Step 1: Add the nav tab** in `settings/layout.tsx` after the Taxes entry:

```ts
  { label: 'Lists',             href: '/settings/lists',            permission: 'settings.lists.manage' },
```

- [ ] **Step 2: Write the failing page test** — follow the exact structure of `frontend/src/app/(app)/finance/pnl/__tests__/pnl.test.tsx` (authStore + activeShopStore mocks, mocked `configApi`, `renderPage()` helper). Assertions:

```tsx
  it('renders each registered list with its options', async () => {
    renderPage();
    expect(await screen.findByText('Device Types')).toBeInTheDocument();
    expect(screen.getByText('Mobile')).toBeInTheDocument();
  });

  it('system options show a lock, not a delete button', async () => {
    renderPage();
    await screen.findByText('Mobile');
    expect(screen.queryByRole('button', { name: /delete mobile/i })).not.toBeInTheDocument();
    expect(screen.getByLabelText(/system default/i)).toBeInTheDocument();
  });

  it('adding an option calls the create endpoint', async () => {
    renderPage();
    await screen.findByText('Device Types');
    fireEvent.change(screen.getByPlaceholderText(/add to device types/i), { target: { value: 'Drone' } });
    fireEvent.click(screen.getByRole('button', { name: /add to device types/i }));
    await waitFor(() => expect(createOption).toHaveBeenCalledWith('device_types', { value: 'Drone' }));
  });
```

(mock `getLists` to return the five lists with one system + one custom option in `device_types`).

- [ ] **Step 3: Implement the page.** One card per list (from `getLists`, which returns all five even when empty): rows show value, drag-free reorder via up/down `sort_order` PATCH buttons, an activate/deactivate toggle (PATCH `is_active`), rename inline (PATCH `value`), delete button only when `!is_system` (DELETE, then invalidate `configKeys.lists`), a lock icon with `aria-label="System default"` when `is_system`, and an "Add to ‹label›" input + button per card (POST). Gate the page on `settings.lists.manage` the same way `settings/taxes/page.tsx` gates on its permission. All mutations invalidate `configKeys.lists`.

- [ ] **Step 4: Run to verify pass** — `cd frontend && npx vitest run "src/app/(app)/settings/lists" && npx tsc --noEmit` → PASS.

- [ ] **Step 5: Commit**

```bash
git add "frontend/src/app/(app)/settings/lists" "frontend/src/app/(app)/settings/layout.tsx"
git commit -m "feat(settings): Lists management page"
```

---

### Task 7: Adopt `ConfigSelect` in the free-text forms

**Files (input swap only — form state, schema and API payloads unchanged):**
- Modify: `frontend/src/app/(app)/jobs/new/page.tsx` — `device_type` → `<ConfigSelect listKey="device_types" …>`, `device_brand` → `listKey="device_brands"`
- Modify: the lead create/edit form (locate the `device_type` input via `grep -n "device_type" frontend/src/app/\(app\)/leads/page.tsx frontend/src/components/crm/LeadCard.tsx`) → `listKey="device_types"`
- Modify: `frontend/src/app/(app)/finance/expenses/page.tsx` — category input → `listKey="expense_categories"`
- Modify: `frontend/src/app/(app)/finance/petty-cash/page.tsx` — category input → `listKey="expense_categories"`
- Modify: `frontend/src/app/(app)/finance/assets/page.tsx` — category input → `listKey="asset_categories"`
- Modify: `frontend/src/components/inventory/ProductForm.tsx` — `brand` input → `listKey="device_brands"`
- Modify: `frontend/src/components/crm/CustomerFormDialog.tsx` — tags input gains `customer_tags` suggestions via `ConfigSelect` (value = tag being typed; keep existing add-tag-to-array behavior)

- [ ] **Step 1: Swap the inputs.** Worked example for `jobs/new/page.tsx` (the others follow the same pattern — replace the `<input type="text">` bound to the field with):

```tsx
<ConfigSelect
  listKey="device_types"
  value={wizardData.device_type}
  onChange={(v) => setWizardData((d) => ({ ...d, device_type: v }))}
  placeholder="e.g. Mobile"
/>
```

- [ ] **Step 2: Update affected page tests.** Any existing test that fired `change` on the old inputs keeps working (ConfigSelect renders a real `<input>` with the same placeholder); add `configApi.getLists` to the page-level API mocks where the page now queries it (mock resolving `{ lists: [] }` is enough — free text still works).
- [ ] **Step 3: Verify** — `cd frontend && npx vitest run && npx tsc --noEmit` → all PASS.
- [ ] **Step 4: Commit**

```bash
git add frontend/src
git commit -m "feat(frontend): adopt ConfigSelect in job, lead, finance, product and customer forms"
```

---

### Task 8: Shared India-states constant with GST codes

**Files:**
- Create: `frontend/src/lib/constants/indiaStates.ts`
- Modify: `frontend/src/app/(app)/onboarding/page.tsx` (delete inline `INDIA_STATES`, import shared; auto-fill `state_code` on select)
- Modify: `frontend/src/app/(app)/settings/shop/page.tsx` (same)
- Test: `frontend/src/lib/constants/__tests__/indiaStates.test.ts` (new)

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect } from 'vitest';
import { INDIA_STATES, gstCodeForState } from '../indiaStates';

describe('INDIA_STATES', () => {
  it('has 36 states/UTs with 2-digit GST codes', () => {
    expect(INDIA_STATES).toHaveLength(36);
    for (const s of INDIA_STATES) {
      expect(s.gst_code).toMatch(/^\d{2}$/);
      expect(s.name.length).toBeGreaterThan(2);
    }
  });

  it('maps names to statutory GST codes', () => {
    expect(gstCodeForState('Delhi')).toBe('07');
    expect(gstCodeForState('Maharashtra')).toBe('27');
    expect(gstCodeForState('Uttar Pradesh')).toBe('09');
    expect(gstCodeForState('Atlantis')).toBeNull();
  });
});
```

- [ ] **Step 2: Implement** `frontend/src/lib/constants/indiaStates.ts`:

```ts
/** Statutory Indian states/UTs with GST state codes. Fixed data — code, not DB. */
export interface IndiaState { name: string; gst_code: string }

export const INDIA_STATES: IndiaState[] = [
  { name: 'Jammu & Kashmir', gst_code: '01' }, { name: 'Himachal Pradesh', gst_code: '02' },
  { name: 'Punjab', gst_code: '03' }, { name: 'Chandigarh', gst_code: '04' },
  { name: 'Uttarakhand', gst_code: '05' }, { name: 'Haryana', gst_code: '06' },
  { name: 'Delhi', gst_code: '07' }, { name: 'Rajasthan', gst_code: '08' },
  { name: 'Uttar Pradesh', gst_code: '09' }, { name: 'Bihar', gst_code: '10' },
  { name: 'Sikkim', gst_code: '11' }, { name: 'Arunachal Pradesh', gst_code: '12' },
  { name: 'Nagaland', gst_code: '13' }, { name: 'Manipur', gst_code: '14' },
  { name: 'Mizoram', gst_code: '15' }, { name: 'Tripura', gst_code: '16' },
  { name: 'Meghalaya', gst_code: '17' }, { name: 'Assam', gst_code: '18' },
  { name: 'West Bengal', gst_code: '19' }, { name: 'Jharkhand', gst_code: '20' },
  { name: 'Odisha', gst_code: '21' }, { name: 'Chhattisgarh', gst_code: '22' },
  { name: 'Madhya Pradesh', gst_code: '23' }, { name: 'Gujarat', gst_code: '24' },
  { name: 'Dadra & Nagar Haveli and Daman & Diu', gst_code: '26' },
  { name: 'Maharashtra', gst_code: '27' }, { name: 'Karnataka', gst_code: '29' },
  { name: 'Goa', gst_code: '30' }, { name: 'Lakshadweep', gst_code: '31' },
  { name: 'Kerala', gst_code: '32' }, { name: 'Tamil Nadu', gst_code: '33' },
  { name: 'Puducherry', gst_code: '34' }, { name: 'Andaman & Nicobar Islands', gst_code: '35' },
  { name: 'Telangana', gst_code: '36' }, { name: 'Andhra Pradesh', gst_code: '37' },
  { name: 'Ladakh', gst_code: '38' },
];

export function gstCodeForState(name: string): string | null {
  return INDIA_STATES.find((s) => s.name === name)?.gst_code ?? null;
}
```

- [ ] **Step 3: Swap both pages** — delete the inline `INDIA_STATES` arrays; render `{INDIA_STATES.map((s) => <SelectItem key={s.gst_code} value={s.name}>{s.name}</SelectItem>)}`; on state change also set the form's `state_code` via `gstCodeForState(name)` (both pages already have a `state_code` field in their form state — check each form's setter name and wire it).
- [ ] **Step 4: Verify** — `cd frontend && npx vitest run src/lib/constants && npx tsc --noEmit` plus the onboarding/shop page tests if present → PASS.
- [ ] **Step 5: Commit**

```bash
git add frontend/src/lib/constants "frontend/src/app/(app)/onboarding/page.tsx" "frontend/src/app/(app)/settings/shop/page.tsx"
git commit -m "refactor(frontend): shared India-states constant with GST codes"
```

---

### Task 9: Full verification + PR

- [ ] **Step 1:** `cd backend && python3 -m pytest --no-cov -q` — green except the 10 known weasyprint local failures.
- [ ] **Step 2:** `cd frontend && npx vitest run && npx tsc --noEmit` — all green.
- [ ] **Step 3:** Live check — `docker compose up -d --build backend && docker compose exec backend python manage.py seed_demo --force`, then in the app verify: `/settings/lists` shows the five lists with defaults; the new-job wizard's device-type field offers Mobile/Laptop/…; CRM shows the three starter segments.
- [ ] **Step 4:** Tick all checkboxes in this plan; commit (`docs(plan): tick configurable-lists tasks`).
- [ ] **Step 5:** Push and open the PR:

```bash
git push -u origin feature/configurable-lists
gh pr create --base master --title "feat: configurable lists + reference dropdown data" --body "<summary, test results, spec/plan links>"
```

(Old `gh` CLI: poll `gh pr checks`; verify the PR base is `master` before merging.)
