"""
Procurement Celery tasks.

send_bill_due_reminders — daily beat task: emails shop admins for purchase
                          invoices due in 3 days that are unpaid/partially paid.
"""

import logging

from celery import shared_task
from django.utils import timezone

logger = logging.getLogger(__name__)


@shared_task(name="procurement.send_bill_due_reminders")
def send_bill_due_reminders() -> None:
    """
    Find purchase invoices due in exactly 3 days that are not fully paid,
    and email the shop address as a payment reminder.
    """
    from datetime import timedelta
    from core.notifications import send_email
    from .models import PurchaseInvoice

    target_date = timezone.localdate() + timedelta(days=3)

    invoices = (
        PurchaseInvoice.objects.filter(
            due_date=target_date,
        )
        .exclude(payment_status=PurchaseInvoice.PaymentStatus.PAID)
        .select_related("supplier", "shop")
    )

    sent = 0
    for invoice in invoices:
        recipient = invoice.shop.email
        if not recipient:
            logger.debug(
                "purchase_bill_due: shop %s has no email, skipping invoice %s",
                invoice.shop.code,
                invoice.bill_number,
            )
            continue

        body = (
            f"Dear Manager,\n\n"
            f"This is a reminder that the following purchase bill is due in 3 days:\n\n"
            f"  Supplier     : {invoice.supplier.name}\n"
            f"  Bill Number  : {invoice.bill_number}\n"
            f"  Amount Due   : {invoice.grand_total - invoice.amount_paid}\n"
            f"  Due Date     : {invoice.due_date}\n\n"
            f"Please arrange payment at the earliest.\n\n"
            f"Regards,\nRepairOS"
        )
        send_email(
            to=recipient,
            subject=f"Payment Reminder: {invoice.bill_number} due {invoice.due_date}",
            body=body,
            template_name="purchase_bill_due",
        )
        sent += 1

    logger.info("send_bill_due_reminders: queued %d reminders for due_date=%s", sent, target_date)
