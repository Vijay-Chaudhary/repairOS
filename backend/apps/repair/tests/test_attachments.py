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
    cust = Customer.objects.create(shop=shop, name="C", phone=f"+9198{uuid.uuid4().int % 100000000:08d}")
    creator = User.objects.create_user(email=f"j{uuid.uuid4().hex[:6]}@t.com",
                                       phone=f"+9197{uuid.uuid4().int % 100000000:08d}", full_name="J", password="p")
    return JobTicket.objects.create(shop=shop, customer=cust, created_by=creator, job_number=f"HTA-{uuid.uuid4().hex[:6]}",
                                    device_type="Laptop", device_brand="Dell", device_model="X",
                                    problem_description="p", service_charge=Decimal("100"),
                                    status=JobTicket.Status.OPEN, **kw)


@pytest.mark.django_db
def test_attachment_persist_and_list(shop, client_with_perms):
    job = make_job(shop)
    # assign_tech → manager sees all shop jobs (not just own) so get_object resolves.
    editor, _ = client_with_perms(["repair.jobs.edit", "repair.jobs.view", "repair.jobs.assign_tech"], shop_ids=[shop.id])

    resp = editor.post(f"/api/v1/repair/jobs/{job.id}/attachments/",
                       {"url": "s3://bucket/a.jpg", "filename": "a.jpg", "kind": "before"}, format="json")
    assert resp.status_code == status.HTTP_201_CREATED, resp.content

    resp = editor.get(f"/api/v1/repair/jobs/{job.id}/attachments/")
    assert resp.status_code == status.HTTP_200_OK
    items = resp.json()["data"]
    assert any(a["filename"] == "a.jpg" and a["kind"] == "before" for a in items)


@pytest.mark.django_db
def test_attachment_create_requires_edit(shop, client_with_perms):
    job = make_job(shop)
    viewer, _ = client_with_perms(["repair.jobs.view"], shop_ids=[shop.id])
    resp = viewer.post(f"/api/v1/repair/jobs/{job.id}/attachments/", {"url": "x"}, format="json")
    assert resp.status_code == status.HTTP_403_FORBIDDEN
