"""
Synchronous helpers for publishing WebSocket events to connected clients.

Usage from Django views / services (sync context):
    from core.ws import send_to_shop, send_to_tenant

The channel layer is not guaranteed to be available (e.g., test environments
with no Redis). All sends are wrapped in try/except so a missing channel layer
never raises and never blocks a request.
"""

import logging

from asgiref.sync import async_to_sync

logger = logging.getLogger(__name__)


def _channel_layer():
    from channels.layers import get_channel_layer
    return get_channel_layer()


def send_to_shop(shop_id: str, event_type: str, data: dict) -> None:
    """Broadcast an event to all connections subscribed to a specific shop."""
    try:
        layer = _channel_layer()
        if layer is None:
            return
        # Convert "job.status_changed" → "job_status_changed" (channel type key)
        channel_type = event_type.replace(".", "_")
        async_to_sync(layer.group_send)(
            f"shop_{shop_id}",
            {"type": channel_type, "data": data},
        )
    except Exception as exc:
        logger.debug("ws.send_to_shop failed (non-fatal): %s", exc)


def send_to_tenant(tenant_slug: str, event_type: str, data: dict) -> None:
    """Broadcast an event to all connections for a tenant (all shops)."""
    try:
        layer = _channel_layer()
        if layer is None:
            return
        channel_type = event_type.replace(".", "_")
        async_to_sync(layer.group_send)(
            f"tenant_{tenant_slug}",
            {"type": channel_type, "data": data},
        )
    except Exception as exc:
        logger.debug("ws.send_to_tenant failed (non-fatal): %s", exc)
