"""
JWT auth for platform admin — separate from apps/authentication/tokens.py.

Platform-admin access/refresh tokens carry: user_id (the PlatformAdminUser's
id), is_platform_admin, admin_token_type, token_family. They never carry
tenant_slug — that's the whole point.
"""
from typing import Any

from rest_framework_simplejwt.authentication import JWTAuthentication
from rest_framework_simplejwt.exceptions import AuthenticationFailed, InvalidToken
from rest_framework_simplejwt.settings import api_settings
from rest_framework_simplejwt.tokens import RefreshToken


class PlatformAdminRefreshToken(RefreshToken):
    """
    Refresh token for platform-admin sessions that never touches simplejwt's
    token_blacklist app.

    Platform-admin tokens are verified against the master ('default') DB, but
    core.routers.TenantDatabaseRouter.allow_migrate() only creates the
    token_blacklist_* tables on tenant DBs — never the master DB. A plain
    RefreshToken(str) runs BlacklistMixin.check_blacklist() during verify(),
    which then queries a table that doesn't exist and raises, 500ing every
    refresh/logout. Session revocation and refresh-token reuse detection are
    handled by PlatformAdminTokenFamily (rotating current_jti) instead, so the
    blacklist app is simply not part of this subsystem. Overriding both hooks to
    no-ops keeps signature/expiry/token-type verification intact while skipping
    the blacklist DB access entirely.
    """

    def check_blacklist(self, *args, **kwargs) -> None:  # noqa: D401
        return None

    def blacklist(self, *args, **kwargs) -> None:
        return None


def _build_platform_admin_claims() -> dict[str, Any]:
    # NOTE: the key is "admin_token_type", NOT "token_type" — "token_type" is
    # simplejwt's own reserved claim (TOKEN_TYPE_CLAIM, default "token_type"),
    # used internally by AccessToken/RefreshToken.verify_token_type() to stamp
    # and check "access" vs "refresh". Overwriting it breaks simplejwt's own
    # token-type verification on every decode (raises TokenError: "Token has
    # wrong type"). Found and fixed during Task 5 — see its notes.
    return {
        "is_platform_admin": True,
        "admin_token_type": "platform_admin",
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
