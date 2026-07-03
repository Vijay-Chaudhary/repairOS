"""
Tests for Pattern 8 — money type contract.

Two serialisation conventions exist in the codebase:

  Finance serialisers (DRF DecimalField, COERCE_DECIMAL_TO_STRING=True default):
    every decimal model field is returned as a string, e.g. "1234.56".

  Reports service:
    _d() helper (all non-dashboard report endpoints) → string "1234.56"
    float()     (dashboard widgets only)             → JSON number 1234.56

These tests pin both contracts so a refactor can't silently change
the type without a failing assertion.
"""

import datetime
from decimal import Decimal

import pytest
from rest_framework import status
from rest_framework_simplejwt.tokens import RefreshToken


# ── helpers ───────────────────────────────────────────────────────────────────

def _money_str(val) -> bool:
    """True if val is a string that can be round-tripped via Decimal."""
    if not isinstance(val, str):
        return False
    try:
        Decimal(val)
        return True
    except Exception:
        return False


def _make_client(api_client, user, permissions: list[str], is_tenant_wide: bool = True):
    refresh = RefreshToken.for_user(user)
    access = refresh.access_token
    access["permissions"] = permissions
    access["shop_ids"] = []
    access["is_tenant_wide"] = is_tenant_wide
    access["role_ids"] = []
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {str(access)}")
    return api_client


# ── fixtures ──────────────────────────────────────────────────────────────────

@pytest.fixture
def shop(db):
    from core.models import Shop
    return Shop.objects.create(
        name="Money Shop", code="MNY",
        address="1 Rupee Rd", city="Delhi",
        state="Delhi", state_code="07",
        phone="+919700000001",
    )


@pytest.fixture
def user(db):
    from authentication.models import User
    from django.contrib.auth.hashers import make_password
    return User.objects.create(
        email="money@test.com", phone="+919700000099",
        full_name="Money Tester",
        password=make_password("pass"), is_active=True,
    )


@pytest.fixture
def client_all(api_client, user, shop):
    return _make_client(api_client, user, [
        "hr.petty_cash.manage",
        "erp.expenses.view", "erp.expenses.create",
        "erp.budget.manage",
        "erp.assets.manage",
        "reports.revenue.view",
        "reports.inventory.view",
        "reports.repair.view",
        "reports.hr.view",
        "reports.crm.view",
        "reports.amc.view",
        "reports.gst.view",
        "reports.pl.view",
    ])


@pytest.fixture
def petty_account(db, shop):
    from finance.models import PettyCashAccount
    return PettyCashAccount.objects.create(
        shop=shop, name="Main Cash",
        current_balance=Decimal("1500.75"),
        low_balance_threshold=Decimal("200.00"),
    )


@pytest.fixture
def expense(db, shop, user):
    from finance.models import Expense
    return Expense.objects.create(
        shop=shop,
        amount=Decimal("750.50"),
        description="Office supplies",
        date=datetime.date(2026, 6, 1),
        recorded_by=user,
    )


@pytest.fixture
def asset(db, shop):
    from finance.models import ShopAsset
    return ShopAsset.objects.create(
        shop=shop, name="Laptop",
        category="Electronics", asset_code="ASSET-001",
        purchase_date=datetime.date(2026, 1, 1),
        purchase_cost=Decimal("45000.00"),
    )


@pytest.fixture
def allocation(db, shop):
    from finance.models import BudgetAllocation, BudgetHead
    head = BudgetHead.objects.create(shop=shop, name="Utilities", category="operations")
    return BudgetAllocation.objects.create(
        head=head, month=6, year=2026,
        budgeted_amount=Decimal("5000.00"),
        actual_amount=Decimal("4200.00"),
        variance=Decimal("4200.00") - Decimal("5000.00"),
    )


# ── Finance: DecimalField → string ────────────────────────────────────────────

@pytest.mark.django_db
class TestFinanceDecimalStrings:
    """
    DRF DecimalField serialises as string by default (COERCE_DECIMAL_TO_STRING=True).
    Finance endpoints must return all money fields as parseable decimal strings.
    """

    def test_petty_cash_account_balance_is_string(self, client_all, petty_account):
        res = client_all.get(f"/api/v1/finance/petty-cash/{petty_account.shop_id}/")
        assert res.status_code == status.HTTP_200_OK
        bal = res.json()["data"]["current_balance"]
        assert _money_str(bal), f"current_balance {bal!r} is not a decimal string"
        assert Decimal(bal) == Decimal("1500.75")

    def test_petty_cash_transaction_amount_and_balance_after_are_strings(
        self, client_all, petty_account
    ):
        payload = {
            "account_id": str(petty_account.id),
            "type": "credit",
            "amount": "300.00",
            "date": "2026-06-01",
        }
        res = client_all.post("/api/v1/finance/petty-cash/transactions/", payload, format="json")
        assert res.status_code == status.HTTP_201_CREATED
        data = res.json()["data"]
        assert _money_str(data["amount"]), f"amount {data['amount']!r} is not a decimal string"
        assert _money_str(data["balance_after"]), f"balance_after {data['balance_after']!r} is not a decimal string"

    def test_petty_cash_transaction_list_amounts_are_strings(
        self, client_all, petty_account
    ):
        # seed one transaction
        client_all.post("/api/v1/finance/petty-cash/transactions/", {
            "account_id": str(petty_account.id),
            "type": "debit",
            "amount": "100.25",
            "date": "2026-06-02",
        }, format="json")
        res = client_all.get("/api/v1/finance/petty-cash/transactions/")
        assert res.status_code == status.HTTP_200_OK
        items = res.json()["data"]["items"]
        assert len(items) >= 1
        row = items[0]
        assert _money_str(row["amount"])
        assert _money_str(row["balance_after"])

    def test_expense_amount_is_string(self, client_all, expense):
        res = client_all.get("/api/v1/finance/expenses/")
        assert res.status_code == status.HTTP_200_OK
        items = res.json()["data"]["items"]
        assert len(items) == 1
        assert _money_str(items[0]["amount"])
        assert Decimal(items[0]["amount"]) == Decimal("750.50")

    def test_asset_purchase_cost_is_string(self, client_all, asset):
        res = client_all.get("/api/v1/finance/assets/")
        assert res.status_code == status.HTTP_200_OK
        items = res.json()["data"]["items"]
        assert len(items) == 1
        assert _money_str(items[0]["purchase_cost"])
        assert Decimal(items[0]["purchase_cost"]) == Decimal("45000.00")

    def test_budget_allocation_amounts_are_strings(self, client_all, allocation):
        res = client_all.get("/api/v1/finance/budget/allocations/")
        assert res.status_code == status.HTTP_200_OK
        items = res.json()["data"]["items"]
        assert len(items) == 1
        row = items[0]
        assert _money_str(row["budgeted_amount"]), f"budgeted_amount {row['budgeted_amount']!r}"
        assert _money_str(row["actual_amount"]),   f"actual_amount {row['actual_amount']!r}"
        assert _money_str(row["variance"]),         f"variance {row['variance']!r}"
        assert Decimal(row["budgeted_amount"]) == Decimal("5000.00")
        assert Decimal(row["actual_amount"]) == Decimal("4200.00")


# ── Reports: _d() → string ────────────────────────────────────────────────────

@pytest.mark.django_db
class TestReportDecimalStrings:
    """
    The reports service uses _d() for all non-dashboard report data.
    Every money field in a report response must be a decimal string.
    Empty datasets return "0.00", not 0 or null.
    """

    def test_revenue_summary_total_is_string(self, client_all):
        res = client_all.get("/api/v1/reports/revenue-summary/")
        assert res.status_code == status.HTTP_200_OK
        data = res.json()["data"]
        assert _money_str(data["total_revenue"]), f"total_revenue {data['total_revenue']!r}"

    def test_revenue_summary_empty_is_zero_string(self, client_all):
        res = client_all.get("/api/v1/reports/revenue-summary/")
        data = res.json()["data"]
        assert data["total_revenue"] == "0.00"

    def test_outstanding_dues_total_is_string(self, client_all):
        res = client_all.get("/api/v1/reports/outstanding-dues/")
        assert res.status_code == status.HTTP_200_OK
        data = res.json()["data"]
        assert _money_str(data["total_outstanding"]), f"total_outstanding {data['total_outstanding']!r}"

    def test_pnl_summary_amounts_are_strings(self, client_all):
        res = client_all.get("/api/v1/reports/pnl-summary/")
        assert res.status_code == status.HTTP_200_OK
        data = res.json()["data"]
        for field in ("revenue", "expenses", "net_profit"):
            assert _money_str(data[field]), f"{field} {data[field]!r} is not a decimal string"

    def test_pnl_empty_net_profit_is_zero_string(self, client_all):
        res = client_all.get("/api/v1/reports/pnl-summary/")
        data = res.json()["data"]
        assert data["net_profit"] == "0.00"

    def test_budget_vs_actual_totals_are_strings(self, client_all, allocation):
        # Query the allocation's own period; the endpoint otherwise defaults to
        # date.today(), which makes this test pass only during that month.
        res = client_all.get("/api/v1/reports/budget-vs-actual/", {
            "month": allocation.month, "year": allocation.year,
        })
        assert res.status_code == status.HTTP_200_OK
        data = res.json()["data"]
        for field in ("total_budgeted", "total_actual", "total_variance"):
            assert _money_str(data[field]), f"{field} {data[field]!r} is not a decimal string"
        # head-level row amounts
        head = data["heads"][0]
        for field in ("budgeted_amount", "actual_amount", "variance"):
            assert _money_str(head[field]), f"head {field} {head[field]!r} is not a decimal string"

    def test_payment_collection_log_amounts_are_strings(self, client_all):
        res = client_all.get("/api/v1/reports/payment-collection-log/")
        assert res.status_code == status.HTTP_200_OK
        data = res.json()["data"]
        assert _money_str(data["total"]), f"total {data['total']!r} is not a decimal string"
        assert data["total"] == "0.00"


# ── Dashboard: float() → JSON number ─────────────────────────────────────────

@pytest.mark.django_db
class TestDashboardFloats:
    """
    Dashboard widgets use float() rather than _d() so the FE receives
    JSON numbers. Verify the contract is preserved for all three money keys.
    """

    def test_revenue_today_is_float(self, client_all):
        res = client_all.get("/api/v1/reports/dashboard/")
        assert res.status_code == status.HTTP_200_OK
        val = res.json()["data"]["revenue_today"]
        assert isinstance(val, float), f"revenue_today {val!r} is {type(val).__name__}, not float"

    def test_revenue_month_is_float(self, client_all):
        val = client_all.get("/api/v1/reports/dashboard/").json()["data"]["revenue_month"]
        assert isinstance(val, float), f"revenue_month {val!r} is {type(val).__name__}, not float"

    def test_outstanding_amount_is_float(self, client_all):
        val = client_all.get("/api/v1/reports/dashboard/").json()["data"]["outstanding_amount"]
        assert isinstance(val, float), f"outstanding_amount {val!r} is {type(val).__name__}, not float"

    def test_empty_dashboard_floats_are_zero(self, client_all):
        """With no transaction data, all money widgets return 0.0, not 0 or "0.00"."""
        data = client_all.get("/api/v1/reports/dashboard/").json()["data"]
        assert data["revenue_today"] == 0.0
        assert data["revenue_month"] == 0.0
        assert data["outstanding_amount"] == 0.0

    def test_revenue_trend_entries_are_floats(self, client_all):
        """Each trend entry's revenue value must be float (may be empty list with no data)."""
        data = client_all.get("/api/v1/reports/dashboard/").json()["data"]
        for entry in data.get("revenue_trend", []):
            val = entry["revenue"]
            assert isinstance(val, float), f"trend revenue {val!r} is {type(val).__name__}, not float"


# ── _d() helper unit tests ────────────────────────────────────────────────────

class TestDHelper:
    """Direct unit tests for the _d() formatting helper (no DB needed)."""

    def test_zero_formats_as_zero_zero(self):
        from reports.services import _d
        assert _d(0) == "0.00"
        assert _d(Decimal("0")) == "0.00"

    def test_positive_decimal_formats_to_two_dp(self):
        from reports.services import _d
        assert _d(Decimal("1234.567")) == "1234.57"  # rounds up
        assert _d(Decimal("1234.564")) == "1234.56"  # rounds down

    def test_integer_formats_to_two_dp(self):
        from reports.services import _d
        assert _d(500) == "500.00"
        assert _d(1) == "1.00"

    def test_none_treated_as_zero(self):
        from reports.services import _d
        assert _d(None) == "0.00"

    def test_result_is_always_string(self):
        from reports.services import _d
        result = _d(Decimal("999.99"))
        assert isinstance(result, str)
        assert Decimal(result) == Decimal("999.99")
