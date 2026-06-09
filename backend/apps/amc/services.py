"""
AMC business logic.

All state mutations, scheduling, and side-effect orchestration live here.
"""

import logging
from datetime import date, timedelta
from decimal import Decimal

from django.db import transaction
from django.utils import timezone

from authentication.models import AuditLog
from core.models import DocumentCounter

from .models import AMCContract, AMCRenewalInvoice, AMCVisit

logger = logging.getLogger(__name__)


# ──────────────────────────────────────────────────────────────────────────────
# Contract creation
# ──────────────────────────────────────────────────────────────────────────────


def create_contract(shop, customer, data: dict, user) -> AMCContract:
    """
    Create a contract, compute visit_interval_days, auto-schedule all visits,
    and return the saved contract.
    """
    year = timezone.now().year
    number = DocumentCounter.next(shop, year, DocumentCounter.DocType.AMC)
    contract_number = f"{shop.code}-AMC-{year}-{number:04d}"

    visits_per_year = int(data.get("visits_per_year", 0))
    visit_interval_days = AMCContract.compute_interval(visits_per_year)

    with transaction.atomic():
        contract = AMCContract.objects.create(
            shop=shop,
            customer=customer,
            contract_number=contract_number,
            visits_per_year=visits_per_year,
            visit_interval_days=visit_interval_days,
            created_by=user,
            **{k: v for k, v in data.items() if k not in ("visits_per_year",)},
        )
        _schedule_visits(contract)

    _write_audit(user, AuditLog.Action.CREATE, "AMCContract", contract.id)
    return contract


def _schedule_visits(contract: AMCContract) -> None:
    """
    Pre-schedule all visits for the contract period at equal intervals.
    Continues the visit_number sequence from any existing visits so this
    is safe to call on both initial creation and after renewal.
    If visits_per_year == 0, no visits are created.
    """
    if contract.visits_per_year <= 0 or contract.visit_interval_days <= 0:
        return

    last = AMCVisit.objects.filter(contract=contract).order_by("-visit_number").first()
    start_number = (last.visit_number + 1) if last else 1

    for i in range(contract.visits_per_year):
        scheduled_date = contract.start_date + timedelta(days=i * contract.visit_interval_days)
        if scheduled_date > contract.end_date:
            break
        AMCVisit.objects.create(
            contract=contract,
            visit_number=start_number + i,
            scheduled_date=scheduled_date,
            technician=contract.assigned_technician,
        )


# ──────────────────────────────────────────────────────────────────────────────
# Visit completion
# ──────────────────────────────────────────────────────────────────────────────


def complete_visit(visit: AMCVisit, data: dict, user) -> AMCVisit:
    from core.exceptions import BusinessRuleViolation

    if visit.status != AMCVisit.Status.SCHEDULED:
        raise BusinessRuleViolation(
            f"Cannot complete a visit with status '{visit.status}'."
        )

    contract = visit.contract
    today = date.today()
    # Compute next visit from scheduled_date (not today) to prevent cumulative drift
    next_date = visit.scheduled_date + timedelta(days=contract.visit_interval_days)

    with transaction.atomic():
        visit.status = AMCVisit.Status.COMPLETED
        visit.actual_date = today
        visit.work_done = data.get("work_done", "")
        visit.issues_found = data.get("issues_found", "")
        visit.customer_signature_url = data.get("customer_signature_url", "")
        visit.photos = data.get("photos", [])
        visit.job_id = data.get("job_id")

        # Compute and store next_visit_date if another visit falls within contract period
        if next_date <= contract.end_date and contract.visit_interval_days > 0:
            visit.next_visit_date = next_date
        else:
            visit.next_visit_date = None

        visit.save()

        # Auto-create the next visit if none exists at next_date and within period
        _maybe_create_next_visit(contract, visit, next_date)

    _write_audit(user, AuditLog.Action.UPDATE, "AMCVisit", visit.id,
                 new_value={"work_done": visit.work_done})

    _send_whatsapp(
        phone=contract.customer.phone,
        template_name="amc_visit_completed",
        variables={
            "customer_name": contract.customer.name,
            "contract_title": contract.title,
            "work_done_summary": visit.work_done[:200],
            "report_link": "",
        },
        customer=contract.customer,
    )

    return visit


def _maybe_create_next_visit(contract: AMCContract, completed_visit: AMCVisit, next_date: date) -> None:
    """
    If no visit is already scheduled at or near next_date, auto-create one.
    This handles the case where a visit is completed ahead of schedule and
    the subsequent scheduled visit hasn't been created yet.
    """
    if next_date > contract.end_date or contract.visit_interval_days <= 0:
        return

    # Check if a future scheduled visit already exists near next_date (within ±7 days)
    already_exists = AMCVisit.objects.filter(
        contract=contract,
        status=AMCVisit.Status.SCHEDULED,
        scheduled_date__gte=next_date - timedelta(days=7),
        scheduled_date__lte=next_date + timedelta(days=7),
    ).exists()

    if not already_exists:
        last_number = (
            AMCVisit.objects.filter(contract=contract).order_by("-visit_number").first()
        )
        next_number = (last_number.visit_number + 1) if last_number else 1
        AMCVisit.objects.create(
            contract=contract,
            visit_number=next_number,
            scheduled_date=next_date,
            technician=contract.assigned_technician,
        )


def reschedule_visit(visit: AMCVisit, new_date: date, user) -> AMCVisit:
    from core.exceptions import BusinessRuleViolation

    if visit.status not in (AMCVisit.Status.SCHEDULED, AMCVisit.Status.MISSED):
        raise BusinessRuleViolation(f"Cannot reschedule a visit with status '{visit.status}'.")

    visit.scheduled_date = new_date
    visit.status = AMCVisit.Status.RESCHEDULED
    visit.save(update_fields=["scheduled_date", "status", "updated_at"])
    return visit


# ──────────────────────────────────────────────────────────────────────────────
# Manual renewal
# ──────────────────────────────────────────────────────────────────────────────


def renew_contract(contract: AMCContract, user, new_end_date=None, new_value=None) -> AMCContract:
    """
    Manually renew a contract:
    1. Create an AMCRenewalInvoice (invoice_id stub until billing is built).
    2. Roll contract dates forward: use new_end_date if provided, else original duration.
    3. Optionally update contract value.
    4. Schedule visits for the new period.
    5. Set status to active.
    """
    from core.exceptions import BusinessRuleViolation

    if contract.status == AMCContract.Status.CANCELLED:
        raise BusinessRuleViolation("Cannot renew a cancelled contract.")

    original_duration = (contract.end_date - contract.start_date).days

    with transaction.atomic():
        new_start = contract.end_date + timedelta(days=1)
        new_end = new_end_date or (new_start + timedelta(days=original_duration))

        renewal = AMCRenewalInvoice.objects.create(
            contract=contract,
            renewal_period_start=new_start,
            renewal_period_end=new_end,
            sent_at=timezone.now(),
        )

        contract.start_date = new_start
        contract.end_date = new_end
        if new_value is not None:
            contract.value = new_value
        contract.status = AMCContract.Status.ACTIVE
        contract.next_renewal_notified_at = None  # reset reminder flag
        contract.save(
            update_fields=["start_date", "end_date", "value", "status", "next_renewal_notified_at", "updated_at"]
        )

        _schedule_visits(contract)

    _write_audit(user, AuditLog.Action.UPDATE, "AMCContract", contract.id,
                 new_value={"renewed_until": str(new_end)})

    _send_whatsapp(
        phone=contract.customer.phone,
        template_name="amc_renewal_invoice",
        variables={
            "customer_name": contract.customer.name,
            "contract_title": contract.title,
            "invoice_number": str(renewal.invoice_id or ""),
            "new_expiry_date": str(new_end),
        },
        customer=contract.customer,
    )

    return contract


# ──────────────────────────────────────────────────────────────────────────────
# Internal helpers
# ──────────────────────────────────────────────────────────────────────────────


def _write_audit(user, action, model_name, object_id, old_value=None, new_value=None):
    try:
        AuditLog.objects.create(
            user_id=user.id if user is not None else None,
            action=action,
            model_name=model_name,
            object_id=object_id,
            old_value=old_value,
            new_value=new_value,
        )
    except Exception:
        logger.exception("Audit log write failed")


def _send_whatsapp(phone, template_name: str, variables: dict, customer=None) -> None:
    from core.notifications import send_whatsapp
    send_whatsapp(phone=phone, template_name=template_name, variables=variables, customer=customer)
