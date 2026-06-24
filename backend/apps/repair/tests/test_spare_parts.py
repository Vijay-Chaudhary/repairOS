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
    shop = kwargs.pop("shop", None) or job.shop
    defaults = {"custom_part_name": "Screen", "quantity": 1, "is_urgent": False}
    defaults.update(kwargs)
    return JobSparePartRequest.objects.create(shop=shop, job=job, requested_by=user, **defaults)


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

    def test_list_resolves_variant_display_name(self, admin_client, shop, customer, admin_user):
        from inventory.models import Product, ProductVariant
        product = Product.objects.create(name="iPhone 14 Screen", sku="SCR-IP14")
        variant = ProductVariant.objects.create(product=product, variant_name="OLED Black")
        job = _make_job(shop, customer, admin_user)
        _make_request(job, admin_user, custom_part_name="", variant_id=variant.id)
        res = admin_client.get("/api/v1/repair/spare-parts/")
        item = res.data["items"][0]
        assert item["custom_part_name"] == ""
        assert item["part_name"] == str(variant) == "iPhone 14 Screen — OLED Black"

    def test_list_part_name_blank_for_unknown_variant(self, admin_client, shop, customer, admin_user):
        import uuid
        job = _make_job(shop, customer, admin_user)
        _make_request(job, admin_user, custom_part_name="", variant_id=uuid.uuid4())
        res = admin_client.get("/api/v1/repair/spare-parts/")
        assert res.data["items"][0]["part_name"] == ""

    def test_list_part_name_uses_custom_name(self, admin_client, shop, customer, admin_user):
        job = _make_job(shop, customer, admin_user)
        _make_request(job, admin_user, custom_part_name="Generic Battery")
        res = admin_client.get("/api/v1/repair/spare-parts/")
        assert res.data["items"][0]["part_name"] == "Generic Battery"


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

    def test_create_requires_job_or_shop(self, admin_client, shop, customer, admin_user):
        res = admin_client.post("/api/v1/repair/spare-parts/", {
            "custom_part_name": "Battery", "quantity": 1,
        }, format="json")
        assert res.status_code == 400
        assert "non_field_errors" in res.data["fields"]

    def test_create_standalone_stock_request(self, admin_client, shop, customer, admin_user):
        """A job-less (stock) request is created against shop_id and has no job."""
        res = admin_client.post("/api/v1/repair/spare-parts/", {
            "shop_id": str(shop.id), "custom_part_name": "Bulk screens", "quantity": 10,
        }, format="json")
        assert res.status_code == 201
        assert res.data["job_id"] is None
        assert res.data["job_number"] is None
        assert res.data["customer_name"] is None
        assert res.data["shop_id"] == str(shop.id)
        assert res.data["shop_name"] == shop.name
        assert res.data["status"] == "requested"

    def test_create_standalone_rejects_shop_outside_scope(self, api_client, shop, shop_b, admin_user):
        scoped = _user_with_perms("scoped3@sp.test", "+919000000025", "ShopBStaff3", ["repair.spare_parts.request"])
        from authentication.models import Role, UserRole
        UserRole.objects.filter(user=scoped).delete()
        UserRole.objects.create(user=scoped, role=Role.objects.get(name="ShopBStaff3"), shop=shop_b)
        client = _client(api_client, scoped)
        res = client.post("/api/v1/repair/spare-parts/", {
            "shop_id": str(shop.id), "custom_part_name": "X", "quantity": 1,
        }, format="json")
        assert res.status_code == 404

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

    def test_review_workflow_on_standalone_request(self, admin_client, shop, admin_user):
        """A job-less request advances requested→approved→ordered→received cleanly
        (the 'received' notification must not crash on a missing job)."""
        from repair.models import JobSparePartRequest
        req = JobSparePartRequest.objects.create(
            shop=shop, job=None, requested_by=admin_user,
            custom_part_name="Bulk batteries", quantity=5,
        )
        for nxt in ("approved", "ordered", "received"):
            res = admin_client.patch(f"/api/v1/repair/spare-parts/{req.id}/", {
                "status": nxt,
            }, format="json")
            assert res.status_code == 200, (nxt, res.data)
            assert res.data["status"] == nxt
            assert res.data["job_number"] is None

    def test_edit_requires_request_permission(self, api_client, shop, customer, admin_user):
        job = _make_job(shop, customer, admin_user)
        req = _make_request(job, admin_user)
        approver_only = _user_with_perms("appr@sp.test", "+919000000025", "ApproverOnly", ["repair.spare_parts.approve"])
        client = _client(api_client, approver_only)
        res = client.patch(f"/api/v1/repair/spare-parts/{req.id}/", {
            "quantity": 9,
        }, format="json")
        assert res.status_code == 403
