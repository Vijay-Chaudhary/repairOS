"""Billing › Credit Notes — approval reduces the invoice outstanding."""
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
    return User.objects.create_user(email="tech@cn.com", phone="+919800000001",
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
def test_credit_note_create_and_approve_reduces_outstanding(shop, customer, tech_user, client_with_perms):
    inv = _job_invoice(shop, customer, tech_user, number="INV-CN1", paid="600", outstanding="400")
    client = client_with_perms(shop, ["billing.credit_notes.view", "billing.credit_notes.create", "billing.credit_notes.approve"])

    resp = client.post("/api/v1/billing/credit-notes/", {
        "invoice_id": str(inv.id), "amount": "150", "reason": "Returned part",
    }, format="json")
    assert resp.status_code == status.HTTP_201_CREATED, resp.content
    cn_id = resp.json()["data"]["id"]
    assert resp.json()["data"]["status"] == "pending"

    resp = client.post(f"/api/v1/billing/credit-notes/{cn_id}/approve/")
    assert resp.status_code == status.HTTP_200_OK
    assert resp.json()["data"]["status"] == "approved"
    inv.refresh_from_db()
    assert inv.amount_outstanding == Decimal("250")


@pytest.mark.django_db
def test_credit_note_over_outstanding_rejected_and_perms(shop, customer, tech_user, client_with_perms):
    inv = _job_invoice(shop, customer, tech_user, number="INV-CN2", paid="900", outstanding="100")
    client = client_with_perms(shop, ["billing.credit_notes.create", "billing.credit_notes.approve"])
    cn = client.post("/api/v1/billing/credit-notes/", {"invoice_id": str(inv.id), "amount": "500", "reason": "x"}, format="json")
    cn_id = cn.json()["data"]["id"]
    resp = client.post(f"/api/v1/billing/credit-notes/{cn_id}/approve/")
    assert resp.status_code == status.HTTP_400_BAD_REQUEST

    nope = client_with_perms(shop, [])
    assert nope.get("/api/v1/billing/credit-notes/").status_code == status.HTTP_403_FORBIDDEN
