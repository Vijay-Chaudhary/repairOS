"""Core cross-module services: in-app notification producers + global search."""

from .models import Notification


# ── Notification producer helpers ───────────────────────────────────────────────


def users_with_permission(codename, shop_ids=None):
    """Distinct users holding `codename` (optionally scoped to shops via their UserRole)."""
    from authentication.models import User

    qs = User.objects.filter(
        user_roles__role__role_permissions__permission__codename=codename
    )
    if shop_ids is not None:
        qs = qs.filter(user_roles__shop_id__in=shop_ids)
    return qs.distinct()


def record_notifications(users, *, type, title, body="", route="", exclude=None):
    """Bulk-create one Notification per distinct user, skipping `exclude` (the actor)."""
    exclude_id = getattr(exclude, "id", None)
    seen = set()
    rows = []
    for u in users:
        if u is None or u.id == exclude_id or u.id in seen:
            continue
        seen.add(u.id)
        rows.append(Notification(recipient=u, type=type, title=title, body=body, route=route))
    if rows:
        Notification.objects.bulk_create(rows)
    return len(rows)


def notify_dedup(user, type, route) -> bool:
    """True if an unread notification of the same type+route already exists for `user`."""
    return Notification.objects.filter(
        recipient=user, type=type, route=route, read_at__isnull=True
    ).exists()
