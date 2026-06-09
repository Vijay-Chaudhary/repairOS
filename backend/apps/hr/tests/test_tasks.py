"""
Tests for HR Celery beat tasks:
  send_payroll_reminders — reminds HR managers on the 25th to generate salary slips
"""

from unittest.mock import patch

import pytest


@pytest.fixture
def active_user(db):
    from authentication.models import User
    return User.objects.create_user(
        email="hrmanager@test.com",
        phone="+919500000001",
        full_name="HR Manager",
        password="pass",
        is_active=True,
        is_platform_admin=False,
    )


@pytest.fixture
def platform_admin(db):
    from authentication.models import User
    return User.objects.create_user(
        email="platform@test.com",
        phone="+919500000002",
        full_name="Platform Admin",
        password="pass",
        is_active=True,
        is_platform_admin=True,
    )


@pytest.fixture
def inactive_user(db):
    from authentication.models import User
    return User.objects.create_user(
        email="inactive@test.com",
        phone="+919500000003",
        full_name="Inactive",
        password="pass",
        is_active=False,
        is_platform_admin=False,
    )


@pytest.mark.django_db
class TestSendPayrollReminders:
    def test_fires_on_25th_and_notifies_active_user(self, db, active_user):
        import datetime
        with (
            patch("django.utils.timezone.localdate", return_value=datetime.date(2026, 6, 25)),
            patch("core.tasks.dispatch_whatsapp_message.delay") as mock_delay,
        ):
            from hr.tasks import send_payroll_reminders
            send_payroll_reminders()

        mock_delay.assert_called_once()
        call_kwargs = mock_delay.call_args.kwargs
        assert call_kwargs["template_name"] == "payroll_reminder"
        assert call_kwargs["phone"] == active_user.phone

    def test_skips_on_non_25th(self, db, active_user):
        import datetime
        with (
            patch("django.utils.timezone.localdate", return_value=datetime.date(2026, 6, 10)),
            patch("core.tasks.dispatch_whatsapp_message.delay") as mock_delay,
        ):
            from hr.tasks import send_payroll_reminders
            send_payroll_reminders()

        mock_delay.assert_not_called()

    def test_platform_admin_excluded(self, db, platform_admin):
        import datetime
        with (
            patch("django.utils.timezone.localdate", return_value=datetime.date(2026, 6, 25)),
            patch("core.tasks.dispatch_whatsapp_message.delay") as mock_delay,
        ):
            from hr.tasks import send_payroll_reminders
            send_payroll_reminders()

        mock_delay.assert_not_called()

    def test_inactive_user_excluded(self, db, inactive_user):
        import datetime
        with (
            patch("django.utils.timezone.localdate", return_value=datetime.date(2026, 6, 25)),
            patch("core.tasks.dispatch_whatsapp_message.delay") as mock_delay,
        ):
            from hr.tasks import send_payroll_reminders
            send_payroll_reminders()

        mock_delay.assert_not_called()

    def test_variables_contain_pending_count(self, db, active_user):
        import datetime
        with (
            patch("django.utils.timezone.localdate", return_value=datetime.date(2026, 6, 25)),
            patch("core.tasks.dispatch_whatsapp_message.delay") as mock_delay,
        ):
            from hr.tasks import send_payroll_reminders
            send_payroll_reminders()

        variables = mock_delay.call_args.kwargs["variables"]
        assert "pending_count" in variables
        assert "manager_name" in variables
        assert variables["manager_name"] == active_user.full_name
