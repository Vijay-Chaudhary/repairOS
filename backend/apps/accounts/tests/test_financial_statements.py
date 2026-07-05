"""Accounts › Financial statements — Profit & Loss + Balance Sheet (Phase 9)."""
import uuid
from decimal import Decimal

import pytest
from rest_framework import status

PNL_URL = "/api/v1/accounts/reports/pnl/"
BS_URL = "/api/v1/accounts/reports/balance-sheet/"


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
def chart(db, shop):
    """Minimal chart covering all five account types."""
    from accounts.models import Account
    return {
        "cash": Account.objects.create(shop=shop, code="1000", name="Cash", account_type="asset"),
        "creditors": Account.objects.create(
            shop=shop, code="2000", name="Sundry Creditors", account_type="liability"
        ),
        "capital": Account.objects.create(shop=shop, code="3000", name="Capital", account_type="equity"),
        "sales": Account.objects.create(shop=shop, code="4000", name="Sales", account_type="income"),
        "rent": Account.objects.create(shop=shop, code="5200", name="Rent", account_type="expense"),
    }


@pytest.fixture
def entry_factory(db, shop):
    """Post (or draft) a balanced two-line entry: Dr debit_acct / Cr credit_acct."""
    from accounts import services

    def _entry(on, debit_acct, credit_acct, amount, post=True):
        entry = services.create_journal_entry(shop, {
            "date": on,
            "narration": "test entry",
            "lines": [
                {"account_id": str(debit_acct.id), "debit": amount, "credit": "0"},
                {"account_id": str(credit_acct.id), "debit": "0", "credit": amount},
            ],
        })
        if post:
            services.post_journal_entry(entry, None)
        return entry

    return _entry


@pytest.fixture
def pnl_data(chart, entry_factory):
    """A sale (Dr Cash / Cr Sales 1000) and an expense (Dr Rent / Cr Cash 300) in June."""
    entry_factory("2026-06-10", chart["cash"], chart["sales"], "1000.00")
    entry_factory("2026-06-12", chart["rent"], chart["cash"], "300.00")
    return chart


# ──────────────────────────────────────────────────────────────────────────────
# Profit & Loss
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.django_db
def test_pnl_requires_reports_view(shop, pnl_data, client_with_perms):
    client = client_with_perms(shop, ["accounts.ledger.view"])
    resp = client.get(PNL_URL)
    assert resp.status_code == status.HTTP_403_FORBIDDEN


@pytest.mark.django_db
def test_pnl_income_expense_and_net(shop, pnl_data, client_with_perms):
    client = client_with_perms(shop, ["accounts.reports.view"])
    resp = client.get(PNL_URL)
    assert resp.status_code == status.HTTP_200_OK, resp.content
    data = resp.json()["data"]

    assert Decimal(data["income"]["subtotal"]) == Decimal("1000.00")
    assert Decimal(data["expense"]["subtotal"]) == Decimal("300.00")
    assert Decimal(data["net_profit"]) == Decimal("700.00")

    income_rows = data["income"]["rows"]
    expense_rows = data["expense"]["rows"]
    assert [r["code"] for r in income_rows] == ["4000"]
    assert [r["code"] for r in expense_rows] == ["5200"]
    assert Decimal(income_rows[0]["amount"]) == Decimal("1000.00")
    assert Decimal(expense_rows[0]["amount"]) == Decimal("300.00")


@pytest.mark.django_db
def test_pnl_date_window_excludes_out_of_range(shop, pnl_data, entry_factory, client_with_perms):
    # An extra sale before the window must not count inside it.
    entry_factory("2026-05-01", pnl_data["cash"], pnl_data["sales"], "500.00")
    client = client_with_perms(shop, ["accounts.reports.view"])

    resp = client.get(PNL_URL, {"date_from": "2026-06-01", "date_to": "2026-06-30"})
    data = resp.json()["data"]
    assert Decimal(data["income"]["subtotal"]) == Decimal("1000.00")
    assert Decimal(data["net_profit"]) == Decimal("700.00")

    # All-time includes it.
    all_time = client.get(PNL_URL).json()["data"]
    assert Decimal(all_time["income"]["subtotal"]) == Decimal("1500.00")


@pytest.mark.django_db
def test_pnl_ignores_draft_entries(shop, pnl_data, entry_factory, client_with_perms):
    entry_factory("2026-06-15", pnl_data["cash"], pnl_data["sales"], "999.00", post=False)
    client = client_with_perms(shop, ["accounts.reports.view"])
    data = client.get(PNL_URL).json()["data"]
    assert Decimal(data["income"]["subtotal"]) == Decimal("1000.00")
    assert Decimal(data["net_profit"]) == Decimal("700.00")


@pytest.mark.django_db
def test_pnl_reversal_reduces_income(shop, pnl_data, entry_factory, client_with_perms):
    # Refund: Dr Sales / Cr Cash nets income back down.
    entry_factory("2026-06-20", pnl_data["sales"], pnl_data["cash"], "200.00")
    client = client_with_perms(shop, ["accounts.reports.view"])
    data = client.get(PNL_URL).json()["data"]
    assert Decimal(data["income"]["subtotal"]) == Decimal("800.00")
    assert Decimal(data["net_profit"]) == Decimal("500.00")


# ──────────────────────────────────────────────────────────────────────────────
# Balance Sheet
# ──────────────────────────────────────────────────────────────────────────────


@pytest.fixture
def bs_data(chart, entry_factory):
    """Opening capital, a sale, a cash expense, and an expense on credit (June)."""
    entry_factory("2026-06-01", chart["cash"], chart["capital"], "5000.00")
    entry_factory("2026-06-10", chart["cash"], chart["sales"], "1000.00")
    entry_factory("2026-06-12", chart["rent"], chart["cash"], "300.00")
    entry_factory("2026-06-14", chart["rent"], chart["creditors"], "200.00")
    return chart


@pytest.mark.django_db
def test_balance_sheet_requires_reports_view(shop, bs_data, client_with_perms):
    client = client_with_perms(shop, ["accounts.ledger.view"])
    assert client.get(BS_URL).status_code == status.HTTP_403_FORBIDDEN


@pytest.mark.django_db
def test_balance_sheet_sections(shop, bs_data, client_with_perms):
    client = client_with_perms(shop, ["accounts.reports.view"])
    resp = client.get(BS_URL)
    assert resp.status_code == status.HTTP_200_OK, resp.content
    data = resp.json()["data"]

    assets = {r["code"]: r for r in data["assets"]["rows"]}
    liabilities = {r["code"]: r for r in data["liabilities"]["rows"]}
    # Cash = 5000 + 1000 - 300 (debit-normal); Creditors = 200 (credit-normal).
    assert Decimal(assets["1000"]["amount"]) == Decimal("5700.00")
    assert Decimal(liabilities["2000"]["amount"]) == Decimal("200.00")
    assert Decimal(data["assets"]["subtotal"]) == Decimal("5700.00")
    assert Decimal(data["liabilities"]["subtotal"]) == Decimal("200.00")


@pytest.mark.django_db
def test_balance_sheet_current_period_earnings(shop, bs_data, client_with_perms):
    client = client_with_perms(shop, ["accounts.reports.view"])
    data = client.get(BS_URL).json()["data"]

    equity_rows = data["equity"]["rows"]
    by_name = {r["name"]: r for r in equity_rows}
    earnings = by_name["Current Period Earnings"]
    # income 1000 − expenses (300 + 200) = 500; synthetic row has no account.
    assert Decimal(earnings["amount"]) == Decimal("500.00")
    assert earnings["account_id"] is None
    assert earnings["code"] is None
    # Income/expense accounts never appear on the balance sheet.
    all_codes = {
        r["code"]
        for section in ("assets", "liabilities", "equity")
        for r in data[section]["rows"]
    }
    assert "4000" not in all_codes
    assert "5200" not in all_codes
    # Equity = Capital 5000 + earnings 500.
    assert Decimal(data["equity"]["subtotal"]) == Decimal("5500.00")


@pytest.mark.django_db
def test_balance_sheet_is_balanced(shop, bs_data, client_with_perms):
    client = client_with_perms(shop, ["accounts.reports.view"])
    data = client.get(BS_URL).json()["data"]
    assert Decimal(data["total_assets"]) == Decimal("5700.00")
    assert Decimal(data["total_liabilities"]) == Decimal("200.00")
    assert Decimal(data["total_equity"]) == Decimal("5500.00")
    assert Decimal(data["total_assets"]) == (
        Decimal(data["total_liabilities"]) + Decimal(data["total_equity"])
    )
    assert data["is_balanced"] is True


@pytest.mark.django_db
def test_balance_sheet_as_of_snapshot(shop, bs_data, entry_factory, client_with_perms):
    # A July sale must be invisible at as_of 2026-06-30 — in assets and in earnings.
    entry_factory("2026-07-01", bs_data["cash"], bs_data["sales"], "400.00")
    client = client_with_perms(shop, ["accounts.reports.view"])

    june = client.get(BS_URL, {"as_of": "2026-06-30"}).json()["data"]
    assert Decimal(june["total_assets"]) == Decimal("5700.00")
    by_name = {r["name"]: r for r in june["equity"]["rows"]}
    assert Decimal(by_name["Current Period Earnings"]["amount"]) == Decimal("500.00")
    assert june["is_balanced"] is True

    latest = client.get(BS_URL).json()["data"]
    assert Decimal(latest["total_assets"]) == Decimal("6100.00")
    assert latest["is_balanced"] is True


@pytest.mark.django_db
def test_balance_sheet_csv_export_requires_export_perm(shop, bs_data, client_with_perms):
    view_only = client_with_perms(shop, ["accounts.reports.view"])
    assert view_only.get(BS_URL, {"format": "csv"}).status_code == status.HTTP_403_FORBIDDEN

    exporter = client_with_perms(shop, ["accounts.reports.view", "accounts.reports.export"])
    resp = exporter.get(BS_URL, {"format": "csv"})
    assert resp.status_code == status.HTTP_200_OK, resp.content
    assert resp["Content-Type"].startswith("text/csv")


@pytest.mark.django_db
def test_pnl_csv_export_requires_export_perm(shop, pnl_data, client_with_perms):
    view_only = client_with_perms(shop, ["accounts.reports.view"])
    resp = view_only.get(PNL_URL, {"format": "csv"})
    assert resp.status_code == status.HTTP_403_FORBIDDEN

    exporter = client_with_perms(shop, ["accounts.reports.view", "accounts.reports.export"])
    resp = exporter.get(PNL_URL, {"format": "csv"})
    assert resp.status_code == status.HTTP_200_OK, resp.content
    assert resp["Content-Type"].startswith("text/csv")
    assert "attachment" in resp["Content-Disposition"]
