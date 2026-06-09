"""
Settings API views for shop profile, tenant branding, WhatsApp, and notification templates.

GET  /shops/{id}/                   — full shop detail
PATCH /shops/{id}/                  — update shop profile

GET  /tenants/me/                   — tenant branding / bank details
PATCH /tenants/me/                  — update tenant branding

GET  /whatsapp/connection/          — WhatsApp channel status
POST /whatsapp/connect/             — mark WhatsApp as connected
POST /whatsapp/disconnect/          — mark WhatsApp as disconnected

GET  /notifications/templates/      — list all templates merged with DB overrides
PATCH /notifications/templates/{id}/ — toggle is_active or set custom_body
"""

import logging

from django.utils import timezone
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from authentication.permissions import require_permission

from .models import NotificationTemplate, Shop, TenantSettings, WhatsAppConnection
from .notifications import TEMPLATE_REGISTRY

logger = logging.getLogger(__name__)

# ── Serializers ───────────────────────────────────────────────────────────────

SHOP_FIELDS = [
    "id", "name", "code", "address", "city", "state", "state_code",
    "phone", "email", "gstin", "is_active", "working_hours",
]

SHOP_WRITE_FIELDS = [
    "name", "address", "city", "state", "state_code",
    "phone", "email", "gstin", "working_hours",
]


def _shop_to_dict(shop: Shop) -> dict:
    return {
        "id": str(shop.id),
        "name": shop.name,
        "code": shop.code,
        "address": shop.address,
        "city": shop.city,
        "state": shop.state,
        "state_code": shop.state_code,
        "phone": shop.phone,
        "email": shop.email,
        "gstin": shop.gstin,
        "is_active": shop.is_active,
        "working_hours": shop.working_hours or {},
    }


def _settings_to_dict(ts: TenantSettings) -> dict:
    return {
        "logo_url": ts.logo_url,
        "invoice_footer": ts.invoice_footer,
        "bank_name": ts.bank_name,
        "bank_account_number": ts.bank_account_number,
        "bank_ifsc": ts.bank_ifsc,
    }


def _wa_to_dict(wa: WhatsAppConnection) -> dict:
    return {
        "phone_number": wa.phone_number,
        "is_connected": wa.is_connected,
        "connected_at": wa.connected_at.isoformat() if wa.connected_at else None,
    }


def _template_to_dict(tmpl_def: dict, override: NotificationTemplate | None) -> dict:
    return {
        "id": tmpl_def["template_name"],  # stable identifier for PATCH
        "template_name": tmpl_def["template_name"],
        "module": tmpl_def["module"],
        "trigger": tmpl_def["trigger"],
        "recipient": tmpl_def["recipient"],
        "variables": tmpl_def["variables"],
        "is_active": override.is_active if override else True,
        "custom_body": override.custom_body if override else None,
    }


# ── Shop views ────────────────────────────────────────────────────────────────

class ShopDetailView(APIView):
    def get_permissions(self):
        if self.request.method == "PATCH":
            return [require_permission("settings.shop.manage")()]
        return [require_permission("settings.shop.view")()]

    def _get_shop(self, shop_id):
        try:
            return Shop.objects.get(id=shop_id)
        except Shop.DoesNotExist:
            raise NotFound("Shop not found.")

    def _check_shop_access(self, request, shop_id):
        token = getattr(request, "auth", None)
        if token and (token.get("is_tenant_wide") or token.get("is_platform_admin")):
            return
        shop_ids = token.get("shop_ids", []) if token else []
        if str(shop_id) not in [str(s) for s in shop_ids]:
            raise NotFound("Shop not found.")

    def get(self, request, shop_id):
        self._check_shop_access(request, shop_id)
        shop = self._get_shop(shop_id)
        return Response(_shop_to_dict(shop))

    def patch(self, request, shop_id):
        self._check_shop_access(request, shop_id)
        shop = self._get_shop(shop_id)
        data = request.data

        update_fields = []
        for field in SHOP_WRITE_FIELDS:
            if field in data:
                setattr(shop, field, data[field])
                update_fields.append(field)

        if not update_fields:
            return Response(_shop_to_dict(shop))

        shop.save(update_fields=update_fields + ["updated_at"])
        return Response(_shop_to_dict(shop))


# ── Tenant branding view ──────────────────────────────────────────────────────

class TenantSettingsView(APIView):
    def get_permissions(self):
        if self.request.method == "PATCH":
            return [require_permission("settings.tenant.manage")()]
        return [require_permission("settings.tenant.view")()]

    def get(self, request):
        ts = TenantSettings.get_or_create_singleton()
        return Response(_settings_to_dict(ts))

    def patch(self, request):
        ts = TenantSettings.get_or_create_singleton()
        data = request.data
        writable = ["logo_url", "invoice_footer", "bank_name", "bank_account_number", "bank_ifsc"]
        update_fields = []
        for field in writable:
            if field in data:
                setattr(ts, field, data[field])
                update_fields.append(field)

        if update_fields:
            ts.save(update_fields=update_fields + ["updated_at"])
        return Response(_settings_to_dict(ts))


# ── WhatsApp views ────────────────────────────────────────────────────────────

class WhatsAppConnectionView(APIView):
    def get_permissions(self):
        return [require_permission("settings.whatsapp.manage")()]

    def get(self, request):
        wa = WhatsAppConnection.get_or_create_singleton()
        return Response(_wa_to_dict(wa))


class WhatsAppConnectView(APIView):
    def get_permissions(self):
        return [require_permission("settings.whatsapp.manage")()]

    def post(self, request):
        phone_number = request.data.get("phone_number", "").strip()
        if not phone_number:
            raise ValidationError({"phone_number": "phone_number is required."})

        wa = WhatsAppConnection.get_or_create_singleton()
        wa.phone_number = phone_number
        wa.is_connected = True
        wa.connected_at = timezone.now()
        wa.save(update_fields=["phone_number", "is_connected", "connected_at", "updated_at"])
        return Response(_wa_to_dict(wa))


class WhatsAppDisconnectView(APIView):
    def get_permissions(self):
        return [require_permission("settings.whatsapp.manage")()]

    def post(self, request):
        wa = WhatsAppConnection.get_or_create_singleton()
        wa.is_connected = False
        wa.save(update_fields=["is_connected", "updated_at"])
        return Response({"detail": "WhatsApp disconnected."})


# ── Notification template views ───────────────────────────────────────────────

class NotificationTemplateListView(APIView):
    def get_permissions(self):
        return [require_permission("settings.whatsapp.manage")()]

    def get(self, request):
        overrides = {
            t.template_name: t
            for t in NotificationTemplate.objects.all()
        }
        items = [_template_to_dict(tmpl, overrides.get(tmpl["template_name"])) for tmpl in TEMPLATE_REGISTRY]
        return Response({"items": items})


class NotificationTemplateDetailView(APIView):
    def get_permissions(self):
        return [require_permission("settings.whatsapp.manage")()]

    def _get_tmpl_def(self, template_name: str):
        from .notifications import _TEMPLATE_MAP
        if template_name not in _TEMPLATE_MAP:
            raise NotFound("Template not found.")
        return _TEMPLATE_MAP[template_name]

    def patch(self, request, template_id: str):
        # template_id is the template_name (string slug)
        tmpl_def = self._get_tmpl_def(template_id)

        override, _ = NotificationTemplate.objects.get_or_create(template_name=template_id)
        data = request.data
        update_fields = []

        if "is_active" in data:
            override.is_active = bool(data["is_active"])
            update_fields.append("is_active")
        if "custom_body" in data:
            override.custom_body = data["custom_body"] or None
            update_fields.append("custom_body")

        if update_fields:
            override.save(update_fields=update_fields + ["updated_at"])

        return Response(_template_to_dict(tmpl_def, override))
