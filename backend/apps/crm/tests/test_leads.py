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
        assert len(res.data["items"]) >= 1

    def test_filter_by_status(self, admin_client, lead):
        res = admin_client.get(self.url + "?status=new")
        assert res.status_code == status.HTTP_200_OK
        for item in res.data["items"]:
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
        assert res.data["status_before_lost"] == "quoted"


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


# ──────────────────────────────────────────────────────────────────────────────
# Shared helpers for isolation / RBAC tests
# ──────────────────────────────────────────────────────────────────────────────


@pytest.fixture
def shop_a(db):
    from core.models import Shop
    return Shop.objects.create(
        name="Shop Alpha", code="ALPHA",
        address="Alpha Road", city="Delhi",
        state="Delhi", state_code="07",
        phone="+919700100001",
    )


@pytest.fixture
def shop_b(db):
    from core.models import Shop
    return Shop.objects.create(
        name="Shop Beta", code="BETA",
        address="Beta Road", city="Mumbai",
        state="Maharashtra", state_code="27",
        phone="+919700100002",
    )


def _make_scoped_client(shop, email, phone, permission_codenames):
    """Return an APIClient authenticated as a shop-specific (non-tenant-wide) user."""
    from authentication.models import Permission, Role, RolePermission, User, UserRole
    from authentication.tokens import _build_token_claims
    from rest_framework.test import APIClient
    from rest_framework_simplejwt.tokens import RefreshToken

    user = User.objects.create_user(
        email=email, phone=phone, full_name="Scoped User", password="Pass@123",
    )
    role_name = f"Role_{email[:30]}"
    role, _ = Role.objects.get_or_create(name=role_name)
    for codename in permission_codenames:
        perm, _ = Permission.objects.get_or_create(
            codename=codename,
            defaults={"module": codename.split(".")[0], "label": codename},
        )
        RolePermission.objects.get_or_create(role=role, permission=perm)
    UserRole.objects.create(user=user, role=role, shop=shop)  # shop-specific → is_tenant_wide=False

    client = APIClient()
    refresh = RefreshToken.for_user(user)
    access = refresh.access_token
    for k, v in _build_token_claims(user, "test").items():
        access[k] = v
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {str(access)}")
    return client


# ──────────────────────────────────────────────────────────────────────────────
# Validation
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.django_db
class TestLeadValidation:
    url = "/api/v1/crm/leads/"

    def test_missing_name_returns_400(self, admin_client, shop):
        res = admin_client.post(self.url, {
            "shop_id": str(shop.id),
            "phone": "+919999000011",
            "source": "walk_in",
        }, format="json")
        assert res.status_code == status.HTTP_400_BAD_REQUEST

    def test_missing_phone_returns_400(self, admin_client, shop):
        res = admin_client.post(self.url, {
            "shop_id": str(shop.id),
            "name": "No Phone Lead",
            "source": "walk_in",
        }, format="json")
        assert res.status_code == status.HTTP_400_BAD_REQUEST

    def test_duplicate_phone_returns_400(self, admin_client, shop, lead):
        res = admin_client.post(self.url, {
            "shop_id": str(shop.id),
            "name": "Duplicate Phone",
            "phone": lead.phone,
            "source": "walk_in",
        }, format="json")
        assert res.status_code == status.HTTP_400_BAD_REQUEST
        assert res.json()["error"]["code"] == "DUPLICATE_PHONE"

    def test_valid_e164_accepted(self, admin_client, shop):
        res = admin_client.post(self.url, {
            "shop_id": str(shop.id),
            "name": "US Lead",
            "phone": "+14155551234",
            "source": "google",
        }, format="json")
        assert res.status_code == status.HTTP_201_CREATED


# ──────────────────────────────────────────────────────────────────────────────
# Retrieve / partial update
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.django_db
class TestLeadRetrievePatch:
    def test_retrieve_lead(self, admin_client, lead):
        res = admin_client.get(f"/api/v1/crm/leads/{lead.id}/")
        assert res.status_code == status.HTTP_200_OK
        assert res.data["id"] == str(lead.id)
        assert res.data["name"] == lead.name
        assert res.data["status"] == "new"

    def test_patch_notes(self, admin_client, lead):
        res = admin_client.patch(
            f"/api/v1/crm/leads/{lead.id}/",
            {"notes": "Needs follow-up by Friday"},
            format="json",
        )
        assert res.status_code == status.HTTP_200_OK
        assert res.data["notes"] == "Needs follow-up by Friday"

    def test_status_is_read_only_via_patch(self, admin_client, lead):
        # `status` is in read_only_fields on LeadSerializer; PATCH silently ignores it.
        res = admin_client.patch(
            f"/api/v1/crm/leads/{lead.id}/",
            {"status": "converted"},
            format="json",
        )
        assert res.status_code == status.HTTP_200_OK
        assert res.data["status"] == "new"  # unchanged

    def test_retrieve_returns_404_for_unknown_id(self, admin_client):
        import uuid
        res = admin_client.get(f"/api/v1/crm/leads/{uuid.uuid4()}/")
        assert res.status_code == status.HTTP_404_NOT_FOUND


# ──────────────────────────────────────────────────────────────────────────────
# Tenant isolation (MANDATORY per spec)
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.django_db
class TestLeadTenantIsolation:
    """
    Isolation is enforced by ShopScopedMixin._shop_filter() which reads
    shop_ids from the JWT claim. A shop-scoped user (UserRole.shop != None)
    only sees leads whose shop_id is in their JWT's shop_ids list.
    """

    VIEW_PERMS = ["crm.leads.view", "crm.leads.create"]

    def test_shop_scoped_user_sees_only_own_shop_leads(self, db, shop_a, shop_b):
        from crm.models import Lead

        lead_a = Lead.objects.create(
            shop=shop_a, name="Lead Alpha", phone="+919800200001",
            source=Lead.Source.WALK_IN,
        )
        Lead.objects.create(
            shop=shop_b, name="Lead Beta", phone="+919800200002",
            source=Lead.Source.WALK_IN,
        )

        client_a = _make_scoped_client(shop_a, "alpha@test.com", "+919700200001", self.VIEW_PERMS)
        res = client_a.get("/api/v1/crm/leads/")

        assert res.status_code == status.HTTP_200_OK
        ids = [item["id"] for item in res.data["items"]]
        assert str(lead_a.id) in ids

    def test_shop_scoped_user_cannot_see_other_shop_leads(self, db, shop_a, shop_b):
        from crm.models import Lead

        Lead.objects.create(
            shop=shop_a, name="Lead Alpha", phone="+919800300001",
            source=Lead.Source.WALK_IN,
        )
        lead_b = Lead.objects.create(
            shop=shop_b, name="Lead Beta", phone="+919800300002",
            source=Lead.Source.WALK_IN,
        )

        client_a = _make_scoped_client(shop_a, "alpha2@test.com", "+919700300001", self.VIEW_PERMS)
        res = client_a.get("/api/v1/crm/leads/")

        assert res.status_code == status.HTTP_200_OK
        ids = [item["id"] for item in res.data["items"]]
        assert str(lead_b.id) not in ids, (
            "Tenant isolation failure: shop A user can see shop B lead"
        )

    def test_tenant_wide_admin_sees_all_shops(self, db, shop_a, shop_b, admin_client):
        from crm.models import Lead

        lead_a = Lead.objects.create(
            shop=shop_a, name="Wide A", phone="+919800400001", source=Lead.Source.WALK_IN,
        )
        lead_b = Lead.objects.create(
            shop=shop_b, name="Wide B", phone="+919800400002", source=Lead.Source.WALK_IN,
        )

        res = admin_client.get("/api/v1/crm/leads/")
        assert res.status_code == status.HTTP_200_OK
        ids = [item["id"] for item in res.data["items"]]
        assert str(lead_a.id) in ids
        assert str(lead_b.id) in ids

    def test_shop_scoped_user_gets_404_on_other_shop_lead_detail(self, db, shop_a, shop_b):
        from crm.models import Lead

        lead_b = Lead.objects.create(
            shop=shop_b, name="Private Lead", phone="+919800500001",
            source=Lead.Source.WALK_IN,
        )
        client_a = _make_scoped_client(shop_a, "alpha3@test.com", "+919700400001", self.VIEW_PERMS)
        res = client_a.get(f"/api/v1/crm/leads/{lead_b.id}/")
        assert res.status_code == status.HTTP_404_NOT_FOUND


# ──────────────────────────────────────────────────────────────────────────────
# RBAC
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.django_db
class TestLeadRBAC:
    url = "/api/v1/crm/leads/"

    def test_receptionist_can_create_lead(self, db, shop):
        client = _make_scoped_client(
            shop, "recept@test.com", "+919600100001",
            ["crm.leads.view", "crm.leads.create"],
        )
        res = client.post(self.url, {
            "shop_id": str(shop.id),
            "name": "Receptionist Lead",
            "phone": "+919700500001",
            "source": "walk_in",
        }, format="json")
        assert res.status_code == status.HTTP_201_CREATED

    def test_technician_gets_403_on_create(self, db, shop):
        # Technician has view but not create permission.
        client = _make_scoped_client(
            shop, "tech@test.com", "+919600100002",
            ["crm.leads.view"],  # no crm.leads.create
        )
        res = client.post(self.url, {
            "shop_id": str(shop.id),
            "name": "Blocked Lead",
            "phone": "+919700500002",
            "source": "walk_in",
        }, format="json")
        assert res.status_code == status.HTTP_403_FORBIDDEN
        assert res.json()["error"]["code"] == "PERMISSION_DENIED"

    def test_technician_can_list_leads_with_view_permission(self, db, shop, lead):
        client = _make_scoped_client(
            shop, "tech2@test.com", "+919600100003",
            ["crm.leads.view"],
        )
        res = client.get(self.url)
        assert res.status_code == status.HTTP_200_OK

    def test_unauthenticated_gets_401(self, api_client, shop):
        res = api_client.post(self.url, {
            "shop_id": str(shop.id), "name": "x",
            "phone": "+919999999999", "source": "walk_in",
        }, format="json")
        assert res.status_code == status.HTTP_401_UNAUTHORIZED
        assert res.json()["error"]["code"] == "NOT_AUTHENTICATED"


# ──────────────────────────────────────────────────────────────────────────────
# Convert — enhanced coverage
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.django_db
class TestLeadConvertEnhanced:
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

    def test_convert_sets_lead_status_to_converted(self, admin_client, lead):
        from crm.models import Lead
        lead = self._advance_to_quoted(lead)
        res = admin_client.post(self._convert_url(lead.id), format="json")
        assert res.status_code == status.HTTP_200_OK
        lead.refresh_from_db()
        assert lead.status == Lead.Status.CONVERTED
        assert lead.converted_at is not None

    def test_convert_response_contains_customer_id(self, admin_client, lead):
        lead = self._advance_to_quoted(lead)
        res = admin_client.post(self._convert_url(lead.id), format="json")
        assert res.status_code == status.HTTP_200_OK
        assert "id" in res.data
        assert res.data["phone"] == lead.phone

    def test_idempotent_both_calls_return_same_customer_id(self, admin_client, lead):
        lead = self._advance_to_quoted(lead)
        res1 = admin_client.post(self._convert_url(lead.id), format="json")
        res2 = admin_client.post(self._convert_url(lead.id), format="json")
        assert res1.status_code == status.HTTP_200_OK
        assert res2.status_code == status.HTTP_200_OK
        assert res1.data["id"] == res2.data["id"]

    def test_convert_sets_converted_customer_fk_on_lead(self, admin_client, lead):
        from crm.models import Customer
        lead = self._advance_to_quoted(lead)
        admin_client.post(self._convert_url(lead.id), format="json")
        lead.refresh_from_db()
        customer = Customer.objects.get(phone=lead.phone)
        assert lead.converted_customer_id == customer.id


# ──────────────────────────────────────────────────────────────────────────────
# Lost from any active stage + re-open to prior stage
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.django_db
class TestLeadLostAndReopen:
    """
    Spec §4.1: any active stage can go to lost (reason required).
    Re-open restores the exact prior stage and clears status_before_lost.
    """

    def _status_url(self, lead_id):
        return f"/api/v1/crm/leads/{lead_id}/status/"

    def _make_lead(self, shop, phone, start_status="new"):
        from crm.models import Lead
        from crm.services import transition_lead
        from authentication.models import User

        lead = Lead.objects.create(
            shop=shop, name="Test Lead", phone=phone,
            source=Lead.Source.WALK_IN,
        )
        if start_status == "new":
            return lead
        user = User.objects.first()
        pipeline = ["contacted", "interested", "quoted"]
        for s in pipeline:
            lead = transition_lead(lead, s, user)
            if s == start_status:
                break
        return lead

    @pytest.mark.parametrize("start_status,phone", [
        ("new",       "+919110000001"),
        ("contacted", "+919110000002"),
        ("interested","+919110000003"),
        ("quoted",    "+919110000004"),
    ])
    def test_lost_from_any_active_stage_sets_status_before_lost(
        self, admin_client, shop, start_status, phone
    ):
        lead = self._make_lead(shop, phone, start_status)
        res = admin_client.post(
            self._status_url(lead.id),
            {"to_status": "lost", "reason": "No budget"},
            format="json",
        )
        assert res.status_code == status.HTTP_200_OK
        assert res.data["status"] == "lost"
        assert res.data["status_before_lost"] == start_status

    @pytest.mark.parametrize("start_status,phone", [
        ("new",       "+919110000011"),
        ("contacted", "+919110000012"),
        ("interested","+919110000013"),
        ("quoted",    "+919110000014"),
    ])
    def test_lost_requires_reason_from_all_stages(
        self, admin_client, shop, start_status, phone
    ):
        lead = self._make_lead(shop, phone, start_status)
        res = admin_client.post(
            self._status_url(lead.id),
            {"to_status": "lost"},  # no reason
            format="json",
        )
        assert res.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY

    @pytest.mark.parametrize("start_status,phone", [
        ("new",       "+919110000021"),
        ("contacted", "+919110000022"),
        ("interested","+919110000023"),
        ("quoted",    "+919110000024"),
    ])
    def test_reopen_returns_to_exact_prior_stage(
        self, admin_client, shop, start_status, phone
    ):
        lead = self._make_lead(shop, phone, start_status)
        # Mark lost first
        admin_client.post(
            self._status_url(lead.id),
            {"to_status": "lost", "reason": "Changed mind"},
            format="json",
        )
        lead.refresh_from_db()
        assert lead.status == "lost"
        assert lead.status_before_lost == start_status

        # Re-open — must target the prior stage
        res = admin_client.post(
            self._status_url(lead.id),
            {"to_status": start_status},
            format="json",
        )
        assert res.status_code == status.HTTP_200_OK
        assert res.data["status"] == start_status
        assert res.data["status_before_lost"] is None

    def test_reopen_clears_lost_reason(self, admin_client, shop):
        lead = self._make_lead(shop, "+919110000031", "quoted")
        admin_client.post(
            self._status_url(lead.id),
            {"to_status": "lost", "reason": "Too expensive"},
            format="json",
        )
        admin_client.post(
            self._status_url(lead.id),
            {"to_status": "quoted"},
            format="json",
        )
        lead.refresh_from_db()
        assert lead.lost_reason is None
        assert lead.status_before_lost is None

    def test_reopen_with_null_status_before_lost_returns_422(self, admin_client, shop):
        from crm.models import Lead
        # Simulate a legacy lost lead with no status_before_lost recorded
        lead = Lead.objects.create(
            shop=shop, name="Legacy Lost", phone="+919110000041",
            source=Lead.Source.OTHER, status=Lead.Status.LOST,
            lost_reason="old record", status_before_lost=None,
        )
        res = admin_client.post(
            self._status_url(lead.id),
            {"to_status": "interested"},
            format="json",
        )
        assert res.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY

    def test_reopen_to_wrong_stage_returns_400(self, admin_client, shop):
        lead = self._make_lead(shop, "+919110000051", "new")
        admin_client.post(
            self._status_url(lead.id),
            {"to_status": "lost", "reason": "Not interested"},
            format="json",
        )
        # Lead was lost from 'new'; trying to re-open to 'quoted' must fail
        res = admin_client.post(
            self._status_url(lead.id),
            {"to_status": "quoted"},
            format="json",
        )
        assert res.status_code == status.HTTP_400_BAD_REQUEST
        assert res.json()["error"]["code"] == "INVALID_STATUS_TRANSITION"

    def test_converted_lead_cannot_be_marked_lost(self, admin_client, lead):
        from crm.services import transition_lead
        from authentication.models import User
        user = User.objects.first()
        for s in ["contacted", "interested", "quoted"]:
            lead = transition_lead(lead, s, user)
        admin_client.post(f"/api/v1/crm/leads/{lead.id}/convert/", format="json")
        lead.refresh_from_db()
        assert lead.status == "converted"

        res = admin_client.post(
            self._status_url(lead.id),
            {"to_status": "lost", "reason": "Irreversible"},
            format="json",
        )
        assert res.status_code == status.HTTP_400_BAD_REQUEST
        assert res.json()["error"]["code"] == "INVALID_STATUS_TRANSITION"
