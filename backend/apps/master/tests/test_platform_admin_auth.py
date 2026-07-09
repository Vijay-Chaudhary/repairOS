"""
Platform admin independent auth — model, command, and endpoint tests.
See docs/superpowers/specs/2026-07-07-platform-admin-independent-login-design.md.
"""
from unittest import mock

import pytest
from django.core.management import call_command
from django.core.management.base import CommandError
from rest_framework import status
from rest_framework.test import APIClient


class TestPlatformAdminUserModel:
    def test_set_password_and_check_password(self, db):
        from master.models import PlatformAdminUser

        admin = PlatformAdminUser(email="root@repaiross.app", full_name="Root Admin")
        admin.set_password("StrongPass@123")
        admin.save(using="default")

        admin = PlatformAdminUser.objects.using("default").get(email="root@repaiross.app")
        assert admin.check_password("StrongPass@123")
        assert not admin.check_password("wrong")

    def test_is_locked_false_by_default(self, db):
        from master.models import PlatformAdminUser

        admin = PlatformAdminUser(email="a@repaiross.app", full_name="A")
        admin.set_password("x")
        admin.save(using="default")
        assert admin.is_locked is False

    def test_is_locked_true_when_locked_until_in_future(self, db):
        from django.utils import timezone

        from master.models import PlatformAdminUser

        admin = PlatformAdminUser(
            email="b@repaiross.app", full_name="B",
            locked_until=timezone.now() + timezone.timedelta(minutes=5),
        )
        admin.set_password("x")
        admin.save(using="default")
        assert admin.is_locked is True


class TestCreatePlatformAdminCommand:
    def test_creates_admin(self, db):
        from master.models import PlatformAdminUser

        call_command(
            "create_platform_admin",
            email="new@repaiross.app", full_name="New Admin", password="Secret@123",
        )
        admin = PlatformAdminUser.objects.using("default").get(email="new@repaiross.app")
        assert admin.check_password("Secret@123")
        assert admin.full_name == "New Admin"

    def test_rejects_duplicate_email(self, db):
        call_command(
            "create_platform_admin",
            email="dup@repaiross.app", full_name="First", password="Secret@123",
        )
        with pytest.raises(CommandError, match="already exists"):
            call_command(
                "create_platform_admin",
                email="dup@repaiross.app", full_name="Second", password="Other@123",
            )


class TestPlatformAdminJWTAuthentication:
    def test_get_user_resolves_platform_admin_from_token(self, db):
        from rest_framework_simplejwt.tokens import AccessToken

        from master.models import PlatformAdminUser
        from master.tokens import PlatformAdminJWTAuthentication

        admin = PlatformAdminUser(email="tok@repaiross.app", full_name="Tok Admin")
        admin.set_password("x")
        admin.save(using="default")

        access = AccessToken.for_user(admin)
        resolved = PlatformAdminJWTAuthentication().get_user(access)
        assert resolved.id == admin.id
        assert resolved.email == "tok@repaiross.app"

    def test_get_user_rejects_unknown_id(self, db):
        import uuid

        from rest_framework_simplejwt.exceptions import AuthenticationFailed
        from rest_framework_simplejwt.tokens import AccessToken

        from master.tokens import PlatformAdminJWTAuthentication

        token = AccessToken()
        token["user_id"] = str(uuid.uuid4())

        with pytest.raises(AuthenticationFailed):
            PlatformAdminJWTAuthentication().get_user(token)


@pytest.fixture
def platform_admin(db):
    from master.models import PlatformAdminUser

    admin = PlatformAdminUser(email="admin@repaiross.app", full_name="Root Admin")
    admin.set_password("StrongPass@123")
    admin.save(using="default")
    return admin


@pytest.fixture
def api_client():
    return APIClient()


class TestPlatformAdminLoginView:
    url = "/api/v1/platform/auth/login/"

    def test_success_returns_access_and_sets_cookie(self, api_client, platform_admin):
        res = api_client.post(self.url, {"email": platform_admin.email, "password": "StrongPass@123"})
        assert res.status_code == status.HTTP_200_OK
        assert res.data["access"]
        assert res.data["admin"]["email"] == platform_admin.email
        assert "platform_refresh_token" in res.cookies

    def test_writes_audit_log(self, api_client, platform_admin):
        from master.models import AuditLogMaster

        api_client.post(self.url, {"email": platform_admin.email, "password": "StrongPass@123"})
        assert AuditLogMaster.objects.using("default").filter(
            event_type="platform_admin.login", actor_email=platform_admin.email
        ).exists()

    def test_wrong_password_increments_failed_attempts(self, api_client, platform_admin):
        res = api_client.post(self.url, {"email": platform_admin.email, "password": "wrong"})
        assert res.status_code == status.HTTP_400_BAD_REQUEST
        platform_admin.refresh_from_db()
        assert platform_admin.failed_login_attempts == 1

    def test_locks_after_max_attempts(self, api_client, platform_admin):
        from django.conf import settings

        max_attempts = settings.AUTH_MAX_FAILED_ATTEMPTS
        for _ in range(max_attempts):
            api_client.post(self.url, {"email": platform_admin.email, "password": "wrong"})
        res = api_client.post(self.url, {"email": platform_admin.email, "password": "StrongPass@123"})
        assert res.status_code == status.HTTP_423_LOCKED

    def test_unknown_email_returns_generic_error(self, api_client, db):
        res = api_client.post(self.url, {"email": "nobody@repaiross.app", "password": "whatever"})
        assert res.status_code == status.HTTP_400_BAD_REQUEST

    def test_succeeds_with_stale_bearer_header_attached(self, api_client, platform_admin):
        # Regression: authentication_classes must be empty on this view. DRF runs
        # authentication in APIView.initial() before permission_classes is even
        # consulted, so a stale/garbage Authorization header must not block a
        # fresh login attempt (e.g. silent-refresh-then-retry, or leftover token
        # in the client after expiry).
        api_client.credentials(HTTP_AUTHORIZATION="Bearer garbage-token")
        res = api_client.post(self.url, {"email": platform_admin.email, "password": "StrongPass@123"})
        assert res.status_code == status.HTTP_200_OK


class TestPlatformAdminMeAndSessions:
    login_url = "/api/v1/platform/auth/login/"
    refresh_url = "/api/v1/platform/auth/token/refresh/"
    logout_url = "/api/v1/platform/auth/logout/"
    me_url = "/api/v1/platform/auth/me/"

    def _login(self, api_client, platform_admin):
        res = api_client.post(self.login_url, {"email": platform_admin.email, "password": "StrongPass@123"})
        api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {res.data['access']}")
        return res

    def test_me_returns_profile(self, api_client, platform_admin):
        self._login(api_client, platform_admin)
        res = api_client.get(self.me_url)
        assert res.status_code == status.HTTP_200_OK
        assert res.data["email"] == platform_admin.email

    def test_me_rejects_tenant_issued_token(self, api_client, db):
        from authentication.models import User
        from rest_framework_simplejwt.tokens import RefreshToken

        tenant_user = User.objects.create_user(
            email="tenant@example.com", phone="+919876500000",
            full_name="Tenant User", password="whatever",
        )
        access = RefreshToken.for_user(tenant_user).access_token
        access["tenant_slug"] = "demo"
        api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {str(access)}")
        res = api_client.get(self.me_url)
        assert res.status_code == status.HTTP_401_UNAUTHORIZED

    def test_refresh_rotates_token(self, api_client, platform_admin):
        self._login(api_client, platform_admin)
        res = api_client.post(self.refresh_url, {})
        assert res.status_code == status.HTTP_200_OK
        assert res.data["access"]

    def test_refresh_does_not_touch_simplejwt_blacklist(self, api_client, platform_admin):
        # Regression: the platform-admin refresh path must not query the
        # simplejwt token_blacklist tables. Those tables are migrated only onto
        # tenant DBs (see core.routers.allow_migrate) — never the master DB
        # where platform-admin tokens are verified. Plain RefreshToken(str)
        # triggers BlacklistMixin.check_blacklist(), which 500s in production
        # because the table is absent. Platform-admin sessions use
        # PlatformAdminTokenFamily for reuse detection instead. Here we simulate
        # the missing table by making any blacklist query raise, and assert the
        # refresh endpoint still succeeds.
        from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken

        self._login(api_client, platform_admin)
        with mock.patch.object(
            BlacklistedToken.objects, "filter",
            side_effect=AssertionError("blacklist table must not be queried"),
        ):
            res = api_client.post(self.refresh_url, {})
        assert res.status_code == status.HTTP_200_OK
        assert res.data["access"]

    def test_logout_writes_audit_log_and_revokes_family(self, api_client, platform_admin):
        from master.models import AuditLogMaster, PlatformAdminTokenFamily

        self._login(api_client, platform_admin)
        old_cookie = api_client.cookies["platform_refresh_token"].value

        res = api_client.post(self.logout_url, {})
        assert res.status_code == status.HTTP_200_OK
        assert AuditLogMaster.objects.using("default").filter(event_type="platform_admin.logout").exists()

        # Cookie was revoked — presenting it again to refresh must fail.
        api_client.cookies["platform_refresh_token"] = old_cookie
        res = api_client.post(self.refresh_url, {})
        assert res.status_code == status.HTTP_401_UNAUTHORIZED
        assert PlatformAdminTokenFamily.objects.using("default").get().is_revoked
