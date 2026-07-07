"""Unit tests for core.services.get_tenant_max_shops()."""

import datetime
from decimal import Decimal

import pytest


@pytest.fixture(autouse=True)
def clear_cache():
    """
    get_tenant_max_shops() caches by slug in the Django cache, which is NOT
    rolled back between tests like the DB is. Since every test below reuses
    the "maxshopsco" slug, a value cached by one test would leak into the
    next and mask real behavior — so clear it before each test runs.
    """
    from django.core.cache import cache

    cache.clear()


@pytest.fixture
def tenant_with_plan(db):
    from master.models import SubscriptionPlan, Tenant, TenantSubscription

    plan = SubscriptionPlan.objects.create(
        name="Starter Test", max_shops=2, max_users=5, max_products=200,
        max_jobs_per_month=200, price_monthly_inr=Decimal("999.00"),
    )
    tenant = Tenant.objects.create(
        name="Max Shops Co", slug="maxshopsco", status=Tenant.Status.ACTIVE,
        owner_email="owner@maxshopsco.com", owner_phone="+919900300001",
    )
    TenantSubscription.objects.create(
        tenant=tenant, plan=plan, status=TenantSubscription.Status.ACTIVE,
        current_period_start=datetime.date(2026, 1, 1),
        current_period_end=datetime.date(2026, 12, 31),
    )
    return tenant


def test_returns_plan_max_shops(db, tenant_with_plan):
    from core.services import get_tenant_max_shops

    assert get_tenant_max_shops("maxshopsco") == 2


def test_returns_none_for_unlimited_plan(db, tenant_with_plan):
    from core.services import get_tenant_max_shops

    sub = tenant_with_plan.subscriptions.first()
    sub.plan.max_shops = None
    sub.plan.save()

    assert get_tenant_max_shops("maxshopsco") is None


def test_returns_none_for_unknown_slug(db):
    from core.services import get_tenant_max_shops

    assert get_tenant_max_shops("no-such-tenant") is None


def test_caches_result(db, tenant_with_plan):
    from django.core.cache import cache
    from core.services import get_tenant_max_shops

    get_tenant_max_shops("maxshopsco")

    assert cache.get("tenant_max_shops:maxshopsco") == 2
