"""
Tests for Repair Celery beat tasks:
  send_warranty_expiry_reminders — WhatsApp reminder 7 days before warranty expires
"""

import datetime
from decimal import Decimal
from unittest.mock import patch

import pytest
from django.utils import timezone


@pytest.fixture
def shop(db):
    from core.models import Shop
    return Shop.objects.create(
        name="Repair Task Shop", code="RTK",
        address="1 Rd", city="Mumbai",
        state="Maharashtra", state_code="27",
        phone="+912200000001",
    )


@pytest.fixture
def admin_user(db):
    from authentication.models import User
    return User.objects.create_user(
        email="admin@repair.test",
        phone="+919000000010",
        full_name="Admin",
        password="pass",
    )


@pytest.fixture
def customer(db, shop):
    from crm.models import Customer
    return Customer.objects.create(
        shop=shop, name="Warranty Customer",
        phone="+919900000011",
        customer_type="individual",
        whatsapp_optout=False,
    )


@pytest.fixture
def opted_out_customer(db, shop):
    from crm.models import Customer
    return Customer.objects.create(
        shop=shop, name="Opted Out",
        phone="+919900000012",
        customer_type="individual",
        whatsapp_optout=True,
    )


def _closed_job(db, shop, customer, admin_user, warranty_expires_at):
    from repair.models import JobTicket
    return JobTicket.objects.create(
        shop=shop,
        customer=customer,
        job_number=f"J-{id(warranty_expires_at)}",
        status=JobTicket.Status.CLOSED,
        device_type="Phone",
        problem_description="Cracked screen",
        created_by=admin_user,
        warranty_expires_at=warranty_expires_at,
    )


@pytest.mark.django_db
class TestSendWarrantyExpiryReminders:
    def test_sends_for_job_expiring_in_7_days(self, db, shop, customer, admin_user):
        expiry = datetime.date.today() + datetime.timedelta(days=7)
        _closed_job(db, shop, customer, admin_user, expiry)

        with patch("core.tasks.dispatch_whatsapp_message.delay") as mock_delay:
            from repair.tasks import send_warranty_expiry_reminders
            count = send_warranty_expiry_reminders()

        assert count == 1
        call_kwargs = mock_delay.call_args.kwargs
        assert call_kwargs["template_name"] == "warranty_expiry_reminder"
        assert call_kwargs["phone"] == customer.phone

    def test_skips_opted_out_customer(self, db, shop, opted_out_customer, admin_user):
        expiry = datetime.date.today() + datetime.timedelta(days=7)
        _closed_job(db, shop, opted_out_customer, admin_user, expiry)

        with patch("core.tasks.dispatch_whatsapp_message.delay") as mock_delay:
            from repair.tasks import send_warranty_expiry_reminders
            count = send_warranty_expiry_reminders()

        assert count == 1  # counted even when opted out (exception path skips notify)
        mock_delay.assert_not_called()

    def test_does_not_fire_for_jobs_expiring_tomorrow(self, db, shop, customer, admin_user):
        expiry = datetime.date.today() + datetime.timedelta(days=1)
        _closed_job(db, shop, customer, admin_user, expiry)

        with patch("core.tasks.dispatch_whatsapp_message.delay") as mock_delay:
            from repair.tasks import send_warranty_expiry_reminders
            count = send_warranty_expiry_reminders()

        assert count == 0
        mock_delay.assert_not_called()

    def test_does_not_fire_for_non_closed_jobs(self, db, shop, customer, admin_user):
        from repair.models import JobTicket
        expiry = datetime.date.today() + datetime.timedelta(days=7)
        JobTicket.objects.create(
            shop=shop, customer=customer,
            job_number="J-OPEN-1",
            status=JobTicket.Status.OPEN,
            device_type="Phone",
            problem_description="Screen crack",
            created_by=admin_user,
            warranty_expires_at=expiry,
        )

        with patch("core.tasks.dispatch_whatsapp_message.delay") as mock_delay:
            from repair.tasks import send_warranty_expiry_reminders
            count = send_warranty_expiry_reminders()

        assert count == 0
        mock_delay.assert_not_called()

    def test_no_jobs_returns_zero(self, db):
        with patch("core.tasks.dispatch_whatsapp_message.delay") as mock_delay:
            from repair.tasks import send_warranty_expiry_reminders
            count = send_warranty_expiry_reminders()

        assert count == 0
        mock_delay.assert_not_called()
