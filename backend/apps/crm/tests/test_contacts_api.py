import uuid

import pytest
from rest_framework import status


@pytest.fixture
def shop(db):
    from core.models import Shop
    return Shop.objects.create(name="S", code="HTA", address="a", city="Delhi",
                               state="Delhi", state_code="07", phone="+919876543210")


@pytest.fixture
def customer(db, shop):
    from crm.models import Customer
    return Customer.objects.create(shop=shop, name="Acme", phone="+919811111111")


@pytest.fixture
def client_with_perms(db):
    from authentication.models import User
    from rest_framework.test import APIClient
    from rest_framework_simplejwt.tokens import RefreshToken

    def _make(perms, shop_ids=None):
        suffix = uuid.uuid4().hex[:8]
        user = User.objects.create_user(
            email=f"u{suffix}@t.com", phone=f"+9190{uuid.uuid4().int % 100000000:08d}",
            full_name="Tester", password="Pass@123",
        )
        refresh = RefreshToken.for_user(user)
        access = refresh.access_token
        access["permissions"] = perms
        if shop_ids is not None:
            access["shop_ids"] = [str(s) for s in shop_ids]
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {str(access)}")
        return client, user

    return _make


@pytest.mark.django_db
def test_contact_crud_and_scoping(shop, customer, client_with_perms):
    client, _ = client_with_perms(
        ["crm.contacts.view", "crm.contacts.create", "crm.contacts.edit"], shop_ids=[shop.id])

    resp = client.post("/api/v1/crm/contacts/", {
        "customer_id": str(customer.id), "name": "Asha", "designation": "Owner",
        "email": "a@acme.com", "phone": "+919822222222", "is_primary": True,
    }, format="json")
    assert resp.status_code == status.HTTP_201_CREATED, resp.content
    cid = resp.json()["data"]["id"]

    resp = client.get(f"/api/v1/crm/contacts/?customer_id={customer.id}")
    assert resp.status_code == status.HTTP_200_OK
    assert any(c["name"] == "Asha" for c in resp.json()["data"]["items"])

    resp = client.patch(f"/api/v1/crm/contacts/{cid}/", {"designation": "Director"}, format="json")
    assert resp.status_code == status.HTTP_200_OK
    assert resp.json()["data"]["designation"] == "Director"


@pytest.mark.django_db
def test_contact_requires_permission(shop, customer, client_with_perms):
    client, _ = client_with_perms([], shop_ids=[shop.id])
    assert client.get("/api/v1/crm/contacts/").status_code == status.HTTP_403_FORBIDDEN
