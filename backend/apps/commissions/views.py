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
