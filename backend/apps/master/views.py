"""
Platform Admin API views.

All endpoints here either:
  - Are public (registration)
  - Require is_platform_admin=True in the JWT (platform admin endpoints)

No tenant DB access — all queries run against the master ('default') DB.
"""

import logging

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
    permission_classes = [AllowAny]

    def post(self, request: Request) -> Response:
        serializer = RegisterTenantSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        from master.models import SubscriptionPlan as SP
        try:
            SP.objects.get(id=data["plan_id"])
        except SP.DoesNotExist:
            return Response({"detail": "Plan not found."}, status=status.HTTP_400_BAD_REQUEST)

        try:
            tenant = services.register_tenant(data)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        return Response(
            {
                "tenant_id": str(tenant.id),
                "slug": tenant.slug,
                "db_status": tenant.status,
            },
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
        tenants = Tenant.objects.using("default").order_by("-created_at")
        paginator = RepairOSCursorPagination()
        page = paginator.paginate_queryset(tenants, request)
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
        return Response(SubscriptionPlanSerializer(plans, many=True).data)

    def post(self, request: Request) -> Response:
        serializer = SubscriptionPlanSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        plan = serializer.save()
        return Response(SubscriptionPlanSerializer(plan).data, status=status.HTTP_201_CREATED)


class SubscriptionPlanDetailView(APIView):
    permission_classes = [IsAuthenticated, IsPlatformAdmin]

    def get(self, request: Request, plan_id) -> Response:
        try:
            plan = SubscriptionPlan.objects.using("default").get(id=plan_id)
        except SubscriptionPlan.DoesNotExist:
            return Response({"detail": "Plan not found."}, status=status.HTTP_404_NOT_FOUND)
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
