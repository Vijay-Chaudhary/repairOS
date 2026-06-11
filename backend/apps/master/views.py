"""
Platform Admin API views.

All endpoints here either:
  - Are public (registration)
  - Require is_platform_admin=True in the JWT (platform admin endpoints)

No tenant DB access — all queries run against the master ('default') DB.
"""

import logging

from django.db import models
from rest_framework import status
from rest_framework.permissions import AllowAny, BasePermission, IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from core.pagination import RepairOSCursorPagination

from . import services
from .models import SubscriptionPlan, Tenant
from .serializers import (
    RegisterTenantSerializer,
    RegisterVerifySerializer,
    SubscriptionPlanSerializer,
    TenantDetailSerializer,
    TenantListSerializer,
)

logger = logging.getLogger(__name__)


class IsPlatformAdmin(BasePermission):
    """Allows access only to JWT tokens with is_platform_admin=True."""

    def has_permission(self, request, view) -> bool:
        token = getattr(request, "auth", None)
        if token is None:
            return False
        return bool(token.get("is_platform_admin"))


# ──────────────────────────────────────────────────────────────────────────────
# Public: tenant registration
# ──────────────────────────────────────────────────────────────────────────────


class RegisterView(APIView):
    """
    POST /register/ — Step 1 of 2-step registration.

    Validates the form, stores pending data in Redis, sends phone OTP + email code.
    Returns 202 with {slug, phone_masked, expires_in}.  The Tenant is NOT created here.
    """

    permission_classes = [AllowAny]

    def post(self, request: Request) -> Response:
        serializer = RegisterTenantSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            result = services.initiate_registration(dict(serializer.validated_data))
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        except services.SmsNotConfiguredError:
            return Response(
                {"code": "SMS_NOT_CONFIGURED", "detail": "SMS service is not available."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        return Response(result, status=status.HTTP_202_ACCEPTED)


class RegisterVerifyView(APIView):
    """
    POST /register/verify/ — Step 2 of 2-step registration.

    Verifies phone OTP + email code, then creates the Tenant and triggers provisioning.
    Returns 201 with {tenant_id, slug, status}.
    """

    permission_classes = [AllowAny]

    def post(self, request: Request) -> Response:
        serializer = RegisterVerifySerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        try:
            tenant = services.verify_registration(
                slug=data["slug"],
                phone_otp=data["phone_otp"],
                email_code=data["email_code"],
            )
        except services.RegistrationNotFoundError:
            return Response(
                {"code": "REGISTRATION_NOT_FOUND", "detail": "No pending registration found. Please restart."},
                status=status.HTTP_404_NOT_FOUND,
            )
        except services.OtpMaxAttemptsError:
            return Response(
                {"code": "OTP_MAX_ATTEMPTS", "detail": "Too many failed attempts. Please restart registration."},
                status=status.HTTP_429_TOO_MANY_REQUESTS,
            )
        except services.OtpInvalidError:
            return Response(
                {"code": "OTP_INVALID", "detail": "Invalid phone OTP."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        except services.EmailCodeInvalidError:
            return Response(
                {"code": "EMAIL_CODE_INVALID", "detail": "Invalid email verification code."},
                status=status.HTTP_400_BAD_REQUEST,
            )
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        return Response(
            {"tenant_id": str(tenant.id), "slug": tenant.slug, "status": tenant.status},
            status=status.HTTP_201_CREATED,
        )


class RegistrationStatusView(APIView):
    """Poll provisioning progress after a successful POST /register/."""

    permission_classes = [AllowAny]

    _STATUS_MAP = {
        Tenant.Status.ACTIVE: "active",
        Tenant.Status.PROVISIONING_FAILED: "failed",
    }

    def get(self, request: Request) -> Response:
        slug = request.query_params.get("slug", "").strip().lower()
        if not slug:
            return Response({"detail": "slug is required."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            tenant = Tenant.objects.using("default").get(slug=slug)
        except Tenant.DoesNotExist:
            return Response({"detail": "Tenant not found."}, status=status.HTTP_404_NOT_FOUND)

        provision_status = self._STATUS_MAP.get(tenant.status, "provisioning")
        return Response({"slug": tenant.slug, "status": provision_status})


# ──────────────────────────────────────────────────────────────────────────────
# Platform admin: tenant management
# ──────────────────────────────────────────────────────────────────────────────


class TenantListView(APIView):
    permission_classes = [IsAuthenticated, IsPlatformAdmin]

    def get(self, request: Request) -> Response:
        from .models import TenantSubscription
        qs = (
            Tenant.objects.using("default")
            .select_related("database")
            .prefetch_related(
                models.Prefetch(
                    "subscriptions",
                    queryset=TenantSubscription.objects.select_related("plan").order_by("-created_at"),
                    to_attr="_prefetched_subscriptions",
                )
            )
            .order_by("-created_at")
        )
        search = request.query_params.get("search")
        if search:
            qs = qs.filter(
                models.Q(name__icontains=search) | models.Q(slug__icontains=search)
            )
        db_status = request.query_params.get("db_status")
        if db_status == "deleted":
            qs = qs.filter(status=Tenant.Status.DELETED)
        elif db_status == "provisioning":
            qs = qs.filter(status=Tenant.Status.PROVISIONING).exclude(database__isnull=False)
        elif db_status == "active":
            qs = qs.filter(database__is_active=True)
        elif db_status == "suspended":
            qs = qs.filter(database__is_active=False)

        paginator = RepairOSCursorPagination()
        page = paginator.paginate_queryset(qs, request)
        data = TenantListSerializer(page, many=True).data
        return paginator.get_paginated_response(data)


class TenantDetailView(APIView):
    permission_classes = [IsAuthenticated, IsPlatformAdmin]

    def _get_tenant(self, tenant_id):
        try:
            return Tenant.objects.using("default").get(id=tenant_id)
        except Tenant.DoesNotExist:
            return None

    def get(self, request: Request, tenant_id) -> Response:
        tenant = self._get_tenant(tenant_id)
        if not tenant:
            return Response({"detail": "Tenant not found."}, status=status.HTTP_404_NOT_FOUND)
        return Response(TenantDetailSerializer(tenant).data)

    def post(self, request: Request, tenant_id) -> Response:
        """POST /{id}/suspend/ — action embedded via URL suffix check."""
        return Response({"detail": "Use /suspend/ endpoint."}, status=status.HTTP_400_BAD_REQUEST)


class TenantSuspendView(APIView):
    permission_classes = [IsAuthenticated, IsPlatformAdmin]

    def post(self, request: Request, tenant_id) -> Response:
        try:
            tenant = Tenant.objects.using("default").get(id=tenant_id)
        except Tenant.DoesNotExist:
            return Response({"detail": "Tenant not found."}, status=status.HTTP_404_NOT_FOUND)

        actor = request.user.email if request.user.is_authenticated else ""
        tenant = services.suspend_tenant(tenant, actor_email=actor)
        return Response(TenantDetailSerializer(tenant).data)


# ──────────────────────────────────────────────────────────────────────────────
# Platform admin: subscription plans
# ──────────────────────────────────────────────────────────────────────────────


class SubscriptionPlanListCreateView(APIView):
    permission_classes = [IsAuthenticated, IsPlatformAdmin]

    def get(self, request: Request) -> Response:
        plans = SubscriptionPlan.objects.using("default").order_by("price_monthly_inr")
        return Response({"items": SubscriptionPlanSerializer(plans, many=True).data})

    def post(self, request: Request) -> Response:
        serializer = SubscriptionPlanSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        plan = serializer.save()
        return Response(SubscriptionPlanSerializer(plan).data, status=status.HTTP_201_CREATED)


class SubscriptionPlanDetailView(APIView):
    permission_classes = [IsAuthenticated, IsPlatformAdmin]

    def _get_plan(self, plan_id):
        try:
            return SubscriptionPlan.objects.using("default").get(id=plan_id)
        except SubscriptionPlan.DoesNotExist:
            return None

    def get(self, request: Request, plan_id) -> Response:
        plan = self._get_plan(plan_id)
        if not plan:
            return Response({"detail": "Plan not found."}, status=status.HTTP_404_NOT_FOUND)
        return Response(SubscriptionPlanSerializer(plan).data)

    def patch(self, request: Request, plan_id) -> Response:
        plan = self._get_plan(plan_id)
        if not plan:
            return Response({"detail": "Plan not found."}, status=status.HTTP_404_NOT_FOUND)
        serializer = SubscriptionPlanSerializer(plan, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        serializer.save()
        return Response(SubscriptionPlanSerializer(plan).data)


# ──────────────────────────────────────────────────────────────────────────────
# Razorpay subscription webhook (public, HMAC-verified)
# ──────────────────────────────────────────────────────────────────────────────


class RazorpaySubscriptionWebhookView(APIView):
    permission_classes = [AllowAny]

    def post(self, request: Request) -> Response:
        signature = request.META.get("HTTP_X_RAZORPAY_SIGNATURE", "")
        try:
            result = services.handle_razorpay_subscription_webhook(request.body, signature)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response({"status": "ok", **result})
