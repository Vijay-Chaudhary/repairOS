"""
Billing API views.

All business logic delegated to services.py.
"""

import logging

from django.http import HttpResponse
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from authentication.permissions import require_permission

from . import services
from .models import RepairInvoice
from .serializers import (
    CreatePaymentSerializer,
    CreateRepairInvoiceSerializer,
    PaymentSerializer,
    RepairInvoiceSerializer,
)

logger = logging.getLogger(__name__)


class RepairInvoiceView(APIView):
    permission_classes = [IsAuthenticated, require_permission("billing.repair_invoices.create")]

    def post(self, request: Request) -> Response:
        serializer = CreateRepairInvoiceSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        try:
            from repair.models import JobTicket
            job = JobTicket.objects.select_related("shop", "customer").get(
                id=data["job_id"]
            )
        except JobTicket.DoesNotExist:
            return Response({"detail": "Job not found."}, status=status.HTTP_404_NOT_FOUND)

        try:
            invoice = services.create_repair_invoice(job, dict(data), request.user)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)

        return Response(RepairInvoiceSerializer(invoice).data, status=status.HTTP_201_CREATED)


class PaymentView(APIView):
    permission_classes = [IsAuthenticated, require_permission("billing.payments.record")]

    def post(self, request: Request) -> Response:
        serializer = CreatePaymentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        try:
            invoice = RepairInvoice.objects.select_related("customer").get(
                id=data["invoice_id"]
            )
        except RepairInvoice.DoesNotExist:
            return Response({"detail": "Invoice not found."}, status=status.HTTP_404_NOT_FOUND)

        payment = services.record_payment(invoice, dict(data), request.user)
        return Response(PaymentSerializer(payment).data, status=status.HTTP_201_CREATED)


class RazorpayWebhookView(APIView):
    permission_classes = []  # HMAC-authenticated, not JWT

    def post(self, request: Request) -> Response:
        signature = request.META.get("HTTP_X_RAZORPAY_SIGNATURE", "")
        try:
            payment = services.handle_razorpay_webhook(request.body, signature)
        except ValueError as exc:
            return Response({"detail": str(exc)}, status=status.HTTP_400_BAD_REQUEST)
        return Response({"status": "ok"}, status=status.HTTP_200_OK)


class TallyExportView(APIView):
    permission_classes = [IsAuthenticated, require_permission("billing.tally_export")]

    def get(self, request: Request) -> HttpResponse:
        from core.models import Shop

        shop_id = request.query_params.get("shop_id")
        from_date = request.query_params.get("from_date")
        to_date = request.query_params.get("to_date")

        if not all([shop_id, from_date, to_date]):
            return Response(
                {"detail": "shop_id, from_date, and to_date are required."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            shop = Shop.objects.get(id=shop_id)
        except Shop.DoesNotExist:
            return Response({"detail": "Shop not found."}, status=status.HTTP_404_NOT_FOUND)

        csv_data = services.tally_export_csv(shop, from_date, to_date)
        response = HttpResponse(csv_data, content_type="text/csv; charset=utf-8")
        response["Content-Disposition"] = (
            f'attachment; filename="tally-export-{from_date}-{to_date}.csv"'
        )
        return response
