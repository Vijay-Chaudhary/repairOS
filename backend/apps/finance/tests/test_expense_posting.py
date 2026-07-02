"""Finance → accounts auto-posting for expenses (Phase 8b)."""
from decimal import Decimal

import pytest

from accounts import services as acc_services
from accounts.models import JournalEntry
from accounts.posting import resolve
from finance import services as finance_services


# ──────────────────────────────────────────────────────────────────────────────
# Fixtures — mirrors apps/finance/tests/test_finance.py
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
def user(db):
    from authentication.models import User
    return User.objects.create_user(
        email="fin-post@test.com", phone="+919000000098",
        full_name="Finance Poster", password="pass",
    )


def test_expense_posts_to_default_account(db, shop, user):
    acc_services.seed_default_chart(shop)
    expense = finance_services.create_expense(
        shop, {"amount": "500.00", "category": "", "date": "2026-07-01"}, user)
    entry = JournalEntry.objects.get(shop=shop, source_type="finance.expense", source_id=expense.id)
    assert entry.lines.get(account=resolve(shop, "expense_default")).debit == Decimal("500.00")
    assert entry.lines.get(account=resolve(shop, "cash")).credit == Decimal("500.00")


def test_expense_skips_when_accounting_disabled(db, shop, user):
    expense = finance_services.create_expense(
        shop, {"amount": "500.00", "date": "2026-07-01"}, user)
    assert expense.id
    assert not JournalEntry.objects.filter(shop=shop, source_type="finance.expense").exists()
