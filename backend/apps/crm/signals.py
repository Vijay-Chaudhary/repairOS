import logging

from django.db.models.signals import post_save, pre_save
from django.dispatch import receiver

logger = logging.getLogger(__name__)


@receiver(pre_save, sender="crm.Lead")
def _capture_assigned_change(sender, instance, **kwargs):
    """
    Store previous assigned_to_id on the instance before save so post_save
    can compare old vs new without hitting the DB a second time.
    """
    if not instance.pk:
        instance._prev_assigned_to_id = None
        return
    try:
        instance._prev_assigned_to_id = (
            sender.objects.only("assigned_to_id").get(pk=instance.pk).assigned_to_id
        )
    except sender.DoesNotExist:
        instance._prev_assigned_to_id = None


@receiver(post_save, sender="crm.Lead")
def _notify_lead_assigned(sender, instance, created, **kwargs):
    """
    Fire send_lead_assigned_notification whenever assigned_to is set or changes:
    - New lead created with an assignee.
    - Existing lead reassigned to a different (non-null) user.
    """
    prev = getattr(instance, "_prev_assigned_to_id", None)
    new = instance.assigned_to_id

    if not new:
        return
    if not created and new == prev:
        return

    try:
        from crm.tasks import send_lead_assigned_notification
        send_lead_assigned_notification.delay(
            lead_id=str(instance.pk), assignee_id=str(new)
        )
    except Exception:
        logger.exception(
            "Failed to queue lead_assigned notification for lead %s", instance.pk
        )
