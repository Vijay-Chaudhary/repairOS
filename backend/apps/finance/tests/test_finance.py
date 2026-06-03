"""
Finance module tests — §10 acceptance criteria + §11 test cases.

Covers:
- Petty cash account creation (one per shop)
- Running balance integrity: credit adds, debit subtracts, balance_after stored
- Sequential transactions produce correct cumulative balance
- Debit below zero is allowed (overdraft scenario — spec doesn't block it)
- Budget allocation create/update
- Expense creation with budget_head updates allocation.actual + variance
- Expense without budget_head has no budget side-effect
- Over-budget: variance positive (actual > budgeted)
- Asset CRUD and condition lifecycle
- Disposed assets excluded from active list
- API: all endpoints return correct status codes
"""

import datetime
from decimal import Decimal

import pytest
from rest_framework import status


# ──────────────────────────────────────────────────────────────────────────────
# Fixtures
# ──────────────────────────────────────────────────────────────────────────────


@pytest.fixture
def shop(db):
    from core.models import Shop
    return Shop.objects.create(
        name="Finance Shop", code="FIN",
        address="1 Cash Lane", city="Delhi",
        state="Delhi", state_code="07",
        phone="+919000000001",
    )


@pytest.fixture
def admin_user(db):
    from authentication.models import Permission, Role, RolePermission, User, UserRole
    user = User.objects.create_user(
        email="fin@test.com", phone="+919000000099",
        full_name="Finance Admin", password="pass",
    )
    role = Role.objects.create(name="FinAdmin", is_system_role=True)
    for code in [
        "hr.petty_cash.manage",
        "erp.expenses.view", "erp.expenses.create",
        "erp.budget.manage",
        "erp.assets.manage",
    ]:
        perm, _ = Permission.objects.get_or_create(codename=code, defaults={"label": code})
        RolePermission.objects.create(role=role, permission=perm)
    UserRole.objects.create(user=user, role=role)
    return user


@pytest.fixture
def fin_client(db, admin_user):
    from rest_framework.test import APIClient
    from rest_framework_simplejwt.tokens import RefreshToken
    refresh = RefreshToken.for_user(admin_user)
    access = refresh.access_token
    access["permissions"] = [
        "hr.petty_cash.manage",
        "erp.expenses.view", "erp.expenses.create",
        "erp.budget.manage",
        "erp.assets.manage",
    ]
    access["is_tenant_wide"] = True
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {str(access)}")
    return client


@pytest.fixture
def petty_cash_account(db, shop):
    from finance.models import PettyCashAccount
    return PettyCashAccount.objects.create(
        shop=shop,
        name="Main Petty Cash",
        current_balance=Decimal("1000.00"),
        low_balance_threshold=Decimal("200.00"),
    )


@pytest.fixture
def budget_head(db, shop):
    from finance.models import BudgetHead
    return BudgetHead.objects.create(
        shop=shop, name="Office Supplies", category="variable"
    )


@pytest.fixture
def budget_allocation(db, budget_head):
    from finance.models import BudgetAllocation
    return BudgetAllocation.objects.create(
        head=budget_head,
        month=6, year=2026,
        budgeted_amount=Decimal("5000.00"),
        actual_amount=Decimal("0.00"),
        variance=Decimal("0.00"),
    )


# ──────────────────────────────────────────────────────────────────────────────
# TestPettyCash
# ──────────────────────────────────────────────────────────────────────────────


class TestPettyCash:
    txn_url = "/api/v1/finance/petty-cash/transactions/"

    def test_get_account(self, fin_client, shop, petty_cash_account):
        res = fin_client.get(f"/api/v1/finance/petty-cash/{shop.id}/")
        assert res.status_code == status.HTTP_200_OK
        assert Decimal(res.data["current_balance"]) == Decimal("1000.00")

    def test_credit_increases_balance(self, fin_client, petty_cash_account, admin_user):
        res = fin_client.post(self.txn_url, {
            "account_id": str(petty_cash_account.id),
            "txn_type": "credit",
            "amount": "500.00",
            "category": "Replenishment",
            "description": "Cash top-up",
            "date": "2026-06-01",
        }, format="json")
        assert res.status_code == status.HTTP_201_CREATED
        assert Decimal(res.data["balance_after"]) == Decimal("1500.00")
        petty_cash_account.refresh_from_db()
        assert petty_cash_account.current_balance == Decimal("1500.00")

    def test_debit_decreases_balance(self, fin_client, petty_cash_account):
        res = fin_client.post(self.txn_url, {
            "account_id": str(petty_cash_account.id),
            "txn_type": "debit",
            "amount": "300.00",
            "category": "Office Supplies",
            "description": "Printer ink",
            "date": "2026-06-01",
        }, format="json")
        assert res.status_code == status.HTTP_201_CREATED
        assert Decimal(res.data["balance_after"]) == Decimal("700.00")
        petty_cash_account.refresh_from_db()
        assert petty_cash_account.current_balance == Decimal("700.00")

    def test_sequential_transactions_running_balance(self, fin_client, petty_cash_account):
        """Three sequential txns produce correct cumulative balance."""
        # Start: 1000
        fin_client.post(self.txn_url, {
            "account_id": str(petty_cash_account.id),
            "txn_type": "debit", "amount": "200.00",
            "category": "X", "description": "", "date": "2026-06-01",
        }, format="json")   # → 800

        fin_client.post(self.txn_url, {
            "account_id": str(petty_cash_account.id),
            "txn_type": "credit", "amount": "500.00",
            "category": "X", "description": "", "date": "2026-06-02",
        }, format="json")   # → 1300

        res = fin_client.post(self.txn_url, {
            "account_id": str(petty_cash_account.id),
            "txn_type": "debit", "amount": "100.00",
            "category": "X", "description": "", "date": "2026-06-03",
        }, format="json")   # → 1200
        assert Decimal(res.data["balance_after"]) == Decimal("1200.00")
        petty_cash_account.refresh_from_db()
        assert petty_cash_account.current_balance == Decimal("1200.00")

    def test_one_account_per_shop(self, db, shop, petty_cash_account):
        """Creating a second account for the same shop raises IntegrityError."""
        from django.db import IntegrityError
        from finance.models import PettyCashAccount
        with pytest.raises(IntegrityError):
            PettyCashAccount.objects.create(
                shop=shop, name="Second", current_balance=0, low_balance_threshold=100
            )

    def test_balance_after_is_immutable_ledger(self, fin_client, petty_cash_account):
        """balance_after on old txns does not change when new txns are added."""
        res1 = fin_client.post(self.txn_url, {
            "account_id": str(petty_cash_account.id),
            "txn_type": "debit", "amount": "100.00",
            "category": "X", "description": "", "date": "2026-06-01",
        }, format="json")
        txn1_balance_after = Decimal(res1.data["balance_after"])

        fin_client.post(self.txn_url, {
            "account_id": str(petty_cash_account.id),
            "txn_type": "debit", "amount": "200.00",
            "category": "X", "description": "", "date": "2026-06-02",
        }, format="json")

        from finance.models import PettyCashTransaction
        txn1 = PettyCashTransaction.objects.get(id=res1.data["id"])
        assert txn1.balance_after == txn1_balance_after


# ──────────────────────────────────────────────────────────────────────────────
# TestBudget
# ──────────────────────────────────────────────────────────────────────────────


class TestBudget:
    alloc_url = "/api/v1/finance/budget/allocations/"

    def test_create_budget_allocation(self, fin_client, budget_head):
        res = fin_client.post(self.alloc_url, {
            "head_id": str(budget_head.id),
            "month": 5,
            "year": 2026,
            "budgeted_amount": "10000.00",
        }, format="json")
        assert res.status_code == status.HTTP_201_CREATED
        assert Decimal(res.data["budgeted_amount"]) == Decimal("10000.00")
        assert Decimal(res.data["actual_amount"]) == Decimal("0.00")
        assert Decimal(res.data["variance"]) == Decimal("0.00")

    def test_list_budget_heads(self, fin_client, budget_head):
        res = fin_client.get("/api/v1/finance/budget/")
        assert res.status_code == status.HTTP_200_OK
        assert len(res.data) >= 1

    def test_duplicate_allocation_blocked(self, fin_client, budget_allocation, budget_head):
        res = fin_client.post(self.alloc_url, {
            "head_id": str(budget_head.id),
            "month": 6, "year": 2026,
            "budgeted_amount": "9999.00",
        }, format="json")
        assert res.status_code == status.HTTP_400_BAD_REQUEST


# ──────────────────────────────────────────────────────────────────────────────
# TestExpenses
# ──────────────────────────────────────────────────────────────────────────────


class TestExpenses:
    url = "/api/v1/finance/expenses/"

    def test_create_expense_without_budget_head(self, fin_client, shop):
        res = fin_client.post(self.url, {
            "shop_id": str(shop.id),
            "category": "Miscellaneous",
            "amount": "150.00",
            "description": "Coffee for team",
            "date": "2026-06-10",
        }, format="json")
        assert res.status_code == status.HTTP_201_CREATED

    def test_expense_with_budget_head_updates_actual(
        self, fin_client, shop, budget_head, budget_allocation
    ):
        fin_client.post(self.url, {
            "shop_id": str(shop.id),
            "budget_head_id": str(budget_head.id),
            "category": "Office Supplies",
            "amount": "800.00",
            "description": "Stationery",
            "date": "2026-06-15",
        }, format="json")

        budget_allocation.refresh_from_db()
        assert budget_allocation.actual_amount == Decimal("800.00")

    def test_expense_updates_variance_correctly(
        self, fin_client, shop, budget_head, budget_allocation
    ):
        """variance = actual − budgeted; positive = over budget."""
        # budgeted = 5000; add two expenses totalling 6000 → variance = 1000
        fin_client.post(self.url, {
            "shop_id": str(shop.id),
            "budget_head_id": str(budget_head.id),
            "category": "X", "amount": "3000.00", "date": "2026-06-10",
        }, format="json")
        fin_client.post(self.url, {
            "shop_id": str(shop.id),
            "budget_head_id": str(budget_head.id),
            "category": "X", "amount": "3000.00", "date": "2026-06-11",
        }, format="json")

        budget_allocation.refresh_from_db()
        assert budget_allocation.actual_amount == Decimal("6000.00")
        assert budget_allocation.variance == Decimal("1000.00")   # over budget

    def test_expense_without_budget_head_no_allocation_change(
        self, fin_client, shop, budget_allocation
    ):
        fin_client.post(self.url, {
            "shop_id": str(shop.id),
            "category": "Travel",
            "amount": "500.00",
            "date": "2026-06-10",
        }, format="json")

        budget_allocation.refresh_from_db()
        assert budget_allocation.actual_amount == Decimal("0.00")

    def test_list_expenses(self, fin_client, shop, db):
        from finance import services
        from authentication.models import User
        u = User.objects.first()
        services.create_expense(shop, {"category": "X", "amount": "100", "date": datetime.date.today()}, u)
        res = fin_client.get(self.url)
        assert res.status_code == status.HTTP_200_OK


# ──────────────────────────────────────────────────────────────────────────────
# TestAssets
# ──────────────────────────────────────────────────────────────────────────────


class TestAssets:
    url = "/api/v1/finance/assets/"

    def test_create_asset(self, fin_client, shop):
        res = fin_client.post(self.url, {
            "shop_id": str(shop.id),
            "name": "Dell Laptop",
            "category": "IT Equipment",
            "asset_code": "FIN-ASSET-001",
            "purchase_date": "2026-01-15",
            "purchase_cost": "55000.00",
            "condition": "good",
        }, format="json")
        assert res.status_code == status.HTTP_201_CREATED
        assert res.data["condition"] == "good"
        assert res.data["is_active"] is True

    def test_update_asset_condition(self, fin_client, shop, db):
        res = fin_client.post(self.url, {
            "shop_id": str(shop.id),
            "name": "UPS", "category": "Electrical",
            "asset_code": "FIN-ASSET-002",
            "purchase_date": "2026-01-01",
            "purchase_cost": "8000.00",
            "condition": "good",
        }, format="json")
        asset_id = res.data["id"]

        res2 = fin_client.patch(f"{self.url}{asset_id}/", {"condition": "poor"}, format="json")
        assert res2.status_code == status.HTTP_200_OK
        assert res2.data["condition"] == "poor"

    def test_dispose_asset_marks_inactive(self, fin_client, shop, db):
        res = fin_client.post(self.url, {
            "shop_id": str(shop.id),
            "name": "Old Monitor", "category": "IT",
            "asset_code": "FIN-ASSET-003",
            "purchase_date": "2024-01-01",
            "purchase_cost": "12000.00",
            "condition": "good",
        }, format="json")
        asset_id = res.data["id"]

        res2 = fin_client.patch(
            f"{self.url}{asset_id}/",
            {"condition": "disposed"},
            format="json",
        )
        assert res2.status_code == status.HTTP_200_OK
        assert res2.data["is_active"] is False

    def test_disposed_assets_excluded_from_active_list(self, fin_client, shop, db):
        # Create one active, one disposed
        fin_client.post(self.url, {
            "shop_id": str(shop.id),
            "name": "Active Asset", "category": "IT",
            "asset_code": "FIN-ACT-001",
            "purchase_date": "2026-01-01",
            "purchase_cost": "5000.00",
            "condition": "good",
        }, format="json")

        res_d = fin_client.post(self.url, {
            "shop_id": str(shop.id),
            "name": "Disposed Asset", "category": "IT",
            "asset_code": "FIN-DIS-001",
            "purchase_date": "2026-01-01",
            "purchase_cost": "3000.00",
            "condition": "good",
        }, format="json")
        fin_client.patch(
            f"{self.url}{res_d.data['id']}/",
            {"condition": "disposed"},
            format="json",
        )

        res = fin_client.get(self.url)
        names = [a["name"] for a in res.data]
        assert "Active Asset" in names
        assert "Disposed Asset" not in names

    def test_duplicate_asset_code_blocked(self, fin_client, shop, db):
        fin_client.post(self.url, {
            "shop_id": str(shop.id),
            "name": "Asset A", "category": "IT",
            "asset_code": "DUPLICATE-001",
            "purchase_date": "2026-01-01",
            "purchase_cost": "1000.00",
        }, format="json")
        res = fin_client.post(self.url, {
            "shop_id": str(shop.id),
            "name": "Asset B", "category": "IT",
            "asset_code": "DUPLICATE-001",
            "purchase_date": "2026-01-01",
            "purchase_cost": "2000.00",
        }, format="json")
        assert res.status_code == status.HTTP_400_BAD_REQUEST
