"""
Tenant-aware WebSocket consumer.

Single endpoint: /ws/
Protocol:
  Client → Server: { "action": "subscribe", "shop_id": "<uuid>" }
  Server → Client: typed event objects (job.status_changed, stock.low_alert, …)

Authentication: Bearer token expected in ?token= query param or first message.
Tenant is derived from the JWT tenant_slug claim.
"""

import json
import logging

from channels.generic.websocket import AsyncJsonWebsocketConsumer

logger = logging.getLogger(__name__)


class TenantConsumer(AsyncJsonWebsocketConsumer):
    """
    One connection per authenticated browser tab.

    Groups:
      - tenant_{slug}          — all events for the tenant (platform-wide)
      - shop_{shop_id}         — shop-scoped events (stock, jobs for a shop)
    """

    async def connect(self):
        self.tenant_slug = ""
        self.shop_id = None
        self.user_id = None
        self.groups_joined: list[str] = []

        # Try to authenticate from query string token
        token_str = self._token_from_query()
        if token_str:
            self.tenant_slug, self.user_id = await self._decode_jwt(token_str)

        await self.accept()

        if self.tenant_slug:
            await self._join_group(f"tenant_{self.tenant_slug}")

    async def disconnect(self, code):
        for group in list(self.groups_joined):
            try:
                await self.channel_layer.group_discard(group, self.channel_name)
            except Exception:
                pass

    async def receive_json(self, content, **kwargs):
        action = content.get("action")

        if action == "auth":
            token_str = content.get("token", "")
            if token_str:
                slug, uid = await self._decode_jwt(token_str)
                if slug:
                    self.tenant_slug = slug
                    self.user_id = uid
                    await self._join_group(f"tenant_{slug}")

        elif action == "subscribe":
            shop_id = content.get("shop_id") or ""
            if shop_id and self.tenant_slug:
                if self.shop_id:
                    old_group = f"shop_{self.shop_id}"
                    if old_group in self.groups_joined:
                        await self.channel_layer.group_discard(old_group, self.channel_name)
                        self.groups_joined.remove(old_group)
                self.shop_id = shop_id
                await self._join_group(f"shop_{shop_id}")

        elif action == "unsubscribe":
            shop_id = content.get("shop_id") or self.shop_id or ""
            if shop_id:
                group = f"shop_{shop_id}"
                if group in self.groups_joined:
                    await self.channel_layer.group_discard(group, self.channel_name)
                    self.groups_joined.remove(group)

    # ── Channel layer event handlers (one per event type) ─────────────────────

    async def job_status_changed(self, event):
        await self.send_json({"type": "job.status_changed", "data": event["data"]})

    async def payment_received(self, event):
        await self.send_json({"type": "payment.received", "data": event["data"]})

    async def stock_low_alert(self, event):
        await self.send_json({"type": "stock.low_alert", "data": event["data"]})

    async def task_due_soon(self, event):
        await self.send_json({"type": "task.due_soon", "data": event["data"]})

    async def stage_handoff(self, event):
        await self.send_json({"type": "stage.handoff", "data": event["data"]})

    async def tenant_db_provisioned(self, event):
        await self.send_json({"type": "tenant.db_provisioned", "data": event["data"]})

    async def amc_visit_due(self, event):
        await self.send_json({"type": "amc.visit_due", "data": event["data"]})

    async def stock_updated(self, event):
        await self.send_json({"type": "stock.updated", "data": event["data"]})

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _token_from_query(self) -> str:
        query_string = self.scope.get("query_string", b"").decode()
        for part in query_string.split("&"):
            if part.startswith("token="):
                return part[6:]
        return ""

    async def _decode_jwt(self, token_str: str) -> tuple[str, str]:
        """Return (tenant_slug, user_id) or ("", "") on failure."""
        from channels.db import database_sync_to_async

        @database_sync_to_async
        def _parse(ts):
            try:
                from rest_framework_simplejwt.tokens import UntypedToken
                payload = UntypedToken(ts).payload
                return payload.get("tenant_slug", ""), str(payload.get("user_id", ""))
            except Exception:
                return "", ""

        return await _parse(token_str)

    async def _join_group(self, group: str):
        if group not in self.groups_joined:
            await self.channel_layer.group_add(group, self.channel_name)
            self.groups_joined.append(group)
