import uuid
from decimal import Decimal

import pytest
from rest_framework import status


@pytest.fixture
def shop(db):
    from core.models import Shop
    return Shop.objects.create(name="S", code="HTA", address="a", city="Delhi",
                               state="Delhi", state_code="07", phone="+919876543210")


@pytest.fixture
def client_with_perms(db):
    from authentication.models import User
    from rest_framework.test import APIClient
    from rest_framework_simplejwt.tokens import RefreshToken

    def _make(perms, shop_ids=None):
        s = uuid.uuid4().hex[:8]
        user = User.objects.create_user(email=f"u{s}@t.com", phone=f"+9190{uuid.uuid4().int % 100000000:08d}",
                                        full_name="T", password="Pass@123")
        access = RefreshToken.for_user(user).access_token
        access["permissions"] = perms
        if shop_ids is not None:
            access["shop_ids"] = [str(x) for x in shop_ids]
        c = APIClient(); c.credentials(HTTP_AUTHORIZATION=f"Bearer {str(access)}")
        return c, user
    return _make


def make_job(shop, **kw):
    from authentication.models import User
    from crm.models import Customer
    from repair.models import JobTicket
    cust = kw.pop("customer", None) or Customer.objects.create(shop=shop, name="C", phone=f"+9198{uuid.uuid4().int % 100000000:08d}")
    creator = kw.pop("created_by", None) or User.objects.create_user(
        email=f"j{uuid.uuid4().hex[:6]}@t.com", phone=f"+9197{uuid.uuid4().int % 100000000:08d}", full_name="J", password="p")
    defaults = dict(shop=shop, customer=cust, created_by=creator, job_number=f"HTA-{uuid.uuid4().hex[:6]}",
                    device_type="Laptop", device_brand="Dell", device_model="X",
                    problem_description="p", service_charge=Decimal("100"), status=JobTicket.Status.OPEN)
    defaults.update(kw)
    return JobTicket.objects.create(**defaults)


def _estimate(job, **kw):
    from repair.models import JobEstimate
    defaults = dict(estimate_number=f"EST-{uuid.uuid4().hex[:6]}", labor_charge=Decimal("100"),
                    parts_cost=Decimal("0"), total_estimate=Decimal("100"), status="sent")
    defaults.update(kw)
    return JobEstimate.objects.create(job=job, **defaults)


@pytest.mark.django_db
def test_estimates_worklist_lists_with_job_and_customer(shop, client_with_perms):
    job = make_job(shop)
    _estimate(job)
    client, _ = client_with_perms(["repair.estimates.view"], shop_ids=[shop.id])
    resp = client.get("/api/v1/repair/estimates/")
    assert resp.status_code == status.HTTP_200_OK
    items = resp.json()["data"]["items"]
    assert items and items[0]["job_number"] == job.job_number
    assert "customer_name" in items[0]


@pytest.mark.django_db
def test_estimates_worklist_status_filter_and_permission(shop, client_with_perms):
    job = make_job(shop)
    _estimate(job, status="sent")
    _estimate(job, status="approved")
    client, _ = client_with_perms(["repair.estimates.view"], shop_ids=[shop.id])
    resp = client.get("/api/v1/repair/estimates/?status=approved")
    nums = {i["status"] for i in resp.json()["data"]["items"]}
    assert nums == {"approved"}

    nope, _ = client_with_perms([], shop_ids=[shop.id])
    assert nope.get("/api/v1/repair/estimates/").status_code == status.HTTP_403_FORBIDDEN
