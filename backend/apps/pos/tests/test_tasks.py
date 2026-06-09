"""
Tests for POS Celery beat tasks:
  send_wholesale_payment_reminders — remind B2B customers with outstanding balances past 30 days
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
        name="POS Task Shop", code="PTK",
        address="1 Rd", city="Delhi",
        state="Delhi", state_code="07",
        phone="+919000000001",
    )


@pytest.fixture
def admin_user(db):
    from authentication.models import User
    return User.objects.create_user(
        email="admin@pos.task.test",
        phone="+919000000050",
        full_name="Admin",
        password="pass",
    )


@pytest.fixture
def wholesale_customer(db, shop):
    from crm.models import Customer
    return Customer.objects.create(
        shop=shop, name="B2B Corp",
        phone="+919811100099",
        customer_type="business",
        whatsapp_optout=False,
    )


@pytest.fixture
def opted_out_customer(db, shop):
    from crm.models import Customer
    return Customer.objects.create(
        shop=shop, name="Opted Out B2B",
        phone="+919811100098",
        customer_type="business",
        whatsapp_optout=True,
    )


def _overdue_sale(shop, customer, admin_user, days_old=35, amount_outstanding=Decimal("5000")):
    from pos.models import Sale
    sale_date = timezone.now() - datetime.timedelta(days=days_old)
    return Sale.objects.create(
        shop=shop,
        customer=customer,
        sale_type=Sale.SaleType.WHOLESALE,
        sale_number=f"WS-{id(customer)}-{days_old}",
        status=Sale.Status.COMPLETED,
        grand_total=amount_outstanding,
        amount_outstanding=amount_outstanding,
        sale_date=sale_date,
        created_by=admin_user,
    )


@pytest.mark.django_db
class TestSendWholesalePaymentReminders:
    def test_sends_reminder_for_overdue_sale(self, db, shop, wholesale_customer, admin_user):
        _overdue_sale(shop, wholesale_customer, admin_user, days_old=35)

        with patch("core.tasks.dispatch_whatsapp_message.delay") as mock_delay:
            from pos.tasks import send_wholesale_payment_reminders
            count = send_wholesale_payment_reminders()

        assert count == 1
        call_kwargs = mock_delay.call_args.kwargs
        assert call_kwargs["template_name"] == "wholesale_payment_reminder"
        assert call_kwargs["phone"] == wholesale_customer.phone

    def test_skips_opted_out_customer(self, db, shop, opted_out_customer, admin_user):
        _overdue_sale(shop, opted_out_customer, admin_user, days_old=35)

        with patch("core.tasks.dispatch_whatsapp_message.delay") as mock_delay:
            from pos.tasks import send_wholesale_payment_reminders
            count = send_wholesale_payment_reminders()

        assert count == 1  # counted, but WhatsApp not dispatched
        mock_delay.assert_not_called()

    def test_does_not_send_for_recent_sale(self, db, shop, wholesale_customer, admin_user):
        _overdue_sale(shop, wholesale_customer, admin_user, days_old=10)

        with patch("core.tasks.dispatch_whatsapp_message.delay") as mock_delay:
            from pos.tasks import send_wholesale_payment_reminders
            count = send_wholesale_payment_reminders()

        assert count == 0
        mock_delay.assert_not_called()

    def test_does_not_send_when_nothing_outstanding(self, db, shop, wholesale_customer, admin_user):
        from pos.models import Sale
        sale_date = timezone.now() - datetime.timedelta(days=35)
        Sale.objects.create(
            shop=shop,
            customer=wholesale_customer,
            sale_type=Sale.SaleType.WHOLESALE,
            sale_number="WS-PAID-01",
            status=Sale.Status.COMPLETED,
            grand_total=Decimal("5000"),
            amount_outstanding=Decimal("0"),
            sale_date=sale_date,
            created_by=admin_user,
        )

        with patch("core.tasks.dispatch_whatsapp_message.delay") as mock_delay:
            from pos.tasks import send_wholesale_payment_reminders
            count = send_wholesale_payment_reminders()

        assert count == 0
        mock_delay.assert_not_called()

    def test_counter_sale_not_included(self, db, shop, wholesale_customer, admin_user):
        from pos.models import Sale
        sale_date = timezone.now() - datetime.timedelta(days=35)
        Sale.objects.create(
            shop=shop,
            customer=wholesale_customer,
            sale_type=Sale.SaleType.COUNTER,
            sale_number="CTR-01",
            status=Sale.Status.COMPLETED,
            grand_total=Decimal("5000"),
            amount_outstanding=Decimal("5000"),
            sale_date=sale_date,
            created_by=admin_user,
        )

        with patch("core.tasks.dispatch_whatsapp_message.delay") as mock_delay:
            from pos.tasks import send_wholesale_payment_reminders
            count = send_wholesale_payment_reminders()

        assert count == 0
        mock_delay.assert_not_called()
