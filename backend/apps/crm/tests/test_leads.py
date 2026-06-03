"""
CRM — Lead tests.
Covers: create, list, status transitions, convert, guard rules.
"""

import pytest
from django.urls import reverse
from rest_framework import status


@pytest.fixture
def shop(db):
    from core.models import Shop
    return Shop.objects.create(
        name="Joy Computer",
        code="JOY",
        address="MG Road",
        city="Delhi",
        state="Uttar Pradesh",
        state_code="09",
        phone="+919876543210",
    )


@pytest.fixture
def tenant_admin(db):
    from authentication.models import Permission, Role, RolePermission, User, UserRole

    user = User.objects.create_user(
        email="admin@joy.com",
        phone="+919000000001",
        full_name="Admin User",
        password="AdminPass@1",
    )
    role, _ = Role.objects.get_or_create(name="Tenant Admin", defaults={"is_system_role": True})

    # Grant all CRM permissions
    crm_perms = [
        "crm.leads.view", "crm.leads.create", "crm.leads.edit", "crm.leads.convert",
        "crm.customers.view", "crm.customers.create", "crm.customers.edit",
        "crm.customers.merge", "crm.communications.log",
        "crm.tasks.manage", "crm.segments.manage",
    ]
    for codename in crm_perms:
        perm, _ = Permission.objects.get_or_create(
            codename=codename,
            defaults={"module": "crm", "label": codename},
        )
        RolePermission.objects.get_or_create(role=role, permission=perm)

    UserRole.objects.create(user=user, role=role, shop=None)  # tenant-wide
    return user


@pytest.fixture
def admin_client(api_client, tenant_admin):
    from authentication.tokens import _build_token_claims
    from rest_framework_simplejwt.tokens import RefreshToken

    refresh = RefreshToken.for_user(tenant_admin)
    access = refresh.access_token  # property creates a new instance each call
    extra = _build_token_claims(tenant_admin, "test")
    for key, value in extra.items():
        access[key] = value

    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {str(access)}")
    return api_client


@pytest.fixture
def lead(db, shop, tenant_admin):
    from crm.models import Lead
    return Lead.objects.create(
        shop=shop,
        name="Ravi Kumar",
        phone="+919812345678",
        source=Lead.Source.WALK_IN,
        status=Lead.Status.NEW,
    )


# ──────────────────────────────────────────────────────────────────────────────
# List / create
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.django_db
class TestLeadCreate:
    url = "/api/v1/crm/leads/"

    def test_create_lead(self, admin_client, shop):
        res = admin_client.post(self.url, {
            "shop_id": str(shop.id),
            "name": "New Lead",
            "phone": "+919999000001",
            "source": "whatsapp",
        }, format="json")
        assert res.status_code == status.HTTP_201_CREATED
        assert res.data["name"] == "New Lead"
        assert res.data["status"] == "new"

    def test_create_requires_auth(self, api_client, shop):
        res = api_client.post(self.url, {"name": "x", "phone": "+91999"})
        assert res.status_code == status.HTTP_401_UNAUTHORIZED

    def test_invalid_phone_format(self, admin_client, shop):
        res = admin_client.post(self.url, {
            "shop_id": str(shop.id),
            "name": "Bad Phone",
            "phone": "9812345678",  # missing +
            "source": "walk_in",
        }, format="json")
        assert res.status_code == status.HTTP_400_BAD_REQUEST

    def test_list_leads(self, admin_client, lead):
        res = admin_client.get(self.url)
        assert res.status_code == status.HTTP_200_OK
        assert len(res.data["data"]) >= 1

    def test_filter_by_status(self, admin_client, lead):
        res = admin_client.get(self.url + "?status=new")
        assert res.status_code == status.HTTP_200_OK
        for item in res.data["data"]:
            assert item["status"] == "new"


# ──────────────────────────────────────────────────────────────────────────────
# Status transitions
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.django_db
class TestLeadStatusTransition:
    def _status_url(self, lead_id):
        return f"/api/v1/crm/leads/{lead_id}/status/"

    def test_valid_transition_new_to_contacted(self, admin_client, lead):
        res = admin_client.post(
            self._status_url(lead.id),
            {"to_status": "contacted"},
            format="json",
        )
        assert res.status_code == status.HTTP_200_OK
        assert res.data["status"] == "contacted"

    def test_invalid_transition_raises_400(self, admin_client, lead):
        res = admin_client.post(
            self._status_url(lead.id),
            {"to_status": "converted"},  # new → converted is not allowed
            format="json",
        )
        assert res.status_code == status.HTTP_400_BAD_REQUEST
        assert res.json()["error"]["code"] == "INVALID_STATUS_TRANSITION"

    def test_lost_requires_reason(self, admin_client, shop):
        from crm.models import Lead
        lead = Lead.objects.create(
            shop=shop, name="X", phone="+919000000099",
            source=Lead.Source.OTHER, status=Lead.Status.QUOTED,
        )
        res = admin_client.post(
            self._status_url(lead.id),
            {"to_status": "lost"},  # missing reason
            format="json",
        )
        assert res.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY

    def test_lost_with_reason_succeeds(self, admin_client, shop):
        from crm.models import Lead
        lead = Lead.objects.create(
            shop=shop, name="X", phone="+919000000098",
            source=Lead.Source.OTHER, status=Lead.Status.QUOTED,
        )
        res = admin_client.post(
            self._status_url(lead.id),
            {"to_status": "lost", "reason": "Budget constraint"},
            format="json",
        )
        assert res.status_code == status.HTTP_200_OK
        assert res.data["status"] == "lost"


# ──────────────────────────────────────────────────────────────────────────────
# Convert lead
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.django_db
class TestLeadConvert:
    def _convert_url(self, lead_id):
        return f"/api/v1/crm/leads/{lead_id}/convert/"

    def _advance_to_quoted(self, lead):
        from crm.services import transition_lead
        from authentication.models import User
        user = User.objects.first()
        lead = transition_lead(lead, "contacted", user)
        lead = transition_lead(lead, "interested", user)
        lead = transition_lead(lead, "quoted", user)
        return lead

    def test_convert_creates_customer(self, admin_client, lead):
        from crm.models import Customer
        lead = self._advance_to_quoted(lead)
        res = admin_client.post(self._convert_url(lead.id), format="json")
        assert res.status_code == status.HTTP_200_OK
        assert Customer.objects.filter(phone=lead.phone).exists()

    def test_convert_is_idempotent(self, admin_client, lead):
        from crm.models import Customer
        lead = self._advance_to_quoted(lead)
        admin_client.post(self._convert_url(lead.id), format="json")
        admin_client.post(self._convert_url(lead.id), format="json")
        # Should still be only one customer with this phone
        assert Customer.objects.filter(phone=lead.phone).count() == 1

    def test_convert_links_source_lead(self, admin_client, lead):
        from crm.models import Customer
        lead = self._advance_to_quoted(lead)
        admin_client.post(self._convert_url(lead.id), format="json")
        customer = Customer.objects.get(phone=lead.phone)
        assert customer.source_lead_id == lead.id
