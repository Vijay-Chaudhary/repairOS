"""Accounts › posting engine — recipes, post_event idempotency, reversals."""
import datetime as dt
import uuid
from decimal import Decimal
from functools import partial
from types import SimpleNamespace

import pytest

from accounts import posting, services
from accounts.models import AccountMapping, JournalEntry
from core.exceptions import BusinessRuleViolation


@pytest.fixture
def shop(db):
    from core.models import Shop
    return Shop.objects.create(
        name="Hotspot Repair", code="HTA", address="MG Road",
        city="Delhi", state="Delhi", state_code="07", phone="+919876543210",
    )


@pytest.fixture
def seeded_shop(shop):
    services.seed_default_chart(shop)  # chart + mappings
    return shop


def _resolve(shop):
    return partial(posting.resolve, shop)


def test_accounting_disabled_until_mapped(shop, seeded_shop):
    assert posting.accounting_enabled(seeded_shop) is True
    AccountMapping.objects.filter(shop=seeded_shop).delete()
    assert posting.accounting_enabled(seeded_shop) is False


def test_resolve_raises_when_key_missing(seeded_shop):
    AccountMapping.objects.filter(shop=seeded_shop, key="debtors").delete()
    with pytest.raises(BusinessRuleViolation):
        posting.resolve(seeded_shop, "debtors")


def test_post_event_skips_when_disabled(shop):
    entry = posting.post_event(
        shop, "billing.invoice", uuid.uuid4(),
        date=dt.date(2026, 7, 1), narration="x",
        lines=[{"account_id": uuid.uuid4(), "debit": Decimal("1.00"), "credit": Decimal("0.00")}],
    )
    assert entry is None
    assert JournalEntry.objects.filter(shop=shop).count() == 0


def test_post_event_creates_posted_entry_and_is_idempotent(seeded_shop):
    resolve = _resolve(seeded_shop)
    invoice = SimpleNamespace(
        subtotal=Decimal("1000.00"), discount_amount=Decimal("0.00"),
        cgst=Decimal("90.00"), sgst=Decimal("90.00"), igst=Decimal("0.00"),
        grand_total=Decimal("1180.00"), id=uuid.uuid4(), invoice_number="INV-1",
    )
    lines = posting.lines_for_repair_invoice(invoice, resolve)
    sid = invoice.id
    e1 = posting.post_event(seeded_shop, "billing.invoice", sid,
                            date=dt.date(2026, 7, 1), narration="INV-1", lines=lines)
    e2 = posting.post_event(seeded_shop, "billing.invoice", sid,
                            date=dt.date(2026, 7, 1), narration="INV-1", lines=lines)
    assert e1.id == e2.id
    assert e1.is_posted
    assert JournalEntry.objects.filter(shop=seeded_shop, source_type="billing.invoice").count() == 1


def test_invoice_recipe_is_balanced(seeded_shop):
    resolve = _resolve(seeded_shop)
    invoice = SimpleNamespace(
        subtotal=Decimal("1000.00"), discount_amount=Decimal("100.00"),
        cgst=Decimal("81.00"), sgst=Decimal("81.00"), igst=Decimal("0.00"),
        grand_total=Decimal("1062.00"),
    )
    lines = posting.lines_for_repair_invoice(invoice, resolve)
    assert sum(l["debit"] for l in lines) == sum(l["credit"] for l in lines) == Decimal("1062.00")
    debtors = posting.resolve(seeded_shop, "debtors").id
    assert next(l for l in lines if l["account_id"] == debtors)["debit"] == Decimal("1062.00")


def test_pos_sale_recipe_partial_paid(seeded_shop):
    resolve = _resolve(seeded_shop)
    sale = SimpleNamespace(
        subtotal=Decimal("500.00"), discount_amount=Decimal("0.00"),
        cgst=Decimal("45.00"), sgst=Decimal("45.00"), igst=Decimal("0.00"),
        amount_paid=Decimal("300.00"), amount_outstanding=Decimal("290.00"),
    )
    lines = posting.lines_for_pos_sale(sale, resolve)
    assert sum(l["debit"] for l in lines) == sum(l["credit"] for l in lines) == Decimal("590.00")


def test_payment_recipe_cash_vs_bank(seeded_shop):
    resolve = _resolve(seeded_shop)
    cash = posting.lines_for_billing_payment(
        SimpleNamespace(amount=Decimal("100.00"), method="cash"), resolve)
    upi = posting.lines_for_billing_payment(
        SimpleNamespace(amount=Decimal("100.00"), method="upi"), resolve)
    cash_acc = posting.resolve(seeded_shop, "cash").id
    bank_acc = posting.resolve(seeded_shop, "bank").id
    assert cash[0]["account_id"] == cash_acc
    assert upi[0]["account_id"] == bank_acc


def test_expense_recipe_defaults(seeded_shop):
    resolve = _resolve(seeded_shop)
    expense = SimpleNamespace(amount=Decimal("250.00"), category="", shop=seeded_shop)
    lines = posting.lines_for_expense(expense, resolve)
    exp_acc = posting.resolve(seeded_shop, "expense_default").id
    cash_acc = posting.resolve(seeded_shop, "cash").id
    assert next(l for l in lines if l["debit"] > 0)["account_id"] == exp_acc
    assert next(l for l in lines if l["credit"] > 0)["account_id"] == cash_acc


def test_reverse_event_full_and_partial(seeded_shop):
    resolve = _resolve(seeded_shop)
    invoice = SimpleNamespace(
        subtotal=Decimal("1000.00"), discount_amount=Decimal("0.00"),
        cgst=Decimal("90.00"), sgst=Decimal("90.00"), igst=Decimal("0.00"),
        grand_total=Decimal("1180.00"),
    )
    inv_id = uuid.uuid4()
    original = posting.post_event(
        seeded_shop, "billing.invoice", inv_id,
        date=dt.date(2026, 7, 1), narration="INV",
        lines=posting.lines_for_repair_invoice(invoice, resolve))

    rev = posting.reverse_event(
        seeded_shop, original_source_type="billing.invoice", original_source_id=inv_id,
        new_source_type="billing.creditnote", new_source_id=uuid.uuid4(),
        date=dt.date(2026, 7, 2), narration="CN", amount=Decimal("590.00"))

    assert rev.reverses_id == original.id
    lines = list(rev.lines.all())
    assert sum(l.debit for l in lines) == sum(l.credit for l in lines)  # still balanced
    debtors = posting.resolve(seeded_shop, "debtors")
    assert sum(l.credit for l in lines if l.account_id == debtors.id) == Decimal("590.00")
    original.refresh_from_db()
    assert original.is_posted and original.reverses_id is None


def test_reverse_event_returns_none_when_original_absent(seeded_shop):
    rev = posting.reverse_event(
        seeded_shop, original_source_type="pos.sale", original_source_id=uuid.uuid4(),
        new_source_type="pos.return", new_source_id=uuid.uuid4(),
        date=dt.date(2026, 7, 2), narration="x")
    assert rev is None


def test_pos_payment_recipe_cash_vs_bank(seeded_shop):
    resolve = _resolve(seeded_shop)
    cash = posting.lines_for_pos_payment(
        SimpleNamespace(amount=Decimal("75.00"), method="cash"), resolve)
    card = posting.lines_for_pos_payment(
        SimpleNamespace(amount=Decimal("75.00"), method="card"), resolve)
    assert cash[0]["account_id"] == posting.resolve(seeded_shop, "cash").id
    assert card[0]["account_id"] == posting.resolve(seeded_shop, "bank").id
    assert cash[1]["account_id"] == posting.resolve(seeded_shop, "debtors").id
    assert sum(l["debit"] for l in cash) == sum(l["credit"] for l in cash) == Decimal("75.00")


def test_refund_recipe_dr_debtors_cr_cash_or_bank(seeded_shop):
    resolve = _resolve(seeded_shop)
    cash = posting.lines_for_refund(
        SimpleNamespace(amount=Decimal("120.00"), method="cash"), resolve)
    upi = posting.lines_for_refund(
        SimpleNamespace(amount=Decimal("120.00"), method="upi"), resolve)
    debtors = posting.resolve(seeded_shop, "debtors").id
    assert next(l for l in cash if l["debit"] > 0)["account_id"] == debtors
    assert next(l for l in cash if l["credit"] > 0)["account_id"] == posting.resolve(seeded_shop, "cash").id
    assert next(l for l in upi if l["credit"] > 0)["account_id"] == posting.resolve(seeded_shop, "bank").id
    assert sum(l["debit"] for l in cash) == sum(l["credit"] for l in cash) == Decimal("120.00")


def test_reverse_event_full_reversal(seeded_shop):
    resolve = _resolve(seeded_shop)
    invoice = SimpleNamespace(
        subtotal=Decimal("1000.00"), discount_amount=Decimal("0.00"),
        cgst=Decimal("90.00"), sgst=Decimal("90.00"), igst=Decimal("0.00"),
        grand_total=Decimal("1180.00"),
    )
    inv_id = uuid.uuid4()
    original = posting.post_event(
        seeded_shop, "billing.invoice", inv_id,
        date=dt.date(2026, 7, 1), narration="INV",
        lines=posting.lines_for_repair_invoice(invoice, resolve))
    # amount=None → full reversal
    rev = posting.reverse_event(
        seeded_shop, original_source_type="billing.invoice", original_source_id=inv_id,
        new_source_type="billing.creditnote", new_source_id=uuid.uuid4(),
        date=dt.date(2026, 7, 2), narration="CN full", amount=None)
    lines = list(rev.lines.all())
    assert sum(l.debit for l in lines) == sum(l.credit for l in lines)
    debtors = posting.resolve(seeded_shop, "debtors")
    assert sum(l.credit for l in lines if l.account_id == debtors.id) == Decimal("1180.00")
    sales = posting.resolve(seeded_shop, "sales")
    assert sum(l.debit for l in lines if l.account_id == sales.id) == Decimal("1000.00")


def test_reverse_event_partial_absorbs_rounding_residue(seeded_shop):
    """Scaling by a non-even fraction leaves a per-cent residue that must be
    absorbed onto the debtors plug leg so the reversal still balances."""
    resolve = _resolve(seeded_shop)
    debtors = posting.resolve(seeded_shop, "debtors")
    sales = posting.resolve(seeded_shop, "sales")
    gst = posting.resolve(seeded_shop, "gst_output")
    # Original total 100.00 with legs that scale unevenly at 0.5.
    inv_id = uuid.uuid4()
    original = posting.post_event(
        seeded_shop, "billing.invoice", inv_id,
        date=dt.date(2026, 7, 1), narration="INV odd",
        lines=[
            {"account_id": debtors.id, "debit": Decimal("100.00"), "credit": Decimal("0.00")},
            {"account_id": sales.id, "debit": Decimal("0.00"), "credit": Decimal("33.33")},
            {"account_id": gst.id, "debit": Decimal("0.00"), "credit": Decimal("66.67")},
        ])
    # Scale by 50/100 = 0.5: sales 16.665→16.67, gst 33.335→33.34 → Σ debit 50.01 vs 50.00
    rev = posting.reverse_event(
        seeded_shop, original_source_type="billing.invoice", original_source_id=inv_id,
        new_source_type="billing.creditnote", new_source_id=uuid.uuid4(),
        date=dt.date(2026, 7, 2), narration="CN partial", amount=Decimal("50.00"))
    lines = list(rev.lines.all())
    total_debit = sum(l.debit for l in lines)
    total_credit = sum(l.credit for l in lines)
    assert total_debit == total_credit  # residue absorbed → still balanced
    # The odd cent landed on the debtors (plug) credit leg.
    assert sum(l.credit for l in lines if l.account_id == debtors.id) == Decimal("50.01")


def test_post_event_reposts_stray_draft(seeded_shop):
    """If a prior attempt left an unposted draft for the key, post_event posts it
    (rather than returning an unposted entry as if it were done)."""
    resolve = _resolve(seeded_shop)
    invoice = SimpleNamespace(
        subtotal=Decimal("100.00"), discount_amount=Decimal("0.00"),
        cgst=Decimal("0.00"), sgst=Decimal("0.00"), igst=Decimal("0.00"),
        grand_total=Decimal("100.00"),
    )
    sid = uuid.uuid4()
    lines = posting.lines_for_repair_invoice(invoice, resolve)
    # Simulate a stray draft from a half-completed prior attempt.
    draft = services.create_journal_entry(seeded_shop, {
        "date": dt.date(2026, 7, 1), "narration": "stray", "lines": lines,
        "source_type": "billing.invoice", "source_id": sid,
    })
    assert not draft.is_posted
    result = posting.post_event(
        seeded_shop, "billing.invoice", sid,
        date=dt.date(2026, 7, 1), narration="INV", lines=lines)
    assert result.id == draft.id
    assert result.is_posted
    assert JournalEntry.objects.filter(
        shop=seeded_shop, source_type="billing.invoice", source_id=sid).count() == 1
