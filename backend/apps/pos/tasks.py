"""
POS Celery tasks — wholesale payment reminders.
"""

import logging
from datetime import date, timedelta

from celery import shared_task

logger = logging.getLogger(__name__)


@shared_task(name="pos.send_wholesale_payment_reminders", bind=True, max_retries=3)
def send_wholesale_payment_reminders(self):
    """
    Nightly task: remind wholesale customers with outstanding balances past 30 days.
    """
    from .models import Sale

    cutoff = date.today() - timedelta(days=30)
    overdue_sales = (
        Sale.objects.filter(
            sale_type=Sale.SaleType.WHOLESALE,
            status__in=[Sale.Status.COMPLETED, Sale.Status.PARTIALLY_PAID],
            amount_outstanding__gt=0,
            sale_date__date__lte=cutoff,
        )
        .select_related("customer", "shop")
    )

    count = 0
    for sale in overdue_sales:
        try:
            if sale.customer and not sale.customer.whatsapp_optout:
                _send_reminder(sale)
            count += 1
        except Exception as exc:
            logger.exception("Payment reminder failed for sale %s: %s", sale.sale_number, exc)

    logger.info("Sent %d wholesale payment reminders", count)
    return count


def _send_reminder(sale) -> None:
    from .services import _send_whatsapp

    _send_whatsapp(
        phone=sale.customer.phone,
        template_name="wholesale_payment_reminder",
        variables={
            "customer_name": sale.customer.name,
            "sale_number": sale.sale_number,
            "outstanding": str(sale.amount_outstanding),
            "payment_link": "",
        },
        customer=sale.customer,
    )
