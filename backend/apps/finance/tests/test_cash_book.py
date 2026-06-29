"""Accounts › Cash Book — read-only running ledger over PettyCashTransaction."""
import uuid
from datetime import date
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
def account(db, shop):
    from finance.models import PettyCashAccount
    return PettyCashAccount.objects.create(shop=shop, name="Petty Cash")


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


def _txn(account, *, txn_type, amount, on, balance_after):
    from finance.models import PettyCashTransaction
    return PettyCashTransaction.objects.create(
        account=account, txn_type=txn_type, amount=Decimal(amount),
        date=on, balance_after=Decimal(balance_after),
    )


@pytest.mark.django_db
def test_cash_book_opening_closing_and_rows(shop, account, client_with_perms):
    # Before the window: credit 1000 → balance 1000 (this is the opening balance)
    _txn(account, txn_type="credit", amount="1000", on=date(2026, 6, 1), balance_after="1000")
    # In window: debit 300 → 700, credit 200 → 900
    _txn(account, txn_type="debit", amount="300", on=date(2026, 6, 10), balance_after="700")
    _txn(account, txn_type="credit", amount="200", on=date(2026, 6, 12), balance_after="900")

    client = client_with_perms(shop, ["accounts.cashbook.view"])
    resp = client.get("/api/v1/finance/cash-book/?date_from=2026-06-05&date_to=2026-06-30")
    assert resp.status_code == status.HTTP_200_OK
    body = resp.json()["data"]
    assert Decimal(body["opening_balance"]) == Decimal("1000")
    assert Decimal(body["closing_balance"]) == Decimal("900")
    assert Decimal(body["total_credit"]) == Decimal("200")
    assert Decimal(body["total_debit"]) == Decimal("300")
    assert len(body["results"]) == 2


@pytest.mark.django_db
def test_cash_book_requires_permission(shop, account, client_with_perms):
    client = client_with_perms(shop, [])  # empty claim → DB fallback → no roles → 403
    resp = client.get("/api/v1/finance/cash-book/")
    assert resp.status_code == status.HTTP_403_FORBIDDEN
