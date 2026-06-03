"""
CRM Celery tasks:
  mark_overdue_tasks     — midnight daily; transitions pending past-due tasks → overdue
  send_task_daily_digest — 8AM daily; notifies each staff member of today's tasks
  send_bulk_whatsapp_segment — background task for bulk segment sends
"""

import logging
from datetime import date

from celery import shared_task
from django.utils import timezone

logger = logging.getLogger(__name__)


@shared_task(name="crm.mark_overdue_tasks", bind=True, max_retries=3)
def mark_overdue_tasks(self):
    from .models import FollowUpTask

    today = timezone.now().date()
    updated = FollowUpTask.objects.filter(
        status=FollowUpTask.Status.PENDING,
        due_date__lt=today,
    ).update(status=FollowUpTask.Status.OVERDUE)

    logger.info("Marked %d tasks as overdue.", updated)

    # Notify assignees of newly overdue tasks
    overdue_tasks = FollowUpTask.objects.filter(
        status=FollowUpTask.Status.OVERDUE,
        due_date=today - timezone.timedelta(days=1),  # tasks that became overdue today
    ).select_related("assigned_to", "customer", "lead")

    for task in overdue_tasks:
        try:
            _notify_task_overdue(task)
        except Exception as exc:
            logger.exception("Failed to send overdue notification for task %s: %s", task.id, exc)

    return updated


@shared_task(name="crm.send_task_daily_digest", bind=True, max_retries=3)
def send_task_daily_digest(self):
    from authentication.models import User
    from .models import FollowUpTask

    today = timezone.now().date()
    staff_with_tasks = (
        FollowUpTask.objects.filter(
            due_date=today,
            status__in=[FollowUpTask.Status.PENDING, FollowUpTask.Status.OVERDUE],
        )
        .values_list("assigned_to_id", flat=True)
        .distinct()
    )

    for user_id in staff_with_tasks:
        try:
            user = User.objects.get(pk=user_id)
            tasks = FollowUpTask.objects.filter(
                assigned_to_id=user_id,
                due_date=today,
                status__in=[FollowUpTask.Status.PENDING, FollowUpTask.Status.OVERDUE],
            ).select_related("customer", "lead")

            _send_daily_digest(user, list(tasks))
        except Exception as exc:
            logger.exception("Daily digest failed for user %s: %s", user_id, exc)


@shared_task(name="crm.send_bulk_whatsapp_segment", bind=True, max_retries=3)
def send_bulk_whatsapp_segment(self, customer_ids: list, template_name: str, variables: dict):
    from .models import Customer

    customers = Customer.objects.filter(id__in=customer_ids, whatsapp_optout=False)
    sent = 0
    failed = 0

    for customer in customers:
        try:
            _send_whatsapp(
                phone=customer.phone,
                template_name=template_name,
                variables={**variables, "customer_name": customer.name},
            )
            sent += 1
        except Exception as exc:
            logger.warning("WhatsApp failed for customer %s: %s", customer.id, exc)
            failed += 1

    logger.info(
        "Bulk WhatsApp: template=%s sent=%d failed=%d", template_name, sent, failed
    )
    return {"sent": sent, "failed": failed}


# ──────────────────────────────────────────────────────────────────────────────
# Internal helpers (stubs — real implementation connects to Meta Cloud API)
# ──────────────────────────────────────────────────────────────────────────────


def _notify_task_overdue(task) -> None:
    customer_name = ""
    if task.customer:
        customer_name = task.customer.name
    elif task.lead:
        customer_name = task.lead.name

    _send_whatsapp(
        phone=task.assigned_to.phone,
        template_name="task_overdue",
        variables={
            "task_title": task.title,
            "due_date": str(task.due_date),
            "customer_name": customer_name,
        },
    )


def _send_daily_digest(user, tasks: list) -> None:
    task_list = "; ".join(t.title for t in tasks[:5])
    _send_whatsapp(
        phone=user.phone,
        template_name="task_daily_digest",
        variables={
            "staff_name": user.full_name,
            "task_count": str(len(tasks)),
            "task_list": task_list,
        },
    )


def _send_whatsapp(phone: str, template_name: str, variables: dict) -> None:
    # TODO: integrate with Meta Cloud API / notification service
    logger.debug("WhatsApp → %s template=%s vars=%s", phone, template_name, variables)
