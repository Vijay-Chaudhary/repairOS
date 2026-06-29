"""Billing › Refunds — approval adjusts invoice paid/outstanding."""
import uuid
from decimal import Decimal

import pytest
from rest_framework import status


@pytest.fixture
def shop(db):
    from core.models import Shop
    return Shop.objects.create(name="Hotspot Repair", code="HTA", address="MG Road",
                               city="Delhi", state="Delhi", state_code="07", phone="+919876543210")


@pytest.fixture
def customer(db, shop):
    from crm.models import Customer
    return Customer.objects.create(shop=shop, name="Asha", phone="+919811111111")


@pytest.fixture
def tech_user(db):
    from authentication.models import User
    return User.objects.create_user(email="tech@rf.com", phone="+919800000002",
                                    full_name="Tech User", password="pass")


@pytest.fixture
def client_with_perms(db):
    from authentication.models import User
    from rest_framework.test import APIClient
    from rest_framework_simplejwt.tokens import RefreshToken

    def _make(shop, perms):
        suffix = uuid.uuid4().hex[:8]
        user = User.objects.create_user(email=f"u{suffix}@t.com",
                                        phone=f"+9190{uuid.uuid4().int % 100000000:08d}",
                                        full_name="Tester", password="Pass@123")
        access = RefreshToken.for_user(user).access_token
        access["permissions"] = perms
        access["shop_ids"] = [str(shop.id)]
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {str(access)}")
        return client
    return _make


def _job_invoice(shop, customer, tech_user, *, number, paid, outstanding, status_val="partially_paid"):
    from billing.models import RepairInvoice
    from repair.models import JobTicket
    job = JobTicket.objects.create(
        shop=shop, customer=customer, created_by=tech_user, job_number=f"HTA-{uuid.uuid4().hex[:6]}",
        device_type="Laptop", device_brand="Dell", device_model="X",
        problem_description="p", service_charge=Decimal("1000"), status=JobTicket.Status.READY_FOR_PICKUP,
    )
    return RepairInvoice.objects.create(
        shop=shop, job=job, customer=customer, invoice_number=number, status=status_val,
        subtotal=Decimal("1000"), grand_total=Decimal("1000"),
        amount_paid=Decimal(paid), amount_outstanding=Decimal(outstanding),
    )


@pytest.mark.django_db
def test_refund_approve_adjusts_paid_and_outstanding(shop, customer, tech_user, client_with_perms):
    inv = _job_invoice(shop, customer, tech_user, number="INV-RF1", paid="1000", outstanding="0", status_val="paid")
    client = client_with_perms(shop, ["billing.refunds.view", "billing.refunds.create", "billing.refunds.approve"])

    cn = client.post("/api/v1/billing/refunds/", {"invoice_id": str(inv.id), "amount": "300", "method": "cash", "reason": "Overpaid"}, format="json")
    assert cn.status_code == status.HTTP_201_CREATED, cn.content
    rid = cn.json()["data"]["id"]

    resp = client.post(f"/api/v1/billing/refunds/{rid}/approve/")
    assert resp.status_code == status.HTTP_200_OK
    inv.refresh_from_db()
    assert inv.amount_paid == Decimal("700")
    assert inv.amount_outstanding == Decimal("300")
    assert inv.status == "partially_paid"


@pytest.mark.django_db
def test_refund_over_paid_rejected(shop, customer, tech_user, client_with_perms):
    inv = _job_invoice(shop, customer, tech_user, number="INV-RF2", paid="100", outstanding="900")
    client = client_with_perms(shop, ["billing.refunds.create", "billing.refunds.approve"])
    r = client.post("/api/v1/billing/refunds/", {"invoice_id": str(inv.id), "amount": "500", "method": "cash"}, format="json")
    rid = r.json()["data"]["id"]
    assert client.post(f"/api/v1/billing/refunds/{rid}/approve/").status_code == status.HTTP_400_BAD_REQUEST
