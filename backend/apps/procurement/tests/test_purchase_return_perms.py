"""Purchase returns list is reachable with erp.purchase_returns.view (nav slug)."""
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

    def _make(shop, perms):
        user = User.objects.create_user(email=f"u{uuid.uuid4().hex[:8]}@t.com",
                                        phone=f"+9190{uuid.uuid4().int % 100000000:08d}",
                                        full_name="T", password="Pass@123")
        access = RefreshToken.for_user(user).access_token
        access["permissions"] = perms
        access["shop_ids"] = [str(shop.id)]
        c = APIClient(); c.credentials(HTTP_AUTHORIZATION=f"Bearer {str(access)}")
        return c
    return _make


@pytest.mark.django_db
def test_purchase_returns_list_view_permission(shop, client_with_perms):
    viewer = client_with_perms(shop, ["erp.purchase_returns.view"])
    assert viewer.get("/api/v1/procurement/purchase-returns/").status_code == status.HTTP_200_OK

    nope = client_with_perms(shop, [])
    assert nope.get("/api/v1/procurement/purchase-returns/").status_code == status.HTTP_403_FORBIDDEN
