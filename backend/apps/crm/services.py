"""
CRM business logic — all write operations live here, not in views.
"""

import logging
from typing import Optional

from django.db import transaction
from django.utils import timezone

from authentication.models import AuditLog

from .models import (
    CommunicationLog,
    Customer,
    CustomerSegment,
    FollowUpTask,
    Lead,
)

logger = logging.getLogger(__name__)


# ──────────────────────────────────────────────────────────────────────────────
# Lead
# ──────────────────────────────────────────────────────────────────────────────

VALID_LEAD_TRANSITIONS = {
    Lead.Status.NEW: {Lead.Status.CONTACTED},
    Lead.Status.CONTACTED: {Lead.Status.INTERESTED},
    Lead.Status.INTERESTED: {Lead.Status.QUOTED},
    Lead.Status.QUOTED: {Lead.Status.CONVERTED, Lead.Status.LOST},
    Lead.Status.CONVERTED: set(),
    Lead.Status.LOST: set(),
}


def transition_lead(lead: Lead, to_status: str, user, reason: str = "") -> Lead:
    from core.exceptions import InvalidStatusTransition, BusinessRuleViolation

    allowed = VALID_LEAD_TRANSITIONS.get(lead.status, set())
    if to_status not in allowed:
        raise InvalidStatusTransition(lead.status, to_status)

    if to_status == Lead.Status.LOST and not reason:
        raise BusinessRuleViolation("lost_reason is required when marking a lead as lost.")

    lead.status = to_status
    if to_status == Lead.Status.LOST:
        lead.lost_reason = reason
    lead.save(update_fields=["status", "lost_reason", "updated_at"])
    return lead


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

    return qs


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
