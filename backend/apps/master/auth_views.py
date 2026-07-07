"""
Platform admin auth endpoints — fully separate from apps/authentication's tenant
auth stack. PlatformAdminUser lives in the master DB and never carries a
tenant_slug claim, so the tenant login/refresh/logout/me views (which resolve
request.user against tenant authentication.User in whatever tenant DB is
routed) cannot be reused here.
"""
import logging
import uuid

from django.conf import settings
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.settings import api_settings
from rest_framework_simplejwt.tokens import RefreshToken

from .models import AuditLogMaster, PlatformAdminTokenFamily, PlatformAdminUser
from .serializers import PlatformAdminLoginSerializer
from .tokens import _build_platform_admin_claims

logger = logging.getLogger(__name__)

_REFRESH_COOKIE = "platform_refresh_token"
_COOKIE_PARAMS = {
    "httponly": True,
    "secure": not getattr(settings, "DEBUG", False),
    "samesite": "Strict",
    "max_age": int(settings.SIMPLE_JWT["REFRESH_TOKEN_LIFETIME"].total_seconds()),
    "path": "/api/v1/platform/auth/",
}


def _get_ip(request) -> str:
    xff = request.META.get("HTTP_X_FORWARDED_FOR")
    if xff:
        return xff.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR", "")


def _set_refresh_cookie(response: Response, refresh_str: str) -> None:
    response.set_cookie(_REFRESH_COOKIE, refresh_str, **_COOKIE_PARAMS)


def _clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(_REFRESH_COOKIE, path="/api/v1/platform/auth/")


def _write_audit(request, admin_email: str, event_type: str) -> None:
    try:
        AuditLogMaster.objects.using("default").create(
            event_type=event_type,
            actor_email=admin_email,
            payload={
                "ip_address": _get_ip(request),
                "user_agent": request.META.get("HTTP_USER_AGENT", "")[:500],
            },
        )
    except Exception:
        logger.exception("Failed to write platform admin audit log")


def _issue_tokens(admin: PlatformAdminUser) -> tuple[str, str]:
    # Deliberately NOT RefreshToken.for_user(admin) — that goes through
    # BlacklistMixin.for_user(), which creates a token_blacklist.OutstandingToken
    # row with user=admin. That FK is hard-coded to AUTH_USER_MODEL
    # (authentication.User), so it raises ValueError for a PlatformAdminUser.
    # Building the token manually sidesteps OutstandingToken bookkeeping
    # entirely — session lifecycle is tracked via PlatformAdminTokenFamily
    # instead. See the gotcha note in Task 3.
    refresh = RefreshToken()
    refresh[api_settings.USER_ID_CLAIM] = str(admin.id)
    access = refresh.access_token  # property creates a new instance each call — access once
    family_id = uuid.uuid4()

    claims = _build_platform_admin_claims()
    for key, value in claims.items():
        refresh[key] = value
        access[key] = value

    refresh["token_family"] = str(family_id)
    access["token_family"] = str(family_id)

    PlatformAdminTokenFamily.objects.using("default").create(
        admin=admin,
        family_id=family_id,
        current_jti=str(refresh["jti"]),
    )

    return str(access), str(refresh)


class PlatformAdminLoginView(APIView):
    # No authentication class needed — this view never reads request.user.
    # DRF runs authentication in APIView.initial() before dispatch(), regardless
    # of permission_classes, so leaving PlatformAdminJWTAuthentication wired up
    # here would 401 a login attempt that happens to carry a stale/expired/
    # garbage Authorization header (e.g. a silent-refresh-then-retry flow, or
    # leftover token in the client after expiry).
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = PlatformAdminLoginSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        admin = serializer.validated_data["admin"]

        access, refresh = _issue_tokens(admin)
        _write_audit(request, admin.email, "platform_admin.login")

        response = Response(
            {
                "access": access,
                "admin": {
                    "id": str(admin.id),
                    "email": admin.email,
                    "full_name": admin.full_name,
                },
            },
            status=status.HTTP_200_OK,
        )
        _set_refresh_cookie(response, refresh)
        return response
