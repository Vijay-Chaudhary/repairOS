"""
Billing API views.

All business logic delegated to services.py.
"""

import logging

from django.db.models import Q
from django.http import HttpResponse
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from authentication.permissions import require_permission
from core.pagination import RepairOSCursorPagination

from . import services
from .models import Payment, RepairInvoice
from .serializers import (
    CreatePaymentSerializer,
    CreateRepairInvoiceSerializer,
    PaymentSerializer,
    RepairInvoiceDetailSerializer,
    RepairInvoiceListSerializer,
)

logger = logging.getLogger(__name__)


class RepairInvoiceView(APIView):
    permission_classes = [IsAuthenticated, require_permission("billing.repair_invoices.create")]

    def get(self, request: Request) -> Response:
        """List repair invoices for the authenticated user's shops."""
        token = getattr(request, "auth", None)
        shop_ids = token.get("shop_ids", []) if token else []
        # Allow explicit shop_id override from query params
        if qp_shop := request.query_params.get("shop_id"):
            shop_ids = [qp_shop]

        qs = (
            RepairInvoice.objects.select_related("customer", "job", "shop")
            .prefetch_related("payment_set")
            .filter(shop_id__in=shop_ids)
            .order_by("-created_at")
        )

        # Filters
        status_filter = request.query_params.get("status")
        if status_filter:
            qs = qs.filter(status=status_filter)

        customer_id = request.query_params.get("customer_id")
        if customer_id:
            qs = qs.filter(customer_id=customer_id)

        search = request.query_params.get("search", "").strip()
        if search:
            qs = qs.filter(
                Q(invoice_number__icontains=search)
                | Q(customer__name__icontains=search)
                | Q(customer__phone__icontains=search)
                | Q(job__job_number__icontains=search)
            )

        paginator = RepairOSCursorPagination()
        page = paginator.paginate_queryset(qs, request)
        serializer = RepairInvoiceListSerializer(page, many=True)
        return paginator.get_paginated_response(serializer.data)

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

        return Response(
            RepairInvoiceDetailSerializer(invoice).data,
            status=status.HTTP_201_CREATED,
        )


class RepairInvoiceDetailView(APIView):
    permission_classes = [IsAuthenticated, require_permission("billing.repair_invoices.create")]

    def get(self, request: Request, invoice_id: str) -> Response:
        try:
            invoice = RepairInvoice.objects.select_related(
                "customer", "job", "shop"
            ).prefetch_related("items", "payment_set").get(id=invoice_id)
        except RepairInvoice.DoesNotExist:
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)

        return Response(RepairInvoiceDetailSerializer(invoice).data)


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
