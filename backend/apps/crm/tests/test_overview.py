"""
CRM — Overview aggregation service + endpoint tests.
Covers: KPI counts, pipeline breakdown, needs-attention lists, shop scoping, permission gate.
"""

import uuid
from datetime import timedelta

import pytest
from django.utils import timezone

from crm import services
from crm.models import Customer, FollowUpTask, Lead


@pytest.fixture
def shop(db):
    from core.models import Shop
    return Shop.objects.create(
        name="Joy Computer", code="JOY", address="MG Road", city="Delhi",
        state="Uttar Pradesh", state_code="09", phone="+919876543210",
    )


@pytest.fixture
def staff_user(db):
    from authentication.models import User
    return User.objects.create_user(
        email="staff@joy.com", phone="+919000000009", full_name="Staff User", password="Pass@123",
    )


def _shop_q(shop):
    from django.db.models import Q
    return Q(shop_id__in=[shop.id])


@pytest.mark.django_db
def test_get_crm_overview_counts(shop, staff_user):
    today = timezone.localdate()
    # Pipeline: 2 new (one unassigned), 1 contacted, 1 converted (within 30d)
    Lead.objects.create(shop=shop, name="A", phone="+9111", status="new")
    Lead.objects.create(shop=shop, name="B", phone="+9112", status="new", assigned_to=staff_user)
    Lead.objects.create(shop=shop, name="C", phone="+9113", status="contacted")
    conv = Lead.objects.create(shop=shop, name="D", phone="+9114", status="converted")
    conv.converted_at = timezone.now()
    conv.save(update_fields=["converted_at"])
    # New customer within 30d
    Customer.objects.create(shop=shop, name="Cust", phone="+9120")
    # Tasks: one overdue pending, one due today, one future pending
    FollowUpTask.objects.create(
        title="Overdue call", due_date=today - timedelta(days=1), status="pending", assigned_to=staff_user,
    )
    FollowUpTask.objects.create(
        title="Today call", due_date=today, status="pending", assigned_to=staff_user,
    )
    FollowUpTask.objects.create(
        title="Future call", due_date=today + timedelta(days=2), status="pending", assigned_to=staff_user,
    )

    data = services.get_crm_overview(_shop_q(shop), str(shop.id))

    assert data["kpis"]["new_leads"] == 2
    assert data["kpis"]["tasks_due_today"] == 1
    assert data["kpis"]["tasks_overdue"] == 1
    assert data["kpis"]["conversions_30d"] == 1
    assert data["kpis"]["new_customers_30d"] == 1
    pipeline = {row["status"]: row["count"] for row in data["pipeline"]}
    assert pipeline["new"] == 2 and pipeline["contacted"] == 1 and pipeline["converted"] == 1
    assert len(data["overdue_tasks"]) == 1
    assert data["overdue_tasks"][0]["title"] == "Overdue call"
    # Only the unassigned 'new' lead appears
    assert len(data["unassigned_leads"]) == 1
    assert data["unassigned_leads"][0]["name"] == "A"


@pytest.fixture
def api_client():
    from rest_framework.test import APIClient
    return APIClient()


def _authenticate(api_client, user):
    """Attach a Bearer token carrying `user`'s permission claims.

    Mirrors the verified pattern in `backend/apps/crm/tests/test_leads.py::admin_client`.
    """
    from authentication.tokens import _build_token_claims
    from rest_framework_simplejwt.tokens import RefreshToken

    refresh = RefreshToken.for_user(user)
    access = refresh.access_token  # property creates a new instance each call
    for key, value in _build_token_claims(user, "test").items():
        access[key] = value
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {str(access)}")
    return api_client


@pytest.fixture
def overview_client(api_client, shop, staff_user):
    """Authed client whose JWT carries crm.customers.view scoped to `shop`."""
    from authentication.models import Permission, Role, RolePermission, UserRole

    role, _ = Role.objects.get_or_create(name="CRM Viewer", defaults={"is_system_role": False})
    perm, _ = Permission.objects.get_or_create(
        codename="crm.customers.view", defaults={"module": "crm", "label": "crm.customers.view"},
    )
    RolePermission.objects.get_or_create(role=role, permission=perm)
    UserRole.objects.get_or_create(user=staff_user, role=role, shop=shop)
    return _authenticate(api_client, staff_user)


@pytest.mark.django_db
def test_overview_endpoint_returns_envelope(overview_client, shop):
    Lead.objects.create(shop=shop, name="A", phone="+9111", status="new")
    res = overview_client.get(f"/api/v1/crm/overview/?shop_id={shop.id}")
    assert res.status_code == 200
    body = res.json()
    assert body["success"] is True
    assert body["data"]["kpis"]["new_leads"] == 1
    assert any(row["status"] == "new" for row in body["data"]["pipeline"])


@pytest.mark.django_db
def test_overview_requires_permission(api_client, staff_user):
    # staff_user has no roles/permissions granted → require_permission denies with 403
    _authenticate(api_client, staff_user)
    res = api_client.get("/api/v1/crm/overview/")
    assert res.status_code == 403


@pytest.mark.django_db
def test_overview_unauthenticated(api_client):
    res = api_client.get("/api/v1/crm/overview/")
    assert res.status_code == 401
