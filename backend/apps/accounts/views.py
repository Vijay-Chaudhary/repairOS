"""Accounts API views — double-entry accounting core."""

import logging

logger = logging.getLogger(__name__)


def _shop_ids_from_token(request):
    """Return (shop_ids_list, is_tenant_wide) extracted from the JWT."""
    token = getattr(request, "auth", None) or {}
    is_wide = bool(token.get("is_tenant_wide") or token.get("is_platform_admin"))
    shop_ids = token.get("shop_ids", [])
    return shop_ids, is_wide
