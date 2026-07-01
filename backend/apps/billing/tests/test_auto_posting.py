"""Billing → accounts auto-posting hooks (Phase 8b)."""
from decimal import Decimal

import pytest

from accounts import services as acc_services
from accounts.models import JournalEntry
from accounts.posting import resolve
from billing import services as billing_services


# ──────────────────────────────────────────────────────────────────────────────
# Fixtures — mirrors apps/billing/tests/test_billing.py
# ──────────────────────────────────────────────────────────────────────────────


@pytest.fixture
def shop(db):
    from core.models import Shop
    return Shop.objects.create(
        name="Hotspot Repair", code="HTA",
        address="MG Road", city="Delhi",
        state="Delhi", state_code="07",
        phone="+919876543210",
    )


@pytest.fixture
def customer(db, shop):
    from crm.models import Customer
    return Customer.objects.create(
        shop=shop, name="Intra Customer",
        phone="+919811100001",
        gstin="07AABCU9603R1ZX",  # Delhi state code 07 — intra-state
    )


@pytest.fixture
def user(db):
    from authentication.models import User
    return User.objects.create_user(
        email="tech@ap.com", phone="+919800000005",
        full_name="Tech User", password="pass",
    )


@pytest.fixture
def invoiceable_job(db, shop, customer, user):
    from repair.models import JobTicket
    return JobTicket.objects.create(
        shop=shop,
        customer=customer,
        created_by=user,
        job_number="HTA-2026-AP01",
        device_type="Laptop",
        device_brand="Dell",
        device_model="Inspiron",
        problem_description="Screen broken",
        service_charge=Decimal("500.00"),
        status=JobTicket.Status.READY_FOR_PICKUP,
    )


# ──────────────────────────────────────────────────────────────────────────────
# Invoice
# ──────────────────────────────────────────────────────────────────────────────


def test_invoice_posts_when_accounting_enabled(db, shop, user, invoiceable_job):
    acc_services.seed_default_chart(shop)
    invoice = billing_services.create_repair_invoice(invoiceable_job, {}, user)
    entry = JournalEntry.objects.get(
        shop=shop, source_type="billing.invoice", source_id=invoice.id)
    assert entry.is_posted
    assert entry.lines.get(account=resolve(shop, "debtors")).debit == invoice.grand_total


def test_invoice_skips_when_accounting_disabled(db, shop, user, invoiceable_job):
    invoice = billing_services.create_repair_invoice(invoiceable_job, {}, user)
    assert invoice.id
    assert not JournalEntry.objects.filter(shop=shop, source_type="billing.invoice").exists()


def test_invoice_hook_is_idempotent(db, shop, user, invoiceable_job):
    acc_services.seed_default_chart(shop)
    invoice = billing_services.create_repair_invoice(invoiceable_job, {}, user)
    assert JournalEntry.objects.filter(
        shop=shop, source_type="billing.invoice", source_id=invoice.id).count() == 1


# ──────────────────────────────────────────────────────────────────────────────
# Payment
# ──────────────────────────────────────────────────────────────────────────────


def test_payment_posts_cash_leg(db, shop, user, invoiceable_job):
    acc_services.seed_default_chart(shop)
    invoice = billing_services.create_repair_invoice(invoiceable_job, {}, user)
    pay = billing_services.record_payment(
        invoice, {"amount": str(invoice.grand_total), "method": "cash"}, user)
    entry = JournalEntry.objects.get(shop=shop, source_type="billing.payment", source_id=pay.id)
    assert entry.lines.get(account=resolve(shop, "cash")).debit == invoice.grand_total
    assert entry.lines.get(account=resolve(shop, "debtors")).credit == invoice.grand_total


def test_payment_skips_when_accounting_disabled(db, shop, user, invoiceable_job):
    invoice = billing_services.create_repair_invoice(invoiceable_job, {}, user)
    pay = billing_services.record_payment(
        invoice, {"amount": str(invoice.grand_total), "method": "cash"}, user)
    assert pay.id
    assert not JournalEntry.objects.filter(shop=shop, source_type="billing.payment").exists()


# ──────────────────────────────────────────────────────────────────────────────
# Refund (reverses the payment)
# ──────────────────────────────────────────────────────────────────────────────


def test_refund_reverses_payment(db, shop, user, invoiceable_job):
    acc_services.seed_default_chart(shop)
    invoice = billing_services.create_repair_invoice(invoiceable_job, {}, user)
    billing_services.record_payment(
        invoice, {"amount": str(invoice.grand_total), "method": "cash"}, user)
    refund = billing_services.create_refund(invoice, Decimal("100.00"), "cash", "damaged", user)
    billing_services.approve_refund(refund, user)
    entry = JournalEntry.objects.get(shop=shop, source_type="billing.refund", source_id=refund.id)
    assert entry.lines.get(account=resolve(shop, "debtors")).debit == Decimal("100.00")
    assert entry.lines.get(account=resolve(shop, "cash")).credit == Decimal("100.00")
    line_accounts = {l.account_id for l in entry.lines.all()}
    assert entry.lines.count() == 2
    assert resolve(shop, "sales").id not in line_accounts
    assert resolve(shop, "gst_output").id not in line_accounts


# ──────────────────────────────────────────────────────────────────────────────
# Credit note (reverses the invoice, scaled)
# ──────────────────────────────────────────────────────────────────────────────


def test_credit_note_reverses_invoice_scaled(db, shop, user, invoiceable_job):
    acc_services.seed_default_chart(shop)
    invoice = billing_services.create_repair_invoice(invoiceable_job, {}, user)
    cn = billing_services.create_credit_note(invoice, Decimal("50.00"), "adj", user)
    billing_services.approve_credit_note(cn, user)
    entry = JournalEntry.objects.get(shop=shop, source_type="billing.creditnote", source_id=cn.id)
    assert entry.reverses is not None
    assert entry.reverses.source_type == "billing.invoice"
    assert str(entry.reverses.source_id) == str(invoice.id)
    total_debit = sum(l.debit for l in entry.lines.all())
    total_credit = sum(l.credit for l in entry.lines.all())
    assert total_debit == total_credit
    debtors_credit = entry.lines.get(account=resolve(shop, "debtors")).credit
    assert abs(debtors_credit - Decimal("50.00")) <= Decimal("0.01")
