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
from core.pagination import RepairOSCursorPagination, RepairOSPageNumberPagination

from . import services
from .models import CreditNote, Payment, RepairInvoice, Refund, TaxRate
from .serializers import (
    CreateCreditNoteSerializer,
    CreatePaymentSerializer,
    CreateRefundSerializer,
    CreateRepairInvoiceSerializer,
    CreditNoteSerializer,
    OutstandingInvoiceSerializer,
    PaymentSerializer,
    RefundSerializer,
    RepairInvoiceDetailSerializer,
    RepairInvoiceListSerializer,
    TaxRateSerializer,
)

logger = logging.getLogger(__name__)


def _shop_ids_from_token(token) -> list | None:
    """Return shop_ids list from JWT, or None if tenant-wide (no filter needed)."""
    if token is None:
        return []
    if token.get("is_tenant_wide") or token.get("is_platform_admin"):
        return None
    return token.get("shop_ids", [])


class RepairInvoiceView(APIView):

    def get_permissions(self):
        if self.request.method == "GET":
            return [IsAuthenticated(), require_permission("billing.repair_invoices.view")()]
        return [IsAuthenticated(), require_permission("billing.repair_invoices.create")()]

    def get(self, request: Request) -> Response:
        """List repair invoices for the authenticated user's shops."""
        token = getattr(request, "auth", None)
        shop_ids = _shop_ids_from_token(token)

        # Explicit shop_id override from query params (allowed for all roles)
        if qp_shop := request.query_params.get("shop_id"):
            shop_ids = [qp_shop]

        qs = RepairInvoice.objects.select_related("customer", "job", "shop").order_by("-created_at")

        if shop_ids is not None:
            qs = qs.filter(shop_id__in=shop_ids)

        # Filters
        status_filter = request.query_params.get("status")
        if status_filter:
            qs = qs.filter(status=status_filter)

        customer_id = request.query_params.get("customer_id")
        if customer_id:
            qs = qs.filter(customer_id=customer_id)

        outstanding_only = request.query_params.get("outstanding_only", "").lower()
        if outstanding_only == "true":
            qs = qs.filter(amount_outstanding__gt=0)

        search = request.query_params.get("search", "").strip()
        if search:
            qs = qs.filter(
                Q(invoice_number__icontains=search)
                | Q(customer__name__icontains=search)
                | Q(customer__phone__icontains=search)
                | Q(job__job_number__icontains=search)
            )

        paginator = RepairOSPageNumberPagination()
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

        invoice = services.create_repair_invoice(job, dict(data), request.user)
        return Response(
            RepairInvoiceDetailSerializer(invoice).data,
            status=status.HTTP_201_CREATED,
        )


class RepairInvoiceDetailView(APIView):

    def get_permissions(self):
        if self.request.method == "GET":
            return [IsAuthenticated(), require_permission("billing.repair_invoices.view")()]
        return [IsAuthenticated(), require_permission("billing.repair_invoices.create")()]

    def _get_invoice(self, request: Request, invoice_id: str):
        """Fetch invoice scoped to the caller's shops. Returns (invoice, error_response)."""
        token = getattr(request, "auth", None)
        shop_ids = _shop_ids_from_token(token)

        qs = RepairInvoice.objects.select_related("customer", "job", "shop").prefetch_related(
            "items", "payments"
        )
        if shop_ids is not None:
            qs = qs.filter(shop_id__in=shop_ids)

        try:
            return qs.get(id=invoice_id), None
        except RepairInvoice.DoesNotExist:
            return None, Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)

    def get(self, request: Request, invoice_id: str) -> Response:
        invoice, err = self._get_invoice(request, invoice_id)
        if err:
            return err
        return Response(RepairInvoiceDetailSerializer(invoice).data)


class RepairInvoicePdfView(APIView):
    permission_classes = [IsAuthenticated, require_permission("billing.repair_invoices.view")]

    def get(self, request: Request, invoice_id: str) -> Response:
        token = getattr(request, "auth", None)
        shop_ids = _shop_ids_from_token(token)

        qs = RepairInvoice.objects.only("id", "pdf_url", "shop_id")
        if shop_ids is not None:
            qs = qs.filter(shop_id__in=shop_ids)

        try:
            invoice = qs.get(id=invoice_id)
        except RepairInvoice.DoesNotExist:
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)

        return Response({"pdf_url": invoice.pdf_url or ""})


class RepairInvoiceSendWhatsappView(APIView):
    permission_classes = [IsAuthenticated, require_permission("billing.repair_invoices.create")]

    def post(self, request: Request, invoice_id: str) -> Response:
        token = getattr(request, "auth", None)
        shop_ids = _shop_ids_from_token(token)

        qs = RepairInvoice.objects.select_related("customer", "shop")
        if shop_ids is not None:
            qs = qs.filter(shop_id__in=shop_ids)

        try:
            invoice = qs.get(id=invoice_id)
        except RepairInvoice.DoesNotExist:
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)

        logger.info(
            "WhatsApp send requested for invoice %s to %s",
            invoice.invoice_number,
            invoice.customer.phone,
        )
        return Response({"queued": True})


class PaymentView(APIView):
    permission_classes = [IsAuthenticated, require_permission("billing.payments.record")]

    def get(self, request: Request) -> Response:
        """List payments scoped to the caller's shops."""
        token = getattr(request, "auth", None)
        shop_ids = _shop_ids_from_token(token)

        qs = Payment.objects.select_related("invoice__shop", "recorded_by").order_by("-paid_at")
        if shop_ids is not None:
            qs = qs.filter(invoice__shop_id__in=shop_ids)

        invoice_id = request.query_params.get("invoice_id")
        if invoice_id:
            qs = qs.filter(invoice_id=invoice_id)

        method = request.query_params.get("method")
        if method:
            qs = qs.filter(method=method)

        date_from = request.query_params.get("date_from")
        if date_from:
            qs = qs.filter(paid_at__date__gte=date_from)

        date_to = request.query_params.get("date_to")
        if date_to:
            qs = qs.filter(paid_at__date__lte=date_to)

        paginator = RepairOSPageNumberPagination()
        page = paginator.paginate_queryset(qs, request)
        serializer = PaymentSerializer(page, many=True)
        return paginator.get_paginated_response(serializer.data)

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


class RazorpayCreateLinkView(APIView):
    permission_classes = [IsAuthenticated, require_permission("billing.payments.record")]

    def post(self, request: Request) -> Response:
        return Response(
            {"code": "FEATURE_PENDING", "detail": "Razorpay payment link creation is not yet implemented."},
            status=status.HTTP_501_NOT_IMPLEMENTED,
        )


class RazorpayWebhookView(APIView):
    permission_classes = []  # HMAC-authenticated, not JWT

    def post(self, request: Request) -> Response:
        signature = request.META.get("HTTP_X_RAZORPAY_SIGNATURE", "")
        try:
            services.handle_razorpay_webhook(request.body, signature)
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


class OutstandingView(APIView):
    """Aging report over repair invoices with money still due."""

    permission_classes = [IsAuthenticated, require_permission("billing.outstanding.view")]

    def get(self, request: Request) -> Response:
        token = getattr(request, "auth", None)
        shop_ids = _shop_ids_from_token(token)
        if qp_shop := request.query_params.get("shop_id"):
            shop_ids = [qp_shop]

        try:
            overdue_days = int(request.query_params.get("overdue_days", 0))
        except (TypeError, ValueError):
            overdue_days = 0
        customer_id = request.query_params.get("customer_id")

        rows = list(
            services.outstanding_queryset(
                shop_ids, overdue_days=overdue_days, customer_id=customer_id
            )
        )
        return Response({
            "summary": services.outstanding_summary(rows),
            "results": OutstandingInvoiceSerializer(rows, many=True).data,
        })


class TaxRateView(APIView):
    """List/create GST tax-rate slabs (Settings › Taxes)."""

    permission_classes = [IsAuthenticated, require_permission("settings.taxes.manage")]

    def get(self, request: Request) -> Response:
        active_only = request.query_params.get("is_active", "").lower() == "true"
        rates = services.list_tax_rates(active_only=active_only)
        return Response(TaxRateSerializer(rates, many=True).data)

    def post(self, request: Request) -> Response:
        ser = TaxRateSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        ser.save()
        return Response(ser.data, status=status.HTTP_201_CREATED)


class TaxRateDetailView(APIView):
    """Retrieve/update/deactivate a single tax-rate slab."""

    permission_classes = [IsAuthenticated, require_permission("settings.taxes.manage")]

    def _get(self, tax_rate_id) -> TaxRate:
        from django.shortcuts import get_object_or_404
        return get_object_or_404(TaxRate, id=tax_rate_id)

    def get(self, request: Request, tax_rate_id) -> Response:
        return Response(TaxRateSerializer(self._get(tax_rate_id)).data)

    def patch(self, request: Request, tax_rate_id) -> Response:
        ser = TaxRateSerializer(self._get(tax_rate_id), data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        ser.save()
        return Response(ser.data)

    def delete(self, request: Request, tax_rate_id) -> Response:
        services.deactivate_tax_rate(self._get(tax_rate_id))
        return Response(status=status.HTTP_204_NO_CONTENT)


class CreditNoteView(APIView):
    def get_permissions(self):
        if self.request.method == "GET":
            return [IsAuthenticated(), require_permission("billing.credit_notes.view")()]
        return [IsAuthenticated(), require_permission("billing.credit_notes.create")()]

    def get(self, request: Request) -> Response:
        token = getattr(request, "auth", None)
        shop_ids = _shop_ids_from_token(token)
        qs = CreditNote.objects.select_related("invoice__customer", "approved_by").order_by("-created_at")
        if shop_ids is not None:
            qs = qs.filter(shop_id__in=shop_ids)
        if s := request.query_params.get("status"):
            qs = qs.filter(status=s)
        if inv := request.query_params.get("invoice_id"):
            qs = qs.filter(invoice_id=inv)
        return Response(CreditNoteSerializer(qs, many=True).data)

    def post(self, request: Request) -> Response:
        ser = CreateCreditNoteSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        token = getattr(request, "auth", None)
        shop_ids = _shop_ids_from_token(token)
        qs = RepairInvoice.objects.select_related("shop", "customer")
        if shop_ids is not None:
            qs = qs.filter(shop_id__in=shop_ids)
        try:
            invoice = qs.get(id=ser.validated_data["invoice_id"])
        except RepairInvoice.DoesNotExist:
            return Response({"detail": "Invoice not found."}, status=status.HTTP_404_NOT_FOUND)
        cn = services.create_credit_note(invoice, ser.validated_data["amount"], ser.validated_data["reason"], request.user)
        return Response(CreditNoteSerializer(cn).data, status=status.HTTP_201_CREATED)


class CreditNoteApproveView(APIView):
    permission_classes = [IsAuthenticated, require_permission("billing.credit_notes.approve")]

    def post(self, request: Request, credit_note_id) -> Response:
        from django.shortcuts import get_object_or_404
        token = getattr(request, "auth", None)
        shop_ids = _shop_ids_from_token(token)
        qs = CreditNote.objects.select_related("invoice")
        if shop_ids is not None:
            qs = qs.filter(shop_id__in=shop_ids)
        cn = get_object_or_404(qs, id=credit_note_id)
        cn = services.approve_credit_note(cn, request.user)
        return Response(CreditNoteSerializer(cn).data)


class RefundView(APIView):
    def get_permissions(self):
        if self.request.method == "GET":
            return [IsAuthenticated(), require_permission("billing.refunds.view")()]
        return [IsAuthenticated(), require_permission("billing.refunds.create")()]

    def get(self, request: Request) -> Response:
        token = getattr(request, "auth", None)
        shop_ids = _shop_ids_from_token(token)
        qs = Refund.objects.select_related("invoice__customer", "approved_by").order_by("-created_at")
        if shop_ids is not None:
            qs = qs.filter(shop_id__in=shop_ids)
        if s := request.query_params.get("status"):
            qs = qs.filter(status=s)
        if inv := request.query_params.get("invoice_id"):
            qs = qs.filter(invoice_id=inv)
        return Response(RefundSerializer(qs, many=True).data)

    def post(self, request: Request) -> Response:
        ser = CreateRefundSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        token = getattr(request, "auth", None)
        shop_ids = _shop_ids_from_token(token)
        qs = RepairInvoice.objects.select_related("shop", "customer")
        if shop_ids is not None:
            qs = qs.filter(shop_id__in=shop_ids)
        try:
            invoice = qs.get(id=ser.validated_data["invoice_id"])
        except RepairInvoice.DoesNotExist:
            return Response({"detail": "Invoice not found."}, status=status.HTTP_404_NOT_FOUND)
        refund = services.create_refund(invoice, ser.validated_data["amount"], ser.validated_data["method"], ser.validated_data["reason"], request.user)
        return Response(RefundSerializer(refund).data, status=status.HTTP_201_CREATED)


class RefundApproveView(APIView):
    permission_classes = [IsAuthenticated, require_permission("billing.refunds.approve")]

    def post(self, request: Request, refund_id) -> Response:
        from django.shortcuts import get_object_or_404
        token = getattr(request, "auth", None)
        shop_ids = _shop_ids_from_token(token)
        qs = Refund.objects.select_related("invoice")
        if shop_ids is not None:
            qs = qs.filter(shop_id__in=shop_ids)
        refund = get_object_or_404(qs, id=refund_id)
        refund = services.approve_refund(refund, request.user)
        return Response(RefundSerializer(refund).data)
