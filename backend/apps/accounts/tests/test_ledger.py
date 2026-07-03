"""Accounts › General Ledger + Trial Balance — running balance, draft exclusion, balancing."""
import uuid
from decimal import Decimal

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
def ledger_data(db, shop):
    """cash + sales accounts; two posted entries and one draft entry."""
    from accounts import services
    from accounts.models import Account

    cash = Account.objects.create(shop=shop, code="1000", name="Cash", account_type="asset")
    sales = Account.objects.create(shop=shop, code="4000", name="Sales", account_type="income")

    def _entry(on, amount):
        return services.create_journal_entry(shop, {
            "date": on,
            "narration": "sale",
            "lines": [
                {"account_id": str(cash.id), "debit": amount, "credit": "0"},
                {"account_id": str(sales.id), "debit": "0", "credit": amount},
            ],
        })

    services.post_journal_entry(_entry("2026-06-10", "100.00"), None)
    services.post_journal_entry(_entry("2026-06-12", "50.00"), None)
    _entry("2026-06-15", "30.00")  # left as draft

    return cash, sales


@pytest.mark.django_db
def test_ledger_running_balance(shop, ledger_data, client_with_perms):
    cash, sales = ledger_data
    client = client_with_perms(shop, ["accounts.ledger.view"])
    resp = client.get(f"/api/v1/accounts/ledger/{cash.id}/")
    assert resp.status_code == status.HTTP_200_OK, resp.content
    data = resp.json()["data"]

    assert Decimal(data["opening_balance"]) == Decimal("0.00")
    assert Decimal(data["closing_balance"]) == Decimal("150.00")
    rows = data["rows"]
    assert len(rows) == 2
    assert Decimal(rows[0]["running_balance"]) == Decimal("100.00")
    assert Decimal(rows[1]["running_balance"]) == Decimal("150.00")


@pytest.mark.django_db
def test_ledger_excludes_draft(shop, ledger_data, client_with_perms):
    cash, sales = ledger_data
    client = client_with_perms(shop, ["accounts.ledger.view"])
    data = client.get(f"/api/v1/accounts/ledger/{cash.id}/").json()["data"]
    # The 30.00 draft entry must not contribute.
    assert len(data["rows"]) == 2
    assert Decimal(data["closing_balance"]) == Decimal("150.00")


@pytest.mark.django_db
def test_trial_balance_balances(shop, ledger_data, client_with_perms):
    cash, sales = ledger_data
    client = client_with_perms(shop, ["accounts.ledger.view"])
    resp = client.get("/api/v1/accounts/trial-balance/")
    assert resp.status_code == status.HTTP_200_OK, resp.content
    data = resp.json()["data"]

    assert Decimal(data["total_debit"]) == Decimal(data["total_credit"])
    assert Decimal(data["total_debit"]) == Decimal("150.00")
    by_code = {r["code"]: r for r in data["rows"]}
    assert Decimal(by_code["1000"]["debit"]) == Decimal("150.00")
    assert Decimal(by_code["4000"]["credit"]) == Decimal("150.00")
