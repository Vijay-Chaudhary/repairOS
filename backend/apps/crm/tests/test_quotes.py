"""
CRM — cross-lead Quotes worklist (GET /api/crm/quotes/) tests.
Covers: list + lead fields, lead-status filter, date range, shop scoping, permission.
"""

import datetime

import pytest
from rest_framework import status

URL = "/api/v1/crm/quotes/"


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
        email="quoteadmin@joy.com",
        phone="+919000000060",
        full_name="Quote Admin",
        password="AdminPass@6",
    )
    role, _ = Role.objects.get_or_create(name="Tenant Admin", defaults={"is_system_role": True})
    for codename in ["crm.leads.view", "crm.leads.edit"]:
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


def _lead(shop, name, phone, status_value="quoted"):
    from crm.models import Lead
    return Lead.objects.create(
        shop=shop, name=name, phone=phone,
        source=Lead.Source.WALK_IN, status=status_value,
    )


def _quote(lead, sent_by, *, number, total="4500.00", created_at=None):
    from crm.models import LeadQuote
    q = LeadQuote.objects.create(
        lead=lead, quote_number=number,
        items=[{"description": "Screen", "amount": total}],
        total_amount=total, valid_until=datetime.date(2026, 12, 31),
        sent_by=sent_by,
    )
    if created_at is not None:
        # created_at is auto-set; override for date-filter tests.
        type(q).objects.filter(pk=q.pk).update(created_at=created_at)
        q.refresh_from_db()
    return q


# ──────────────────────────────────────────────────────────────────────────────
# List + filters (tenant-wide)
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.django_db
class TestQuotesWorklist:
    def test_lists_quotes_across_leads_with_lead_fields(self, admin_client, shop_a, tenant_admin):
        l1 = _lead(shop_a, "Ravi", "+919811100001")
        l2 = _lead(shop_a, "Sita", "+919811100002")
        _quote(l1, tenant_admin, number="ALPHA-QT-2026-0001")
        _quote(l2, tenant_admin, number="ALPHA-QT-2026-0002")

        res = admin_client.get(URL)
        assert res.status_code == status.HTTP_200_OK
        assert res.data["meta"]["count"] == 2
        names = {row["lead_name"] for row in res.data["items"]}
        assert names == {"Ravi", "Sita"}
        assert all(row["lead_status"] == "quoted" for row in res.data["items"])
        assert all(row["lead_id"] for row in res.data["items"])

    def test_ordered_by_created_at_desc(self, admin_client, shop_a, tenant_admin):
        from django.utils import timezone
        l1 = _lead(shop_a, "Ravi", "+919811100003")
        now = timezone.now()
        _quote(l1, tenant_admin, number="ALPHA-QT-2026-0010",
               created_at=now - datetime.timedelta(days=2))
        _quote(l1, tenant_admin, number="ALPHA-QT-2026-0011", created_at=now)
        res = admin_client.get(URL)
        numbers = [r["quote_number"] for r in res.data["items"]]
        assert numbers == ["ALPHA-QT-2026-0011", "ALPHA-QT-2026-0010"]

    def test_filter_by_lead_status(self, admin_client, shop_a, tenant_admin):
        quoted = _lead(shop_a, "Quoted Lead", "+919811100004", status_value="quoted")
        converted = _lead(shop_a, "Converted Lead", "+919811100005", status_value="converted")
        _quote(quoted, tenant_admin, number="ALPHA-QT-2026-0020")
        _quote(converted, tenant_admin, number="ALPHA-QT-2026-0021")

        res = admin_client.get(URL, {"lead_status": "converted"})
        assert res.status_code == status.HTTP_200_OK
        assert {r["lead_name"] for r in res.data["items"]} == {"Converted Lead"}

    def test_filter_by_date_range_inclusive(self, admin_client, shop_a, tenant_admin):
        from django.utils import timezone
        l1 = _lead(shop_a, "Ravi", "+919811100006")
        base = timezone.now().replace(hour=12, minute=0, second=0, microsecond=0)
        _quote(l1, tenant_admin, number="ALPHA-QT-2026-0030",
               created_at=base - datetime.timedelta(days=3))
        _quote(l1, tenant_admin, number="ALPHA-QT-2026-0031",
               created_at=base - datetime.timedelta(days=1))
        _quote(l1, tenant_admin, number="ALPHA-QT-2026-0032", created_at=base)

        res = admin_client.get(URL, {
            "date_from": (base - datetime.timedelta(days=1)).date().isoformat(),
            "date_to": base.date().isoformat(),
        })
        nums = {r["quote_number"] for r in res.data["items"]}
        assert nums == {"ALPHA-QT-2026-0031", "ALPHA-QT-2026-0032"}

    def test_requires_leads_view_permission(self, db, shop_a, tenant_admin):
        l1 = _lead(shop_a, "Ravi", "+919811100007")
        _quote(l1, tenant_admin, number="ALPHA-QT-2026-0040")
        client = _make_scoped_client(shop_a, "noperm@cl.com", "+919811299010", ["crm.customers.view"])
        res = client.get(URL)
        assert res.status_code == status.HTTP_403_FORBIDDEN


# ──────────────────────────────────────────────────────────────────────────────
# Shop scoping
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.django_db
class TestQuotesShopScoping:
    PERMS = ["crm.leads.view"]

    def test_tenant_wide_sees_all_shops(self, admin_client, shop_a, shop_b, tenant_admin):
        la = _lead(shop_a, "Alpha Lead", "+919811200001")
        lb = _lead(shop_b, "Beta Lead", "+919811200002")
        _quote(la, tenant_admin, number="ALPHA-QT-2026-0050")
        _quote(lb, tenant_admin, number="BETA-QT-2026-0050")
        res = admin_client.get(URL)
        assert {r["lead_name"] for r in res.data["items"]} == {"Alpha Lead", "Beta Lead"}

    def test_scoped_user_sees_only_own_shop(self, db, shop_a, shop_b, tenant_admin):
        la = _lead(shop_a, "Alpha Lead", "+919811200003")
        lb = _lead(shop_b, "Beta Lead", "+919811200004")
        _quote(la, tenant_admin, number="ALPHA-QT-2026-0060")
        _quote(lb, tenant_admin, number="BETA-QT-2026-0060")

        client_a = _make_scoped_client(shop_a, "alpha@cl.com", "+919811299011", self.PERMS)
        res = client_a.get(URL)
        assert res.status_code == status.HTTP_200_OK
        assert {r["lead_name"] for r in res.data["items"]} == {"Alpha Lead"}
