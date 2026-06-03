"""
Procurement views — 7 spec endpoints + purchase-returns.

GET/POST  /procurement/suppliers/                    — list / create suppliers
GET       /procurement/suppliers/{id}/ledger/        — supplier payable ledger
POST      /procurement/purchase-orders/              — create PO
PATCH     /procurement/purchase-orders/{id}/         — update / send PO
POST      /procurement/grn/                          — receive GRN (posts stock)
POST      /procurement/purchase-invoices/            — record supplier bill
POST      /procurement/purchase-payments/            — record payment
POST      /procurement/purchase-returns/             — create return
PATCH     /procurement/purchase-returns/{id}/dispatch/ — dispatch return + debit note
"""

import logging

from rest_framework import status
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.viewsets import GenericViewSet

from authentication.permissions import require_permission
from core.pagination import RepairOSCursorPagination

from . import services
from .models import (
    GoodsReceiptNote,
    PurchaseInvoice,
    PurchaseOrder,
    PurchaseReturn,
    Supplier,
)
from .serializers import (
    CreateGRNSerializer,
    CreatePurchaseInvoiceSerializer,
    CreatePurchaseOrderSerializer,
    CreatePurchasePaymentSerializer,
    CreatePurchaseReturnSerializer,
    GRNSerializer,
    PurchaseInvoiceSerializer,
    PurchaseOrderSerializer,
    PurchasePaymentSerializer,
    PurchaseReturnSerializer,
    SupplierSerializer,
    UpdatePurchaseOrderSerializer,
)

logger = logging.getLogger(__name__)


# ──────────────────────────────────────────────────────────────────────────────
# Suppliers
# ──────────────────────────────────────────────────────────────────────────────


class SupplierView(APIView):
    pagination_class = RepairOSCursorPagination

    def get_permissions(self):
        return [require_permission("erp.suppliers.manage")()]

    def get(self, request):
        qs = Supplier.objects.filter(is_active=True).order_by("name")
        if q := request.query_params.get("q"):
            from django.db.models import Q
            qs = qs.filter(Q(name__icontains=q) | Q(phone__icontains=q))
        return Response(SupplierSerializer(qs, many=True).data)

    def post(self, request):
        serializer = SupplierSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        supplier = services.create_supplier(dict(serializer.validated_data), request.user)
        return Response(SupplierSerializer(supplier).data, status=status.HTTP_201_CREATED)


class SupplierDetailView(APIView):
    def get_permissions(self):
        return [require_permission("erp.suppliers.manage")()]

    def _get_supplier(self, pk):
        try:
            return Supplier.objects.get(pk=pk)
        except Supplier.DoesNotExist:
            from rest_framework.exceptions import NotFound
            raise NotFound("Supplier not found.")

    def patch(self, request, pk):
        supplier = self._get_supplier(pk)
        serializer = SupplierSerializer(supplier, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        supplier = services.update_supplier(supplier, dict(serializer.validated_data), request.user)
        return Response(SupplierSerializer(supplier).data)

    def get(self, request, pk):
        supplier = self._get_supplier(pk)
        return Response(SupplierSerializer(supplier).data)


class SupplierLedgerView(APIView):
    def get_permissions(self):
        return [require_permission("erp.suppliers.manage")()]

    def get(self, request, pk):
        try:
            supplier = Supplier.objects.get(pk=pk)
        except Supplier.DoesNotExist:
            from rest_framework.exceptions import NotFound
            raise NotFound("Supplier not found.")
        return Response(services.get_supplier_ledger(supplier))


# ──────────────────────────────────────────────────────────────────────────────
# Purchase Orders
# ──────────────────────────────────────────────────────────────────────────────


class PurchaseOrderView(APIView):
    def get_permissions(self):
        return [require_permission("erp.purchase_orders.create")()]

    def post(self, request):
        from core.models import Shop
        from core.exceptions import BusinessRuleViolation

        serializer = CreatePurchaseOrderSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        vd = serializer.validated_data

        try:
            shop = Shop.objects.get(id=vd["shop_id"])
        except Shop.DoesNotExist:
            from rest_framework.exceptions import NotFound
            raise NotFound("Shop not found.")

        try:
            supplier = Supplier.objects.get(id=vd["supplier_id"], is_active=True)
        except Supplier.DoesNotExist:
            from rest_framework.exceptions import NotFound
            raise NotFound("Supplier not found.")

        po = services.create_purchase_order(shop, supplier, vd, request.user)
        return Response(PurchaseOrderSerializer(po).data, status=status.HTTP_201_CREATED)


class PurchaseOrderDetailView(APIView):
    def get_permissions(self):
        return [require_permission("erp.purchase_orders.create")()]

    def _get_po(self, pk):
        try:
            return PurchaseOrder.objects.prefetch_related("items__variant__product").get(pk=pk)
        except PurchaseOrder.DoesNotExist:
            from rest_framework.exceptions import NotFound
            raise NotFound("Purchase order not found.")

    def get(self, request, pk):
        return Response(PurchaseOrderSerializer(self._get_po(pk)).data)

    def patch(self, request, pk):
        po = self._get_po(pk)
        serializer = UpdatePurchaseOrderSerializer(data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        po = services.update_purchase_order(po, serializer.validated_data, request.user)
        return Response(PurchaseOrderSerializer(po).data)


# ──────────────────────────────────────────────────────────────────────────────
# GRN
# ──────────────────────────────────────────────────────────────────────────────


class GRNView(APIView):
    def get_permissions(self):
        return [require_permission("erp.grn.receive")()]

    def post(self, request):
        serializer = CreateGRNSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        vd = serializer.validated_data

        try:
            po = PurchaseOrder.objects.get(id=vd["po_id"])
        except PurchaseOrder.DoesNotExist:
            from rest_framework.exceptions import NotFound
            raise NotFound("Purchase order not found.")

        grn = services.receive_grn(po.shop, po, vd, request.user)
        return Response(GRNSerializer(grn).data, status=status.HTTP_201_CREATED)


# ──────────────────────────────────────────────────────────────────────────────
# Purchase Invoice
# ──────────────────────────────────────────────────────────────────────────────


class PurchaseInvoiceView(APIView):
    def get_permissions(self):
        return [require_permission("erp.purchase_invoices.record")()]

    def post(self, request):
        from core.models import Shop

        serializer = CreatePurchaseInvoiceSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        vd = serializer.validated_data

        try:
            shop = Shop.objects.get(id=vd["shop_id"])
        except Shop.DoesNotExist:
            from rest_framework.exceptions import NotFound
            raise NotFound("Shop not found.")

        try:
            supplier = Supplier.objects.get(id=vd["supplier_id"])
        except Supplier.DoesNotExist:
            from rest_framework.exceptions import NotFound
            raise NotFound("Supplier not found.")

        invoice = services.create_purchase_invoice(shop, supplier, vd, request.user)
        return Response(PurchaseInvoiceSerializer(invoice).data, status=status.HTTP_201_CREATED)


# ──────────────────────────────────────────────────────────────────────────────
# Purchase Payment
# ──────────────────────────────────────────────────────────────────────────────


class PurchasePaymentView(APIView):
    def get_permissions(self):
        return [require_permission("erp.purchase_invoices.record")()]

    def post(self, request):
        serializer = CreatePurchasePaymentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        vd = serializer.validated_data

        try:
            invoice = PurchaseInvoice.objects.get(id=vd["purchase_invoice_id"])
        except PurchaseInvoice.DoesNotExist:
            from rest_framework.exceptions import NotFound
            raise NotFound("Purchase invoice not found.")

        payment = services.record_purchase_payment(invoice, vd, request.user)
        return Response(PurchasePaymentSerializer(payment).data, status=status.HTTP_201_CREATED)


# ──────────────────────────────────────────────────────────────────────────────
# Purchase Return
# ──────────────────────────────────────────────────────────────────────────────


class PurchaseReturnView(APIView):
    def get_permissions(self):
        return [require_permission("erp.purchase_returns.create")()]

    def post(self, request):
        serializer = CreatePurchaseReturnSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        vd = serializer.validated_data

        try:
            invoice = PurchaseInvoice.objects.get(id=vd["purchase_invoice_id"])
        except PurchaseInvoice.DoesNotExist:
            from rest_framework.exceptions import NotFound
            raise NotFound("Purchase invoice not found.")

        ret = services.create_purchase_return(invoice, vd, request.user)
        return Response(PurchaseReturnSerializer(ret).data, status=status.HTTP_201_CREATED)


class PurchaseReturnDispatchView(APIView):
    def get_permissions(self):
        return [require_permission("erp.purchase_returns.create")()]

    def patch(self, request, pk):
        try:
            ret = PurchaseReturn.objects.get(pk=pk)
        except PurchaseReturn.DoesNotExist:
            from rest_framework.exceptions import NotFound
            raise NotFound("Purchase return not found.")

        ret = services.dispatch_purchase_return(ret, request.user)
        return Response(PurchaseReturnSerializer(ret).data)
