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
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.settings import api_settings
from rest_framework_simplejwt.tokens import RefreshToken

from .models import AuditLogMaster, PlatformAdminTokenFamily, PlatformAdminUser
from .serializers import PlatformAdminLoginSerializer
from .tokens import PlatformAdminJWTAuthentication, _build_platform_admin_claims

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


class PlatformAdminTokenRefreshView(APIView):
    # No authentication class — same reasoning as PlatformAdminLoginView in
    # Task 4: this view never reads request.user (it resolves the admin from
    # the refresh cookie's own claims), and refresh is called precisely when
    # the access token has expired, so requiring a valid Bearer header here
    # would break the normal refresh flow, not just an edge case.
    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        from rest_framework.exceptions import NotAuthenticated

        refresh_str = request.COOKIES.get(_REFRESH_COOKIE)
        if not refresh_str:
            raise NotAuthenticated()

        try:
            refresh = RefreshToken(refresh_str)
        except TokenError:
            response = Response(
                {"code": "REFRESH_TOKEN_INVALID", "message": "Refresh token is invalid or expired."},
                status=status.HTTP_401_UNAUTHORIZED,
            )
            _clear_refresh_cookie(response)
            return response

        jti = str(refresh["jti"])
        family_id = refresh.get("token_family")
        admin_id = refresh.get("user_id")

        try:
            family = PlatformAdminTokenFamily.objects.using("default").get(current_jti=jti)
        except PlatformAdminTokenFamily.DoesNotExist:
            if family_id:
                PlatformAdminTokenFamily.objects.using("default").filter(
                    family_id=family_id, is_revoked=False
                ).update(is_revoked=True, revoked_at=timezone.now())
            response = Response(
                {"code": "REFRESH_TOKEN_REUSE", "message": "Token reuse detected. All sessions have been revoked."},
                status=status.HTTP_401_UNAUTHORIZED,
            )
            _clear_refresh_cookie(response)
            return response

        if family.is_revoked:
            response = Response(
                {"code": "REFRESH_TOKEN_REUSE", "message": "Token reuse detected. Please log in again."},
                status=status.HTTP_401_UNAUTHORIZED,
            )
            _clear_refresh_cookie(response)
            return response

        try:
            admin = PlatformAdminUser.objects.using("default").get(id=admin_id, is_active=True)
        except PlatformAdminUser.DoesNotExist:
            response = Response(
                {"code": "NOT_AUTHENTICATED", "message": "Admin not found."},
                status=status.HTTP_401_UNAUTHORIZED,
            )
            _clear_refresh_cookie(response)
            return response

        # Not RefreshToken.for_user(admin) — see the gotcha note in Task 3
        # (BlacklistMixin.for_user() would try to FK an OutstandingToken to a
        # PlatformAdminUser, which isn't AUTH_USER_MODEL, and raise ValueError).
        new_refresh = RefreshToken()
        new_refresh[api_settings.USER_ID_CLAIM] = str(admin.id)
        new_access = new_refresh.access_token
        claims = _build_platform_admin_claims()
        for key, value in claims.items():
            new_refresh[key] = value
            new_access[key] = value
        new_refresh["token_family"] = str(family.family_id)
        new_access["token_family"] = str(family.family_id)

        family.current_jti = str(new_refresh["jti"])
        family.save(using="default", update_fields=["current_jti"])

        try:
            refresh.blacklist()
        except Exception:
            pass

        response = Response({"access": str(new_access)})
        _set_refresh_cookie(response, str(new_refresh))
        return response


class PlatformAdminLogoutView(APIView):
    authentication_classes = [PlatformAdminJWTAuthentication]
    permission_classes = [IsAuthenticated]

    def post(self, request):
        refresh_str = request.COOKIES.get(_REFRESH_COOKIE)
        if refresh_str:
            try:
                refresh = RefreshToken(refresh_str)
                jti = str(refresh["jti"])
                PlatformAdminTokenFamily.objects.using("default").filter(current_jti=jti).update(
                    is_revoked=True, revoked_at=timezone.now()
                )
                refresh.blacklist()
            except Exception:
                pass

        _write_audit(request, request.user.email, "platform_admin.logout")

        response = Response({"message": "Logged out successfully."})
        _clear_refresh_cookie(response)
        return response


class PlatformAdminMeView(APIView):
    authentication_classes = [PlatformAdminJWTAuthentication]
    permission_classes = [IsAuthenticated]

    def get(self, request):
        admin = request.user
        return Response({
            "id": str(admin.id),
            "email": admin.email,
            "full_name": admin.full_name,
        })
