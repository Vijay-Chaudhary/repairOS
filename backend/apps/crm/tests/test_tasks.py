"""
Tests for CRM Celery beat tasks:
  mark_overdue_tasks     — transitions pending past-due tasks → overdue
  send_task_daily_digest — sends a digest to each assignee with tasks due today
"""

import datetime
from unittest.mock import patch

import pytest
from django.utils import timezone


@pytest.fixture
def shop(db):
    from core.models import Shop
    return Shop.objects.create(
        name="CRM Task Shop", code="CTK",
        address="1 Rd", city="Delhi",
        state="Delhi", state_code="07",
        phone="+919000000001",
    )


@pytest.fixture
def assignee(db):
    from authentication.models import User
    return User.objects.create_user(
        email="staff@crm.test",
        phone="+919111000001",
        full_name="Staff Member",
        password="pass",
    )


@pytest.fixture
def customer(db, shop):
    from crm.models import Customer
    return Customer.objects.create(
        shop=shop, name="Test Cust",
        phone="+919222000001",
        customer_type="individual",
    )


def _task(db, assignee, customer, due_date, status="pending"):
    from crm.models import FollowUpTask
    return FollowUpTask.objects.create(
        title="Call back",
        due_date=due_date,
        status=status,
        assigned_to=assignee,
        customer=customer,
    )


# ── mark_overdue_tasks ────────────────────────────────────────────────────────

@pytest.mark.django_db
class TestMarkOverdueTasks:
    def test_pending_past_due_transitions_to_overdue(self, db, assignee, customer):
        yesterday = timezone.now().date() - datetime.timedelta(days=1)
        task = _task(db, assignee, customer, due_date=yesterday, status="pending")

        with patch("core.tasks.dispatch_whatsapp_message.delay"):
            from crm.tasks import mark_overdue_tasks
            count = mark_overdue_tasks()

        assert count == 1
        task.refresh_from_db()
        assert task.status == "overdue"

    def test_future_task_stays_pending(self, db, assignee, customer):
        tomorrow = timezone.now().date() + datetime.timedelta(days=1)
        task = _task(db, assignee, customer, due_date=tomorrow, status="pending")

        with patch("core.tasks.dispatch_whatsapp_message.delay"):
            from crm.tasks import mark_overdue_tasks
            count = mark_overdue_tasks()

        assert count == 0
        task.refresh_from_db()
        assert task.status == "pending"

    def test_already_overdue_not_double_counted(self, db, assignee, customer):
        yesterday = timezone.now().date() - datetime.timedelta(days=1)
        _task(db, assignee, customer, due_date=yesterday, status="overdue")

        with patch("core.tasks.dispatch_whatsapp_message.delay"):
            from crm.tasks import mark_overdue_tasks
            count = mark_overdue_tasks()

        assert count == 0

    def test_multiple_tasks_all_transitioned(self, db, assignee, customer):
        yesterday = timezone.now().date() - datetime.timedelta(days=1)
        for i in range(3):
            _task(db, assignee, customer, due_date=yesterday, status="pending")

        with patch("core.tasks.dispatch_whatsapp_message.delay"):
            from crm.tasks import mark_overdue_tasks
            count = mark_overdue_tasks()

        assert count == 3
        from crm.models import FollowUpTask
        assert FollowUpTask.objects.filter(status="overdue").count() == 3


# ── send_task_daily_digest ────────────────────────────────────────────────────

@pytest.mark.django_db
class TestSendTaskDailyDigest:
    def test_sends_digest_for_assignee_with_tasks_today(self, db, assignee, customer):
        today = timezone.now().date()
        _task(db, assignee, customer, due_date=today, status="pending")

        with patch("core.tasks.dispatch_whatsapp_message.delay") as mock_delay:
            from crm.tasks import send_task_daily_digest
            send_task_daily_digest()

        mock_delay.assert_called()
        call_kwargs = mock_delay.call_args.kwargs
        assert call_kwargs["template_name"] == "task_daily_digest"
        assert call_kwargs["phone"] == assignee.phone

    def test_no_tasks_today_sends_nothing(self, db, assignee, customer):
        yesterday = timezone.now().date() - datetime.timedelta(days=1)
        _task(db, assignee, customer, due_date=yesterday, status="pending")

        with patch("core.tasks.dispatch_whatsapp_message.delay") as mock_delay:
            from crm.tasks import send_task_daily_digest
            send_task_daily_digest()

        mock_delay.assert_not_called()

    def test_completed_tasks_excluded_from_digest(self, db, assignee, customer):
        today = timezone.now().date()
        _task(db, assignee, customer, due_date=today, status="completed")

        with patch("core.tasks.dispatch_whatsapp_message.delay") as mock_delay:
            from crm.tasks import send_task_daily_digest
            send_task_daily_digest()

        mock_delay.assert_not_called()
