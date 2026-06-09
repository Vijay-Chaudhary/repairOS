"""
Tests for core settings views — shop profile, tenant branding, WhatsApp, notification templates.

Critical test: tenant isolation — a user scoped to shop A cannot read or modify shop B.
"""

import pytest
from django.contrib.auth.hashers import make_password
from rest_framework import status
from rest_framework_simplejwt.tokens import RefreshToken


# ── Helpers ───────────────────────────────────────────────────────────────────

def _make_client(api_client, user, permissions: list[str], shop_ids: list | None = None, is_tenant_wide: bool = False):
    refresh = RefreshToken.for_user(user)
    access = refresh.access_token
    access["permissions"] = permissions
    access["shop_ids"] = [str(s) for s in (shop_ids or [])]
    access["is_tenant_wide"] = is_tenant_wide
    access["role_ids"] = []
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {str(access)}")
    return api_client


@pytest.fixture
def admin_user(db):
    from authentication.models import User
    return User.objects.create(
        email="admin@shop.com",
        phone="+919500000001",
        full_name="Shop Admin",
        password=make_password("TestPass@123"),
        is_active=True,
    )


@pytest.fixture
def shop_a(db):
    from core.models import Shop
    return Shop.objects.create(
        name="Alpha Shop",
        code="ALP",
        address="123 Alpha St",
        city="Mumbai",
        state="Maharashtra",
        state_code="27",
        phone="+912200000001",
    )


@pytest.fixture
def shop_b(db):
    from core.models import Shop
    return Shop.objects.create(
        name="Beta Shop",
        code="BET",
        address="456 Beta Rd",
        city="Pune",
        state="Maharashtra",
        state_code="27",
        phone="+912200000002",
    )


@pytest.fixture
def shop_client(api_client, admin_user, shop_a):
    return _make_client(api_client, admin_user, ["settings.shop.edit"], shop_ids=[shop_a.id])


@pytest.fixture
def tenant_wide_client(api_client, admin_user):
    return _make_client(api_client, admin_user, ["settings.shop.edit"], is_tenant_wide=True)


@pytest.fixture
def notif_client(api_client, admin_user):
    return _make_client(api_client, admin_user, ["settings.notifications.manage"], is_tenant_wide=True)


# ── Shop detail ───────────────────────────────────────────────────────────────

@pytest.mark.django_db
class TestShopDetail:
    def test_get_shop_returns_detail(self, shop_client, shop_a):
        res = shop_client.get(f"/api/v1/shops/{shop_a.id}/")
        assert res.status_code == status.HTTP_200_OK
        data = res.json()["data"]
        assert data["name"] == "Alpha Shop"
        assert data["code"] == "ALP"

    def test_update_shop_name(self, shop_client, shop_a):
        res = shop_client.patch(
            f"/api/v1/shops/{shop_a.id}/",
            {"name": "Alpha Shop v2"},
            format="json",
        )
        assert res.status_code == status.HTTP_200_OK
        shop_a.refresh_from_db()
        assert shop_a.name == "Alpha Shop v2"

    def test_update_shop_all_writable_fields(self, shop_client, shop_a):
        payload = {
            "address": "999 New St",
            "city": "Nagpur",
            "state": "Maharashtra",
            "state_code": "27",
            "phone": "+912200000099",
            "email": "alpha@shop.com",
            "gstin": "27AAAAA0000A1Z5",
        }
        res = shop_client.patch(f"/api/v1/shops/{shop_a.id}/", payload, format="json")
        assert res.status_code == status.HTTP_200_OK
        shop_a.refresh_from_db()
        assert shop_a.city == "Nagpur"
        assert shop_a.email == "alpha@shop.com"

    def test_requires_permission(self, api_client, shop_a, admin_user):
        no_perm = _make_client(api_client, admin_user, [], shop_ids=[shop_a.id])
        res = no_perm.get(f"/api/v1/shops/{shop_a.id}/")
        assert res.status_code == status.HTTP_403_FORBIDDEN

    # ── TENANT ISOLATION TEST ─────────────────────────────────────────────────
    def test_user_scoped_to_shop_a_cannot_read_shop_b(self, shop_client, shop_b):
        """
        shop_client holds shop_ids=[shop_a.id] in its JWT.
        Attempting to read shop_b must return 404, not shop_b's data.
        """
        res = shop_client.get(f"/api/v1/shops/{shop_b.id}/")
        assert res.status_code == status.HTTP_404_NOT_FOUND

    def test_user_scoped_to_shop_a_cannot_update_shop_b(self, shop_client, shop_b):
        """
        PATCH to shop_b by a user with only shop_a access must be rejected.
        """
        res = shop_client.patch(
            f"/api/v1/shops/{shop_b.id}/",
            {"name": "Hacked"},
            format="json",
        )
        assert res.status_code == status.HTTP_404_NOT_FOUND
        shop_b.refresh_from_db()
        assert shop_b.name == "Beta Shop"

    def test_tenant_wide_user_can_access_any_shop(self, tenant_wide_client, shop_a, shop_b):
        """Tenant Admin (is_tenant_wide=True) must be able to read both shops."""
        for shop in (shop_a, shop_b):
            res = tenant_wide_client.get(f"/api/v1/shops/{shop.id}/")
            assert res.status_code == status.HTTP_200_OK


# ── Tenant settings (branding) ────────────────────────────────────────────────

@pytest.mark.django_db
class TestTenantSettings:
    def test_get_returns_branding_fields(self, tenant_wide_client):
        res = tenant_wide_client.get("/api/v1/tenants/me/")
        assert res.status_code == status.HTTP_200_OK
        data = res.json()["data"]
        assert "logo_url" in data
        assert "bank_name" in data

    def test_update_branding(self, tenant_wide_client):
        payload = {
            "logo_url": "https://cdn.example.com/logo.png",
            "invoice_footer": "Thank you!",
            "bank_name": "HDFC",
            "bank_account_number": "123456789",
            "bank_ifsc": "HDFC0001234",
        }
        res = tenant_wide_client.patch("/api/v1/tenants/me/", payload, format="json")
        assert res.status_code == status.HTTP_200_OK
        data = res.json()["data"]
        assert data["logo_url"] == "https://cdn.example.com/logo.png"
        assert data["bank_name"] == "HDFC"

    def test_requires_permission(self, api_client, admin_user):
        no_perm = _make_client(api_client, admin_user, [], is_tenant_wide=True)
        res = no_perm.get("/api/v1/tenants/me/")
        assert res.status_code == status.HTTP_403_FORBIDDEN


# ── WhatsApp connection ───────────────────────────────────────────────────────

@pytest.mark.django_db
class TestWhatsAppConnection:
    def test_get_connection_status(self, notif_client):
        res = notif_client.get("/api/v1/whatsapp/connection/")
        assert res.status_code == status.HTTP_200_OK
        data = res.json()["data"]
        assert "is_connected" in data
        assert "phone_number" in data

    def test_connect_sets_phone_and_status(self, notif_client):
        res = notif_client.post(
            "/api/v1/whatsapp/connect/",
            {"phone_number": "+919800000001"},
            format="json",
        )
        assert res.status_code == status.HTTP_200_OK
        data = res.json()["data"]
        assert data["is_connected"] is True
        assert data["phone_number"] == "+919800000001"

    def test_connect_missing_phone_returns_400(self, notif_client):
        res = notif_client.post("/api/v1/whatsapp/connect/", {}, format="json")
        assert res.status_code == status.HTTP_400_BAD_REQUEST

    def test_disconnect_clears_connected_flag(self, notif_client):
        notif_client.post("/api/v1/whatsapp/connect/", {"phone_number": "+919800000002"}, format="json")
        res = notif_client.post("/api/v1/whatsapp/disconnect/", {}, format="json")
        assert res.status_code == status.HTTP_200_OK
        status_res = notif_client.get("/api/v1/whatsapp/connection/")
        assert status_res.json()["data"]["is_connected"] is False

    def test_requires_permission(self, api_client, admin_user):
        no_perm = _make_client(api_client, admin_user, [], is_tenant_wide=True)
        res = no_perm.get("/api/v1/whatsapp/connection/")
        assert res.status_code == status.HTTP_403_FORBIDDEN


# ── Notification templates ────────────────────────────────────────────────────

@pytest.mark.django_db
class TestNotificationTemplates:
    def test_list_returns_all_registry_templates(self, notif_client):
        from core.notifications import TEMPLATE_REGISTRY
        res = notif_client.get("/api/v1/notifications/templates/")
        assert res.status_code == status.HTTP_200_OK
        data = res.json()["data"]
        assert "items" in data
        assert len(data["items"]) == len(TEMPLATE_REGISTRY)

    def test_each_template_has_required_fields(self, notif_client):
        res = notif_client.get("/api/v1/notifications/templates/")
        items = res.json()["data"]["items"]
        for item in items:
            assert "id" in item
            assert "template_name" in item
            assert "is_active" in item
            assert isinstance(item["variables"], list)

    def test_toggle_template_inactive(self, notif_client):
        from core.notifications import TEMPLATE_REGISTRY
        first = TEMPLATE_REGISTRY[0]["template_name"]
        res = notif_client.patch(
            f"/api/v1/notifications/templates/{first}/",
            {"is_active": False},
            format="json",
        )
        assert res.status_code == status.HTTP_200_OK
        assert res.json()["data"]["is_active"] is False

    def test_toggle_back_to_active(self, notif_client):
        from core.notifications import TEMPLATE_REGISTRY
        first = TEMPLATE_REGISTRY[0]["template_name"]
        notif_client.patch(f"/api/v1/notifications/templates/{first}/", {"is_active": False}, format="json")
        res = notif_client.patch(f"/api/v1/notifications/templates/{first}/", {"is_active": True}, format="json")
        assert res.status_code == status.HTTP_200_OK
        assert res.json()["data"]["is_active"] is True

    def test_patch_nonexistent_template_returns_404(self, notif_client):
        res = notif_client.patch(
            "/api/v1/notifications/templates/nonexistent_template/",
            {"is_active": False},
            format="json",
        )
        assert res.status_code == status.HTTP_404_NOT_FOUND

    def test_requires_permission(self, api_client, admin_user):
        no_perm = _make_client(api_client, admin_user, [], is_tenant_wide=True)
        res = no_perm.get("/api/v1/notifications/templates/")
        assert res.status_code == status.HTTP_403_FORBIDDEN
