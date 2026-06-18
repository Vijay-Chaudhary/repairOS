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
