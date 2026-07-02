"""Phase 8b integration — full cycle balances; atomic rollback on misconfig."""
from decimal import Decimal

import pytest

from accounts import services as acc_services
from accounts.models import AccountMapping, JournalEntry
from accounts.services import trial_balance
from billing import services as billing_services
from core.exceptions import BusinessRuleViolation


# ──────────────────────────────────────────────────────────────────────────────
# Fixtures — mirrors apps/billing/tests/test_auto_posting.py
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
# Full cycle → trial balance still balances
# ──────────────────────────────────────────────────────────────────────────────


def test_full_cycle_trial_balance_balances(db, shop, user, invoiceable_job):
    acc_services.seed_default_chart(shop)
    invoice = billing_services.create_repair_invoice(invoiceable_job, {}, user)
    # Partial payment leaves an outstanding balance for the credit note to reduce.
    billing_services.record_payment(
        invoice, {"amount": "100.00", "method": "cash"}, user)
    cn = billing_services.create_credit_note(invoice, Decimal("50.00"), "adj", user)
    billing_services.approve_credit_note(cn, user)

    tb = trial_balance(shop)  # 8a service: per-account debit/credit totals
    assert tb["total_debit"] == tb["total_credit"]  # books balance after invoice+payment+CN
    assert tb["total_debit"] > Decimal("0.00")  # entries actually posted


# ──────────────────────────────────────────────────────────────────────────────
# Missing mapping while accounting is enabled → whole event rolls back
# ──────────────────────────────────────────────────────────────────────────────


def test_missing_mapping_rolls_back_the_whole_event(db, shop, user, invoiceable_job):
    acc_services.seed_default_chart(shop)
    AccountMapping.objects.filter(shop=shop, key="debtors").delete()  # enabled but misconfigured
    from billing.models import RepairInvoice
    with pytest.raises(BusinessRuleViolation):
        billing_services.create_repair_invoice(invoiceable_job, {}, user)
    # The invoice was NOT persisted — posting failure rolled back the business op.
    assert not RepairInvoice.objects.filter(job=invoiceable_job).exists()
    assert not JournalEntry.objects.filter(shop=shop, source_type="billing.invoice").exists()
