"""
Tests for the audit log read API — list filters, pagination, user-name
resolution, facets, and the settings.audit.view permission gate.
"""

from datetime import timedelta

import pytest
from django.contrib.auth.hashers import make_password
from django.utils import timezone
from rest_framework import status
from rest_framework_simplejwt.tokens import RefreshToken

from authentication.models import AuditLog, User

AUDIT_URL = "/api/v1/audit/"
FACETS_URL = "/api/v1/audit/facets/"


# ── Helpers ───────────────────────────────────────────────────────────────────

def _make_client(api_client, user, permissions: list[str]):
    refresh = RefreshToken.for_user(user)
    access = refresh.access_token
    access["permissions"] = permissions
    access["shop_ids"] = []
    access["is_tenant_wide"] = True
    access["role_ids"] = []
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {str(access)}")
    return api_client


@pytest.fixture
def admin(db):
    return User.objects.create(
        email="auditor@example.com",
        phone="+919000000010",
        full_name="Audit Admin",
        password=make_password("TestPass@123"),
        is_active=True,
    )


@pytest.fixture
def audit_client(api_client, admin):
    return _make_client(api_client, admin, ["settings.audit.view"])


def _log(**kwargs):
    defaults = dict(action=AuditLog.Action.CREATE, model_name="Invoice")
    defaults.update(kwargs)
    return AuditLog.objects.create(**defaults)


# ── List ──────────────────────────────────────────────────────────────────────

@pytest.mark.django_db
class TestAuditList:
    def test_returns_items_and_meta_newest_first(self, audit_client, admin):
        older = _log(user_id=admin.id, created_at=timezone.now() - timedelta(hours=1))
        newer = _log(user_id=admin.id, action=AuditLog.Action.UPDATE)
        res = audit_client.get(AUDIT_URL)
        assert res.status_code == status.HTTP_200_OK
        data = res.json()["data"]
        assert data["meta"]["count"] == 2
        assert [row["id"] for row in data["items"]] == [str(newer.id), str(older.id)]

    def test_resolves_user_name(self, audit_client, admin):
        _log(user_id=admin.id)
        _log(user_id=None, action=AuditLog.Action.LOGIN, model_name="User")
        res = audit_client.get(AUDIT_URL)
        rows = {row["model_name"]: row for row in res.json()["data"]["items"]}
        assert rows["Invoice"]["user_name"] == "Audit Admin"
        assert rows["User"]["user_name"] is None

    def test_filter_by_action(self, audit_client):
        _log(action=AuditLog.Action.CREATE)
        _log(action=AuditLog.Action.DELETE)
        res = audit_client.get(AUDIT_URL, {"action": "delete"})
        items = res.json()["data"]["items"]
        assert len(items) == 1
        assert items[0]["action"] == "delete"

    def test_filter_by_model_name(self, audit_client):
        _log(model_name="Invoice")
        _log(model_name="Customer")
        res = audit_client.get(AUDIT_URL, {"model_name": "Customer"})
        items = res.json()["data"]["items"]
        assert len(items) == 1
        assert items[0]["model_name"] == "Customer"

    def test_filter_by_user(self, audit_client, admin):
        other = User.objects.create(
            email="other@example.com", phone="+919000000011",
            full_name="Other", password=make_password("TestPass@123"), is_active=True,
        )
        _log(user_id=admin.id)
        _log(user_id=other.id)
        res = audit_client.get(AUDIT_URL, {"user_id": str(other.id)})
        items = res.json()["data"]["items"]
        assert len(items) == 1
        assert items[0]["user_id"] == str(other.id)

    def test_filter_by_date_range(self, audit_client):
        _log(created_at=timezone.now() - timedelta(days=10))
        recent = _log()
        today = timezone.now().date()
        res = audit_client.get(AUDIT_URL, {
            "date_from": (today - timedelta(days=1)).isoformat(),
            "date_to": today.isoformat(),
        })
        items = res.json()["data"]["items"]
        assert [row["id"] for row in items] == [str(recent.id)]

    def test_pagination(self, audit_client):
        for _ in range(25):
            _log()
        res = audit_client.get(AUDIT_URL, {"page": 2})
        data = res.json()["data"]
        assert data["meta"]["total_pages"] == 2
        assert len(data["items"]) == 5

    def test_requires_auth(self, api_client):
        res = api_client.get(AUDIT_URL)
        assert res.status_code in (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN)

    def test_wrong_permission_is_denied(self, api_client, admin):
        client = _make_client(api_client, admin, ["repair.jobs.view"])
        res = client.get(AUDIT_URL)
        assert res.status_code == status.HTTP_403_FORBIDDEN
