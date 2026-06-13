"""
Commissions business logic.

Commission accrues at job closure. Rules define rate and lead-tech split.
Payout batches collect unpaid commissions and mark them paid atomically.
"""

import logging
from decimal import ROUND_HALF_UP, Decimal

from django.db import transaction
from django.utils import timezone

from .models import CommissionPayout, CommissionRule, TechnicianCommission

logger = logging.getLogger(__name__)

_TWO = Decimal("0.01")


# ──────────────────────────────────────────────────────────────────────────────
# Accrual
# ──────────────────────────────────────────────────────────────────────────────


def accrue_commission(job) -> None:
    """
    Compute and persist TechnicianCommission rows for a closed job.

    Called from repair.services._on_close (lazy import). Silently skips when:
    - SC = 0 (warranty/free job)
    - No applicable rule exists for the closure date + job type

    Multi-tech split:
    - pool = SC × rate%
    - lead = pool × lead_tech_share%   (stage_order=1 technician)
    - remainder split equally among others; last tech absorbs any rounding residual
    """
    if job.service_charge <= 0:
        return

    closed_date = timezone.now().date()
    rule = _resolve_rule(closed_date, job.device_type)
    if rule is None:
        return

    technicians = _get_technicians(job)
    if not technicians:
        return

    pool = (job.service_charge * rule.rate / 100).quantize(_TWO, rounding=ROUND_HALF_UP)
    rows = _compute_splits(job, technicians, pool, rule)

    with transaction.atomic():
        for row in rows:
            TechnicianCommission.objects.get_or_create(
                job=job,
                technician=row["technician"],
                defaults={
                    "stage": row.get("stage"),
                    "rule": rule,
                    "is_lead": row["is_lead"],
                    "sc_amount": job.service_charge,
                    "rate": rule.rate,
                    "commission_amount": row["amount"],
                },
            )


def _resolve_rule(closed_date, device_type: str) -> CommissionRule | None:
    """
    Pick the best-matching active rule for this date and device_type.

    Precedence: specific job_type match > generic (NULL) match.
    Within same specificity: most recent effective_from wins.
    """
    from django.db.models import Q
    # Single filter with Q() avoids the Django QuerySet union which doesn't
    # support chaining .filter() after .union() in Django 4.2+.
    qs = CommissionRule.objects.filter(
        effective_from__lte=closed_date,
    ).filter(
        Q(effective_to__isnull=True) | Q(effective_to__gt=closed_date)
    )

    specific = qs.filter(applies_to_job_type=device_type).order_by("-effective_from").first()
    if specific:
        return specific
    return qs.filter(applies_to_job_type__isnull=True).order_by("-effective_from").first()


def _get_technicians(job) -> list[dict]:
    """
    Return ordered list of {technician, stage, is_lead} dicts.

    Lead = technician assigned to stage_order=1 (or only stage).
    Falls back to job.created_by when no stages exist.
    """
    stages = (
        job.stages
        .select_related("assigned_technician")
        .order_by("stage_order")
    )

    seen = {}  # technician_id → first-seen stage
    for stage in stages:
        tech_id = stage.assigned_technician_id
        if tech_id not in seen:
            seen[tech_id] = stage

    if not seen:
        # job.created_by is typically the receptionist who opened the ticket,
        # not a technician — crediting them would misattribute commission.
        # JobTicket has no assigned_technician field (only JobStage does), so
        # there's no reliable technician to credit on a stageless job: skip.
        logger.warning(
            "Job %s has no stages; skipping commission accrual (no technician to attribute it to).",
            job.job_number,
        )
        return []

    result = []
    for i, (tech_id, stage) in enumerate(seen.items()):
        result.append({
            "technician": stage.assigned_technician,
            "stage": stage,
            "is_lead": i == 0,
        })
    return result


def _compute_splits(job, technicians: list[dict], pool: Decimal, rule: CommissionRule) -> list[dict]:
    """
    Split pool among technicians, guaranteeing sum == pool (no rounding leak).

    Single tech: all of pool.
    Multi-tech: lead gets lead_tech_share%; others split remainder,
                last other absorbs any rounding residual.
    """
    if len(technicians) == 1:
        return [{**technicians[0], "amount": pool}]

    lead_amount = (pool * rule.lead_tech_share / 100).quantize(_TWO, rounding=ROUND_HALF_UP)
    others_pool = pool - lead_amount
    others = [t for t in technicians if not t["is_lead"]]
    n_others = len(others)

    per_other = (others_pool / n_others).quantize(_TWO, rounding=ROUND_HALF_UP)
    assigned = per_other * (n_others - 1)
    last_amount = others_pool - assigned  # absorbs residual

    result = [{**technicians[0], "amount": lead_amount}]
    for i, tech in enumerate(others):
        amount = last_amount if i == n_others - 1 else per_other
        result.append({**tech, "amount": amount})
    return result


# ──────────────────────────────────────────────────────────────────────────────
# Payout
# ──────────────────────────────────────────────────────────────────────────────


def create_payout(technician, period_start, period_end, created_by) -> CommissionPayout:
    """
    Collect all unpaid TechnicianCommission rows for the technician in period,
    create a draft CommissionPayout, and mark them is_paid.

    Raises BusinessRuleViolation if nothing to pay.
    """
    from core.context import get_tenant_db_alias
    from core.exceptions import BusinessRuleViolation

    _db = get_tenant_db_alias() or "default"

    # Filter by commission.created_at (set atomically at job closure) not
    # job.created_at (job open date), so commissions are attributed to the
    # period in which the job was actually closed.
    unpaid = TechnicianCommission.objects.filter(
        technician=technician,
        is_paid=False,
        created_at__date__gte=period_start,
        created_at__date__lte=period_end,
    ).select_for_update()

    with transaction.atomic(using=_db):
        rows = list(unpaid)
        if not rows:
            raise BusinessRuleViolation("No unpaid commissions for this technician in this period.")

        total = sum(r.commission_amount for r in rows).quantize(_TWO)

        payout = CommissionPayout.objects.create(
            technician=technician,
            period_start=period_start,
            period_end=period_end,
            total_commission=total,
            status=CommissionPayout.Status.DRAFT,
        )

        TechnicianCommission.objects.filter(pk__in=[r.pk for r in rows]).update(
            is_paid=True, payout=payout
        )

    from commissions.tasks import generate_payout_pdf
    from core.context import get_tenant_db_alias
    alias = get_tenant_db_alias() or ""
    tenant_slug = alias.removeprefix("tenant_") if alias.startswith("tenant_") else ""
    generate_payout_pdf.delay(str(payout.id), tenant_slug)

    return payout
