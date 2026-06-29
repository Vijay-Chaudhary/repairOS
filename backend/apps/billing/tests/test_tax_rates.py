"""Settings › Taxes — TaxRate master CRUD, gated on settings.taxes.manage."""
import uuid
from decimal import Decimal

import pytest
from rest_framework import status


@pytest.fixture
def shop(db):
    from core.models import Shop
    return Shop.objects.create(
        name="Hotspot Repair", code="HTA", address="MG Road",
        city="Delhi", state="Delhi", state_code="07", phone="+919876543210",
    )


@pytest.fixture
def client_with_perms(db):
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


@pytest.mark.django_db
def test_seeded_slabs_present(db):
    from billing.models import TaxRate
    names = set(TaxRate.objects.values_list("name", flat=True))
    assert {"GST 0%", "GST 5%", "GST 12%", "GST 18%", "GST 28%"} <= names


@pytest.mark.django_db
def test_create_list_update_deactivate(shop, client_with_perms):
    client = client_with_perms(shop, ["settings.taxes.manage"])

    resp = client.post("/api/v1/billing/tax-rates/", {
        "name": "GST 3% (gold)", "rate": "3.00", "tax_type": "gst",
    }, format="json")
    assert resp.status_code == status.HTTP_201_CREATED
    rate_id = resp.json()["data"]["id"]

    resp = client.get("/api/v1/billing/tax-rates/")
    assert resp.status_code == status.HTTP_200_OK
    assert any(r["name"] == "GST 3% (gold)" for r in resp.json()["data"])

    resp = client.patch(f"/api/v1/billing/tax-rates/{rate_id}/", {"rate": "3.50"}, format="json")
    assert resp.status_code == status.HTTP_200_OK
    assert Decimal(resp.json()["data"]["rate"]) == Decimal("3.50")

    resp = client.delete(f"/api/v1/billing/tax-rates/{rate_id}/")
    assert resp.status_code == status.HTTP_204_NO_CONTENT
    from billing.models import TaxRate
    assert TaxRate.objects.get(id=rate_id).is_active is False


@pytest.mark.django_db
def test_rate_validation_and_permission(shop, client_with_perms):
    client = client_with_perms(shop, ["settings.taxes.manage"])
    resp = client.post("/api/v1/billing/tax-rates/", {
        "name": "Bad", "rate": "150.00", "tax_type": "gst",
    }, format="json")
    assert resp.status_code == status.HTTP_400_BAD_REQUEST

    nope = client_with_perms(shop, [])
    assert nope.get("/api/v1/billing/tax-rates/").status_code == status.HTTP_403_FORBIDDEN
