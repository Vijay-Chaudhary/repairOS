"""
Custom exception handler and DRF exception classes.

Maps DRF/Django exceptions to the RepairOS error registry (foundation/03-conventions §3).
The renderer wraps the returned data in {"success": false, "error": {...}}.
"""

import logging

from django.core.exceptions import PermissionDenied, ValidationError as DjangoValidationError
from django.http import Http404
from rest_framework import status
from rest_framework.exceptions import (
    APIException,
    AuthenticationFailed,
    NotAuthenticated,
    NotFound,
    PermissionDenied as DRFPermissionDenied,
    Throttled,
    ValidationError,
)
from rest_framework.response import Response
from rest_framework.views import exception_handler

logger = logging.getLogger(__name__)


# ──────────────────────────────────────────────────────────────────────────────
# Custom exception classes
# ──────────────────────────────────────────────────────────────────────────────


class BusinessRuleViolation(APIException):
    status_code = status.HTTP_422_UNPROCESSABLE_ENTITY
    default_code = "BUSINESS_RULE_VIOLATION"

    def __init__(self, message: str):
        super().__init__(detail=message, code=self.default_code)


class InvalidStatusTransition(APIException):
    status_code = status.HTTP_400_BAD_REQUEST
    default_code = "INVALID_STATUS_TRANSITION"

    def __init__(self, from_status: str, to_status: str, hint: str = ""):
        msg = f"Cannot move from '{from_status}' to '{to_status}'."
        if hint:
            msg = f"{msg} {hint}"
        super().__init__(detail=msg, code=self.default_code)


class CreditLimitExceeded(APIException):
    status_code = status.HTTP_422_UNPROCESSABLE_ENTITY
    default_code = "CREDIT_LIMIT_EXCEEDED"

    def __init__(self, message: str):
        super().__init__(detail=message, code=self.default_code)


class InsufficientStock(APIException):
    status_code = status.HTTP_400_BAD_REQUEST
    default_code = "INSUFFICIENT_STOCK"


class DuplicatePhone(APIException):
    status_code = status.HTTP_400_BAD_REQUEST
    default_code = "DUPLICATE_PHONE"

    def __init__(self):
        super().__init__(detail="A customer with this phone number already exists.", code=self.default_code)


class AccountLocked(APIException):
    status_code = status.HTTP_423_LOCKED
    default_code = "ACCOUNT_LOCKED"

    def __init__(self, locked_until):
        super().__init__(
            detail={"message": "Account is locked due to too many failed login attempts.", "locked_until": str(locked_until)},
            code=self.default_code,
        )


class OTPExpired(APIException):
    status_code = status.HTTP_410_GONE
    default_code = "OTP_EXPIRED"

    def __init__(self):
        super().__init__(detail="The OTP has expired. Please request a new one.", code=self.default_code)


class OTPRateLimit(APIException):
    status_code = status.HTTP_429_TOO_MANY_REQUESTS
    default_code = "OTP_RATE_LIMIT"

    def __init__(self):
        super().__init__(detail="Too many OTP requests. Please wait before trying again.", code=self.default_code)


class PlanShopLimitExceeded(APIException):
    status_code = status.HTTP_403_FORBIDDEN
    default_code = "PLAN_SHOP_LIMIT_EXCEEDED"

    def __init__(self, max_shops: int):
        super().__init__(
            detail=f"Your plan allows {max_shops} shop(s). Upgrade to add more.",
            code=self.default_code,
        )


class DuplicateShopCode(APIException):
    status_code = status.HTTP_409_CONFLICT
    default_code = "DUPLICATE_SHOP_CODE"

    def __init__(self, code: str):
        super().__init__(
            detail=f"Shop code '{code}' is already in use.",
            code=self.default_code,
        )


# ──────────────────────────────────────────────────────────────────────────────
# Custom exception handler
# ──────────────────────────────────────────────────────────────────────────────


def repairosException_handler(exc, context):
    # Coerce Django exceptions to DRF equivalents
    if isinstance(exc, Http404):
        exc = NotFound()
    elif isinstance(exc, PermissionDenied):
        exc = DRFPermissionDenied()
    elif isinstance(exc, DjangoValidationError):
        exc = ValidationError(detail=exc.message_dict if hasattr(exc, "message_dict") else exc.messages)

    response = exception_handler(exc, context)

    if response is None:
        logger.exception("Unhandled exception", exc_info=exc)
        return Response(
            {"code": "INTERNAL_ERROR", "message": "An unexpected error occurred."},
            status=status.HTTP_500_INTERNAL_SERVER_ERROR,
        )

    # Normalise to our error shape; the renderer wraps it in {"success": false, "error": ...}
    if isinstance(exc, ValidationError):
        response.data = {"code": "VALIDATION_ERROR", "message": "Validation failed.", "fields": response.data}
    elif isinstance(exc, NotAuthenticated):
        response.data = {"code": "NOT_AUTHENTICATED", "message": "Authentication required."}
    elif isinstance(exc, AuthenticationFailed):
        response.data = {"code": "INVALID_CREDENTIALS", "message": str(exc.detail)}
    elif isinstance(exc, DRFPermissionDenied):
        response.data = {"code": "PERMISSION_DENIED", "message": "You do not have permission to perform this action."}
    elif isinstance(exc, NotFound):
        response.data = {"code": "NOT_FOUND", "message": "The requested resource was not found or has been deleted."}
    elif isinstance(exc, Throttled):
        response.data = {"code": "RATE_LIMIT_EXCEEDED", "message": "Request rate limit exceeded."}
        if exc.wait is not None:
            response["Retry-After"] = int(exc.wait)
    elif isinstance(exc, APIException):
        code = getattr(exc, "default_code", "API_ERROR") or "API_ERROR"
        detail = exc.detail
        if isinstance(detail, dict):
            response.data = {**{"code": code}, **detail}
        else:
            response.data = {"code": code, "message": str(detail)}

    return response
