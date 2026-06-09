"""
Tests for authentication settings views — users, roles, permissions.

Covers:
- User list/invite/update/force-logout
- Role CRUD (including system-role guards)
- Permission list
- Permission gate: unauthenticated → 401/403
"""

import pytest
from django.contrib.auth.hashers import make_password
from rest_framework import status
from rest_framework_simplejwt.tokens import RefreshToken


# ── Helpers ───────────────────────────────────────────────────────────────────

def _make_client(api_client, user, permissions: list[str], shop_ids: list | None = None, is_tenant_wide: bool = True):
    refresh = RefreshToken.for_user(user)
    access = refresh.access_token
    access["permissions"] = permissions
    access["shop_ids"] = shop_ids or []
    access["is_tenant_wide"] = is_tenant_wide
    access["role_ids"] = []
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {str(access)}")
    return api_client


@pytest.fixture
def manager(db):
    from authentication.models import User
    return User.objects.create(
        email="mgr@example.com",
        phone="+919000000001",
        full_name="Manager",
        password=make_password("TestPass@123"),
        is_active=True,
    )


@pytest.fixture
def mgr_client(api_client, manager):
    return _make_client(api_client, manager, [
        "settings.users.manage",
        "settings.roles.manage",
    ])


# ── Users ─────────────────────────────────────────────────────────────────────

USERS_URL = "/api/v1/users/"


@pytest.mark.django_db
class TestUserList:
    def test_returns_items_and_meta(self, mgr_client, manager):
        res = mgr_client.get(USERS_URL)
        assert res.status_code == status.HTTP_200_OK
        data = res.json()["data"]
        assert "items" in data
        assert "meta" in data
        assert any(u["email"] == manager.email for u in data["items"])

    def test_search_by_name(self, mgr_client, db):
        from authentication.models import User
        User.objects.create(
            email="alice@example.com",
            phone="+919000000002",
            full_name="Alice Unique",
            password=make_password("x"),
        )
        res = mgr_client.get(USERS_URL + "?search=Alice+Unique")
        data = res.json()["data"]
        assert len(data["items"]) == 1
        assert data["items"][0]["email"] == "alice@example.com"

    def test_requires_auth(self, api_client):
        res = api_client.get(USERS_URL)
        assert res.status_code in (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN)

    def test_wrong_permission_is_denied(self, api_client, manager):
        client = _make_client(api_client, manager, ["repair.jobs.view"])
        res = client.get(USERS_URL)
        assert res.status_code == status.HTTP_403_FORBIDDEN


@pytest.mark.django_db
class TestUserInvite:
    def test_invite_creates_user(self, mgr_client, db):
        body = {"email": "new@example.com", "phone": "+919111111111", "full_name": "New One", "role_ids": []}
        res = mgr_client.post(USERS_URL, body, format="json")
        assert res.status_code == status.HTTP_201_CREATED
        data = res.json()["data"]
        assert data["email"] == "new@example.com"
        assert data["is_active"] is True

    def test_duplicate_email_returns_400(self, mgr_client, manager):
        body = {"email": manager.email, "phone": "+919111111112", "full_name": "Dup"}
        res = mgr_client.post(USERS_URL, body, format="json")
        assert res.status_code == status.HTTP_400_BAD_REQUEST

    def test_invite_with_roles(self, mgr_client, db):
        from authentication.models import Permission, Role, RolePermission
        perm = Permission.objects.create(codename="crm.leads.view", module="crm", label="CRM leads view")
        role = Role.objects.create(name="ReadOnly")
        RolePermission.objects.create(role=role, permission=perm)

        body = {
            "email": "roleuser@example.com",
            "phone": "+919111111113",
            "full_name": "Role User",
            "role_ids": [str(role.id)],
        }
        res = mgr_client.post(USERS_URL, body, format="json")
        assert res.status_code == status.HTTP_201_CREATED
        data = res.json()["data"]
        assert str(role.id) in data["role_ids"]

    def test_missing_required_fields_returns_400(self, mgr_client):
        res = mgr_client.post(USERS_URL, {"email": "x@x.com"}, format="json")
        assert res.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.django_db
class TestUserUpdate:
    def test_deactivate_user(self, mgr_client, db):
        from authentication.models import User
        user = User.objects.create(
            email="active@example.com",
            phone="+919200000001",
            full_name="Active",
            password=make_password("x"),
            is_active=True,
        )
        res = mgr_client.patch(f"{USERS_URL}{user.id}/", {"is_active": False}, format="json")
        assert res.status_code == status.HTTP_200_OK
        user.refresh_from_db()
        assert user.is_active is False

    def test_update_role_ids(self, mgr_client, db):
        from authentication.models import Role, User
        user = User.objects.create(
            email="roleswap@example.com",
            phone="+919200000002",
            full_name="Roleswap",
            password=make_password("x"),
        )
        role = Role.objects.create(name="Swapper")
        res = mgr_client.patch(f"{USERS_URL}{user.id}/", {"role_ids": [str(role.id)]}, format="json")
        assert res.status_code == status.HTTP_200_OK
        assert str(role.id) in res.json()["data"]["role_ids"]

    def test_nonexistent_user_returns_404(self, mgr_client):
        import uuid
        res = mgr_client.patch(f"{USERS_URL}{uuid.uuid4()}/", {"is_active": False}, format="json")
        assert res.status_code == status.HTTP_404_NOT_FOUND


@pytest.mark.django_db
class TestForceLogout:
    def test_revokes_token_families(self, mgr_client, db):
        from authentication.models import User, UserTokenFamily
        user = User.objects.create(
            email="target@example.com",
            phone="+919300000001",
            full_name="Target",
            password=make_password("x"),
        )
        import uuid as _uuid
        UserTokenFamily.objects.create(user=user, family_id=_uuid.uuid4(), is_revoked=False, current_jti=str(_uuid.uuid4()))
        UserTokenFamily.objects.create(user=user, family_id=_uuid.uuid4(), is_revoked=False, current_jti=str(_uuid.uuid4()))

        res = mgr_client.post(f"{USERS_URL}{user.id}/force-logout/", {}, format="json")
        assert res.status_code == status.HTTP_200_OK
        assert res.json()["data"]["revoked_families"] == 2
        assert not UserTokenFamily.objects.filter(user=user, is_revoked=False).exists()


# ── Roles ─────────────────────────────────────────────────────────────────────

ROLES_URL = "/api/v1/roles/"


@pytest.mark.django_db
class TestRoles:
    def test_list_returns_items(self, mgr_client, db):
        from authentication.models import Role
        Role.objects.create(name="TestRole")
        res = mgr_client.get(ROLES_URL)
        assert res.status_code == status.HTTP_200_OK
        assert "items" in res.json()["data"]

    def test_create_role(self, mgr_client, db):
        from authentication.models import Permission
        perm = Permission.objects.create(codename="pos.sales.view", module="pos", label="POS sales view")
        body = {"name": "SalesViewer", "description": "Read-only", "permission_ids": [str(perm.id)]}
        res = mgr_client.post(ROLES_URL, body, format="json")
        assert res.status_code == status.HTTP_201_CREATED
        data = res.json()["data"]
        assert data["name"] == "SalesViewer"
        assert str(perm.id) in data["permission_ids"]

    def test_create_duplicate_name_returns_400(self, mgr_client, db):
        from authentication.models import Role
        Role.objects.create(name="DuplicateRole")
        res = mgr_client.post(ROLES_URL, {"name": "DuplicateRole", "permission_ids": []}, format="json")
        assert res.status_code == status.HTTP_400_BAD_REQUEST

    def test_patch_role(self, mgr_client, db):
        from authentication.models import Role
        role = Role.objects.create(name="PatchMe")
        res = mgr_client.patch(f"{ROLES_URL}{role.id}/", {"name": "PatchedName"}, format="json")
        assert res.status_code == status.HTTP_200_OK
        assert res.json()["data"]["name"] == "PatchedName"

    def test_patch_system_role_is_forbidden(self, mgr_client, db):
        from authentication.models import Role
        sysrole = Role.objects.create(name="System", is_system_role=True)
        res = mgr_client.patch(f"{ROLES_URL}{sysrole.id}/", {"name": "Hacked"}, format="json")
        assert res.status_code == status.HTTP_403_FORBIDDEN

    def test_delete_role(self, mgr_client, db):
        from authentication.models import Role
        role = Role.objects.create(name="ToDelete")
        res = mgr_client.delete(f"{ROLES_URL}{role.id}/")
        assert res.status_code == status.HTTP_204_NO_CONTENT
        role.refresh_from_db()
        assert role.deleted_at is not None

    def test_delete_system_role_is_forbidden(self, mgr_client, db):
        from authentication.models import Role
        sysrole = Role.objects.create(name="Sys", is_system_role=True)
        res = mgr_client.delete(f"{ROLES_URL}{sysrole.id}/")
        assert res.status_code == status.HTTP_403_FORBIDDEN

    def test_delete_role_with_users_returns_400(self, mgr_client, db):
        from authentication.models import Role, User, UserRole
        user = User.objects.create(
            email="roleuser2@example.com",
            phone="+919400000001",
            full_name="RoleUser",
            password=make_password("x"),
        )
        role = Role.objects.create(name="InUse")
        UserRole.objects.create(user=user, role=role, shop=None)
        res = mgr_client.delete(f"{ROLES_URL}{role.id}/")
        assert res.status_code == status.HTTP_400_BAD_REQUEST


# ── Permissions ───────────────────────────────────────────────────────────────

PERMS_URL = "/api/v1/permissions/"


@pytest.mark.django_db
class TestPermissions:
    def test_list_returns_items(self, mgr_client, db):
        from authentication.models import Permission
        Permission.objects.create(codename="test.perm", module="test", label="Test")
        res = mgr_client.get(PERMS_URL)
        assert res.status_code == status.HTTP_200_OK
        data = res.json()["data"]
        assert "items" in data
        assert any(p["codename"] == "test.perm" for p in data["items"])
