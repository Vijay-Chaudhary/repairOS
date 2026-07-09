"""
Platform Admin module tests — §10 acceptance criteria + §11 test cases.

Covers:
- Tenant registration (2-step): init returns 202, does not create tenant yet
- Slug uniqueness enforced at init time; invalid slugs rejected
- Verify step: phone OTP + email code both required; creates tenant on success
- Verify step: wrong OTP → 400, max 5 attempts → 429, expired → 404
- Verify step: dispatches provisioning task, stores credentials in cache, writes audit log
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
    from master.models import PlatformAdminUser

    admin = PlatformAdminUser(email="platform@repaiross.app", full_name="Platform Admin")
    admin.set_password("adminpass")
    admin.save(using="default")
    return admin


@pytest.fixture
def platform_client(db, platform_admin_user):
    from rest_framework.test import APIClient
    from rest_framework_simplejwt.tokens import AccessToken

    # AccessToken.for_user() (not RefreshToken.for_user()) — AccessToken doesn't
    # mix in BlacklistMixin, so it's safe to call directly on a PlatformAdminUser.
    # See the gotcha note in Task 3: RefreshToken.for_user() would try to FK an
    # OutstandingToken to a user that isn't AUTH_USER_MODEL and raise ValueError.
    access = AccessToken.for_user(platform_admin_user)
    access["is_platform_admin"] = True
    access["admin_token_type"] = "platform_admin"  # NOT "token_type" — see Task 3's tokens.py note
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
    """Tests for Step 1 of 2-step registration: POST /register/ (init)."""

    url = "/api/v1/register/"

    def _post(self, client, starter_plan, slug="joycomputer", **overrides):
        payload = {
            "business_name": "Joy Computer", "slug": slug,
            "owner_name": "Joy Owner", "phone": "+919811100001",
            "email": f"owner@{slug}.com", "password": "SecurePass123!",
            "plan_id": str(starter_plan.id),
            **overrides,
        }
        return client.post(self.url, payload, format="json")

    def test_register_init_returns_202(self, db, starter_plan):
        from unittest.mock import patch
        from rest_framework.test import APIClient
        client = APIClient()
        with patch("master.services._send_registration_otp", return_value=True), \
             patch("master.services._send_registration_email_code"):
            res = self._post(client, starter_plan)
        assert res.status_code == status.HTTP_202_ACCEPTED
        assert res.data["slug"] == "joycomputer"
        assert "phone_masked" in res.data
        assert res.data["expires_in"] == 600

    def test_register_init_does_not_create_tenant(self, db, starter_plan):
        from unittest.mock import patch
        from rest_framework.test import APIClient
        from master.models import Tenant
        client = APIClient()
        with patch("master.services._send_registration_otp", return_value=True), \
             patch("master.services._send_registration_email_code"):
            self._post(client, starter_plan)
        assert not Tenant.objects.filter(slug="joycomputer").exists()

    def test_register_init_stores_pending_in_cache(self, db, starter_plan):
        from unittest.mock import patch
        from django.core.cache import cache
        from rest_framework.test import APIClient
        client = APIClient()
        with patch("master.services._send_registration_otp", return_value=True), \
             patch("master.services._send_registration_email_code"):
            res = self._post(client, starter_plan)
        assert res.status_code == status.HTTP_202_ACCEPTED
        pending = cache.get("reg_pending:joycomputer")
        assert pending is not None
        assert "phone_otp" in pending and "email_code" in pending
        assert pending["otp_attempts"] == 0

    def test_duplicate_slug_blocked(self, db, active_tenant, starter_plan):
        from unittest.mock import patch
        from rest_framework.test import APIClient
        client = APIClient()
        with patch("master.services._send_registration_otp", return_value=True), \
             patch("master.services._send_registration_email_code"):
            res = self._post(client, starter_plan, slug="activecorp")
        assert res.status_code == status.HTTP_400_BAD_REQUEST

    def test_invalid_slug_rejected(self, db, starter_plan):
        from rest_framework.test import APIClient
        client = APIClient()
        for bad_slug in ["Joy Computer", "UPPER", "ab"]:
            res = self._post(client, starter_plan, slug=bad_slug)
            assert res.status_code == status.HTTP_400_BAD_REQUEST, f"Slug '{bad_slug}' should be rejected"


# ──────────────────────────────────────────────────────────────────────────────
# TestRegistrationVerify
# ──────────────────────────────────────────────────────────────────────────────


class TestRegistrationVerify:
    """Tests for Step 2 of 2-step registration: POST /register/verify/."""

    init_url = "/api/v1/register/"
    verify_url = "/api/v1/register/verify/"

    def _do_init(self, starter_plan, slug="verifyshop", phone="+919811200100"):
        """
        Call POST /register/ with mocked OTP sending.
        Returns (client, phone_otp, email_code) ready for the verify step.
        """
        from unittest.mock import patch
        from django.core.cache import cache
        from rest_framework.test import APIClient
        client = APIClient()
        with patch("master.services._send_registration_otp", return_value=True), \
             patch("master.services._send_registration_email_code"):
            res = client.post(self.init_url, {
                "business_name": "Verify Shop", "slug": slug,
                "owner_name": "Verify Owner", "phone": phone,
                "email": f"owner@{slug}.com", "password": "SecurePass123!",
                "plan_id": str(starter_plan.id),
            }, format="json")
        assert res.status_code == 202, f"Init failed with {res.status_code}: {res.data}"
        pending = cache.get(f"reg_pending:{slug}")
        return client, pending["phone_otp"], pending["email_code"]

    def test_verify_creates_tenant(self, db, starter_plan):
        from unittest.mock import patch
        from master.models import Tenant
        client, phone_otp, email_code = self._do_init(starter_plan)
        with patch("master.tasks.provision_tenant.delay"):
            res = client.post(self.verify_url, {
                "slug": "verifyshop", "phone_otp": phone_otp, "email_code": email_code,
            }, format="json")
        assert res.status_code == status.HTTP_201_CREATED
        assert "tenant_id" in res.data
        assert Tenant.objects.filter(slug="verifyshop").exists()
        from master.models import Tenant as T
        t = T.objects.get(slug="verifyshop")
        assert t.status == T.Status.PROVISIONING

    def test_verify_dispatches_provisioning_task(self, db, starter_plan):
        from unittest.mock import patch
        client, phone_otp, email_code = self._do_init(starter_plan, slug="taskshop2", phone="+919811200101")
        with patch("master.tasks.provision_tenant.delay") as mock_delay:
            res = client.post(self.verify_url, {
                "slug": "taskshop2", "phone_otp": phone_otp, "email_code": email_code,
            }, format="json")
        assert res.status_code == status.HTTP_201_CREATED
        mock_delay.assert_called_once()

    def test_verify_writes_audit_log(self, db, starter_plan):
        from unittest.mock import patch
        from master.models import AuditLogMaster
        client, phone_otp, email_code = self._do_init(starter_plan, slug="auditshop2", phone="+919811200102")
        with patch("master.tasks.provision_tenant.delay"):
            client.post(self.verify_url, {
                "slug": "auditshop2", "phone_otp": phone_otp, "email_code": email_code,
            }, format="json")
        assert AuditLogMaster.objects.filter(event_type="tenant.created").exists()

    def test_verify_stores_credentials_in_cache(self, db, starter_plan):
        from unittest.mock import patch
        from django.core import signing
        from django.core.cache import cache
        client, phone_otp, email_code = self._do_init(starter_plan, slug="credshop", phone="+919811200103")
        with patch("master.tasks.provision_tenant.delay"):
            res = client.post(self.verify_url, {
                "slug": "credshop", "phone_otp": phone_otp, "email_code": email_code,
            }, format="json")
        tenant_id = res.data["tenant_id"]
        raw = cache.get(f"tenant_init:{tenant_id}")
        assert raw is not None, "Signed credentials must be in cache after verify"
        data = signing.loads(raw)
        assert data["owner_name"] == "Verify Owner"
        assert data["password"] == "SecurePass123!"

    def test_verify_stores_shop_name_falls_back_to_business_name(self, db, starter_plan):
        from unittest.mock import patch
        from django.core import signing
        from django.core.cache import cache
        client, phone_otp, email_code = self._do_init(starter_plan, slug="shopnameshop", phone="+919811200107")
        with patch("master.tasks.provision_tenant.delay"):
            res = client.post(self.verify_url, {
                "slug": "shopnameshop", "phone_otp": phone_otp, "email_code": email_code,
            }, format="json")
        tenant_id = res.data["tenant_id"]
        data = signing.loads(cache.get(f"tenant_init:{tenant_id}"))
        assert data["shop_name"] == "Verify Shop"  # _do_init's business_name, no shop_name sent

    def test_verify_stores_explicit_shop_name(self, db, starter_plan):
        from unittest.mock import patch
        from django.core import signing
        from django.core.cache import cache
        from rest_framework.test import APIClient
        client = APIClient()
        with patch("master.services._send_registration_otp", return_value=True), \
             patch("master.services._send_registration_email_code"):
            client.post(self.init_url, {
                "business_name": "Verify Shop Co", "slug": "explicitshop",
                "shop_name": "Verify Shop - Main Branch",
                "owner_name": "Verify Owner", "phone": "+919811200108",
                "email": "owner@explicitshop.com", "password": "SecurePass123!",
                "plan_id": str(starter_plan.id),
            }, format="json")
        pending = cache.get("reg_pending:explicitshop")
        with patch("master.tasks.provision_tenant.delay"):
            res = client.post(self.verify_url, {
                "slug": "explicitshop",
                "phone_otp": pending["phone_otp"], "email_code": pending["email_code"],
            }, format="json")
        tenant_id = res.data["tenant_id"]
        data = signing.loads(cache.get(f"tenant_init:{tenant_id}"))
        assert data["shop_name"] == "Verify Shop - Main Branch"

    def test_verify_wrong_phone_otp_returns_400(self, db, starter_plan):
        client, _, email_code = self._do_init(starter_plan, slug="wrongotp", phone="+919811200104")
        res = client.post(self.verify_url, {
            "slug": "wrongotp", "phone_otp": "000000", "email_code": email_code,
        }, format="json")
        assert res.status_code == status.HTTP_400_BAD_REQUEST
        assert res.data.get("code") == "OTP_INVALID"

    def test_verify_wrong_email_code_returns_400(self, db, starter_plan):
        client, phone_otp, _ = self._do_init(starter_plan, slug="wrongemail", phone="+919811200105")
        res = client.post(self.verify_url, {
            "slug": "wrongemail", "phone_otp": phone_otp, "email_code": "000000",
        }, format="json")
        assert res.status_code == status.HTTP_400_BAD_REQUEST
        assert res.data.get("code") == "EMAIL_CODE_INVALID"

    def test_verify_max_attempts_returns_429(self, db, starter_plan):
        client, _, email_code = self._do_init(starter_plan, slug="maxattempts", phone="+919811200106")
        # 5 failed phone OTP attempts
        for _ in range(5):
            client.post(self.verify_url, {
                "slug": "maxattempts", "phone_otp": "000000", "email_code": email_code,
            }, format="json")
        # 6th attempt must be rate-limited
        res = client.post(self.verify_url, {
            "slug": "maxattempts", "phone_otp": "000000", "email_code": email_code,
        }, format="json")
        assert res.status_code == status.HTTP_429_TOO_MANY_REQUESTS

    def test_verify_expired_or_missing_returns_404(self, db):
        from rest_framework.test import APIClient
        res = APIClient().post(self.verify_url, {
            "slug": "doesnotexist", "phone_otp": "123456", "email_code": "654321",
        }, format="json")
        assert res.status_code == status.HTTP_404_NOT_FOUND

    def test_verify_is_public(self, db, starter_plan):
        """Verify endpoint requires no auth — unauthenticated requests must not get 401/403."""
        from django.core import signing
        from django.core.cache import cache
        from rest_framework.test import APIClient
        from unittest.mock import patch

        cache.set("reg_pending:pubshop", {
            "signed_data": signing.dumps({
                "business_name": "Pub Shop", "slug": "pubshop",
                "owner_name": "Pub Owner", "phone": "+919811200199",
                "email": "owner@pubshop.com", "password": "SecurePass123!",
                "plan_id": str(starter_plan.id),
            }),
            "phone_otp": "123456", "email_code": "654321", "otp_attempts": 0,
        }, timeout=600)

        client = APIClient()  # no credentials
        with patch("master.tasks.provision_tenant.delay"):
            res = client.post(self.verify_url, {
                "slug": "pubshop", "phone_otp": "123456", "email_code": "654321",
            }, format="json")
        assert res.status_code not in (
            status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN
        )


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

    def test_do_provision_tenant_creates_shop_with_registration_name(self, db, provisioning_tenant):
        from django.core import signing
        from django.core.cache import cache
        from master.services import do_provision_tenant
        from core.models import Shop

        payload = signing.dumps({
            "owner_name": "Prov Owner", "password": "Pass@123!",
            "shop_name": "Prov Corp Main Branch",
        })
        cache.set(f"tenant_init:{provisioning_tenant.id}", payload, timeout=3600)

        with self._patch_infra():
            do_provision_tenant(str(provisioning_tenant.id))

        assert Shop.objects.get().name == "Prov Corp Main Branch"

    def test_do_provision_tenant_shop_name_falls_back_to_tenant_name(self, db, provisioning_tenant):
        from django.core import signing
        from django.core.cache import cache
        from master.services import do_provision_tenant
        from core.models import Shop

        payload = signing.dumps({"owner_name": "Prov Owner", "password": "Pass@123!"})
        cache.set(f"tenant_init:{provisioning_tenant.id}", payload, timeout=3600)

        with self._patch_infra():
            do_provision_tenant(str(provisioning_tenant.id))

        assert Shop.objects.get().name == "Prov Corp"

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

    def test_list_tenant_includes_fe_required_fields(self, platform_client, active_tenant, starter_plan):
        """TenantListSerializer must emit the fields the FE Tenant interface expects."""
        res = platform_client.get(self.list_url)
        tenant = next(t for t in res.data["items"] if t["slug"] == "activecorp")
        assert tenant["db_status"] == "provisioning"  # no TenantDatabase row
        assert tenant["plan_name"] == starter_plan.name
        assert str(tenant["plan_id"]) == str(starter_plan.id)
        assert tenant["subscription_status"] == "active"
        assert tenant["is_active"] is True
        assert tenant["trial_ends_at"] is None  # status=active, not trialing

    def test_list_tenant_trial_ends_at_set_for_trialing(self, platform_client, starter_plan, db):
        from master.models import Tenant, TenantSubscription
        import datetime
        tenant = Tenant.objects.create(
            name="Trial Corp", slug="trialcorp",
            status=Tenant.Status.ACTIVE,
            owner_email="owner@trialcorp.com",
            owner_phone="+919000000101",
        )
        TenantSubscription.objects.create(
            tenant=tenant, plan=starter_plan,
            status=TenantSubscription.Status.TRIALING,
            current_period_start=datetime.date(2026, 6, 1),
            current_period_end=datetime.date(2026, 7, 1),
        )
        res = platform_client.get(self.list_url)
        t_data = next((t for t in res.data["items"] if t["slug"] == "trialcorp"), None)
        assert t_data is not None
        assert t_data["trial_ends_at"] == "2026-07-01"
        assert t_data["subscription_status"] == "trialing"

    def test_list_search_filter(self, platform_client, active_tenant):
        res = platform_client.get(self.list_url, {"search": "activecorp"})
        assert res.status_code == status.HTTP_200_OK
        assert len(res.data["items"]) == 1
        assert res.data["items"][0]["slug"] == "activecorp"

    def test_list_search_no_match(self, platform_client, active_tenant):
        res = platform_client.get(self.list_url, {"search": "nonexistent-xyz"})
        assert res.status_code == status.HTTP_200_OK
        assert len(res.data["items"]) == 0

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
        assert res.status_code == status.HTTP_401_UNAUTHORIZED


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
        assert "items" in res.data
        names = [p["name"] for p in res.data["items"]]
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

    def test_patch_plan_price(self, platform_client, starter_plan):
        res = platform_client.patch(
            f"{self.url}{starter_plan.id}/",
            {"price_monthly_inr": "1499.00"},
            format="json",
        )
        assert res.status_code == status.HTTP_200_OK
        assert res.data["price_monthly_inr"] == "1499.00"
        starter_plan.refresh_from_db()
        from decimal import Decimal
        assert starter_plan.price_monthly_inr == Decimal("1499.00")

    def test_patch_plan_features(self, platform_client, starter_plan):
        res = platform_client.patch(
            f"{self.url}{starter_plan.id}/",
            {"features": {"pos": True, "amc": True, "hr": True,
                          "segmentation": True, "multi_stage_repair": False,
                          "wholesale": False, "whatsapp": False}},
            format="json",
        )
        assert res.status_code == status.HTTP_200_OK
        assert res.data["features"]["amc"] is True

    def test_patch_plan_unknown_returns_404(self, platform_client):
        import uuid
        res = platform_client.patch(
            f"{self.url}{uuid.uuid4()}/",
            {"price_monthly_inr": "0.00"},
            format="json",
        )
        assert res.status_code == status.HTTP_404_NOT_FOUND

    def test_patch_plan_requires_platform_admin(self, db, starter_plan):
        from authentication.models import User
        from rest_framework.test import APIClient
        from rest_framework_simplejwt.tokens import RefreshToken
        regular = User.objects.create_user(
            email="regular2@test.com", phone="+919000000060",
            full_name="Regular", password="pass",
        )
        refresh = RefreshToken.for_user(regular)
        access = refresh.access_token
        access["is_platform_admin"] = False
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {str(access)}")
        res = client.patch(
            f"/api/v1/platform/plans/{starter_plan.id}/",
            {"price_monthly_inr": "0.00"},
            format="json",
        )
        assert res.status_code == status.HTTP_401_UNAUTHORIZED


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


# ──────────────────────────────────────────────────────────────────────────────
# TestTenantDetailDbStatus
# ──────────────────────────────────────────────────────────────────────────────


class TestTenantDetailDbStatus:
    """
    TenantDetailSerializer.get_db_status() must return values inside the FE
    DbStatus union ('provisioning' | 'active' | 'suspended' | 'deleted').
    """

    url = "/api/v1/platform/tenants/"

    def _make_tenant(self, db, slug, status_val):
        from master.models import Tenant
        return Tenant.objects.create(
            name=slug, slug=slug, status=status_val,
            owner_email=f"o@{slug}.com", owner_phone="+919000001000",
        )

    def _make_tenant_db(self, db, tenant, is_active):
        from master.models import TenantDatabase
        td = TenantDatabase(
            tenant=tenant, db_name=f"db_{tenant.slug}",
            db_host="localhost", db_port=5432,
            db_user=f"u_{tenant.slug}",
        )
        td.encrypt_password("secret")
        td.is_active = is_active
        td.save()
        return td

    def test_no_tenant_database_returns_provisioning(self, db, platform_client):
        tenant = self._make_tenant(db, "nodb", "provisioning")
        res = platform_client.get(f"{self.url}{tenant.id}/")
        assert res.status_code == 200
        assert res.data["db_status"] == "provisioning"

    def test_active_tenant_db_returns_active(self, db, platform_client):
        tenant = self._make_tenant(db, "activedb", "active")
        self._make_tenant_db(db, tenant, is_active=True)
        res = platform_client.get(f"{self.url}{tenant.id}/")
        assert res.status_code == 200
        assert res.data["db_status"] == "active"

    def test_inactive_tenant_db_returns_suspended(self, db, platform_client):
        tenant = self._make_tenant(db, "inactivedb", "suspended")
        self._make_tenant_db(db, tenant, is_active=False)
        res = platform_client.get(f"{self.url}{tenant.id}/")
        assert res.status_code == 200
        assert res.data["db_status"] == "suspended"

    def test_deleted_tenant_returns_deleted(self, db, platform_client):
        tenant = self._make_tenant(db, "deleteddb", "deleted")
        res = platform_client.get(f"{self.url}{tenant.id}/")
        assert res.status_code == 200
        assert res.data["db_status"] == "deleted"


# ──────────────────────────────────────────────────────────────────────────────
# TestPlatformIsolation
# ──────────────────────────────────────────────────────────────────────────────


class TestPlatformIsolation:
    def test_platform_admin_cannot_access_tenant_crm(self, platform_client):
        """Platform admin JWT must not reach tenant-scoped API endpoints."""
        res = platform_client.get("/api/v1/crm/customers/")
        # Either 404 (no shop/tenant context) or 403, but NOT 200
        assert res.status_code != status.HTTP_200_OK
