"""
Auth endpoints per foundation/02-auth-rbac §3.

POST /auth/login/       — email + password → access token; refresh in HttpOnly cookie
POST /auth/otp/request/ — phone → OTP via SMS (Redis-backed, 600 s TTL)
POST /auth/otp/verify/  — phone + OTP → access token; refresh in HttpOnly cookie
POST /auth/token/refresh/ — HttpOnly cookie → new access token + rotated cookie
POST /auth/logout/      — blacklist refresh token + clear cookie
POST /auth/password/change/ — change password (authenticated)
"""

import logging
import random
import secrets
import string
import uuid

from django.conf import settings
from django.core.cache import cache
from django.utils import timezone
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import RefreshToken

from .models import AuditLog, User, UserTokenFamily
from .serializers import (
    LoginSerializer,
    OTPRequestSerializer,
    OTPVerifySerializer,
    PasswordChangeSerializer,
    UserSerializer,
)

logger = logging.getLogger(__name__)


class DevOTPView(APIView):
    """DEV/E2E ONLY — returns the cached OTP for a phone number.
    Only active when DEBUG=True. NEVER exposed in production."""

    permission_classes = [AllowAny]

    def get(self, request):
        if not settings.DEBUG or not getattr(settings, "DEV_OTP_ENABLED", False):
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied("Not available in production.")
        phone = request.query_params.get("phone", "")
        otp_key = f"otp:{phone}"
        cached = cache.get(otp_key)
        if not cached:
            return Response({"error": "No OTP found for this phone"}, status=404)
        return Response({"otp": cached["otp"]})

_REFRESH_COOKIE = "refresh_token"
_COOKIE_PARAMS = {
    "httponly": True,
    "secure": not getattr(settings, "DEBUG", False),
    "samesite": "Strict",
    "max_age": int(settings.SIMPLE_JWT["REFRESH_TOKEN_LIFETIME"].total_seconds()),
    "path": "/api/v1/auth/",
}


def _get_ip(request) -> str:
    xff = request.META.get("HTTP_X_FORWARDED_FOR")
    if xff:
        return xff.split(",")[0].strip()
    return request.META.get("REMOTE_ADDR", "")


def _get_tenant_slug(request) -> str:
    from core.context import get_tenant_db_alias

    alias = get_tenant_db_alias() or ""
    return alias.removeprefix("tenant_")


def _issue_tokens(user, tenant_slug: str, request) -> tuple[str, str, dict]:
    """Returns (access_token_str, refresh_token_str) with custom claims injected."""
    from .tokens import _build_token_claims

    refresh = RefreshToken.for_user(user)
    # Access the access token ONCE — the property creates a new instance each call.
    access = refresh.access_token
    family_id = uuid.uuid4()

    extra = _build_token_claims(user, tenant_slug)
    for key, value in extra.items():
        refresh[key] = value
        access[key] = value

    refresh["token_family"] = str(family_id)
    access["token_family"] = str(family_id)

    # Persist family for replay detection
    UserTokenFamily.objects.create(
        user=user,
        family_id=family_id,
        current_jti=str(refresh["jti"]),
    )

    return str(access), str(refresh), extra


def _set_refresh_cookie(response: Response, refresh_str: str) -> None:
    response.set_cookie(_REFRESH_COOKIE, refresh_str, **_COOKIE_PARAMS)


def _clear_refresh_cookie(response: Response) -> None:
    response.delete_cookie(_REFRESH_COOKIE, path="/api/v1/auth/")


def _write_audit(request, user_id, action: str, model_name: str = "User", object_id=None, extra=None):
    try:
        AuditLog.objects.create(
            user_id=user_id,
            action=action,
            model_name=model_name,
            object_id=object_id or user_id,
            new_value=extra,
            ip_address=_get_ip(request),
            user_agent=request.META.get("HTTP_USER_AGENT", "")[:500],
        )
    except Exception:
        logger.exception("Failed to write audit log")


# ──────────────────────────────────────────────────────────────────────────────
# Views
# ──────────────────────────────────────────────────────────────────────────────


class LoginView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        serializer = LoginSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)

        user = serializer.validated_data["user"]
        tenant_slug = _get_tenant_slug(request)

        # Block login for suspended tenants. Tenant identity is derived solely
        # from the request's resolved subdomain/JWT context — 'default' means
        # no tenant context (tests/local/platform-admin), so we skip the check.
        ctx_slug = tenant_slug if tenant_slug not in ("", "default") else ""
        if ctx_slug:
            try:
                from master.models import Tenant
                t = Tenant.objects.using("default").get(slug=ctx_slug)
                if t.status == Tenant.Status.SUSPENDED:
                    return Response(
                        {"code": "TENANT_SUSPENDED", "detail": "This account is suspended."},
                        status=status.HTTP_403_FORBIDDEN,
                    )
            except Tenant.DoesNotExist:
                pass

        access, refresh, claims = _issue_tokens(user, tenant_slug, request)
        _write_audit(request, user.id, AuditLog.Action.LOGIN)

        response = Response(
            {
                "access": access,
                "user": {
                    "id": str(user.id),
                    "name": user.full_name,
                    "email": user.email,
                    "phone": user.phone or "",
                    "avatar_url": user.avatar_url or None,
                    "is_platform_admin": user.is_platform_admin,
                    "shop_ids": claims.get("shop_ids", []),
                    "role_ids": claims.get("role_ids", []),
                    "permissions": claims.get("permissions", []),
                },
            },
            status=status.HTTP_200_OK,
        )
        _set_refresh_cookie(response, refresh)
        return response


class OTPRequestView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        from core.exceptions import OTPRateLimit

        serializer = OTPRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        phone = serializer.validated_data["phone"]

        rate_key = f"otp_rate:{phone}"
        count = cache.get(rate_key, 0)
        if count >= settings.OTP_RATE_LIMIT:
            raise OTPRateLimit()

        otp = "".join(random.choices(string.digits, k=6))
        otp_key = f"otp:{phone}"

        if not self._send_otp(phone, otp):
            return Response(
                {"code": "SMS_NOT_CONFIGURED", "message": "SMS delivery is not configured. Please log in with email and password."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        cache.set(otp_key, {"otp": otp, "attempts": 0}, timeout=settings.OTP_EXPIRY_SECONDS)
        cache.set(rate_key, count + 1, timeout=settings.OTP_RATE_WINDOW)
        logger.info("OTP sent to %s", phone)

        return Response({"message": "OTP sent.", "expires_in": settings.OTP_EXPIRY_SECONDS})

    def _send_otp(self, phone: str, otp: str) -> bool:
        """Dispatch the OTP via SMS. Returns True once dispatched (or logged in DEBUG)."""
        if getattr(settings, "DEBUG", False):
            logger.debug("DEV OTP for %s: %s", phone, otp)
            return True
        # Production: send via MSG91 — not yet integrated.
        # return msg91_service.send_otp(phone, otp)
        return False


class OTPVerifyView(APIView):
    permission_classes = [AllowAny]

    def post(self, request):
        from core.exceptions import OTPExpired

        serializer = OTPVerifySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        phone = serializer.validated_data["phone"]
        otp_input = serializer.validated_data["otp"]

        otp_key = f"otp:{phone}"
        cached = cache.get(otp_key)

        if cached is None:
            raise OTPExpired()

        if cached["otp"] != otp_input:
            from rest_framework.exceptions import ValidationError

            cached["attempts"] = cached.get("attempts", 0) + 1
            if cached["attempts"] >= settings.MAX_OTP_ATTEMPTS:
                cache.delete(otp_key)
                raise ValidationError({"otp": ["Too many attempts. Request a new OTP."]})

            cache.set(otp_key, cached, timeout=settings.OTP_EXPIRY_SECONDS)
            raise ValidationError({"otp": ["Invalid OTP."]})

        cache.delete(otp_key)

        try:
            user = User.objects.get(phone=phone, is_active=True)
        except User.DoesNotExist:
            from rest_framework.exceptions import ValidationError

            raise ValidationError({"phone": ["No active account found for this phone number."]})

        tenant_slug = _get_tenant_slug(request)
        access, refresh, claims = _issue_tokens(user, tenant_slug, request)
        _write_audit(request, user.id, AuditLog.Action.LOGIN, extra={"method": "otp"})

        response = Response(
            {
                "access": access,
                "user": {
                    "id": str(user.id),
                    "name": user.full_name,
                    "email": user.email,
                    "phone": user.phone or "",
                    "avatar_url": user.avatar_url or None,
                    "is_platform_admin": user.is_platform_admin,
                    "shop_ids": claims.get("shop_ids", []),
                    "role_ids": claims.get("role_ids", []),
                    "permissions": claims.get("permissions", []),
                },
            },
            status=status.HTTP_200_OK,
        )
        _set_refresh_cookie(response, refresh)
        return response


class TokenRefreshView(APIView):
    """
    Reads the refresh token from the HttpOnly cookie, validates it with
    family replay detection, and returns a new access token + rotated cookie.
    """

    permission_classes = [AllowAny]

    def post(self, request):
        refresh_str = request.COOKIES.get(_REFRESH_COOKIE)
        if not refresh_str:
            from rest_framework.exceptions import NotAuthenticated

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
        user_id = refresh.get("user_id")
        tenant_slug = refresh.get("tenant_slug", "")

        try:
            family = UserTokenFamily.objects.get(current_jti=jti)
        except UserTokenFamily.DoesNotExist:
            # Token not in our DB → possible replay after logout; revoke all families
            if family_id:
                UserTokenFamily.objects.filter(
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
            user = User.objects.get(id=user_id, is_active=True)
        except User.DoesNotExist:
            response = Response(
                {"code": "NOT_AUTHENTICATED", "message": "User not found."},
                status=status.HTTP_401_UNAUTHORIZED,
            )
            _clear_refresh_cookie(response)
            return response

        # Rotate: blacklist old, issue new
        from .tokens import _build_token_claims

        new_refresh = RefreshToken.for_user(user)
        new_access = new_refresh.access_token  # create once
        extra = _build_token_claims(user, tenant_slug)
        for key, value in extra.items():
            new_refresh[key] = value
            new_access[key] = value
        new_refresh["token_family"] = str(family.family_id)
        new_access["token_family"] = str(family.family_id)

        # Update family with new jti
        family.current_jti = str(new_refresh["jti"])
        family.save(update_fields=["current_jti"])

        # Blacklist old refresh token
        try:
            refresh.blacklist()
        except Exception:
            pass

        response = Response({"access": str(new_access)})
        _set_refresh_cookie(response, str(new_refresh))
        return response


class LogoutView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        refresh_str = request.COOKIES.get(_REFRESH_COOKIE)
        if refresh_str:
            try:
                refresh = RefreshToken(refresh_str)
                jti = str(refresh["jti"])
                UserTokenFamily.objects.filter(current_jti=jti).update(
                    is_revoked=True, revoked_at=timezone.now()
                )
                refresh.blacklist()
            except Exception:
                pass

        _write_audit(request, request.user.id, AuditLog.Action.LOGOUT)

        response = Response({"message": "Logged out successfully."})
        _clear_refresh_cookie(response)
        return response


class PasswordChangeView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        serializer = PasswordChangeSerializer(data=request.data, context={"request": request})
        serializer.is_valid(raise_exception=True)

        request.user.set_password(serializer.validated_data["new_password"])
        request.user.save(update_fields=["password"])

        _write_audit(request, request.user.id, AuditLog.Action.UPDATE, extra={"action": "password_change"})

        return Response({"message": "Password changed successfully."})


class MeView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        user = request.user
        tenant_slug = _get_tenant_slug(request)
        from .tokens import _build_token_claims
        claims = _build_token_claims(user, tenant_slug)
        return Response({
            "id": str(user.id),
            "name": user.full_name,
            "email": user.email,
            "phone": user.phone or "",
            "avatar_url": user.avatar_url or None,
            "is_platform_admin": user.is_platform_admin,
            "shop_ids": claims.get("shop_ids", []),
            "role_ids": claims.get("role_ids", []),
            "permissions": claims.get("permissions", []),
        })
