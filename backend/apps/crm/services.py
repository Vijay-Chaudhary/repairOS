"""
CRM business logic — all write operations live here, not in views.
"""

import logging
from typing import Optional

from django.db import transaction
from django.utils import timezone

from authentication.models import AuditLog
from core.notifications import send_whatsapp

from .models import (
    CommunicationLog,
    Customer,
    CustomerSegment,
    FollowUpTask,
    Lead,
    LeadQuote,
)

logger = logging.getLogger(__name__)


# ──────────────────────────────────────────────────────────────────────────────
# Lead
# ──────────────────────────────────────────────────────────────────────────────

VALID_LEAD_TRANSITIONS = {
    Lead.Status.NEW: {Lead.Status.CONTACTED, Lead.Status.LOST},
    Lead.Status.CONTACTED: {Lead.Status.INTERESTED, Lead.Status.LOST},
    Lead.Status.INTERESTED: {Lead.Status.QUOTED, Lead.Status.LOST},
    Lead.Status.QUOTED: {Lead.Status.CONVERTED, Lead.Status.LOST},
    Lead.Status.CONVERTED: set(),
    # All active stages are listed here so the validator doesn't short-circuit;
    # the service further constrains re-open to status_before_lost only.
    Lead.Status.LOST: {
        Lead.Status.NEW,
        Lead.Status.CONTACTED,
        Lead.Status.INTERESTED,
        Lead.Status.QUOTED,
    },
}


def transition_lead(lead: Lead, to_status: str, user, reason: str = "") -> Lead:
    from core.exceptions import InvalidStatusTransition, BusinessRuleViolation

    allowed = VALID_LEAD_TRANSITIONS.get(lead.status, set())
    if to_status not in allowed:
        raise InvalidStatusTransition(lead.status, to_status)

    if to_status == Lead.Status.LOST and not reason:
        raise BusinessRuleViolation("lost_reason is required when marking a lead as lost.")

    # ── Re-open: must restore to the exact prior stage ────────────────────────
    if lead.status == Lead.Status.LOST:
        if not lead.status_before_lost:
            raise BusinessRuleViolation(
                "Cannot re-open this lead: the stage before it was marked lost is unknown."
            )
        if to_status != lead.status_before_lost:
            raise InvalidStatusTransition(
                lead.status,
                to_status,
                hint=f"Re-open must target '{lead.status_before_lost}' (the stage before lost).",
            )
        lead.status = lead.status_before_lost
        lead.status_before_lost = None
        lead.lost_reason = None
        lead.save(update_fields=["status", "status_before_lost", "lost_reason", "updated_at"])
        return lead

    # ── Going to lost: snapshot current stage ────────────────────────────────
    if to_status == Lead.Status.LOST:
        lead.status_before_lost = lead.status
        lead.status = Lead.Status.LOST
        lead.lost_reason = reason
        lead.save(update_fields=["status", "status_before_lost", "lost_reason", "updated_at"])
        return lead

    # ── Normal forward transition ─────────────────────────────────────────────
    lead.status = to_status
    lead.save(update_fields=["status", "updated_at"])
    return lead


def send_quote(lead: Lead, data: dict, user) -> LeadQuote:
    """
    Create a LeadQuote, transition the lead to QUOTED, send a WhatsApp
    notification, and log a CommunicationLog entry — all in one atomic step.

    data keys:
        items        list[{description: str, amount: str}]  (at least one)
        total_amount str | Decimal
        valid_until  date
        notes        str  (optional)
    """
    from core.exceptions import BusinessRuleViolation
    from core.context import get_tenant_db_alias
    from core.models import DocumentCounter
    from decimal import Decimal

    if lead.status not in (Lead.Status.INTERESTED, Lead.Status.QUOTED):
        raise BusinessRuleViolation(
            f"Cannot send a quote for a lead with status '{lead.status}'."
        )

    items = data.get("items", [])
    if not items:
        raise BusinessRuleViolation("At least one line item is required.")

    total = Decimal(str(data["total_amount"]))
    valid_until = data["valid_until"]

    _db = get_tenant_db_alias() or "default"
    with transaction.atomic(using=_db):
        # Generate quote number: SHOP-QT-YEAR-0001
        year = timezone.now().year
        seq = DocumentCounter.next(lead.shop, year, DocumentCounter.DocType.LEAD_QUOTE)
        quote_number = f"{lead.shop.code}-QT-{year}-{seq:04d}"

        # Coerce Decimal amounts to str so JSONField can serialise them
        serialisable_items = [
            {"description": it["description"], "amount": str(it["amount"])}
            for it in items
        ]
        quote = LeadQuote.objects.create(
            lead=lead,
            quote_number=quote_number,
            items=serialisable_items,
            total_amount=total,
            valid_until=valid_until,
            notes=data.get("notes", ""),
            sent_by=user,
        )

        # Transition to QUOTED (idempotent if already quoted)
        if lead.status != Lead.Status.QUOTED:
            lead.status = Lead.Status.QUOTED
            lead.save(update_fields=["status", "updated_at"])

        # Log communication
        CommunicationLog.objects.create(
            lead=lead,
            type=CommunicationLog.CommType.WHATSAPP,
            direction=CommunicationLog.Direction.OUTBOUND,
            summary=f"Quote {quote_number} sent — ₹{total:,.0f}, valid until {valid_until}",
            logged_by=user,
            logged_at=timezone.now(),
        )

    # Send WhatsApp (outside atomic so a notification failure doesn't roll back)
    try:
        send_whatsapp(
            phone=lead.phone,
            template_name="lead_quote_sent",
            variables={
                "customer_name": lead.name,
                "quote_amount": f"₹{quote.total_amount:,.0f}",
                "valid_until": str(quote.valid_until),
                "shop_phone": lead.shop.phone,
            },
        )
    except Exception:
        logger.warning("WhatsApp notification failed for quote %s", quote.quote_number)
    quote.sent_via_whatsapp = True
    quote.save(update_fields=["sent_via_whatsapp"])

    return quote


def convert_lead(lead: Lead, user) -> Customer:
    """
    Idempotent: returns the existing customer if already converted.
    Creates a Customer from Lead data, links them, and transitions lead to CONVERTED.
    If the phone already exists as a (non-deleted) customer, links to that customer.
    """
    if lead.status == Lead.Status.CONVERTED and lead.converted_customer_id:
        return lead.converted_customer

    with transaction.atomic():
        existing = Customer.objects.filter(phone=lead.phone).first()
        if existing:
            customer = existing
        else:
            customer = Customer.objects.create(
                shop=lead.shop,
                name=lead.name,
                phone=lead.phone,
                email=lead.email,
                source_lead=lead,
            )

        lead.status = Lead.Status.CONVERTED
        lead.converted_customer = customer
        lead.converted_at = timezone.now()
        lead.save(update_fields=["status", "converted_customer", "converted_at", "updated_at"])

        _write_audit(
            user_id=user.id,
            action=AuditLog.Action.UPDATE,
            model_name="Lead",
            object_id=lead.id,
            new_value={"converted_customer_id": str(customer.id)},
        )

    return customer


# ──────────────────────────────────────────────────────────────────────────────
# Customer
# ──────────────────────────────────────────────────────────────────────────────


def merge_customers(source: Customer, target: Customer, user) -> Customer:
    """
    Merge source into target:
    - Repoints CommunicationLog, FollowUpTask FKs from source → target.
    - Sums denormalized counters.
    - Merges tags (union).
    - Soft-deletes source.

    NOTE: When Repair, POS, AMC modules are built, their customer FKs must
    also be repointed here (job_tickets.customer_id, sales.customer_id, etc.).
    """
    if source.id == target.id:
        from core.exceptions import BusinessRuleViolation
        raise BusinessRuleViolation("Source and target customer must be different.")

    with transaction.atomic():
        CommunicationLog.objects.filter(customer=source).update(customer=target)
        FollowUpTask.objects.filter(customer=source).update(customer=target)

        target.total_jobs += source.total_jobs
        target.total_billed += source.total_billed
        target.total_outstanding += source.total_outstanding

        combined_tags = list(set((target.tags or []) + (source.tags or [])))
        target.tags = combined_tags

        if source.alternate_phone and not target.alternate_phone:
            target.alternate_phone = source.alternate_phone
        elif source.phone != target.phone and not target.alternate_phone:
            target.alternate_phone = source.phone

        target.save(
            update_fields=[
                "total_jobs",
                "total_billed",
                "total_outstanding",
                "tags",
                "alternate_phone",
                "updated_at",
            ]
        )

        source.soft_delete(user_id=user.id)

        _write_audit(
            user_id=user.id,
            action=AuditLog.Action.DELETE,
            model_name="Customer",
            object_id=source.id,
            new_value={"merged_into": str(target.id)},
        )

    return target


# ──────────────────────────────────────────────────────────────────────────────
# Segments
# ──────────────────────────────────────────────────────────────────────────────


def evaluate_segment(segment: CustomerSegment):
    """
    Apply segment filter_rules to the Customer queryset.
    Supported rules:
      tags           — list; customers who have ANY of these tags
      min_total_billed / max_total_billed — decimal thresholds
      customer_type  — "individual" | "business"
      city           — case-insensitive contains
      whatsapp_optout — bool
      min_total_jobs — integer threshold
    """
    rules = segment.filter_rules or {}
    qs = Customer.objects.all()  # SoftDeleteManager already filters deleted_at IS NULL

    if tags := rules.get("tags"):
        from django.db.models import Q
        tag_filter = Q()
        for tag in tags:
            tag_filter |= Q(tags__contains=tag)
        qs = qs.filter(tag_filter)

    if (min_billed := rules.get("min_total_billed")) is not None:
        qs = qs.filter(total_billed__gte=min_billed)

    if (max_billed := rules.get("max_total_billed")) is not None:
        qs = qs.filter(total_billed__lte=max_billed)

    if customer_type := rules.get("customer_type"):
        qs = qs.filter(customer_type=customer_type)

    if city := rules.get("city"):
        qs = qs.filter(city__icontains=city)

    if (optout := rules.get("whatsapp_optout")) is not None:
        qs = qs.filter(whatsapp_optout=optout)

    if (min_jobs := rules.get("min_total_jobs")) is not None:
        qs = qs.filter(total_jobs__gte=min_jobs)

    return qs


def segment_recipient_ids(segment: CustomerSegment):
    """Return (total_members, opted_in_customer_ids) for a segment.

    Single source of truth for both the bulk-WhatsApp send and the pre-send
    recipient-count preview, so opt-out exclusion stays consistent.
    """
    from .models import CustomerSegmentMember

    if segment.is_dynamic:
        qs = evaluate_segment(segment)
        total = qs.count()
        ids = list(qs.filter(whatsapp_optout=False).values_list("id", flat=True))
    else:
        members = CustomerSegmentMember.objects.filter(segment=segment)
        total = members.count()
        ids = list(
            members.filter(customer__whatsapp_optout=False).values_list("customer_id", flat=True)
        )
    return total, ids


# ──────────────────────────────────────────────────────────────────────────────
# Follow-up task completion
# ──────────────────────────────────────────────────────────────────────────────


def complete_task(task: FollowUpTask, user) -> FollowUpTask:
    from core.exceptions import BusinessRuleViolation

    if task.status not in (FollowUpTask.Status.PENDING, FollowUpTask.Status.OVERDUE):
        raise BusinessRuleViolation(f"Cannot complete a task with status '{task.status}'.")

    task.status = FollowUpTask.Status.COMPLETED
    task.completed_at = timezone.now()
    task.completed_by = user.id
    task.save(update_fields=["status", "completed_at", "completed_by", "updated_at"])
    return task


# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────


def _write_audit(user_id, action, model_name, object_id, new_value=None):
    try:
        AuditLog.objects.create(
            user_id=user_id,
            action=action,
            model_name=model_name,
            object_id=object_id,
            new_value=new_value,
        )
    except Exception:
        logger.exception("Failed to write audit log")


# ──────────────────────────────────────────────────────────────────────────────
# Overview aggregation
# ──────────────────────────────────────────────────────────────────────────────


def get_crm_overview(shop_filter, shop_id=None):
    """Aggregate CRM KPIs, the lead pipeline, and needs-attention lists for the Overview hub.

    Leads and customers are shop-scoped via `shop_filter` (a Q from ShopScopedMixin) plus an
    optional explicit `shop_id`. Tasks have no shop column and are tenant-wide today, so task
    metrics are NOT shop-filtered (matches the existing Tasks list behavior). A handful of
    aggregate queries — no N+1.
    """
    from datetime import timedelta

    from django.db.models import Count
    from django.utils import timezone

    from .models import Customer, FollowUpTask, Lead

    PIPELINE_ORDER = ["new", "contacted", "interested", "quoted", "converted", "lost"]
    today = timezone.localdate()
    since = timezone.now() - timedelta(days=30)

    leads = Lead.objects.filter(shop_filter)
    customers = Customer.objects.filter(shop_filter)
    if shop_id:
        leads = leads.filter(shop_id=shop_id)
        customers = customers.filter(shop_id=shop_id)

    status_counts = {row["status"]: row["count"] for row in leads.values("status").annotate(count=Count("id"))}

    tasks_due_today = FollowUpTask.objects.filter(status="pending", due_date=today).count()
    tasks_overdue = FollowUpTask.objects.filter(status="pending", due_date__lt=today).count()

    overdue_tasks = [
        {
            "id": t.id,
            "title": t.title,
            "due_date": t.due_date,
            "assigned_to_name": (t.assigned_to.full_name if t.assigned_to else None),
            "customer_name": (t.customer.name if t.customer else None),
        }
        for t in FollowUpTask.objects.filter(status="pending", due_date__lt=today)
        .select_related("assigned_to", "customer")
        .order_by("due_date")[:8]
    ]
    unassigned_leads = [
        {
            "id": l.id,
            "name": l.name,
            "phone": l.phone,
            "source": l.source,
            "created_at": l.created_at,
        }
        for l in leads.filter(status="new", assigned_to__isnull=True).order_by("-created_at")[:8]
    ]

    return {
        "kpis": {
            "new_leads": status_counts.get("new", 0),
            "tasks_due_today": tasks_due_today,
            "tasks_overdue": tasks_overdue,
            "conversions_30d": leads.filter(converted_at__gte=since).count(),
            "new_customers_30d": customers.filter(created_at__gte=since).count(),
        },
        "pipeline": [{"status": s, "count": status_counts.get(s, 0)} for s in PIPELINE_ORDER],
        "overdue_tasks": overdue_tasks,
        "unassigned_leads": unassigned_leads,
    }
