"""
Platform admin independent auth — model, command, and endpoint tests.
See docs/superpowers/specs/2026-07-07-platform-admin-independent-login-design.md.
"""
import pytest
from django.core.management import call_command
from django.core.management.base import CommandError


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
