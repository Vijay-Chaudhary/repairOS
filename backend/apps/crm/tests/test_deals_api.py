import uuid

import pytest
from rest_framework import status

ALL = ["crm.deals.view", "crm.deals.create", "crm.deals.edit", "crm.deals.change_stage", "crm.deals.close"]


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
def test_deal_crud_stage_and_close(shop, client_with_perms):
    client, _ = client_with_perms(ALL, shop_ids=[shop.id])

    resp = client.post("/api/v1/crm/deals/", {
        "shop": str(shop.id), "title": "Acme upgrade", "expected_revenue": "50000", "probability": 40,
    }, format="json")
    assert resp.status_code == status.HTTP_201_CREATED, resp.content
    did = resp.json()["data"]["id"]

    # legal stage move (open → open)
    resp = client.post(f"/api/v1/crm/deals/{did}/stage/", {"to_stage": "proposal"}, format="json")
    assert resp.status_code == status.HTTP_200_OK
    assert resp.json()["data"]["stage"] == "proposal"

    # illegal stage move (→ won via stage endpoint) rejected
    resp = client.post(f"/api/v1/crm/deals/{did}/stage/", {"to_stage": "won"}, format="json")
    assert resp.status_code == status.HTTP_400_BAD_REQUEST

    # close as lost requires a reason
    assert client.post(f"/api/v1/crm/deals/{did}/close/", {"outcome": "lost"}, format="json").status_code == status.HTTP_400_BAD_REQUEST
    resp = client.post(f"/api/v1/crm/deals/{did}/close/", {"outcome": "lost", "reason": "Budget"}, format="json")
    assert resp.status_code == status.HTTP_200_OK
    body = resp.json()["data"]
    assert body["stage"] == "lost" and body["lost_reason"] == "Budget" and body["closed_at"]


@pytest.mark.django_db
def test_deal_requires_permission(shop, client_with_perms):
    client, _ = client_with_perms([], shop_ids=[shop.id])
    assert client.get("/api/v1/crm/deals/").status_code == status.HTTP_403_FORBIDDEN
