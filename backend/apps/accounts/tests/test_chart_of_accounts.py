"""Accounts › Chart of Accounts — CRUD, per-shop unique codes, seeded default chart."""
import uuid

import pytest
from rest_framework import status


@pytest.fixture
def shop(db):
    from core.models import Shop
    return Shop.objects.create(
        name="Hotspot Repair", code="HTA", address="MG Road",
        city="Delhi", state="Delhi", state_code="07", phone="+919876543210",
    )


@pytest.fixture
def client_with_perms(db):
    """Factory: APIClient whose JWT carries the given permissions + shop scope."""
    from authentication.models import User
    from rest_framework.test import APIClient
    from rest_framework_simplejwt.tokens import RefreshToken

    def _make(shop, perms):
        suffix = uuid.uuid4().hex[:8]
        user = User.objects.create_user(
            email=f"u{suffix}@t.com", phone=f"+9190{uuid.uuid4().int % 100000000:08d}",
            full_name="Tester", password="Pass@123",
        )
        refresh = RefreshToken.for_user(user)
        access = refresh.access_token
        access["permissions"] = perms
        access["shop_ids"] = [str(shop.id)]
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {str(access)}")
        return client

    return _make


MANAGE = ["accounts.chart.manage", "accounts.ledger.view"]


@pytest.mark.django_db
def test_create_account_requires_chart_manage(shop, client_with_perms):
    client = client_with_perms(shop, ["accounts.ledger.view"])  # view only, no manage
    resp = client.post(
        "/api/v1/accounts/chart/",
        {"code": "1000", "name": "Cash", "account_type": "asset"},
        format="json",
    )
    assert resp.status_code == status.HTTP_403_FORBIDDEN


@pytest.mark.django_db
def test_create_and_list_account(shop, client_with_perms):
    client = client_with_perms(shop, MANAGE)
    resp = client.post(
        "/api/v1/accounts/chart/",
        {"code": "1000", "name": "Cash", "account_type": "asset"},
        format="json",
    )
    assert resp.status_code == status.HTTP_201_CREATED, resp.content
    created = resp.json()["data"]
    assert created["code"] == "1000"
    assert created["normal_balance"] == "debit"
    assert created["is_system"] is False

    list_resp = client.get("/api/v1/accounts/chart/")
    assert list_resp.status_code == status.HTTP_200_OK
    items = list_resp.json()["data"]["items"]
    assert any(a["code"] == "1000" for a in items)


@pytest.mark.django_db
def test_account_code_unique_per_shop(shop, client_with_perms):
    client = client_with_perms(shop, MANAGE)
    payload = {"code": "1000", "name": "Cash", "account_type": "asset"}
    first = client.post("/api/v1/accounts/chart/", payload, format="json")
    assert first.status_code == status.HTTP_201_CREATED
    dup = client.post(
        "/api/v1/accounts/chart/",
        {"code": "1000", "name": "Cash Duplicate", "account_type": "asset"},
        format="json",
    )
    assert dup.status_code == status.HTTP_400_BAD_REQUEST


@pytest.mark.django_db
def test_seed_default_chart_idempotent(shop, client_with_perms):
    client = client_with_perms(shop, MANAGE)
    seed1 = client.post("/api/v1/accounts/chart/seed/", {}, format="json")
    assert seed1.status_code in (status.HTTP_200_OK, status.HTTP_201_CREATED), seed1.content

    from accounts.models import Account
    count_after_first = Account.objects.filter(shop=shop).count()
    assert count_after_first > 0
    # Every seeded row is a system account.
    assert Account.objects.filter(shop=shop, is_system=False).count() == 0

    seed2 = client.post("/api/v1/accounts/chart/seed/", {}, format="json")
    assert seed2.status_code in (status.HTTP_200_OK, status.HTTP_201_CREATED)
    assert Account.objects.filter(shop=shop).count() == count_after_first  # no-op


@pytest.mark.django_db
def test_cannot_delete_system_account(shop, client_with_perms):
    client = client_with_perms(shop, MANAGE)
    client.post("/api/v1/accounts/chart/seed/", {}, format="json")

    from accounts.models import Account
    system_acct = Account.objects.filter(shop=shop, is_system=True).first()
    assert system_acct is not None

    resp = client.delete(f"/api/v1/accounts/chart/{system_acct.id}/")
    assert resp.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY
    # Not deleted, not deactivated.
    system_acct.refresh_from_db()
    assert system_acct.is_active is True


@pytest.mark.django_db
def test_delete_user_account_deactivates(shop, client_with_perms):
    client = client_with_perms(shop, MANAGE)
    created = client.post(
        "/api/v1/accounts/chart/",
        {"code": "5900", "name": "Misc", "account_type": "expense"},
        format="json",
    ).json()["data"]

    resp = client.delete(f"/api/v1/accounts/chart/{created['id']}/")
    assert resp.status_code in (status.HTTP_200_OK, status.HTTP_204_NO_CONTENT)

    from accounts.models import Account
    acct = Account.objects.get(id=created["id"])
    assert acct.is_active is False  # soft-deactivated, not hard-deleted
