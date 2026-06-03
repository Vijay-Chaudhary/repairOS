"""
Platform Admin business logic.

All operations target the master ('default') database.
Provisioning is triggered asynchronously; API returns status=provisioning immediately.
"""

import hashlib
import hmac
import json
import logging

from django.conf import settings
from django.utils import timezone

from .models import AuditLogMaster, Tenant, TenantSubscription

logger = logging.getLogger(__name__)


# ──────────────────────────────────────────────────────────────────────────────
# Registration / provisioning
# ──────────────────────────────────────────────────────────────────────────────


def register_tenant(data: dict) -> Tenant:
    """
    Create a Tenant record (status=provisioning) and a TenantSubscription.
    The actual DB provisioning happens asynchronously (Celery or management command).

    Raises ValueError on slug collision.
    """
    from .models import SubscriptionPlan

    slug = data["slug"].lower().strip()

    if Tenant.objects.filter(slug=slug).exists():
        raise ValueError(f"Slug '{slug}' is already taken.")

    plan = SubscriptionPlan.objects.get(id=data["plan_id"])

    tenant = Tenant.objects.create(
        name=data["business_name"],
        slug=slug,
        status=Tenant.Status.PROVISIONING,
        plan=Tenant.Plan.STARTER,
        owner_email=data["email"],
        owner_phone=data["phone"],
    )

    today = timezone.now().date()
    import datetime
    TenantSubscription.objects.create(
        tenant=tenant,
        plan=plan,
        status=TenantSubscription.Status.TRIALING,
        current_period_start=today,
        current_period_end=today + datetime.timedelta(days=30),
    )

    AuditLogMaster.objects.create(
        event_type="tenant.created",
        tenant=tenant,
        payload={"slug": slug, "plan": plan.name, "owner_email": data["email"]},
    )

    # Celery task stub — wire when Celery is configured:
    # tasks.provision_tenant.delay(str(tenant.id))

    logger.info("Tenant '%s' created, provisioning queued.", slug)
    return tenant


def suspend_tenant(tenant: Tenant, actor_email: str = "") -> Tenant:
    tenant.status = Tenant.Status.SUSPENDED
    tenant.save(update_fields=["status", "updated_at"])

    AuditLogMaster.objects.create(
        event_type="tenant.suspended",
        tenant=tenant,
        actor_email=actor_email,
        payload={"slug": tenant.slug},
    )
    return tenant


def reactivate_tenant(tenant: Tenant, actor_email: str = "") -> Tenant:
    tenant.status = Tenant.Status.ACTIVE
    tenant.save(update_fields=["status", "updated_at"])

    AuditLogMaster.objects.create(
        event_type="tenant.reactivated",
        tenant=tenant,
        actor_email=actor_email,
        payload={"slug": tenant.slug},
    )
    return tenant


# ──────────────────────────────────────────────────────────────────────────────
# Razorpay subscription webhook
# ──────────────────────────────────────────────────────────────────────────────

_RAZORPAY_EVENT_TO_STATUS = {
    "subscription.activated": TenantSubscription.Status.ACTIVE,
    "subscription.charged": TenantSubscription.Status.ACTIVE,
    "subscription.halted": TenantSubscription.Status.PAST_DUE,
    "subscription.cancelled": TenantSubscription.Status.CANCELLED,
    "subscription.paused": TenantSubscription.Status.PAUSED,
    "subscription.resumed": TenantSubscription.Status.ACTIVE,
    "subscription.pending": TenantSubscription.Status.PAST_DUE,
}


def verify_razorpay_signature(payload: bytes, signature: str) -> bool:
    secret = getattr(settings, "RAZORPAY_WEBHOOK_SECRET", "")
    expected = hmac.new(secret.encode(), payload, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


def handle_razorpay_subscription_webhook(payload: bytes, signature: str) -> dict:
    if not verify_razorpay_signature(payload, signature):
        raise ValueError("Invalid Razorpay signature.")

    data = json.loads(payload)
    event = data.get("event", "")
    new_status = _RAZORPAY_EVENT_TO_STATUS.get(event)
    if new_status is None:
        return {"ignored": True, "event": event}

    entity = data["payload"]["subscription"]["entity"]
    razorpay_id = entity["id"]

    try:
        sub = TenantSubscription.objects.get(razorpay_subscription_id=razorpay_id)
    except TenantSubscription.DoesNotExist:
        logger.warning("Subscription %s not found for event %s", razorpay_id, event)
        return {"ignored": True, "reason": "subscription_not_found"}

    sub.status = new_status
    sub.save(update_fields=["status", "updated_at"])

    AuditLogMaster.objects.create(
        event_type=f"subscription.{event.split('.')[1]}",
        tenant=sub.tenant,
        payload={"razorpay_id": razorpay_id, "new_status": new_status},
    )

    logger.info("Subscription %s → %s (event: %s)", razorpay_id, new_status, event)
    return {"updated": True, "status": new_status}
