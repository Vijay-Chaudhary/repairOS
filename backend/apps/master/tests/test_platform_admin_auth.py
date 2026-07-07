"""
Platform admin independent auth — model, command, and endpoint tests.
See docs/superpowers/specs/2026-07-07-platform-admin-independent-login-design.md.
"""
import pytest


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
