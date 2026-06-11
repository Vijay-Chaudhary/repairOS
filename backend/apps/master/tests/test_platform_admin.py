"""
Platform Admin module tests — §10 acceptance criteria + §11 test cases.

Covers:
- Tenant registration: slug sanitised, uniqueness enforced, status=provisioning
- Invalid slug rejected (spaces, uppercase, reserved)
- Registration dispatches provisioning task and stores signed credentials in cache
- do_provision_tenant: seeds roles, creates Tenant Admin, activates tenant
- provision_tenant task marks provisioning_failed after max retries
- Platform admin can list all tenants
- Platform admin can suspend a tenant
- Suspended tenant is blocked at the login endpoint (auth-level block)
- Platform admin cannot reach tenant-scoped API endpoints
- SubscriptionPlan CRUD
- TenantSubscription created with plan
- Razorpay subscription webhook updates subscription status
- AuditLogMaster entry written on tenant suspend
- Plan feature flags queryable per tenant
"""

import datetime
from decimal import Decimal

import pytest
from rest_framework import status


# ──────────────────────────────────────────────────────────────────────────────
# Fixtures
# ──────────────────────────────────────────────────────────────────────────────


@pytest.fixture
def platform_admin_user(db):
    from authentication.models import User
    return User.objects.create_user(
        email="platform@repaiross.app", phone="+919000000001",
        full_name="Platform Admin", password="adminpass",
        is_platform_admin=True,
    )


@pytest.fixture
def platform_client(db, platform_admin_user):
    from rest_framework.test import APIClient
    from rest_framework_simplejwt.tokens import RefreshToken
    refresh = RefreshToken.for_user(platform_admin_user)
    access = refresh.access_token
    access["is_platform_admin"] = True
    access["is_tenant_wide"] = True
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {str(access)}")
    return client


@pytest.fixture
def starter_plan(db):
    from master.models import SubscriptionPlan
    return SubscriptionPlan.objects.create(
        name="Starter",
        max_shops=1, max_users=5, max_products=200, max_jobs_per_month=200,
        features={
            "pos": True, "amc": False, "hr": False,
            "segmentation": False, "multi_stage_repair": False,
            "wholesale": False, "whatsapp": False,
        },
        price_monthly_inr=Decimal("999.00"),
    )


@pytest.fixture
def professional_plan(db):
    from master.models import SubscriptionPlan
    return SubscriptionPlan.objects.create(
        name="Professional",
        max_shops=5, max_users=25, max_products=5000, max_jobs_per_month=1000,
        features={
            "pos": True, "amc": True, "hr": True,
            "segmentation": True, "multi_stage_repair": True,
            "wholesale": True, "whatsapp": True,
        },
        price_monthly_inr=Decimal("2999.00"),
    )


@pytest.fixture
def active_tenant(db, starter_plan):
    from master.models import Tenant, TenantSubscription
    tenant = Tenant.objects.create(
        name="Active Corp", slug="activecorp",
        status=Tenant.Status.ACTIVE,
        owner_email="owner@activecorp.com",
        owner_phone="+919000000100",
    )
    TenantSubscription.objects.create(
        tenant=tenant, plan=starter_plan,
        status=TenantSubscription.Status.ACTIVE,
        current_period_start=datetime.date(2026, 1, 1),
        current_period_end=datetime.date(2026, 12, 31),
    )
    return tenant


# ──────────────────────────────────────────────────────────────────────────────
# TestRegistration
# ──────────────────────────────────────────────────────────────────────────────


class TestRegistration:
    url = "/api/v1/register/"

    def test_register_creates_tenant_with_provisioning_status(self, db, starter_plan):
        from unittest.mock import patch
        from rest_framework.test import APIClient
        client = APIClient()
        with patch("master.tasks.provision_tenant.delay"):
            res = client.post(self.url, {
                "business_name": "Joy Computer",
                "slug": "joycomputer",
                "owner_name": "Joy Owner",
                "phone": "+919811100001",
                "email": "owner@joycomputer.com",
                "password": "SecurePass123!",
                "plan_id": str(starter_plan.id),
            }, format="json")
        assert res.status_code == status.HTTP_201_CREATED
        assert res.data["db_status"] == "provisioning"
        assert "tenant_id" in res.data

        from master.models import Tenant
        t = Tenant.objects.get(id=res.data["tenant_id"])
        assert t.slug == "joycomputer"
        assert t.status == Tenant.Status.PROVISIONING

    def test_duplicate_slug_blocked(self, db, active_tenant, starter_plan):
        from unittest.mock import patch
        from rest_framework.test import APIClient
        client = APIClient()
        with patch("master.tasks.provision_tenant.delay"):
            res = client.post(self.url, {
                "business_name": "Another Corp",
                "slug": "activecorp",
                "owner_name": "Another Owner",
                "phone": "+919811100002",
                "email": "other@test.com",
                "password": "SecurePass123!",
                "plan_id": str(starter_plan.id),
            }, format="json")
        assert res.status_code == status.HTTP_400_BAD_REQUEST

    def test_invalid_slug_rejected(self, db, starter_plan):
        from rest_framework.test import APIClient
        client = APIClient()
        for bad_slug in ["Joy Computer", "UPPER", "ab"]:
            res = client.post(self.url, {
                "business_name": "Test", "slug": bad_slug,
                "owner_name": "Owner", "phone": "+919811100003",
                "email": "t@test.com", "password": "SecurePass123!",
                "plan_id": str(starter_plan.id),
            }, format="json")
            assert res.status_code == status.HTTP_400_BAD_REQUEST, f"Slug '{bad_slug}' should be rejected"

    def test_audit_log_written_on_registration(self, db, starter_plan):
        from unittest.mock import patch
        from rest_framework.test import APIClient
        client = APIClient()
        with patch("master.tasks.provision_tenant.delay"):
            client.post(self.url, {
                "business_name": "Audit Test", "slug": "auditcorp",
                "owner_name": "Owner", "phone": "+919811100010",
                "email": "audit@test.com", "password": "SecurePass123!",
                "plan_id": str(starter_plan.id),
            }, format="json")

        from master.models import AuditLogMaster
        assert AuditLogMaster.objects.filter(event_type="tenant.created").exists()

    def test_register_dispatches_provisioning_task(self, db, starter_plan):
        """register_tenant() must enqueue the provisioning task."""
        from unittest.mock import patch
        from rest_framework.test import APIClient

        client = APIClient()
        with patch("master.tasks.provision_tenant.delay") as mock_delay:
            res = client.post(self.url, {
                "business_name": "Task Corp", "slug": "taskcorp",
                "owner_name": "Task Owner", "phone": "+919811100020",
                "email": "owner@taskcorp.com", "password": "SecurePass123!",
                "plan_id": str(starter_plan.id),
            }, format="json")

        assert res.status_code == status.HTTP_201_CREATED
        mock_delay.assert_called_once_with(res.data["tenant_id"])

    def test_register_stores_credentials_in_cache(self, db, starter_plan):
        """register_tenant() stores signed owner credentials in Redis for the task."""
        from unittest.mock import patch
        from django.core import signing
        from django.core.cache import cache
        from rest_framework.test import APIClient

        client = APIClient()
        with patch("master.tasks.provision_tenant.delay"):
            res = client.post(self.url, {
                "business_name": "Cache Corp", "slug": "cachecorp",
                "owner_name": "Cache Owner", "phone": "+919811100021",
                "email": "owner@cachecorp.com", "password": "SecurePass123!",
                "plan_id": str(starter_plan.id),
            }, format="json")

        tenant_id = res.data["tenant_id"]
        raw = cache.get(f"tenant_init:{tenant_id}")
        assert raw is not None, "Signed credentials must be in cache after registration"
        data = signing.loads(raw)
        assert data["owner_name"] == "Cache Owner"
        assert data["password"] == "SecurePass123!"


# ──────────────────────────────────────────────────────────────────────────────
# TestRegistrationStatus
# ──────────────────────────────────────────────────────────────────────────────


class TestRegistrationStatus:
    url = "/api/v1/register/status/"

    def test_provisioning_tenant_returns_provisioning(self, db, starter_plan):
        from rest_framework.test import APIClient
        from master.models import Tenant
        tenant = Tenant.objects.create(
            name="Prov Status", slug="provstatus",
            status=Tenant.Status.PROVISIONING,
            owner_email="o@provstatus.com", owner_phone="+919000000200",
        )
        res = APIClient().get(self.url, {"slug": tenant.slug})
        assert res.status_code == 200
        assert res.data["status"] == "provisioning"

    def test_active_tenant_returns_active(self, db, active_tenant):
        from rest_framework.test import APIClient
        res = APIClient().get(self.url, {"slug": active_tenant.slug})
        assert res.status_code == 200
        assert res.data["status"] == "active"

    def test_failed_tenant_returns_failed(self, db):
        from rest_framework.test import APIClient
        from master.models import Tenant
        tenant = Tenant.objects.create(
            name="Failed Tenant", slug="failedtenant",
            status=Tenant.Status.PROVISIONING_FAILED,
            owner_email="o@failed.com", owner_phone="+919000000201",
        )
        res = APIClient().get(self.url, {"slug": tenant.slug})
        assert res.status_code == 200
        assert res.data["status"] == "failed"

    def test_unknown_slug_returns_404(self, db):
        from rest_framework.test import APIClient
        res = APIClient().get(self.url, {"slug": "doesnotexist"})
        assert res.status_code == 404

    def test_missing_slug_returns_400(self, db):
        from rest_framework.test import APIClient
        res = APIClient().get(self.url)
        assert res.status_code == 400

    def test_endpoint_is_public(self, db, active_tenant):
        """No auth header required."""
        from rest_framework.test import APIClient
        client = APIClient()
        # deliberately no credentials set
        res = client.get(self.url, {"slug": active_tenant.slug})
        assert res.status_code == 200


# ──────────────────────────────────────────────────────────────────────────────
# TestProvisioning
# ──────────────────────────────────────────────────────────────────────────────


class TestProvisioning:
    """Unit tests for do_provision_tenant() — PG creation and migrations are mocked."""

    @pytest.fixture
    def provisioning_tenant(self, db, starter_plan):
        from master.models import Tenant, TenantSubscription
        import datetime
        tenant = Tenant.objects.create(
            name="Prov Corp", slug="provcorp",
            status=Tenant.Status.PROVISIONING,
            owner_email="owner@provcorp.com",
            owner_phone="+919811200001",
        )
        TenantSubscription.objects.create(
            tenant=tenant, plan=starter_plan,
            status=TenantSubscription.Status.TRIALING,
            current_period_start=datetime.date(2026, 1, 1),
            current_period_end=datetime.date(2026, 1, 31),
        )
        return tenant

    def _patch_infra(self):
        """Return a context manager that stubs out PG creation and migrations."""
        from unittest.mock import patch, MagicMock
        import contextlib

        @contextlib.contextmanager
        def ctx():
            # call_command is imported locally inside do_provision_tenant, so patch
            # the real source rather than a module-level alias.
            with patch("master.services._create_pg_resources"), \
                 patch("django.core.management.call_command"), \
                 patch("django.db.connections") as mock_conns:
                mock_conns.databases = {}
                yield
        return ctx()

    def test_do_provision_tenant_activates_tenant(self, db, provisioning_tenant):
        from django.core import signing
        from django.core.cache import cache
        from master.services import do_provision_tenant
        from master.models import Tenant

        # Seed cache as register_tenant() would
        payload = signing.dumps({"owner_name": "Prov Owner", "password": "Pass@123!"})
        cache.set(f"tenant_init:{provisioning_tenant.id}", payload, timeout=3600)

        with self._patch_infra():
            do_provision_tenant(str(provisioning_tenant.id))

        provisioning_tenant.refresh_from_db()
        assert provisioning_tenant.status == Tenant.Status.ACTIVE

    def test_do_provision_tenant_seeds_roles(self, db, provisioning_tenant):
        from django.core import signing
        from django.core.cache import cache
        from master.services import do_provision_tenant
        from authentication.models import Role

        payload = signing.dumps({"owner_name": "Prov Owner", "password": "Pass@123!"})
        cache.set(f"tenant_init:{provisioning_tenant.id}", payload, timeout=3600)

        with self._patch_infra():
            do_provision_tenant(str(provisioning_tenant.id))

        assert Role.objects.filter(name="Tenant Admin").exists()
        assert Role.objects.filter(name="Shop Manager").exists()

    def test_do_provision_tenant_creates_admin_user(self, db, provisioning_tenant):
        from django.core import signing
        from django.core.cache import cache
        from master.services import do_provision_tenant
        from authentication.models import User

        payload = signing.dumps({"owner_name": "Prov Owner", "password": "Pass@123!"})
        cache.set(f"tenant_init:{provisioning_tenant.id}", payload, timeout=3600)

        with self._patch_infra():
            do_provision_tenant(str(provisioning_tenant.id))

        assert User.objects.filter(email="owner@provcorp.com").exists()

    def test_do_provision_tenant_writes_audit_log(self, db, provisioning_tenant):
        from django.core import signing
        from django.core.cache import cache
        from master.services import do_provision_tenant
        from master.models import AuditLogMaster

        payload = signing.dumps({"owner_name": "Prov Owner", "password": "Pass@123!"})
        cache.set(f"tenant_init:{provisioning_tenant.id}", payload, timeout=3600)

        with self._patch_infra():
            do_provision_tenant(str(provisioning_tenant.id))

        assert AuditLogMaster.objects.filter(event_type="tenant.provisioned").exists()

    def test_do_provision_tenant_idempotent_if_already_active(self, db, active_tenant):
        """Calling do_provision_tenant on an already-active tenant is a no-op."""
        from master.services import do_provision_tenant
        from master.models import Tenant
        original_status = active_tenant.status

        with self._patch_infra():
            do_provision_tenant(str(active_tenant.id))  # must not raise

        active_tenant.refresh_from_db()
        assert active_tenant.status == original_status

    def test_provision_task_marks_failed_after_max_retries(self, db, provisioning_tenant):
        from unittest.mock import patch, MagicMock
        from celery.exceptions import MaxRetriesExceededError
        from master.tasks import provision_tenant
        from master.models import Tenant

        with patch("master.services.do_provision_tenant", side_effect=RuntimeError("PG down")), \
             patch.object(provision_tenant, "retry", side_effect=MaxRetriesExceededError()):
            with pytest.raises(MaxRetriesExceededError):
                provision_tenant(str(provisioning_tenant.id))

        provisioning_tenant.refresh_from_db()
        assert provisioning_tenant.status == Tenant.Status.PROVISIONING_FAILED


# ──────────────────────────────────────────────────────────────────────────────
# TestPlatformAdminTenants
# ──────────────────────────────────────────────────────────────────────────────


class TestPlatformAdminTenants:
    list_url = "/api/v1/platform/tenants/"

    def test_list_tenants(self, platform_client, active_tenant):
        res = platform_client.get(self.list_url)
        assert res.status_code == status.HTTP_200_OK
        assert "items" in res.data and "meta" in res.data
        slugs = [t["slug"] for t in res.data["items"]]
        assert "activecorp" in slugs

    def test_get_tenant_detail(self, platform_client, active_tenant):
        res = platform_client.get(f"{self.list_url}{active_tenant.id}/")
        assert res.status_code == status.HTTP_200_OK
        assert res.data["slug"] == "activecorp"
        assert "subscription" in res.data

    def test_suspend_tenant(self, platform_client, active_tenant):
        res = platform_client.post(f"{self.list_url}{active_tenant.id}/suspend/")
        assert res.status_code == status.HTTP_200_OK
        active_tenant.refresh_from_db()
        assert active_tenant.status == "suspended"

    def test_suspend_writes_audit_log(self, platform_client, active_tenant):
        platform_client.post(f"{self.list_url}{active_tenant.id}/suspend/")
        from master.models import AuditLogMaster
        assert AuditLogMaster.objects.filter(
            event_type="tenant.suspended", tenant=active_tenant
        ).exists()

    def test_non_platform_admin_cannot_list_tenants(self, db):
        from authentication.models import User
        from rest_framework.test import APIClient
        from rest_framework_simplejwt.tokens import RefreshToken
        regular_user = User.objects.create_user(
            email="regular@test.com", phone="+919000000050",
            full_name="Regular User", password="pass",
        )
        refresh = RefreshToken.for_user(regular_user)
        access = refresh.access_token
        access["is_platform_admin"] = False
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {str(access)}")
        res = client.get(self.list_url)
        assert res.status_code == status.HTTP_403_FORBIDDEN


# ──────────────────────────────────────────────────────────────────────────────
# TestSuspendedTenantBlocked
# ──────────────────────────────────────────────────────────────────────────────


class TestSuspendedTenantBlocked:
    login_url = "/api/v1/auth/login/"

    def test_suspended_tenant_login_blocked(self, db):
        """Login attempt for a user whose tenant is suspended returns 403."""
        from master.models import Tenant
        tenant = Tenant.objects.create(
            name="Suspended Co", slug="suspendedco",
            status=Tenant.Status.SUSPENDED,
            owner_email="o@suspended.com",
            owner_phone="+919000000200",
        )

        from authentication.models import User
        user = User.objects.create_user(
            email="user@suspended.com", phone="+919000000201",
            full_name="Suspended User", password="pass",
        )

        from rest_framework.test import APIClient
        from core.context import set_tenant_db_alias

        # Simulate the request having already resolved to this tenant's DB
        # alias (the same state TenantMiddleware leaves behind for subdomain-
        # routed requests, including the stale-cache window where a tenant's
        # `tenant_db_config` cache entry outlives a status flip to SUSPENDED).
        # We deliberately do NOT send `tenant_slug` in the body — LoginView
        # must derive tenant identity solely from resolved context, never from
        # client-supplied input (a client could otherwise probe the suspension
        # status of arbitrary tenants).
        set_tenant_db_alias("tenant_suspendedco")
        try:
            client = APIClient()
            res = client.post(self.login_url, {
                "email": "user@suspended.com",
                "password": "pass",
            }, format="json")
        finally:
            set_tenant_db_alias("default")
        # Login for suspended tenant must fail (403 or 400 with error code)
        assert res.status_code in (status.HTTP_403_FORBIDDEN, status.HTTP_400_BAD_REQUEST)


# ──────────────────────────────────────────────────────────────────────────────
# TestSubscriptionPlans
# ──────────────────────────────────────────────────────────────────────────────


class TestSubscriptionPlans:
    url = "/api/v1/platform/plans/"

    def test_list_plans(self, platform_client, starter_plan, professional_plan):
        res = platform_client.get(self.url)
        assert res.status_code == status.HTTP_200_OK
        names = [p["name"] for p in res.data]
        assert "Starter" in names
        assert "Professional" in names

    def test_create_plan(self, platform_client):
        res = platform_client.post(self.url, {
            "name": "Enterprise",
            "max_shops": None,
            "max_users": None,
            "max_products": None,
            "max_jobs_per_month": None,
            "features": {"pos": True, "amc": True, "hr": True, "api_access": True},
            "price_monthly_inr": "0.00",
        }, format="json")
        assert res.status_code == status.HTTP_201_CREATED
        assert res.data["features"]["api_access"] is True

    def test_plan_feature_flags_queryable(self, platform_client, starter_plan):
        res = platform_client.get(f"{self.url}{starter_plan.id}/")
        assert res.status_code == status.HTTP_200_OK
        assert res.data["features"]["amc"] is False
        assert res.data["features"]["pos"] is True


# ──────────────────────────────────────────────────────────────────────────────
# TestRazorpaySubscriptionWebhook
# ──────────────────────────────────────────────────────────────────────────────


class TestRazorpaySubscriptionWebhook:
    url = "/api/v1/webhooks/razorpay-subscription/"

    def test_subscription_activated_webhook_updates_status(self, db, active_tenant, starter_plan):
        import hashlib, hmac, json
        from master.models import TenantSubscription
        sub = TenantSubscription.objects.filter(tenant=active_tenant).first()
        sub.razorpay_subscription_id = "sub_test001"
        sub.status = TenantSubscription.Status.TRIALING
        sub.save()

        secret = "webhook_secret"
        payload = json.dumps({
            "event": "subscription.activated",
            "payload": {
                "subscription": {
                    "entity": {"id": "sub_test001", "status": "active"}
                }
            }
        }).encode()
        sig = hmac.new(secret.encode(), payload, hashlib.sha256).hexdigest()

        from rest_framework.test import APIClient
        client = APIClient()
        from django.test import override_settings
        with override_settings(RAZORPAY_WEBHOOK_SECRET=secret):
            res = client.post(
                self.url, data=payload,
                content_type="application/json",
                HTTP_X_RAZORPAY_SIGNATURE=sig,
            )
        assert res.status_code == status.HTTP_200_OK
        sub.refresh_from_db()
        assert sub.status == TenantSubscription.Status.ACTIVE

    def test_subscription_cancelled_webhook(self, db, active_tenant, starter_plan):
        import hashlib, hmac, json
        from master.models import TenantSubscription
        sub = TenantSubscription.objects.filter(tenant=active_tenant).first()
        sub.razorpay_subscription_id = "sub_cancel001"
        sub.save()

        secret = "webhook_secret"
        payload = json.dumps({
            "event": "subscription.cancelled",
            "payload": {
                "subscription": {
                    "entity": {"id": "sub_cancel001", "status": "cancelled"}
                }
            }
        }).encode()
        sig = hmac.new(secret.encode(), payload, hashlib.sha256).hexdigest()

        from rest_framework.test import APIClient
        client = APIClient()
        from django.test import override_settings
        with override_settings(RAZORPAY_WEBHOOK_SECRET=secret):
            res = client.post(
                self.url, data=payload,
                content_type="application/json",
                HTTP_X_RAZORPAY_SIGNATURE=sig,
            )
        assert res.status_code == status.HTTP_200_OK
        sub.refresh_from_db()
        assert sub.status == TenantSubscription.Status.CANCELLED


# ──────────────────────────────────────────────────────────────────────────────
# TestPlatformIsolation
# ──────────────────────────────────────────────────────────────────────────────


class TestPlatformIsolation:
    def test_platform_admin_cannot_access_tenant_crm(self, platform_client):
        """Platform admin JWT must not reach tenant-scoped API endpoints."""
        res = platform_client.get("/api/v1/crm/customers/")
        # Either 404 (no shop/tenant context) or 403, but NOT 200
        assert res.status_code != status.HTTP_200_OK
