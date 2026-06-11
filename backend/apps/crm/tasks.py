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
    newly_overdue_qs = FollowUpTask.objects.filter(
        status=FollowUpTask.Status.PENDING,
        due_date__lt=today,
    )
    newly_overdue_ids = list(newly_overdue_qs.values_list("id", flat=True))
    updated = newly_overdue_qs.update(status=FollowUpTask.Status.OVERDUE)

    logger.info("Marked %d tasks as overdue.", updated)

    # Notify assignees of every task that just transitioned to overdue in this run —
    # not just ones exactly one day overdue, so a multi-day outage doesn't skip notifications.
    overdue_tasks = FollowUpTask.objects.filter(
        id__in=newly_overdue_ids,
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
            from core.notifications import send_whatsapp
            send_whatsapp(
                phone=customer.phone,
                template_name=template_name,
                variables={**variables, "customer_name": customer.name},
                customer=customer,
            )
            sent += 1
        except Exception as exc:
            logger.warning("WhatsApp failed for customer %s: %s", customer.id, exc)
            failed += 1

    logger.info(
        "Bulk WhatsApp: template=%s sent=%d failed=%d", template_name, sent, failed
    )
    return {"sent": sent, "failed": failed}


@shared_task(name="crm.send_lead_assigned_notification", bind=True, max_retries=3)
def send_lead_assigned_notification(self, lead_id: str, assignee_id: str) -> None:
    """Notify a staff member that a lead has been assigned to them."""
    from authentication.models import User
    from .models import Lead

    try:
        lead = Lead.objects.get(pk=lead_id)
        assignee = User.objects.get(pk=assignee_id)
    except (Lead.DoesNotExist, User.DoesNotExist):
        logger.warning(
            "send_lead_assigned_notification: lead %s or user %s not found", lead_id, assignee_id
        )
        return

    if not getattr(assignee, "phone", None):
        return

    from core.notifications import send_whatsapp
    send_whatsapp(
        phone=assignee.phone,
        template_name="lead_assigned",
        variables={
            "staff_name": assignee.full_name,
            "lead_name": lead.name,
            "lead_phone": lead.phone,
            "source": lead.get_source_display(),
        },
    )


def _notify_task_overdue(task) -> None:
    from core.notifications import send_whatsapp
    customer_name = ""
    if task.customer:
        customer_name = task.customer.name
    elif task.lead:
        customer_name = task.lead.name

    send_whatsapp(
        phone=task.assigned_to.phone,
        template_name="task_overdue",
        variables={
            "staff_name": task.assigned_to.full_name,
            "task_title": task.title,
            "due_date": str(task.due_date),
        },
    )


def _send_daily_digest(user, tasks: list) -> None:
    from core.notifications import send_whatsapp
    task_list = "; ".join(t.title for t in tasks[:5])
    send_whatsapp(
        phone=user.phone,
        template_name="task_daily_digest",
        variables={
            "staff_name": user.full_name,
            "task_count": str(len(tasks)),
            "task_list": task_list,
        },
    )
