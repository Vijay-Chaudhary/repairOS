"""Tests for POST /api/v1/shops/ — creating additional shops for an existing tenant."""

import pytest
from rest_framework import status
from rest_framework.test import APIClient


def _make_client(email, permission_codenames):
    """Authenticated tenant-wide APIClient (shop=None) with the given permissions."""
    from authentication.models import Permission, Role, RolePermission, User, UserRole
    from authentication.tokens import _build_token_claims
    from rest_framework_simplejwt.tokens import RefreshToken

    # Derive a unique phone per user — `phone` is unique=True on User, and this
    # helper is invoked once per fixture within the same test in some cases.
    phone_suffix = str(abs(hash(email)) % 10_000_000).zfill(7)
    user = User.objects.create_user(
        email=email, phone=f"+91{phone_suffix}", full_name="Admin User", password="Pass@123",
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
