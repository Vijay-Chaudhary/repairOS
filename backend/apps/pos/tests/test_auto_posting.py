"""POS → accounts auto-posting hooks (Phase 8b)."""
from decimal import Decimal

import pytest

from accounts import services as acc_services
from accounts.models import JournalEntry
from accounts.posting import resolve
from pos import services as pos_services


# ──────────────────────────────────────────────────────────────────────────────
# Fixtures — mirrors apps/pos/tests/test_sales.py
# ──────────────────────────────────────────────────────────────────────────────


@pytest.fixture
def shop(db):
    from core.models import Shop
    return Shop.objects.create(
        name="Joy Computer", code="JOY",
        address="MG Rd", city="Delhi",
        state="UP", state_code="09", phone="+919876543210",
    )


@pytest.fixture
def user(db):
    from authentication.models import User
    return User.objects.create_user(
        email="pos@ap.com", phone="+919800000006",
        full_name="POS User", password="pass",
    )


def _items():
    # 2 * 250 = 500 subtotal, 18% tax = 90, total = 590
    return [{
        "product_name_snapshot": "USB Cable",
        "quantity": "2",
        "unit_price": "250.00",
        "tax_rate": "18.00",
    }]


@pytest.fixture
def sale_data():
    return {
        "sale_type": "counter",
        "items": _items(),
        "payments": [{"amount": "590.00", "method": "cash"}],
    }


@pytest.fixture
def unpaid_sale_data():
    return {
        "sale_type": "counter",
        "items": _items(),
        "payments": [],
    }


@pytest.fixture
def partial_sale_data():
    return {
        "sale_type": "counter",
        "items": _items(),
        "payments": [{"amount": "200.00", "method": "cash"}],
    }


# ──────────────────────────────────────────────────────────────────────────────
# Sale
# ──────────────────────────────────────────────────────────────────────────────


def test_completed_sale_posts(db, shop, user, sale_data):
    acc_services.seed_default_chart(shop)
    sale = pos_services.create_sale(shop, sale_data, user)  # fully paid → COMPLETED
    assert sale.status == "completed"
    entry = JournalEntry.objects.get(shop=shop, source_type="pos.sale", source_id=sale.id)
    assert entry.is_posted
    assert entry.lines.get(account=resolve(shop, "cash")).debit == sale.amount_paid


def test_draft_sale_does_not_post(db, shop, user, unpaid_sale_data):
    acc_services.seed_default_chart(shop)
    sale = pos_services.create_sale(shop, unpaid_sale_data, user)  # no payments → DRAFT
    assert sale.status == "draft"
    assert not JournalEntry.objects.filter(shop=shop, source_type="pos.sale").exists()


def test_sale_skips_when_accounting_disabled(db, shop, user, sale_data):
    sale = pos_services.create_sale(shop, sale_data, user)
    assert sale.id
    assert not JournalEntry.objects.filter(shop=shop, source_type="pos.sale").exists()


def test_sale_hook_is_idempotent(db, shop, user, sale_data):
    from functools import partial
    from django.utils import timezone
    from accounts import posting
    acc_services.seed_default_chart(shop)
    sale = pos_services.create_sale(shop, sale_data, user)  # posts pos.sale once
    # A retried request re-runs post_event for the same source key → no duplicate.
    resolve = partial(posting.resolve, shop)
    again = posting.post_event(
        shop, "pos.sale", sale.id, date=timezone.now().date(),
        narration="retry", lines=posting.lines_for_pos_sale(sale, resolve))
    assert JournalEntry.objects.filter(
        shop=shop, source_type="pos.sale", source_id=sale.id).count() == 1
    assert again.is_posted


def test_partially_paid_sale_posts_cash_and_debtors_legs(db, shop, user, partial_sale_data):
    acc_services.seed_default_chart(shop)
    sale = pos_services.create_sale(shop, partial_sale_data, user)  # PARTIALLY_PAID
    assert sale.status == "partially_paid"
    sale_entry = JournalEntry.objects.get(
        shop=shop, source_type="pos.sale", source_id=sale.id)
    assert sale_entry.lines.get(account=resolve(shop, "cash")).debit == sale.amount_paid
    assert sale_entry.lines.get(account=resolve(shop, "debtors")).debit == sale.amount_outstanding
    assert sum(l.debit for l in sale_entry.lines.all()) == \
        sum(l.credit for l in sale_entry.lines.all())


# ──────────────────────────────────────────────────────────────────────────────
# Payment
# ──────────────────────────────────────────────────────────────────────────────


def test_add_payment_posts(db, shop, user, partial_sale_data):
    acc_services.seed_default_chart(shop)
    sale = pos_services.create_sale(shop, partial_sale_data, user)  # PARTIALLY_PAID
    assert sale.status == "partially_paid"
    pos_services.add_payment(
        sale, {"amount": str(sale.amount_outstanding), "method": "cash"}, user
    )
    entry = JournalEntry.objects.get(shop=shop, source_type="pos.payment")
    assert entry.lines.get(account=resolve(shop, "cash")).debit == Decimal("390.00")
    assert entry.lines.get(account=resolve(shop, "debtors")).credit == Decimal("390.00")


def test_add_payment_skips_when_accounting_disabled(db, shop, user, partial_sale_data):
    sale = pos_services.create_sale(shop, partial_sale_data, user)
    pos_services.add_payment(
        sale, {"amount": str(sale.amount_outstanding), "method": "cash"}, user
    )
    assert not JournalEntry.objects.filter(shop=shop, source_type="pos.payment").exists()


def test_add_payment_skips_duplicate_razorpay_payment(db, shop, user, sale_data):
    """_record_payment returns None for a duplicate razorpay id — the hook must
    not blow up building lines for a None payment."""
    acc_services.seed_default_chart(shop)
    unpaid = {
        "sale_type": "counter",
        "items": _items(),
        "payments": [],
    }
    sale = pos_services.create_sale(shop, unpaid, user)
    pay_data = {"amount": "590.00", "method": "upi", "razorpay_payment_id": "pay_dup_001"}
    pos_services.add_payment(sale, pay_data, user)
    assert JournalEntry.objects.filter(shop=shop, source_type="pos.payment").count() == 1
    # Duplicate — silently ignored by _record_payment, must not raise or post again
    pos_services.add_payment(sale, pay_data, user)
    assert JournalEntry.objects.filter(shop=shop, source_type="pos.payment").count() == 1


# ──────────────────────────────────────────────────────────────────────────────
# Return (reverses the sale, scaled)
# ──────────────────────────────────────────────────────────────────────────────


def test_return_reverses_sale_scaled(db, shop, user, sale_data):
    acc_services.seed_default_chart(shop)
    sale = pos_services.create_sale(shop, sale_data, user)
    ret = pos_services.create_return(
        sale, {
            "items": [], "reason": "defect", "refund_method": "cash",
            "total_refund_amount": "100.00",
        }, user,
    )
    pos_services.approve_return(ret, user)
    entry = JournalEntry.objects.get(shop=shop, source_type="pos.return", source_id=ret.id)
    assert entry.reverses is not None
    assert entry.reverses.source_type == "pos.sale"
    assert str(entry.reverses.source_id) == str(sale.id)
    total_debit = sum(l.debit for l in entry.lines.all())
    total_credit = sum(l.credit for l in entry.lines.all())
    assert total_debit == total_credit
    cash_credit = entry.lines.get(account=resolve(shop, "cash")).credit
    assert abs(cash_credit - Decimal("100.00")) <= Decimal("0.01")


def test_return_skips_when_accounting_disabled(db, shop, user, sale_data):
    sale = pos_services.create_sale(shop, sale_data, user)
    ret = pos_services.create_return(
        sale, {
            "items": [], "reason": "defect", "refund_method": "cash",
            "total_refund_amount": "100.00",
        }, user,
    )
    pos_services.approve_return(ret, user)
    assert not JournalEntry.objects.filter(shop=shop, source_type="pos.return").exists()
