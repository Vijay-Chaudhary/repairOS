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


class CommissionRulesView(APIView):
    permission_classes = [IsAuthenticated, require_permission("settings.commission_rules.manage")]

    def get(self, request: Request) -> Response:
        rules = CommissionRule.objects.all().order_by("-effective_from")
        return Response(CommissionRuleSerializer(rules, many=True).data)

    def post(self, request: Request) -> Response:
        serializer = CommissionRuleSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        rule = serializer.save()
        return Response(CommissionRuleSerializer(rule).data, status=status.HTTP_201_CREATED)


class TechnicianLedgerView(APIView):
    permission_classes = [IsAuthenticated, require_permission("hr.salary.view")]

    def get(self, request: Request, technician_id: str) -> Response:
        from authentication.models import User
        try:
            technician = User.objects.get(id=technician_id)
        except User.DoesNotExist:
            return Response({"detail": "Technician not found."}, status=status.HTTP_404_NOT_FOUND)

        commissions = TechnicianCommission.objects.filter(
            technician=technician
        ).select_related("job", "payout").order_by("-created_at")

        total_unpaid = sum(
            c.commission_amount for c in commissions if not c.is_paid
        )

        return Response({
            "technician_id": str(technician_id),
            "total_unpaid": str(total_unpaid.quantize(Decimal("0.01"))),
            "commissions": TechnicianCommissionSerializer(commissions, many=True).data,
        })


class CommissionPayoutView(APIView):
    permission_classes = [IsAuthenticated, require_permission("hr.salary.generate")]

    def get(self, request: Request) -> Response:
        from .models import CommissionPayout
        qs = CommissionPayout.objects.select_related("technician").order_by("-period_end")
        if tech_id := request.query_params.get("technician_id"):
            qs = qs.filter(technician_id=tech_id)
        if s := request.query_params.get("status"):
            qs = qs.filter(status=s)
        return Response(CommissionPayoutSerializer(qs, many=True).data)

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
            return Response(
                {"detail": f"Payout is already '{payout.status}'; no further transitions."},
                status=status.HTTP_422_UNPROCESSABLE_ENTITY,
            )
        payout.status = next_status
        if next_status == CommissionPayout.Status.PAID:
            payout.paid_at = tz.now()
            payout.paid_by = request.user
        payout.save()
        return Response(CommissionPayoutSerializer(payout).data)
