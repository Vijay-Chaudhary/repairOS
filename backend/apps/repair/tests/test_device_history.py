import uuid
from decimal import Decimal

import pytest


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


@pytest.mark.django_db
def test_device_history_matches_serial_and_imei(shop, client_with_perms):
    make_job(shop, serial_number="SN-123", job_number="HTA-A")
    make_job(shop, imei="IMEI-999", job_number="HTA-B")
    client, _ = client_with_perms(["repair.jobs.view"], shop_ids=[shop.id])

    by_serial = client.get("/api/v1/repair/device-history/?serial=SN-123").json()["data"]["items"]
    assert {r["job_number"] for r in by_serial} == {"HTA-A"}

    by_imei = client.get("/api/v1/repair/device-history/?imei=IMEI-999").json()["data"]["items"]
    assert {r["job_number"] for r in by_imei} == {"HTA-B"}

    assert client.get("/api/v1/repair/device-history/").json()["data"]["items"] == []
