"""Accounts › Journal Entries — balanced double-entry, draft→posted, posted-immutable."""
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


@pytest.fixture
def accounts(db, shop):
    from accounts.models import Account
    cash = Account.objects.create(shop=shop, code="1000", name="Cash", account_type="asset")
    sales = Account.objects.create(shop=shop, code="4000", name="Sales", account_type="income")
    return cash, sales


def _balanced_payload(cash, sales, amount="100.00"):
    return {
        "date": "2026-06-15",
        "narration": "Cash sale",
        "lines": [
            {"account_id": str(cash.id), "debit": amount, "credit": "0"},
            {"account_id": str(sales.id), "debit": "0", "credit": amount},
        ],
    }


JOURNAL = ["accounts.journal.create", "accounts.journal.view"]


@pytest.mark.django_db
def test_create_balanced_draft(shop, accounts, client_with_perms):
    cash, sales = accounts
    client = client_with_perms(shop, JOURNAL)
    resp = client.post("/api/v1/accounts/journal/", _balanced_payload(cash, sales), format="json")
    assert resp.status_code == status.HTTP_201_CREATED, resp.content
    data = resp.json()["data"]
    assert data["status"] == "draft"
    assert data["entry_number"]
    assert len(data["lines"]) == 2


@pytest.mark.django_db
def test_unbalanced_entry_rejected(shop, accounts, client_with_perms):
    cash, sales = accounts
    client = client_with_perms(shop, JOURNAL)
    payload = _balanced_payload(cash, sales)
    payload["lines"][1]["credit"] = "90.00"  # debit 100 != credit 90
    resp = client.post("/api/v1/accounts/journal/", payload, format="json")
    assert resp.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY


@pytest.mark.django_db
def test_line_requires_debit_xor_credit(shop, accounts, client_with_perms):
    cash, sales = accounts
    client = client_with_perms(shop, JOURNAL)
    payload = _balanced_payload(cash, sales)
    payload["lines"][0]["credit"] = "100.00"  # line now has both debit and credit
    resp = client.post("/api/v1/accounts/journal/", payload, format="json")
    assert resp.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY


@pytest.mark.django_db
def test_post_sets_status_and_immutable(shop, accounts, client_with_perms):
    cash, sales = accounts
    client = client_with_perms(shop, JOURNAL + ["accounts.journal.post"])
    created = client.post(
        "/api/v1/accounts/journal/", _balanced_payload(cash, sales), format="json"
    ).json()["data"]

    posted = client.post(f"/api/v1/accounts/journal/{created['id']}/post/", {}, format="json")
    assert posted.status_code == status.HTTP_200_OK, posted.content
    assert posted.json()["data"]["status"] == "posted"

    # Posted entries are immutable.
    patched = client.patch(
        f"/api/v1/accounts/journal/{created['id']}/", {"narration": "edit"}, format="json"
    )
    assert patched.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY
    deleted = client.delete(f"/api/v1/accounts/journal/{created['id']}/")
    assert deleted.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY


@pytest.mark.django_db
def test_post_requires_post_perm(shop, accounts, client_with_perms):
    cash, sales = accounts
    client = client_with_perms(shop, JOURNAL)  # no accounts.journal.post
    created = client.post(
        "/api/v1/accounts/journal/", _balanced_payload(cash, sales), format="json"
    ).json()["data"]
    resp = client.post(f"/api/v1/accounts/journal/{created['id']}/post/", {}, format="json")
    assert resp.status_code == status.HTTP_403_FORBIDDEN
