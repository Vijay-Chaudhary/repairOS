import uuid

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
def test_search_respects_permission_gates(shop, client_with_perms):
    from crm.models import Customer, Lead
    Customer.objects.create(shop=shop, name="Ramesh Kumar", phone="+919811111111")
    Lead.objects.create(shop=shop, name="Ramesh Traders", phone="+919822222222")

    client, _ = client_with_perms(["crm.customers.view"], shop_ids=[shop.id])
    body = client.get("/api/v1/search/?q=Ramesh").json()["data"]
    types = {r["type"] for r in body["results"]}
    assert "customer" in types
    assert "lead" not in types  # caller lacks crm.leads.view
    # result rows carry the standard envelope fields
    row = next(r for r in body["results"] if r["type"] == "customer")
    assert set(row) >= {"type", "id", "label", "route"}

    # short query → empty
    assert client.get("/api/v1/search/?q=R").json()["data"]["results"] == []
