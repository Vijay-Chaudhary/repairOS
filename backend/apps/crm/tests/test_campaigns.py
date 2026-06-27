"""
CRM — Campaign (bulk-WhatsApp history) tests.
Covers: create (recipient/opt-out counting + send trigger), list, detail, permission.
"""

from unittest.mock import patch

import pytest
from rest_framework import status

URL = "/api/v1/crm/campaigns/"


# ──────────────────────────────────────────────────────────────────────────────
# Fixtures
# ──────────────────────────────────────────────────────────────────────────────


@pytest.fixture
def shop(db):
    from core.models import Shop
    return Shop.objects.create(
        name="Joy Computer", code="JOY",
        address="MG Road", city="Delhi",
        state="Delhi", state_code="07", phone="+919876543210",
    )


@pytest.fixture
def tenant_admin(db):
    from authentication.models import Permission, Role, RolePermission, User, UserRole

    user = User.objects.create_user(
        email="campadmin@joy.com", phone="+919000000070",
        full_name="Campaign Admin", password="AdminPass@8",
    )
    role, _ = Role.objects.get_or_create(name="Tenant Admin", defaults={"is_system_role": True})
    for codename in ["crm.segments.manage", "crm.customers.view"]:
        perm, _ = Permission.objects.get_or_create(
            codename=codename, defaults={"module": "crm", "label": codename}
        )
        RolePermission.objects.get_or_create(role=role, permission=perm)
    UserRole.objects.create(user=user, role=role, shop=None)
    return user


@pytest.fixture
def admin_client(api_client, tenant_admin):
    from authentication.tokens import _build_token_claims
    from rest_framework_simplejwt.tokens import RefreshToken

    refresh = RefreshToken.for_user(tenant_admin)
    access = refresh.access_token
    for key, value in _build_token_claims(tenant_admin, "test").items():
        access[key] = value
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {str(access)}")
    return api_client


def _no_perm_client(shop, email, phone):
    from authentication.models import Permission, Role, RolePermission, User, UserRole
    from authentication.tokens import _build_token_claims
    from rest_framework.test import APIClient
    from rest_framework_simplejwt.tokens import RefreshToken

    user = User.objects.create_user(email=email, phone=phone, full_name="No Perm", password="Pass@123")
    role, _ = Role.objects.get_or_create(name=f"Role_{email[:30]}")
    perm, _ = Permission.objects.get_or_create(
        codename="crm.customers.view", defaults={"module": "crm", "label": "crm.customers.view"}
    )
    RolePermission.objects.get_or_create(role=role, permission=perm)
    UserRole.objects.create(user=user, role=role, shop=shop)

    client = APIClient()
    refresh = RefreshToken.for_user(user)
    access = refresh.access_token
    for k, v in _build_token_claims(user, "test").items():
        access[k] = v
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {str(access)}")
    return client


@pytest.fixture
def segment(db, shop):
    """A dynamic segment matching big spenders: one opted-in, one opted-out."""
    from crm.models import Customer, CustomerSegment
    Customer.objects.create(shop=shop, name="In", phone="+919000300001", total_billed="20000", whatsapp_optout=False)
    Customer.objects.create(shop=shop, name="Out", phone="+919000300002", total_billed="20000", whatsapp_optout=True)
    return CustomerSegment.objects.create(
        name="Big spenders", filter_rules={"min_total_billed": 10000}, is_dynamic=True,
    )


# ──────────────────────────────────────────────────────────────────────────────
# Create
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.django_db
class TestCampaignCreate:
    def test_create_counts_recipients_and_excludes_optout(self, admin_client, segment):
        with patch("crm.tasks.send_bulk_whatsapp_segment.delay") as mock_delay:
            res = admin_client.post(URL, {
                "name": "June promo",
                "segment_id": str(segment.id),
                "template": "promo_june_2026",
            }, format="json")

        assert res.status_code == status.HTTP_201_CREATED
        assert res.data["recipient_count"] == 1
        assert res.data["excluded_optout_count"] == 1
        assert res.data["status"] == "sent"
        assert res.data["sent_at"] is not None
        assert res.data["segment_name"] == "Big spenders"
        assert res.data["template"] == "promo_june_2026"

        # Send task fired with the opted-in recipient only.
        mock_delay.assert_called_once()
        assert len(mock_delay.call_args.kwargs["customer_ids"]) == 1
        assert mock_delay.call_args.kwargs["template_name"] == "promo_june_2026"

    def test_create_persists_campaign(self, admin_client, segment):
        from crm.models import Campaign
        with patch("crm.tasks.send_bulk_whatsapp_segment.delay"):
            admin_client.post(URL, {
                "name": "Persisted", "segment_id": str(segment.id), "template": "t1",
            }, format="json")
        assert Campaign.objects.filter(name="Persisted", recipient_count=1).exists()

    def test_create_unknown_segment_404(self, admin_client):
        import uuid
        res = admin_client.post(URL, {
            "name": "x", "segment_id": str(uuid.uuid4()), "template": "t",
        }, format="json")
        assert res.status_code == status.HTTP_404_NOT_FOUND

    def test_create_requires_segments_manage(self, db, shop, segment):
        client = _no_perm_client(shop, "noperm@c.com", "+919000399001")
        res = client.post(URL, {
            "name": "x", "segment_id": str(segment.id), "template": "t",
        }, format="json")
        assert res.status_code == status.HTTP_403_FORBIDDEN


# ──────────────────────────────────────────────────────────────────────────────
# List / detail
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.django_db
class TestCampaignList:
    def test_lists_newest_first(self, admin_client, segment, tenant_admin):
        from crm.models import Campaign
        c1 = Campaign.objects.create(name="Older", segment=segment, template="t", created_by=tenant_admin)
        c2 = Campaign.objects.create(name="Newer", segment=segment, template="t", created_by=tenant_admin)
        # Force created_at ordering.
        Campaign.objects.filter(pk=c1.pk).update(created_at="2026-01-01T00:00:00Z")
        Campaign.objects.filter(pk=c2.pk).update(created_at="2026-06-01T00:00:00Z")

        res = admin_client.get(URL)
        assert res.status_code == status.HTTP_200_OK
        names = [c["name"] for c in res.data["items"]]
        assert names == ["Newer", "Older"]

    def test_detail(self, admin_client, segment, tenant_admin):
        from crm.models import Campaign
        c = Campaign.objects.create(
            name="Detail", segment=segment, template="t",
            recipient_count=5, excluded_optout_count=2, created_by=tenant_admin,
        )
        res = admin_client.get(f"{URL}{c.id}/")
        assert res.status_code == status.HTTP_200_OK
        assert res.data["name"] == "Detail"
        assert res.data["recipient_count"] == 5
        assert res.data["excluded_optout_count"] == 2
