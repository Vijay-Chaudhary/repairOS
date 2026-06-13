"""
Commissions API views.

All business logic in services.py.
"""

import logging
from decimal import Decimal

from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from authentication.permissions import require_permission
from core.pagination import RepairOSCursorPagination

from . import services
from .models import CommissionRule, TechnicianCommission
from .serializers import (
    CommissionPayoutSerializer,
    CommissionRuleSerializer,
    CreatePayoutSerializer,
    TechnicianCommissionSerializer,
)

logger = logging.getLogger(__name__)

_PAYOUT_STATUS_TRANSITIONS = {
    "draft":    "approved",
    "approved": "paid",
}

_ZERO = Decimal("0.00")


def _shop_ids_for_request(token) -> tuple[list, bool]:
    """Returns (shop_ids, is_wide). is_wide=True means no shop filter should apply."""
    if not token:
        return [], False
    if token.get("is_tenant_wide") or token.get("is_platform_admin"):
        return [], True
    return token.get("shop_ids", []), False


class CommissionRulesView(APIView):
    permission_classes = [IsAuthenticated, require_permission("settings.commission_rules.manage")]

    def get(self, request: Request) -> Response:
        rules = CommissionRule.objects.all().order_by("-effective_from")
        return Response({"items": CommissionRuleSerializer(rules, many=True).data})

    def post(self, request: Request) -> Response:
        serializer = CommissionRuleSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        rule = serializer.save()
        return Response(CommissionRuleSerializer(rule).data, status=status.HTTP_201_CREATED)


class TechnicianLedgerView(APIView):

    def get_permissions(self):
        # Technicians may view their own ledger without hr.salary.view
        tech_id = self.kwargs.get("technician_id")
        if self.request.method == "GET" and str(self.request.user.id) == str(tech_id):
            return [IsAuthenticated()]
        return [IsAuthenticated(), require_permission("hr.salary.view")()]

    def get(self, request: Request, technician_id: str) -> Response:
        from authentication.models import User
        try:
            technician = User.objects.get(id=technician_id)
        except User.DoesNotExist:
            return Response({"detail": "Technician not found."}, status=status.HTTP_404_NOT_FOUND)

        qs = TechnicianCommission.objects.filter(
            technician=technician
        ).select_related("job", "payout").order_by("-created_at")

        if ps := request.query_params.get("period_start"):
            qs = qs.filter(created_at__date__gte=ps)
        if pe := request.query_params.get("period_end"):
            qs = qs.filter(created_at__date__lte=pe)

        commissions = list(qs)
        total_earned = sum((c.commission_amount for c in commissions), _ZERO)
        total_paid = sum((c.commission_amount for c in commissions if c.is_paid), _ZERO)
        total_unpaid = total_earned - total_paid

        return Response({
            "technician_id": str(technician_id),
            "technician_name": technician.full_name,
            "total_earned": float(total_earned),
            "total_paid": float(total_paid),
            "total_unpaid": float(total_unpaid),
            "commissions": TechnicianCommissionSerializer(commissions, many=True).data,
        })


class CommissionPayoutView(APIView):
    permission_classes = [IsAuthenticated, require_permission("hr.salary.generate")]

    def get(self, request: Request) -> Response:
        from .models import CommissionPayout
        token = getattr(request, "auth", None)
        shop_ids, is_wide = _shop_ids_for_request(token)

        qs = CommissionPayout.objects.select_related("technician").order_by("-period_end")
        if not is_wide:
            qs = qs.filter(technician__shop_access__shop_id__in=shop_ids)
        if tech_id := request.query_params.get("technician_id"):
            qs = qs.filter(technician_id=tech_id)
        if s := request.query_params.get("status"):
            qs = qs.filter(status=s)
        paginator = RepairOSCursorPagination()
        page = paginator.paginate_queryset(qs, request)
        data = CommissionPayoutSerializer(page, many=True).data
        return paginator.get_paginated_response(data)

    def post(self, request: Request) -> Response:
        serializer = CreatePayoutSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        from authentication.models import User
        try:
            technician = User.objects.get(id=data["technician_id"])
        except User.DoesNotExist:
            return Response({"detail": "Technician not found."}, status=status.HTTP_404_NOT_FOUND)

        payout = services.create_payout(
            technician=technician,
            period_start=data["period_start"],
            period_end=data["period_end"],
            created_by=request.user,
        )
        return Response(CommissionPayoutSerializer(payout).data, status=status.HTTP_201_CREATED)


class CommissionPayoutDetailView(APIView):
    """PATCH to advance payout status: draft→approved→paid."""

    permission_classes = [IsAuthenticated, require_permission("hr.salary.generate")]

    def get(self, request: Request, payout_id) -> Response:
        from .models import CommissionPayout
        try:
            payout = CommissionPayout.objects.select_related("technician").get(id=payout_id)
        except CommissionPayout.DoesNotExist:
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        return Response(CommissionPayoutSerializer(payout).data)

    def patch(self, request: Request, payout_id) -> Response:
        from .models import CommissionPayout
        from django.utils import timezone as tz
        try:
            payout = CommissionPayout.objects.get(id=payout_id)
        except CommissionPayout.DoesNotExist:
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)

        next_status = _PAYOUT_STATUS_TRANSITIONS.get(payout.status)
        if not next_status:
            from core.exceptions import BusinessRuleViolation
            raise BusinessRuleViolation(
                f"Payout is already '{payout.status}'; no further transitions."
            )
        payout.status = next_status
        if next_status == CommissionPayout.Status.PAID:
            payout.paid_at = tz.now()
            payout.paid_by = request.user
        payout.save()

        from authentication.models import AuditLog
        try:
            AuditLog.objects.create(
                user_id=request.user.id,
                action=AuditLog.Action.UPDATE,
                model_name="CommissionPayout",
                object_id=payout.id,
                new_value={"status": next_status},
            )
        except Exception:
            pass

        return Response(CommissionPayoutSerializer(payout).data)
