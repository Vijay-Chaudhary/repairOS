"""
JWT auth for platform admin — separate from apps/authentication/tokens.py.

Platform-admin access/refresh tokens carry: user_id (the PlatformAdminUser's
id), is_platform_admin, token_type, token_family. They never carry
tenant_slug — that's the whole point.
"""
from typing import Any

from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.exceptions import AuthenticationFailed, InvalidToken
from rest_framework_simplejwt.settings import api_settings


def _build_platform_admin_claims() -> dict[str, Any]:
    return {
        "is_platform_admin": True,
        "token_type": "platform_admin",
    }


class PlatformAdminJWTAuthentication(JWTAuthentication):
    """
    Resolves request.user against PlatformAdminUser (master DB), not tenant
    authentication.User. Set as authentication_classes on /platform/* views only.
    """

    def get_user(self, validated_token):
        from .models import PlatformAdminUser

        try:
            admin_id = validated_token[api_settings.USER_ID_CLAIM]
        except KeyError as exc:
            raise InvalidToken("Token contained no recognizable user identification") from exc

        try:
            return PlatformAdminUser.objects.using("default").get(id=admin_id, is_active=True)
        except PlatformAdminUser.DoesNotExist as exc:
            raise AuthenticationFailed("Platform admin not found", code="user_not_found") from exc
