"""
Tests for FaultTemplate nested-parts write + job auto-populate.
"""

import pytest
from rest_framework import status


# ──────────────────────────────────────────────────────────────────────────────
# Fixtures
# ──────────────────────────────────────────────────────────────────────────────


@pytest.fixture
def shop(db):
    from core.models import Shop
    return Shop.objects.create(
        name="Fix Hub",
        code="FIX",
        address="Ring Road",
        city="Pune",
        state="MH",
        state_code="27",
        phone="+919900000001",
    )


@pytest.fixture
def customer(db, shop):
    from crm.models import Customer
    return Customer.objects.create(shop=shop, name="Test Customer", phone="+919811200002")


@pytest.fixture
def admin_user(db):
    from authentication.models import Permission, Role, RolePermission, User, UserRole

    user = User.objects.create_user(
        email="admin@tmpl.test",
        phone="+919000000099",
        full_name="Template Admin",
        password="AdminPass@1",
    )
    role, _ = Role.objects.get_or_create(name="Tenant Admin", defaults={"is_system_role": True})
    for codename in [
        "repair.templates.manage",
        "repair.jobs.create",
        "repair.jobs.view",
    ]:
        perm, _ = Permission.objects.get_or_create(
            codename=codename, defaults={"module": "repair", "label": codename}
        )
        RolePermission.objects.get_or_create(role=role, permission=perm)
    UserRole.objects.create(user=user, role=role, shop=None)
    return user


@pytest.fixture
def admin_client(api_client, admin_user):
    from authentication.tokens import _build_token_claims
    from rest_framework_simplejwt.tokens import RefreshToken

    refresh = RefreshToken.for_user(admin_user)
    access = refresh.access_token
    for k, v in _build_token_claims(admin_user, "test").items():
        access[k] = v
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {str(access)}")
    return api_client


TEMPLATE_URL = "/api/v1/repair/fault-templates/"


# ──────────────────────────────────────────────────────────────────────────────
# Nested create
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.django_db
class TestFaultTemplateNestedCreate:
    def test_create_template_with_parts_persists_rows(self, admin_client, shop):
        from repair.models import FaultTemplatePart

        payload = {
            "shop_id": str(shop.id),
            "name": "Screen Replacement",
            "device_type": "Smartphone",
            "problem_description": "Customer reports cracked display panel.",
            "default_sc": "1200.00",
            "parts": [
                {"custom_part_name": "OLED Display", "quantity": 1},
                {"custom_part_name": "Adhesive strip", "quantity": 2},
            ],
        }
        res = admin_client.post(TEMPLATE_URL, payload, format="json")

        assert res.status_code == status.HTTP_201_CREATED
        assert len(res.data["parts"]) == 2
        names = {p["custom_part_name"] for p in res.data["parts"]}
        assert names == {"OLED Display", "Adhesive strip"}

        template_id = res.data["id"]
        assert FaultTemplatePart.objects.filter(template_id=template_id).count() == 2

    def test_create_template_without_parts_returns_empty_list(self, admin_client, shop):
        payload = {
            "shop_id": str(shop.id),
            "name": "Quick Clean",
            "device_type": "Laptop",
            "problem_description": "Customer requests routine cleaning of internals.",
            "default_sc": "300.00",
        }
        res = admin_client.post(TEMPLATE_URL, payload, format="json")

        assert res.status_code == status.HTTP_201_CREATED
        assert res.data["parts"] == []

    def test_create_template_part_requires_name_or_variant(self, admin_client, shop):
        payload = {
            "shop_id": str(shop.id),
            "name": "Bad Part Template",
            "device_type": "Laptop",
            "problem_description": "Template with invalid part missing name or variant.",
            "default_sc": "500.00",
            "parts": [
                {"quantity": 1},  # neither variant_id nor custom_part_name
            ],
        }
        res = admin_client.post(TEMPLATE_URL, payload, format="json")
        assert res.status_code == status.HTTP_400_BAD_REQUEST


# ──────────────────────────────────────────────────────────────────────────────
# Nested update (PATCH)
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.django_db
class TestFaultTemplateNestedUpdate:
    @pytest.fixture
    def template(self, db, shop):
        from repair.models import FaultTemplate, FaultTemplatePart

        t = FaultTemplate.objects.create(
            shop=shop,
            name="Battery Swap",
            device_type="Phone",
            problem_description="Battery not holding charge after one hour of use.",
            default_sc="800.00",
        )
        FaultTemplatePart.objects.create(template=t, custom_part_name="Old Battery", quantity=1)
        return t

    def test_patch_with_parts_replaces_existing(self, admin_client, template):
        from repair.models import FaultTemplatePart

        res = admin_client.patch(
            f"{TEMPLATE_URL}{template.id}/",
            {"parts": [{"custom_part_name": "New Battery", "quantity": 1}]},
            format="json",
        )
        assert res.status_code == status.HTTP_200_OK
        assert len(res.data["parts"]) == 1
        assert res.data["parts"][0]["custom_part_name"] == "New Battery"
        assert not FaultTemplatePart.objects.filter(template=template, custom_part_name="Old Battery").exists()

    def test_patch_without_parts_preserves_existing(self, admin_client, template):
        from repair.models import FaultTemplatePart

        res = admin_client.patch(
            f"{TEMPLATE_URL}{template.id}/",
            {"name": "Battery Replacement"},  # no "parts" key
            format="json",
        )
        assert res.status_code == status.HTTP_200_OK
        assert FaultTemplatePart.objects.filter(template=template).count() == 1

    def test_patch_with_empty_parts_clears_all(self, admin_client, template):
        from repair.models import FaultTemplatePart

        res = admin_client.patch(
            f"{TEMPLATE_URL}{template.id}/",
            {"parts": []},
            format="json",
        )
        assert res.status_code == status.HTTP_200_OK
        assert res.data["parts"] == []
        assert FaultTemplatePart.objects.filter(template=template).count() == 0


# ──────────────────────────────────────────────────────────────────────────────
# Auto-populate on job create
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.django_db
class TestJobAutoPopulateParts:
    @pytest.fixture
    def template_with_parts(self, db, shop):
        from repair.models import FaultTemplate, FaultTemplatePart

        t = FaultTemplate.objects.create(
            shop=shop,
            name="Motherboard Repair",
            device_type="Laptop",
            problem_description="Laptop powers on but keyboard and USB not responding.",
            default_sc="3500.00",
        )
        FaultTemplatePart.objects.create(template=t, custom_part_name="Replacement IC chip", quantity=2)
        FaultTemplatePart.objects.create(template=t, custom_part_name="Thermal paste", quantity=1)
        return t

    def test_create_job_from_template_seeds_spare_parts(
        self, admin_client, shop, customer, template_with_parts
    ):
        from repair.models import JobSparePartRequest

        res = admin_client.post(
            "/api/v1/repair/jobs/",
            {
                "shop_id": str(shop.id),
                "customer_id": str(customer.id),
                "device_type": "Laptop",
                "template_id": str(template_with_parts.id),
                "problem_description": "Laptop powers on but keyboard and USB not responding.",
            },
            format="json",
        )
        assert res.status_code == status.HTTP_201_CREATED

        job_id = res.data["id"]
        requests = list(JobSparePartRequest.objects.filter(job_id=job_id).order_by("created_at"))
        assert len(requests) == 2
        names = {r.custom_part_name for r in requests}
        assert names == {"Replacement IC chip", "Thermal paste"}
        qtys = {r.custom_part_name: r.quantity for r in requests}
        assert qtys["Replacement IC chip"] == 2
        assert qtys["Thermal paste"] == 1

    def test_create_job_without_template_has_no_auto_parts(
        self, admin_client, shop, customer
    ):
        from repair.models import JobSparePartRequest

        res = admin_client.post(
            "/api/v1/repair/jobs/",
            {
                "shop_id": str(shop.id),
                "customer_id": str(customer.id),
                "device_type": "Phone",
                "problem_description": "Screen is cracked on the top-left corner.",
            },
            format="json",
        )
        assert res.status_code == status.HTTP_201_CREATED
        job_id = res.data["id"]
        assert JobSparePartRequest.objects.filter(job_id=job_id).count() == 0

    def test_create_job_from_template_without_parts_has_no_requests(
        self, admin_client, shop, customer
    ):
        from repair.models import FaultTemplate, JobSparePartRequest

        empty_template = FaultTemplate.objects.create(
            shop=shop,
            name="Generic Repair",
            device_type="Phone",
            problem_description="Generic repair job template for miscellaneous issues.",
            default_sc="500.00",
        )
        res = admin_client.post(
            "/api/v1/repair/jobs/",
            {
                "shop_id": str(shop.id),
                "customer_id": str(customer.id),
                "device_type": "Phone",
                "template_id": str(empty_template.id),
                "problem_description": "Generic repair job template for miscellaneous issues.",
            },
            format="json",
        )
        assert res.status_code == status.HTTP_201_CREATED
        job_id = res.data["id"]
        assert JobSparePartRequest.objects.filter(job_id=job_id).count() == 0


# ──────────────────────────────────────────────────────────────────────────────
# Phase 4: search filter + real soft-delete + permission on delete
# ──────────────────────────────────────────────────────────────────────────────


def _noperm_client(api_client, db):
    """A client whose token lacks repair.templates.manage."""
    from authentication.models import Permission, Role, RolePermission, User, UserRole
    from authentication.tokens import _build_token_claims
    from rest_framework_simplejwt.tokens import RefreshToken

    user = User.objects.create_user(
        email="noperm@tmpl.test", phone="+919000000098",
        full_name="No Perm", password="NoPerm@1",
    )
    role, _ = Role.objects.get_or_create(name="ViewerOnly", defaults={"is_system_role": False})
    perm, _ = Permission.objects.get_or_create(
        codename="crm.customers.view", defaults={"module": "crm", "label": "crm.customers.view"}
    )
    RolePermission.objects.get_or_create(role=role, permission=perm)
    UserRole.objects.create(user=user, role=role, shop=None)
    access = RefreshToken.for_user(user).access_token
    for k, v in _build_token_claims(user, "test").items():
        access[k] = v
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {str(access)}")
    return api_client


@pytest.mark.django_db
class TestFaultTemplateSearchAndDelete:
    def _create(self, admin_client, shop, name, device_type="Smartphone", brand=""):
        res = admin_client.post(TEMPLATE_URL, {
            "shop_id": str(shop.id), "name": name, "device_type": device_type,
            "device_brand": brand, "problem_description": "x" * 12, "default_sc": "500",
        }, format="json")
        assert res.status_code == status.HTTP_201_CREATED
        return res.data["id"]

    def test_search_filters_by_name(self, admin_client, shop):
        self._create(admin_client, shop, "iPhone screen swap")
        self._create(admin_client, shop, "Samsung battery")
        res = admin_client.get(TEMPLATE_URL, {"search": "iphone"})
        assert [t["name"] for t in res.data["items"]] == ["iPhone screen swap"]

    def test_search_matches_brand_and_device(self, admin_client, shop):
        self._create(admin_client, shop, "Generic", device_type="Laptop", brand="Dell")
        self._create(admin_client, shop, "Other", device_type="Smartphone", brand="Apple")
        res = admin_client.get(TEMPLATE_URL, {"search": "dell"})
        assert len(res.data["items"]) == 1
        res2 = admin_client.get(TEMPLATE_URL, {"search": "laptop"})
        assert len(res2.data["items"]) == 1

    def test_delete_soft_deletes_and_removes_from_list(self, admin_client, shop):
        tid = self._create(admin_client, shop, "To Delete")
        d = admin_client.delete(f"{TEMPLATE_URL}{tid}/")
        assert d.status_code == status.HTTP_204_NO_CONTENT
        res = admin_client.get(TEMPLATE_URL)
        assert tid not in [t["id"] for t in res.data["items"]]
        from repair.models import FaultTemplate
        assert FaultTemplate.all_objects.get(pk=tid).deleted_at is not None

    def test_delete_requires_manage_permission(self, api_client, admin_client, shop, db):
        tid = self._create(admin_client, shop, "Guarded")
        client = _noperm_client(api_client, db)
        res = client.delete(f"{TEMPLATE_URL}{tid}/")
        assert res.status_code == status.HTTP_403_FORBIDDEN

    def test_list_does_not_scale_queries_with_parts(self, admin_client, shop, django_assert_max_num_queries):
        # Two templates each with parts; prefetch keeps the query count flat.
        for n in ("A", "B"):
            res = admin_client.post(TEMPLATE_URL, {
                "shop_id": str(shop.id), "name": f"Tmpl {n}", "device_type": "Smartphone",
                "problem_description": "x" * 12, "default_sc": "500",
                "parts": [
                    {"custom_part_name": "Screen", "quantity": 1},
                    {"custom_part_name": "Battery", "quantity": 2},
                ],
            }, format="json")
            assert res.status_code == status.HTTP_201_CREATED
        with django_assert_max_num_queries(8):
            r = admin_client.get(TEMPLATE_URL)
        assert len(r.data["items"]) == 2
        assert all(len(t["parts"]) == 2 for t in r.data["items"])
