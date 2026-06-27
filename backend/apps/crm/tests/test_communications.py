"""
CRM — Communication-log (Activity feed) list tests.
Covers: ordering, type filter, date-range filter, shop scoping, customer/lead filters.
"""

import datetime

import pytest
from rest_framework import status

URL = "/api/v1/crm/communications/"


# ──────────────────────────────────────────────────────────────────────────────
# Fixtures
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


@pytest.fixture
def tenant_admin(db):
    from authentication.models import Permission, Role, RolePermission, User, UserRole

    user = User.objects.create_user(
        email="commadmin@joy.com",
        phone="+919000000050",
        full_name="Comm Admin",
        password="AdminPass@5",
    )
    role, _ = Role.objects.get_or_create(name="Tenant Admin", defaults={"is_system_role": True})
    for codename in ["crm.communications.log", "crm.customers.view", "crm.leads.view"]:
        perm, _ = Permission.objects.get_or_create(
            codename=codename, defaults={"module": "crm", "label": codename}
        )
        RolePermission.objects.get_or_create(role=role, permission=perm)
    UserRole.objects.create(user=user, role=role, shop=None)  # tenant-wide
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


def _make_scoped_client(shop, email, phone, permission_codenames):
    """An APIClient authenticated as a shop-specific (non-tenant-wide) user."""
    from authentication.models import Permission, Role, RolePermission, User, UserRole
    from authentication.tokens import _build_token_claims
    from rest_framework.test import APIClient
    from rest_framework_simplejwt.tokens import RefreshToken

    user = User.objects.create_user(
        email=email, phone=phone, full_name="Scoped User", password="Pass@123",
    )
    role, _ = Role.objects.get_or_create(name=f"Role_{email[:30]}")
    for codename in permission_codenames:
        perm, _ = Permission.objects.get_or_create(
            codename=codename,
            defaults={"module": codename.split(".")[0], "label": codename},
        )
        RolePermission.objects.get_or_create(role=role, permission=perm)
    UserRole.objects.create(user=user, role=role, shop=shop)  # shop-specific

    client = APIClient()
    refresh = RefreshToken.for_user(user)
    access = refresh.access_token
    for k, v in _build_token_claims(user, "test").items():
        access[k] = v
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {str(access)}")
    return client


def _customer(shop, name, phone):
    from crm.models import Customer
    return Customer.objects.create(shop=shop, name=name, phone=phone)


def _comm(customer=None, lead=None, *, type, summary, logged_by, logged_at):
    from crm.models import CommunicationLog
    return CommunicationLog.objects.create(
        customer=customer, lead=lead, type=type,
        summary=summary, logged_by=logged_by, logged_at=logged_at,
    )


# ──────────────────────────────────────────────────────────────────────────────
# Ordering + filters (tenant-wide)
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.django_db
class TestActivityFeed:
    def test_ordered_by_logged_at_desc(self, admin_client, shop_a, tenant_admin):
        from django.utils import timezone
        cust = _customer(shop_a, "Ravi", "+919811100001")
        now = timezone.now()
        _comm(cust, type="call", summary="oldest", logged_by=tenant_admin,
              logged_at=now - datetime.timedelta(days=2))
        _comm(cust, type="note", summary="newest", logged_by=tenant_admin,
              logged_at=now)
        _comm(cust, type="visit", summary="middle", logged_by=tenant_admin,
              logged_at=now - datetime.timedelta(days=1))

        res = admin_client.get(URL)
        assert res.status_code == status.HTTP_200_OK
        summaries = [i["summary"] for i in res.data["items"]]
        assert summaries == ["newest", "middle", "oldest"]

    def test_filter_by_type(self, admin_client, shop_a, tenant_admin):
        from django.utils import timezone
        cust = _customer(shop_a, "Ravi", "+919811100002")
        now = timezone.now()
        _comm(cust, type="call", summary="a call", logged_by=tenant_admin, logged_at=now)
        _comm(cust, type="note", summary="a note", logged_by=tenant_admin, logged_at=now)

        res = admin_client.get(URL, {"type": "call"})
        assert res.status_code == status.HTTP_200_OK
        assert {i["type"] for i in res.data["items"]} == {"call"}

    def test_filter_by_date_range_inclusive(self, admin_client, shop_a, tenant_admin):
        from django.utils import timezone
        cust = _customer(shop_a, "Ravi", "+919811100003")
        base = timezone.now().replace(hour=12, minute=0, second=0, microsecond=0)
        _comm(cust, type="call", summary="day -3", logged_by=tenant_admin,
              logged_at=base - datetime.timedelta(days=3))
        _comm(cust, type="call", summary="day -1", logged_by=tenant_admin,
              logged_at=base - datetime.timedelta(days=1))
        _comm(cust, type="call", summary="today", logged_by=tenant_admin, logged_at=base)

        day_from = (base - datetime.timedelta(days=1)).date().isoformat()
        day_to = base.date().isoformat()
        res = admin_client.get(URL, {"date_from": day_from, "date_to": day_to})
        assert res.status_code == status.HTTP_200_OK
        summaries = {i["summary"] for i in res.data["items"]}
        assert summaries == {"day -1", "today"}

    def test_includes_customer_and_lead_names(self, admin_client, shop_a, tenant_admin):
        from django.utils import timezone
        cust = _customer(shop_a, "Ravi Kumar", "+919811100004")
        _comm(cust, type="call", summary="hi", logged_by=tenant_admin,
              logged_at=timezone.now())
        res = admin_client.get(URL)
        assert res.status_code == status.HTTP_200_OK
        row = res.data["items"][0]
        assert row["customer_name"] == "Ravi Kumar"
        assert row["lead_name"] is None

    def test_filter_by_customer_id(self, admin_client, shop_a, tenant_admin):
        from django.utils import timezone
        c1 = _customer(shop_a, "Cust One", "+919811100005")
        c2 = _customer(shop_a, "Cust Two", "+919811100006")
        _comm(c1, type="call", summary="for c1", logged_by=tenant_admin, logged_at=timezone.now())
        _comm(c2, type="call", summary="for c2", logged_by=tenant_admin, logged_at=timezone.now())

        res = admin_client.get(URL, {"customer_id": str(c1.id)})
        assert res.status_code == status.HTTP_200_OK
        assert {i["summary"] for i in res.data["items"]} == {"for c1"}


# ──────────────────────────────────────────────────────────────────────────────
# Shop scoping
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.django_db
class TestActivityFeedShopScoping:
    PERMS = ["crm.communications.log", "crm.customers.view", "crm.leads.view"]

    def test_tenant_wide_sees_all_shops(self, admin_client, shop_a, shop_b, tenant_admin):
        from django.utils import timezone
        ca = _customer(shop_a, "Alpha Cust", "+919811200001")
        cb = _customer(shop_b, "Beta Cust", "+919811200002")
        _comm(ca, type="call", summary="alpha", logged_by=tenant_admin, logged_at=timezone.now())
        _comm(cb, type="call", summary="beta", logged_by=tenant_admin, logged_at=timezone.now())

        res = admin_client.get(URL)
        assert {i["summary"] for i in res.data["items"]} == {"alpha", "beta"}

    def test_scoped_user_sees_only_own_shop(self, db, shop_a, shop_b, tenant_admin):
        from django.utils import timezone
        ca = _customer(shop_a, "Alpha Cust", "+919811200003")
        cb = _customer(shop_b, "Beta Cust", "+919811200004")
        _comm(ca, type="call", summary="alpha", logged_by=tenant_admin, logged_at=timezone.now())
        _comm(cb, type="call", summary="beta", logged_by=tenant_admin, logged_at=timezone.now())

        client_a = _make_scoped_client(shop_a, "alpha@cl.com", "+919811299001", self.PERMS)
        res = client_a.get(URL)
        assert res.status_code == status.HTTP_200_OK
        assert {i["summary"] for i in res.data["items"]} == {"alpha"}

    def test_scoped_user_sees_lead_comms_in_own_shop(self, db, shop_a, shop_b, tenant_admin):
        from crm.models import Lead
        from django.utils import timezone
        lead_a = Lead.objects.create(
            shop=shop_a, name="Lead A", phone="+919811200010",
            source=Lead.Source.WALK_IN, status=Lead.Status.NEW,
        )
        lead_b = Lead.objects.create(
            shop=shop_b, name="Lead B", phone="+919811200011",
            source=Lead.Source.WALK_IN, status=Lead.Status.NEW,
        )
        _comm(lead=lead_a, type="whatsapp", summary="lead-alpha",
              logged_by=tenant_admin, logged_at=timezone.now())
        _comm(lead=lead_b, type="whatsapp", summary="lead-beta",
              logged_by=tenant_admin, logged_at=timezone.now())

        client_a = _make_scoped_client(shop_a, "alpha2@cl.com", "+919811299002", self.PERMS)
        res = client_a.get(URL)
        assert {i["summary"] for i in res.data["items"]} == {"lead-alpha"}
