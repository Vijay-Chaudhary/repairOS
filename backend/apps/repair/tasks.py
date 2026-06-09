"""
Repair module Celery tasks.
"""

import logging
from datetime import date, timedelta

from celery import shared_task

logger = logging.getLogger(__name__)


@shared_task(name="repair.send_warranty_expiry_reminders", bind=True, max_retries=3)
def send_warranty_expiry_reminders(self):
    """
    Nightly task: send WhatsApp reminder 7 days before warranty expires.
    """
    from .models import JobTicket

    reminder_date = date.today() + timedelta(days=7)
    jobs = JobTicket.objects.filter(
        status=JobTicket.Status.CLOSED,
        warranty_expires_at=reminder_date,
    ).select_related("customer", "shop")

    count = 0
    for job in jobs:
        try:
            if not job.customer.whatsapp_optout:
                _send_reminder(job)
            count += 1
        except Exception as exc:
            logger.exception("Warranty reminder failed for job %s: %s", job.job_number, exc)

    logger.info("Sent %d warranty expiry reminders for %s", count, reminder_date)
    return count


def _send_reminder(job) -> None:
    from core.notifications import send_whatsapp

    send_whatsapp(
        phone=job.customer.phone,
        template_name="warranty_expiry_reminder",
        variables={
            "customer_name": job.customer.name,
            "job_number": job.job_number,
            "device_type": job.device_type,
            "expiry_date": str(job.warranty_expires_at),
            "shop_phone": job.shop.phone,
        },
        customer=job.customer,
    )
