"""
Repair module business logic.

All state mutations, validations, and side-effect orchestration live here.
Views only handle HTTP plumbing; models only define structure.
"""

import logging
import secrets
from datetime import date, timedelta
from decimal import Decimal
from typing import Optional

from django.db import transaction
from django.utils import timezone

from authentication.models import AuditLog
from core.models import DocumentCounter
from core.notifications import send_whatsapp

from .models import (
    FaultTemplate,
    FaultTemplatePart,
    JobCheckinCondition,
    JobEstimate,
    JobSparePartRequest,
    JobStage,
    JobTicket,
)

logger = logging.getLogger(__name__)

# Default warranty period when shop/device-type settings are not yet available.
# Replace with a settings lookup when the platform-admin module is built.
DEFAULT_WARRANTY_DAYS = 30

# ──────────────────────────────────────────────────────────────────────────────
# Status transition map  (spec §4.1)
# ──────────────────────────────────────────────────────────────────────────────

VALID_TRANSITIONS: dict[str, set[str]] = {
    JobTicket.Status.DRAFT: {JobTicket.Status.OPEN},
    JobTicket.Status.OPEN: {
        JobTicket.Status.IN_PROGRESS,
        JobTicket.Status.ESTIMATED,
        JobTicket.Status.CANCELLED,
    },
    JobTicket.Status.ESTIMATED: {JobTicket.Status.ESTIMATE_SENT, JobTicket.Status.OPEN},
    JobTicket.Status.ESTIMATE_SENT: {
        JobTicket.Status.ESTIMATE_APPROVED,
        JobTicket.Status.ESTIMATE_REJECTED,
        JobTicket.Status.IN_PROGRESS,
    },
    JobTicket.Status.ESTIMATE_APPROVED: {JobTicket.Status.IN_PROGRESS},
    JobTicket.Status.ESTIMATE_REJECTED: {
        JobTicket.Status.ESTIMATED,
        JobTicket.Status.CANCELLED,
    },
    JobTicket.Status.IN_PROGRESS: {
        JobTicket.Status.ON_HOLD,
        JobTicket.Status.READY_FOR_QC,
        JobTicket.Status.READY_FOR_PICKUP,
        JobTicket.Status.CANCELLED,
    },
    JobTicket.Status.ON_HOLD: {JobTicket.Status.IN_PROGRESS, JobTicket.Status.CANCELLED},
    JobTicket.Status.READY_FOR_QC: {
        JobTicket.Status.READY_FOR_PICKUP,
        JobTicket.Status.QC_FAILED,
    },
    JobTicket.Status.QC_FAILED: {JobTicket.Status.IN_PROGRESS},
    JobTicket.Status.READY_FOR_PICKUP: {
        JobTicket.Status.DELIVERED,
        JobTicket.Status.IN_PROGRESS,
    },
    JobTicket.Status.DELIVERED: {JobTicket.Status.CLOSED},
    JobTicket.Status.CLOSED: set(),
    JobTicket.Status.CANCELLED: {JobTicket.Status.OPEN},  # re-open (Tenant Admin only)
}


# ──────────────────────────────────────────────────────────────────────────────
# Job creation
# ──────────────────────────────────────────────────────────────────────────────


def create_job(shop, customer, data: dict, user) -> JobTicket:
    """
    Create a job ticket, generate its job number atomically, and optionally
    pre-fill from a fault template.
    """
    from core.models import DocumentCounter

    year = timezone.now().year
    number = DocumentCounter.next(shop, year, DocumentCounter.DocType.JOB)
    job_number = f"{shop.code}-{year}-{number:04d}"

    template: Optional[FaultTemplate] = data.pop("template", None)

    # Seed from template if provided
    if template:
        data.setdefault("problem_description", template.problem_description)
        data.setdefault("service_charge", template.default_sc)

    job = JobTicket.objects.create(
        shop=shop,
        customer=customer,
        job_number=job_number,
        template=template,
        created_by=user,
        **data,
    )

    if template:
        for part in template.parts.all():
            JobSparePartRequest.objects.create(
                job=job,
                requested_by=user,
                variant_id=part.variant_id,
                custom_part_name=part.custom_part_name,
                quantity=part.quantity,
            )

    _write_audit(user, AuditLog.Action.CREATE, "JobTicket", job.id, new_value={"job_number": job_number})

    # Broadcast to shop channel
    _broadcast(shop.id, "job.created", {
        "job_id": str(job.id),
        "job_number": job.job_number,
        "customer_name": customer.name,
        "device_type": job.device_type,
        "priority": job.priority,
    })

    return job


# ──────────────────────────────────────────────────────────────────────────────
# Status transitions
# ──────────────────────────────────────────────────────────────────────────────


def transition_job(job: JobTicket, to_status: str, user, reason: str = "", is_tenant_wide: bool = False) -> JobTicket:
    from core.exceptions import BusinessRuleViolation, InvalidStatusTransition

    allowed = VALID_TRANSITIONS.get(job.status, set())
    if to_status not in allowed:
        raise InvalidStatusTransition(job.status, to_status)

    # Business-rule guards
    if to_status == JobTicket.Status.OPEN:
        _guard_open(job, user, reason, is_tenant_wide)

    if to_status == JobTicket.Status.ON_HOLD and not reason:
        raise BusinessRuleViolation("A reason is required when placing a job on hold.")

    if to_status == JobTicket.Status.READY_FOR_QC:
        _guard_ready_for_qc(job)

    old_status = job.status
    job.status = to_status
    update_fields = ["status", "updated_at"]

    if to_status == JobTicket.Status.CLOSED:
        _on_close(job)
        update_fields += ["warranty_days", "warranty_expires_at"]

    job.save(update_fields=update_fields)

    _write_audit(user, AuditLog.Action.UPDATE, "JobTicket", job.id,
                 old_value={"status": old_status}, new_value={"status": to_status, "reason": reason})

    _broadcast(job.shop_id, "job.status_changed", {
        "job_id": str(job.id),
        "job_number": job.job_number,
        "customer_name": job.customer.name,
        "old_status": old_status,
        "new_status": to_status,
    })

    _send_status_notification(job, to_status, reason)
    return job


def _guard_open(job: JobTicket, user, reason: str, is_tenant_wide: bool = False) -> None:
    from core.exceptions import BusinessRuleViolation

    has_checkin = JobCheckinCondition.objects.filter(job=job).exists()
    if has_checkin:
        return

    # Only Tenant Admin may bypass the check-in requirement
    if reason:
        if not is_tenant_wide:
            raise BusinessRuleViolation("Only Tenant Admin may skip check-in.")
        _write_audit(user, AuditLog.Action.UPDATE, "JobTicket", job.id,
                     new_value={"bypass_checkin_reason": reason})
        return

    raise BusinessRuleViolation(
        "A check-in form must be submitted before opening a job. "
        "Pass 'reason' to override (Tenant Admin only)."
    )


def _guard_ready_for_qc(job: JobTicket) -> None:
    from core.exceptions import BusinessRuleViolation

    non_complete = job.stages.exclude(
        stage_type__in=[JobStage.StageType.QC, JobStage.StageType.PACKING]
    ).exclude(status__in=[JobStage.StageStatus.COMPLETED, JobStage.StageStatus.SKIPPED])

    if non_complete.exists():
        raise BusinessRuleViolation(
            "All non-QC/packing stages must be completed or skipped before moving to ready_for_qc."
        )


def _on_close(job: JobTicket) -> None:
    job.warranty_days = DEFAULT_WARRANTY_DAYS
    job.warranty_expires_at = date.today() + timedelta(days=DEFAULT_WARRANTY_DAYS)

    # Update customer total_jobs counter and last_visit (CRM denormalization)
    try:
        from crm.models import Customer
        Customer.objects.filter(pk=job.customer_id).update(
            total_jobs=models.F("total_jobs") + 1,
            last_visit=timezone.now(),
        )
    except Exception:
        logger.exception("Failed to update customer total_jobs for job %s", job.id)

    # Accrue technician commission (no-op when no rule applies)
    try:
        from commissions.services import accrue_commission
        accrue_commission(job)
    except Exception:
        logger.exception("Commission accrual failed for job %s", job.job_number)

    # Deduct received spare parts from inventory stock
    try:
        from inventory.models import ProductVariant
        from inventory.services import record_repair_out
        received = job.spare_part_requests.filter(
            status=JobSparePartRequest.RequestStatus.RECEIVED,
            variant_id__isnull=False,
        )
        for req in received:
            try:
                variant = ProductVariant.objects.get(pk=req.variant_id)
                record_repair_out(
                    shop=job.shop,
                    variant=variant,
                    qty=Decimal(str(req.quantity)),
                    job_id=job.id,
                    user=job.created_by,
                )
            except ProductVariant.DoesNotExist:
                logger.warning(
                    "Variant %s not found for spare part request %s on job %s — skipping",
                    req.variant_id, req.id, job.job_number,
                )
    except Exception:
        logger.exception("Stock deduction failed for job %s", job.job_number)


# ──────────────────────────────────────────────────────────────────────────────
# Check-in
# ──────────────────────────────────────────────────────────────────────────────


def submit_checkin(job: JobTicket, data: dict, user) -> JobCheckinCondition:
    from core.exceptions import BusinessRuleViolation

    if job.status != JobTicket.Status.DRAFT:
        raise BusinessRuleViolation("Check-in can only be submitted for draft jobs.")

    checkin, created = JobCheckinCondition.objects.update_or_create(
        job=job, defaults=data
    )
    _write_audit(user, AuditLog.Action.CREATE if created else AuditLog.Action.UPDATE,
                 "JobCheckinCondition", checkin.id)
    return checkin


# ──────────────────────────────────────────────────────────────────────────────
# Estimates
# ──────────────────────────────────────────────────────────────────────────────


def create_estimate(job: JobTicket, data: dict, user) -> JobEstimate:
    from core.exceptions import BusinessRuleViolation

    if job.status not in (JobTicket.Status.OPEN, JobTicket.Status.ESTIMATED):
        raise BusinessRuleViolation("Estimates can only be created for open or estimated jobs.")

    year = timezone.now().year
    from core.models import DocumentCounter
    number = DocumentCounter.next(job.shop, year, DocumentCounter.DocType.ESTIMATE)
    estimate_number = f"{job.shop.code}-EST-{year}-{number:04d}"

    labor_charge = Decimal(str(data["labor_charge"]))
    parts_cost = Decimal(str(data.get("parts_cost", 0)))

    send_via = data.pop("send_via", None)

    estimate = JobEstimate.objects.create(
        job=job,
        estimate_number=estimate_number,
        labor_charge=labor_charge,
        parts_cost=parts_cost,
        total_estimate=labor_charge + parts_cost,
        valid_until=data.get("valid_until"),
        notes=data.get("notes", ""),
        status=JobEstimate.Status.SENT if send_via else JobEstimate.Status.DRAFT,
        sent_at=timezone.now() if send_via else None,
    )

    if send_via:
        _transition_estimate_sent(job, estimate, user)

    _write_audit(user, AuditLog.Action.CREATE, "JobEstimate", estimate.id)
    return estimate


def _transition_estimate_sent(job: JobTicket, estimate: JobEstimate, user) -> None:
    """Move job to estimated/estimate_sent and fire WhatsApp notification."""
    if job.status == JobTicket.Status.OPEN:
        job.status = JobTicket.Status.ESTIMATE_SENT
        job.save(update_fields=["status", "updated_at"])

    approval_link = f"https://app.repaiross.app/e/{estimate.id}"
    send_whatsapp(
        phone=job.customer.phone,
        template_name="repair_estimate",
        variables={
            "customer_name": job.customer.name,
            "job_number": job.job_number,
            "total_amount": str(estimate.total_estimate),
            "valid_until": str(estimate.valid_until or ""),
            "approval_link": approval_link,
        },
        customer=job.customer,
    )


def respond_to_estimate(estimate: JobEstimate, response: str, method: str, user) -> JobEstimate:
    """Customer approves or rejects the estimate."""
    from core.exceptions import BusinessRuleViolation

    if estimate.status not in (JobEstimate.Status.SENT, JobEstimate.Status.DRAFT):
        raise BusinessRuleViolation(f"Cannot respond to an estimate with status '{estimate.status}'.")

    estimate.customer_response_at = timezone.now()
    estimate.customer_response_method = method

    job = estimate.job

    if response == "approved":
        estimate.status = JobEstimate.Status.APPROVED
        # §4.4: SC = estimate.labor_charge on approval
        job.service_charge = estimate.labor_charge
        job.status = JobTicket.Status.ESTIMATE_APPROVED
        job.save(update_fields=["service_charge", "status", "updated_at"])

        # Notify assigned technician
        first_stage = job.stages.filter(stage_order=1).first()
        if first_stage:
            send_whatsapp(
                phone=first_stage.assigned_technician.phone,
                template_name="estimate_approved_staff",
                variables={
                    "tech_name": first_stage.assigned_technician.full_name,
                    "job_number": job.job_number,
                    "device_type": job.device_type,
                },
            )

        # Log CRM communication
        _log_crm_comm(job, method, f"Estimate {estimate.estimate_number} approved.", user)

    elif response == "rejected":
        estimate.status = JobEstimate.Status.REJECTED
        job.status = JobTicket.Status.ESTIMATE_REJECTED
        job.save(update_fields=["status", "updated_at"])

    estimate.save(update_fields=["status", "customer_response_at", "customer_response_method", "updated_at"])
    _write_audit(user, AuditLog.Action.UPDATE, "JobEstimate", estimate.id,
                 new_value={"response": response})
    return estimate


# ──────────────────────────────────────────────────────────────────────────────
# Stages
# ──────────────────────────────────────────────────────────────────────────────


def set_stages(job: JobTicket, stages_data: list, user) -> list:
    """Define or replace the stage workflow for a job."""
    with transaction.atomic():
        # Remove existing pending stages only (don't delete started stages)
        job.stages.filter(status=JobStage.StageStatus.PENDING).delete()

        created = []
        for item in stages_data:
            stage = JobStage.objects.create(
                job=job,
                stage_order=item["stage_order"],
                stage_type=item["stage_type"],
                assigned_technician_id=item["assigned_technician_id"],
            )
            created.append(stage)

    _write_audit(user, AuditLog.Action.UPDATE, "JobTicket", job.id,
                 new_value={"stages_set": len(created)})
    return created


def advance_stage(stage: JobStage, action: str, notes: str, user) -> JobStage:
    """
    Advance a stage: action is 'complete' or 'skip'.

    Completing auto-starts the next pending stage and sends stage_handoff
    WhatsApp to the next technician.
    """
    from core.exceptions import BusinessRuleViolation

    if stage.status not in (JobStage.StageStatus.PENDING, JobStage.StageStatus.IN_PROGRESS):
        raise BusinessRuleViolation(f"Cannot advance a stage with status '{stage.status}'.")

    with transaction.atomic():
        if action == "complete":
            # Guard: no other stage should be in_progress
            in_progress_count = stage.job.stages.filter(
                status=JobStage.StageStatus.IN_PROGRESS
            ).exclude(pk=stage.pk).count()
            if in_progress_count > 0:
                raise BusinessRuleViolation("Another stage is already in progress for this job.")

            if stage.status == JobStage.StageStatus.PENDING:
                stage.started_at = timezone.now()

            stage.status = JobStage.StageStatus.COMPLETED
            stage.completed_at = timezone.now()
            stage.notes = notes
            stage.save(update_fields=["status", "started_at", "completed_at", "notes", "updated_at"])

            # Auto-start next pending stage
            next_stage = (
                stage.job.stages.filter(
                    stage_order__gt=stage.stage_order,
                    status=JobStage.StageStatus.PENDING,
                )
                .order_by("stage_order")
                .first()
            )
            if next_stage:
                next_stage.status = JobStage.StageStatus.IN_PROGRESS
                next_stage.started_at = timezone.now()
                next_stage.save(update_fields=["status", "started_at", "updated_at"])

                send_whatsapp(
                    phone=next_stage.assigned_technician.phone,
                    template_name="stage_handoff",
                    variables={
                        "tech_name": next_stage.assigned_technician.full_name,
                        "job_number": stage.job.job_number,
                        "stage_type": next_stage.stage_type,
                    },
                )
                _broadcast(stage.job.shop_id, "stage.handoff", {
                    "job_id": str(stage.job_id),
                    "stage_type": next_stage.stage_type,
                    "assigned_tech_id": str(next_stage.assigned_technician_id),
                    "tech_name": next_stage.assigned_technician.full_name,
                })

        elif action == "skip":
            stage.status = JobStage.StageStatus.SKIPPED
            stage.notes = notes
            stage.save(update_fields=["status", "notes", "updated_at"])
        else:
            raise BusinessRuleViolation(f"Unknown stage action '{action}'.")

    _write_audit(user, AuditLog.Action.UPDATE, "JobStage", stage.id,
                 new_value={"action": action})
    return stage


def start_stage(stage: JobStage, user) -> JobStage:
    """Manually start a pending stage (for the first stage or out-of-order start)."""
    from core.exceptions import BusinessRuleViolation

    in_progress = stage.job.stages.filter(
        status=JobStage.StageStatus.IN_PROGRESS
    ).exclude(pk=stage.pk).exists()
    if in_progress:
        raise BusinessRuleViolation("Another stage is already in progress.")

    stage.status = JobStage.StageStatus.IN_PROGRESS
    stage.started_at = timezone.now()
    stage.save(update_fields=["status", "started_at", "updated_at"])
    return stage


# ──────────────────────────────────────────────────────────────────────────────
# Spare-part requests
# ──────────────────────────────────────────────────────────────────────────────


def request_spare_part(job: JobTicket, data: dict, user) -> JobSparePartRequest:
    variant_id = data.get("variant_id")
    if variant_id:
        from inventory.models import InventoryStock
        from core.exceptions import InsufficientStock
        requested_qty = data.get("quantity", 1)
        stock = InventoryStock.objects.filter(
            shop_id=job.shop_id, variant_id=variant_id
        ).first()
        available = stock.quantity_in_stock if stock else 0
        if available < requested_qty:
            raise InsufficientStock(
                detail=f"Insufficient stock: {available} available, {requested_qty} requested."
            )

    req = JobSparePartRequest.objects.create(
        job=job,
        requested_by=user,
        **data,
    )

    if req.is_urgent:
        # Notify shop manager — find any manager user (stub: notify first admin)
        _send_shop_notification(
            shop_id=job.shop_id,
            template_name="spare_part_request",
            variables={
                "manager_name": "Manager",
                "tech_name": user.full_name,
                "job_number": job.job_number,
                "part_name": req.custom_part_name or str(req.variant_id),
            },
        )
    return req


def review_spare_part(req: JobSparePartRequest, status: str, reviewer, po_id=None) -> JobSparePartRequest:
    from core.exceptions import BusinessRuleViolation

    valid_reviews = {
        JobSparePartRequest.RequestStatus.REQUESTED: {
            JobSparePartRequest.RequestStatus.APPROVED,
            JobSparePartRequest.RequestStatus.REJECTED,
        },
        JobSparePartRequest.RequestStatus.APPROVED: {
            JobSparePartRequest.RequestStatus.ORDERED,
        },
        JobSparePartRequest.RequestStatus.ORDERED: {
            JobSparePartRequest.RequestStatus.RECEIVED,
        },
    }
    allowed = valid_reviews.get(req.status, set())
    if status not in allowed:
        raise BusinessRuleViolation(f"Cannot move spare part request from '{req.status}' to '{status}'.")

    req.status = status
    req.reviewed_by = reviewer
    if po_id:
        req.po_id = po_id
    req.save(update_fields=["status", "reviewed_by", "po_id", "updated_at"])

    if status == JobSparePartRequest.RequestStatus.RECEIVED:
        send_whatsapp(
            phone=req.requested_by.phone,
            template_name="spare_part_received",
            variables={
                "tech_name": req.requested_by.full_name,
                "part_name": req.custom_part_name or str(req.variant_id),
                "job_number": req.job.job_number,
            },
        )
    return req


# ──────────────────────────────────────────────────────────────────────────────
# Warranty claims
# ──────────────────────────────────────────────────────────────────────────────


def create_warranty_claim(original_job: JobTicket, user) -> JobTicket:
    from core.exceptions import BusinessRuleViolation
    from core.models import DocumentCounter

    if original_job.warranty_expires_at is None:
        raise BusinessRuleViolation("Original job has no warranty expiry set.")
    if date.today() > original_job.warranty_expires_at:
        raise BusinessRuleViolation(
            f"Warranty expired on {original_job.warranty_expires_at}. "
            "Warranty claims must be raised before expiry."
        )

    year = timezone.now().year
    number = DocumentCounter.next(original_job.shop, year, DocumentCounter.DocType.JOB)
    job_number = f"{original_job.shop.code}-{year}-{number:04d}"

    warranty_job = JobTicket.objects.create(
        shop=original_job.shop,
        customer=original_job.customer,
        job_number=job_number,
        device_type=original_job.device_type,
        device_brand=original_job.device_brand,
        device_model=original_job.device_model,
        serial_number=original_job.serial_number,
        imei=original_job.imei,
        problem_description=f"Warranty claim for {original_job.job_number}.",
        service_charge=Decimal("0"),
        warranty_of_job=original_job,
        created_by=user,
    )
    _write_audit(user, AuditLog.Action.CREATE, "JobTicket", warranty_job.id,
                 new_value={"warranty_of": str(original_job.id)})
    return warranty_job


# ──────────────────────────────────────────────────────────────────────────────
# Fault templates
# ──────────────────────────────────────────────────────────────────────────────


def create_fault_template(shop, data: dict, parts_data: list, user) -> FaultTemplate:
    with transaction.atomic():
        template = FaultTemplate.objects.create(shop=shop, **data)
        for part in parts_data:
            FaultTemplatePart.objects.create(template=template, **part)
    _write_audit(user, AuditLog.Action.CREATE, "FaultTemplate", template.id)
    return template


def update_fault_template(
    template: FaultTemplate, data: dict, parts_data: "list | None", user
) -> FaultTemplate:
    """
    Update template fields. When parts_data is not None (i.e. 'parts' key was
    sent in the request), replace all FaultTemplatePart rows atomically.
    parts_data=[] clears parts without adding new ones.
    """
    with transaction.atomic():
        for attr, value in data.items():
            setattr(template, attr, value)
        template.save()
        if parts_data is not None:
            template.parts.all().delete()
            for part in parts_data:
                FaultTemplatePart.objects.create(template=template, **part)
    _write_audit(user, AuditLog.Action.UPDATE, "FaultTemplate", template.id)
    return template


# ──────────────────────────────────────────────────────────────────────────────
# Internal helpers
# ──────────────────────────────────────────────────────────────────────────────


def _write_audit(user, action, model_name, object_id, old_value=None, new_value=None):
    try:
        AuditLog.objects.create(
            user_id=user.id,
            action=action,
            model_name=model_name,
            object_id=object_id,
            old_value=old_value,
            new_value=new_value,
        )
    except Exception:
        logger.exception("Audit log write failed")


def _broadcast(shop_id, event_type: str, payload: dict) -> None:
    from core.ws import send_to_shop
    send_to_shop(str(shop_id), event_type, payload)



def _send_shop_notification(shop_id, template_name: str, variables: dict) -> None:
    logger.debug("Shop notification shop=%s template=%s", shop_id, template_name)


def _send_status_notification(job: JobTicket, to_status: str, reason: str = "") -> None:
    STATUS_TEMPLATES = {
        JobTicket.Status.OPEN: ("job_received", "customer"),
        JobTicket.Status.ON_HOLD: ("job_on_hold", "customer"),
        JobTicket.Status.READY_FOR_PICKUP: ("device_ready", "customer"),
        JobTicket.Status.DELIVERED: ("job_delivered", "customer"),
        JobTicket.Status.CANCELLED: ("cancellation_notice", "customer"),
    }
    if to_status not in STATUS_TEMPLATES:
        return

    template_name, recipient = STATUS_TEMPLATES[to_status]
    variables = {
        "customer_name": job.customer.name,
        "job_number": job.job_number,
        "device_type": job.device_type,
        "shop_phone": job.shop.phone,
        "hold_reason": reason,
        "shop_address": job.shop.address,
    }
    send_whatsapp(phone=job.customer.phone, template_name=template_name,
                   variables=variables, customer=job.customer)


def _log_crm_comm(job: JobTicket, comm_type: str, summary: str, user) -> None:
    try:
        from crm.models import CommunicationLog
        from django.utils import timezone as tz

        CommunicationLog.objects.create(
            customer=job.customer,
            type="whatsapp",
            direction="outbound",
            summary=summary,
            logged_by=user,
            logged_at=tz.now(),
        )
    except Exception:
        logger.exception("Failed to log CRM communication for job %s", job.job_number)


# Import F here to avoid circular at module level
from django.db import models


def get_repair_overview(shop_filter, shop_id=None):
    """Aggregate KPIs, status breakdown, and a needs-attention list for the Repair Overview.

    Shop-wide summary: applies `shop_filter` (a Q from ShopScopedMixin) and an optional
    explicit `shop_id`. A handful of aggregate queries — no N+1.
    """
    from django.db.models import Count, Q
    from django.utils import timezone

    from .models import JobTicket

    TERMINAL = ["delivered", "closed", "cancelled"]
    AWAITING_PARTS = ["requested", "approved", "ordered"]
    STATUS_ORDER = ["open", "in_progress", "on_hold", "ready_for_qc", "ready_for_pickup", "delivered"]
    today = timezone.localdate()

    base = JobTicket.objects.filter(shop_filter)
    if shop_id:
        base = base.filter(shop_id=shop_id)

    status_counts = {row["status"]: row["count"] for row in base.values("status").annotate(count=Count("id"))}

    open_jobs = base.exclude(status__in=TERMINAL).count()
    overdue = base.exclude(status__in=TERMINAL).filter(expected_delivery_date__lt=today).count()
    ready_for_pickup = status_counts.get("ready_for_pickup", 0)
    awaiting_parts = (
        base.filter(spare_part_requests__status__in=AWAITING_PARTS).distinct().count()
    )

    needs_attention = list(
        base.exclude(status__in=TERMINAL)
        .filter(
            Q(expected_delivery_date__lt=today)
            | Q(advance_paid=0, service_charge__gt=0)
            | Q(spare_part_requests__status__in=AWAITING_PARTS)
        )
        .select_related("customer")
        .distinct()
        .order_by("expected_delivery_date", "intake_date")[:8]
    )

    return {
        "kpis": {
            "open_jobs": open_jobs,
            "overdue": overdue,
            "awaiting_parts": awaiting_parts,
            "ready_for_pickup": ready_for_pickup,
        },
        "by_status": [{"status": s, "count": status_counts.get(s, 0)} for s in STATUS_ORDER],
        "needs_attention": needs_attention,
    }
