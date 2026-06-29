"""Billing › Outstanding — aging report over RepairInvoice with amount_outstanding > 0."""
import uuid
from datetime import timedelta
from decimal import Decimal

import pytest
from django.utils import timezone
from rest_framework import status


@pytest.fixture
def shop(db):
    from core.models import Shop
    return Shop.objects.create(
        name="Hotspot Repair", code="HTA", address="MG Road",
        city="Delhi", state="Delhi", state_code="07", phone="+919876543210",
    )


@pytest.fixture
def customer(db, shop):
    from crm.models import Customer
    return Customer.objects.create(shop=shop, name="Asha", phone="+919811111111")


@pytest.fixture
def tech_user(db):
    from authentication.models import User
    return User.objects.create_user(
        email="tech@out.com", phone="+919800000001",
        full_name="Tech User", password="pass",
    )


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


def _job_invoice(shop, customer, tech_user, *, number, outstanding, due_offset_days, status_val):
    from billing.models import RepairInvoice
    from repair.models import JobTicket
    job = JobTicket.objects.create(
        shop=shop, customer=customer, created_by=tech_user,
        job_number=f"HTA-2026-{uuid.uuid4().hex[:6]}",
        device_type="Laptop", device_brand="Dell", device_model="Inspiron",
        problem_description="Screen broken", service_charge=Decimal("500.00"),
        status=JobTicket.Status.READY_FOR_PICKUP,
    )
    today = timezone.now().date()
    return RepairInvoice.objects.create(
        shop=shop, job=job, customer=customer, invoice_number=number, status=status_val,
        subtotal=Decimal("1000"), grand_total=Decimal("1000"),
        amount_paid=Decimal("1000") - Decimal(outstanding),
        amount_outstanding=Decimal(outstanding),
        due_date=today + timedelta(days=due_offset_days),
    )


@pytest.mark.django_db
def test_outstanding_lists_only_unpaid_with_aging(shop, customer, tech_user, client_with_perms):
    # 3 unpaid: not-due (current), 15d overdue (1-30), 75d overdue (61-90)
    _job_invoice(shop, customer, tech_user, number="INV-1", outstanding="200", due_offset_days=10, status_val="partially_paid")
    _job_invoice(shop, customer, tech_user, number="INV-2", outstanding="300", due_offset_days=-15, status_val="issued")
    _job_invoice(shop, customer, tech_user, number="INV-3", outstanding="500", due_offset_days=-75, status_val="partially_paid")
    # paid invoice must be excluded
    _job_invoice(shop, customer, tech_user, number="INV-4", outstanding="0", due_offset_days=-5, status_val="paid")

    client = client_with_perms(shop, ["billing.outstanding.view"])
    resp = client.get("/api/v1/billing/outstanding/")
    assert resp.status_code == status.HTTP_200_OK
    # Responses are wrapped in a {"success", "data"} envelope by the project renderer.
    body = resp.json()["data"]
    assert body["summary"]["invoice_count"] == 3
    assert Decimal(body["summary"]["total_outstanding"]) == Decimal("1000")
    assert Decimal(body["summary"]["buckets"]["current"]) == Decimal("200")
    assert Decimal(body["summary"]["buckets"]["1-30"]) == Decimal("300")
    assert Decimal(body["summary"]["buckets"]["61-90"]) == Decimal("500")
    numbers = {r["invoice_number"] for r in body["results"]}
    assert numbers == {"INV-1", "INV-2", "INV-3"}


@pytest.mark.django_db
def test_outstanding_requires_permission(shop, client_with_perms):
    client = client_with_perms(shop, [])  # empty claim → DB fallback → no roles → 403
    resp = client.get("/api/v1/billing/outstanding/")
    assert resp.status_code == status.HTTP_403_FORBIDDEN
