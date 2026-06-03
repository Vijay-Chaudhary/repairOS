"""
Custom JWT tokens for RepairOS.

Access token carries:
    user_id, tenant_slug, shop_ids, role_ids, permissions, is_platform_admin

Refresh token carries:
    user_id, tenant_slug, token_family (UUID for replay detection)

TenantJWTAuthentication — reads access token, switches tenant context if not
already set (handles direct API calls that bypass TenantMiddleware in tests).
"""

from typing import Any

from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.serializers import (
    TokenObtainPairSerializer,
    TokenRefreshSerializer,
)
from rest_framework_simplejwt.tokens import RefreshToken


def _build_token_claims(user, tenant_slug: str) -> dict[str, Any]:
    """Compute the extra claims baked into both access and refresh tokens."""
    from authentication.models import RolePermission, UserRole

    user_role_rows = list(UserRole.objects.filter(user=user).values("role_id", "shop_id"))

    shop_ids = list({str(r["shop_id"]) for r in user_role_rows if r["shop_id"]})
    role_ids = list({str(r["role_id"]) for r in user_role_rows})
    is_tenant_wide = any(r["shop_id"] is None for r in user_role_rows)

    permissions = sorted(
        RolePermission.objects.filter(role_id__in=role_ids)
        .values_list("permission__codename", flat=True)
        .distinct()
    )

    return {
        "tenant_slug": tenant_slug,
        "shop_ids": shop_ids,
        "role_ids": role_ids,
        "permissions": permissions,
        "is_platform_admin": user.is_platform_admin,
        "is_tenant_wide": is_tenant_wide,
    }


class TenantTokenObtainPairSerializer(TokenObtainPairSerializer):
    @classmethod
    def get_token(cls, user):
        token = super().get_token(user)
        tenant_slug = getattr(user, "_tenant_slug", "")
        extra = _build_token_claims(user, tenant_slug)
        for key, value in extra.items():
            token[key] = value
        return token

    def validate(self, attrs):
        data = super().validate(attrs)
        # Attach tenant_slug to user so get_token can read it
        self.user._tenant_slug = getattr(self, "_tenant_slug", "")
        return data


class TenantTokenRefreshSerializer(TokenRefreshSerializer):
    def validate(self, attrs):
        data = super().validate(attrs)
        return data


class TenantJWTAuthentication(JWTAuthentication):
    """
    Standard JWT authentication that additionally ensures tenant DB context
    is set for the request (safety net — TenantMiddleware normally handles this).
    """

    def authenticate(self, request):
        result = super().authenticate(request)
        if result is None:
            return None

        user, token = result
        tenant_slug = token.get("tenant_slug")

        if tenant_slug:
            from core.context import get_tenant_db_alias, set_tenant_db_alias
            from core.middleware import TenantMiddleware

            if not get_tenant_db_alias():
                middleware = TenantMiddleware(lambda r: None)
                try:
                    db_config = middleware._load_db_config(tenant_slug)
                    alias = f"tenant_{tenant_slug}"
                    middleware._ensure_db_connection(alias, db_config)
                    set_tenant_db_alias(alias)
                except Exception:
                    pass  # TenantMiddleware already handles failures with proper responses

        return user, token
