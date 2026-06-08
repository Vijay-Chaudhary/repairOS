"""
AMC Celery tasks — nightly scheduled operations.

mark_missed_visits         — flag overdue scheduled visits as missed
send_renewal_reminders     — WhatsApp reminder when contract nears expiry
send_visit_reminders       — WhatsApp reminder 2 days before a visit
process_auto_renewals      — auto-renew expired contracts (if auto_renew=True)
"""

import logging
from datetime import date, timedelta

from celery import shared_task
from django.utils import timezone

logger = logging.getLogger(__name__)


@shared_task(name="amc.mark_missed_visits", bind=True, max_retries=3)
def mark_missed_visits(self):
    """Nightly: mark scheduled visits past their date as missed, alert manager."""
    from .models import AMCVisit

    today = date.today()
    missed_qs = AMCVisit.objects.filter(
        status=AMCVisit.Status.SCHEDULED,
        scheduled_date__lt=today,
    ).select_related("contract", "contract__customer", "contract__shop")

    count = 0
    for visit in missed_qs:
        try:
            visit.status = AMCVisit.Status.MISSED
            visit.save(update_fields=["status", "updated_at"])
            _alert_manager_missed_visit(visit)
            count += 1
        except Exception as exc:
            logger.exception("Failed to process missed visit %s: %s", visit.id, exc)

    logger.info("Marked %d visits as missed", count)
    return count


@shared_task(name="amc.send_renewal_reminders", bind=True, max_retries=3)
def send_renewal_reminders(self):
    """Nightly: send renewal reminder once when within renewal_reminder_days of expiry."""
    from .models import AMCContract

    today = date.today()
    contracts = AMCContract.objects.filter(
        status=AMCContract.Status.ACTIVE,
        next_renewal_notified_at__isnull=True,
    ).select_related("customer", "shop")

    count = 0
    for contract in contracts:
        days_left = (contract.end_date - today).days
        if 0 <= days_left <= contract.renewal_reminder_days:
            try:
                _send_renewal_reminder(contract)
                contract.status = AMCContract.Status.PENDING_RENEWAL
                contract.next_renewal_notified_at = timezone.now()
                contract.save(update_fields=["status", "next_renewal_notified_at", "updated_at"])
                count += 1
            except Exception as exc:
                logger.exception("Renewal reminder failed for contract %s: %s",
                                 contract.contract_number, exc)

    logger.info("Sent %d renewal reminders", count)
    return count


@shared_task(name="amc.send_visit_reminders", bind=True, max_retries=3)
def send_visit_reminders(self):
    """Daily: remind customers of upcoming visits 2 days out."""
    from .models import AMCVisit

    target_date = date.today() + timedelta(days=2)
    visits = AMCVisit.objects.filter(
        status=AMCVisit.Status.SCHEDULED,
        scheduled_date=target_date,
    ).select_related("contract", "contract__customer", "technician")

    count = 0
    for visit in visits:
        try:
            if not visit.contract.customer.whatsapp_optout:
                _send_visit_reminder(visit)
            count += 1
        except Exception as exc:
            logger.exception("Visit reminder failed for visit %s: %s", visit.id, exc)

    logger.info("Sent %d visit reminders for %s", count, target_date)
    return count


@shared_task(name="amc.process_auto_renewals", bind=True, max_retries=3)
def process_auto_renewals(self):
    """Nightly: auto-renew expired contracts where auto_renew=True."""
    from .models import AMCContract
    from .services import renew_contract

    today = date.today()
    expired = AMCContract.objects.filter(
        auto_renew=True,
        status__in=[AMCContract.Status.ACTIVE, AMCContract.Status.PENDING_RENEWAL],
        end_date__lt=today,
    ).select_related("customer", "shop")

    count = 0
    for contract in expired:
        try:
            # No human triggered this — pass user=None so the audit trail
            # records it as system-initiated rather than misattributing it
            # to an arbitrary active user.
            renew_contract(contract, None)
            count += 1
        except Exception as exc:
            logger.exception("Auto-renewal failed for %s: %s", contract.contract_number, exc)

    logger.info("Auto-renewed %d contracts", count)
    return count


# ──────────────────────────────────────────────────────────────────────────────
# Notification stubs
# ──────────────────────────────────────────────────────────────────────────────


def _send_visit_reminder(visit) -> None:
    from .services import _send_whatsapp
    tech_name = visit.technician.full_name if visit.technician else "Our technician"
    _send_whatsapp(
        phone=visit.contract.customer.phone,
        template_name="amc_visit_reminder",
        variables={
            "customer_name": visit.contract.customer.name,
            "contract_title": visit.contract.title,
            "visit_date": str(visit.scheduled_date),
            "tech_name": tech_name,
        },
        customer=visit.contract.customer,
    )


def _send_renewal_reminder(contract) -> None:
    from .services import _send_whatsapp
    _send_whatsapp(
        phone=contract.customer.phone,
        template_name="amc_renewal_reminder",
        variables={
            "customer_name": contract.customer.name,
            "contract_title": contract.title,
            "expiry_date": str(contract.end_date),
            "renewal_value": str(contract.value),
        },
        customer=contract.customer,
    )


def _alert_manager_missed_visit(visit) -> None:
    from .services import _send_whatsapp
    _send_whatsapp(
        phone=visit.contract.shop.phone,
        template_name="amc_visit_missed_alert",
        variables={
            "manager_name": "Manager",
            "contract_title": visit.contract.title,
            "customer_name": visit.contract.customer.name,
            "scheduled_date": str(visit.scheduled_date),
        },
    )

