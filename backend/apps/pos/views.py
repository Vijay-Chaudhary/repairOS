"""
POS views — 5 API endpoints from modules/03-pos §6.

POST  /sales/                       — create sale
GET   /sales/{id}/                  — detail
POST  /sales/{id}/payment/          — add payment to existing sale
POST  /sales/{id}/return/           — create return
PATCH /sales/returns/{id}/          — review return (approve/reject)
GET   /products/barcode/{barcode}/  — barcode lookup (shop-aware: variant + stock)
"""

import logging
from decimal import Decimal

from django.db.models import Q
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.viewsets import GenericViewSet

from authentication.permissions import require_permission
from core.pagination import RepairOSCursorPagination
from crm.views import ShopScopedMixin

from . import services
from .models import Sale, SalesReturn
from .serializers import (
    AddPaymentSerializer,
    BarcodeLookupSerializer,
    CreateReturnSerializer,
    CreateSaleSerializer,
    ReviewReturnSerializer,
    SaleListSerializer,
    SaleSerializer,
    SalesReturnSerializer,
)

logger = logging.getLogger(__name__)


# ──────────────────────────────────────────────────────────────────────────────
# Sale viewset
# ──────────────────────────────────────────────────────────────────────────────


class SaleViewSet(ShopScopedMixin, GenericViewSet):
    pagination_class = RepairOSCursorPagination
    http_method_names = ["get", "post", "head", "options"]

    def get_permissions(self):
        if self.action == "create":
            return [require_permission("pos.counter_sale.create")()]
        if self.action in ("retrieve", "list"):
            return [require_permission("billing.sales_invoices.view")()]
        if self.action == "add_payment":
            return [require_permission("billing.payments.record")()]
        if self.action == "create_return":
            return [require_permission("pos.returns.create")()]
        return [require_permission("billing.sales_invoices.view")()]

    def get_queryset(self):
        qs = Sale.objects.filter(self._shop_filter()).select_related("customer", "shop")

        qp = self.request.query_params
        if s := qp.get("status"):
            qs = qs.filter(status=s)
        if st := qp.get("sale_type"):
            qs = qs.filter(sale_type=st)
        if cid := qp.get("customer_id"):
            qs = qs.filter(customer_id=cid)
        if date_from := qp.get("date_from"):
            qs = qs.filter(sale_date__date__gte=date_from)
        if date_to := qp.get("date_to"):
            qs = qs.filter(sale_date__date__lte=date_to)
        if q := qp.get("search"):
            from django.db.models import Q
            qs = qs.filter(
                Q(sale_number__icontains=q) | Q(customer__name__icontains=q)
            )
        return qs

    def list(self, request, *args, **kwargs):
        qs = self.get_queryset()
        page = self.paginate_queryset(qs)
        data = SaleListSerializer(page if page is not None else qs, many=True).data
        if page is not None:
            return self.get_paginated_response(data)
        return Response(data)

    def create(self, request, *args, **kwargs):
        serializer = CreateSaleSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        vd = serializer.validated_data

        shop = vd.pop("shop")
        sale = services.create_sale(shop, vd, request.user)
        sale = (
            Sale.objects
            .prefetch_related("items", "payments", "returns")
            .select_related("customer")
            .get(pk=sale.pk)
        )
        return Response(SaleSerializer(sale).data, status=status.HTTP_201_CREATED)

    def retrieve(self, request, pk=None):
        sale = self._get_sale(pk)
        return Response(SaleSerializer(sale).data)

    @action(detail=True, methods=["post"], url_path="payment")
    def add_payment(self, request, pk=None):
        sale = self._get_sale(pk)
        serializer = AddPaymentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        sale = services.add_payment(sale, serializer.validated_data, request.user)
        return Response(SaleSerializer(sale).data)

    @action(detail=True, methods=["post"], url_path="return")
    def create_return(self, request, pk=None):
        sale = self._get_sale(pk)
        serializer = CreateReturnSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        ret = services.create_return(sale, serializer.validated_data, request.user)
        return Response(SalesReturnSerializer(ret).data, status=status.HTTP_201_CREATED)

    def _get_sale(self, pk):
        try:
            return (
                Sale.objects.filter(self._shop_filter())
                .prefetch_related("items", "payments", "returns")
                .select_related("customer")
                .get(pk=pk)
            )
        except Sale.DoesNotExist:
            from rest_framework.exceptions import NotFound
            raise NotFound("Sale not found.")


# ──────────────────────────────────────────────────────────────────────────────
# Return review viewset
# ──────────────────────────────────────────────────────────────────────────────


class SalesReturnViewSet(GenericViewSet):
    http_method_names = ["patch", "head", "options"]

    def get_permissions(self):
        return [require_permission("pos.returns.approve")()]

    def get_queryset(self):
        qs = SalesReturn.objects.select_related("sale__shop")
        token = getattr(self.request, "auth", None)
        if token and not token.get("is_tenant_wide") and not token.get("is_platform_admin"):
            shop_ids = token.get("shop_ids", [])
            qs = qs.filter(sale__shop_id__in=shop_ids)
        return qs

    def partial_update(self, request, pk=None):
        try:
            ret = self.get_queryset().get(pk=pk)
        except SalesReturn.DoesNotExist:
            from rest_framework.exceptions import NotFound
            raise NotFound("Return not found.")

        serializer = ReviewReturnSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        action_val = serializer.validated_data["action"]
        if action_val == "approve":
            ret = services.approve_return(ret, request.user)
        else:
            ret = services.reject_return(ret, request.user)

        return Response(SalesReturnSerializer(ret).data)


# ──────────────────────────────────────────────────────────────────────────────
# Barcode lookup
# ──────────────────────────────────────────────────────────────────────────────


class BarcodeView(APIView):
    """
    Shop-aware variant lookup for the POS cart (§6): combines the catalogue
    variant with its stock-on-hand at the requesting shop, in the shape the
    cart needs to add an item directly from a barcode scan.
    """

    def get_permissions(self):
        return [require_permission("pos.counter_sale.create")()]

    def get(self, request, barcode):
        from rest_framework.exceptions import NotFound

        from inventory.models import InventoryStock, ProductVariant

        try:
            variant = ProductVariant.objects.select_related("product").get(
                barcode=barcode, is_active=True
            )
        except ProductVariant.DoesNotExist:
            raise NotFound(f"No active variant found with barcode '{barcode}'.")

        stock_quantity = Decimal("0")
        shop_id = request.query_params.get("shop_id")
        if shop_id:
            stock = InventoryStock.objects.filter(shop_id=shop_id, variant=variant).first()
            if stock:
                stock_quantity = stock.quantity_in_stock

        data = {
            "id": variant.id,
            "product_name": variant.product.name,
            "variant_name": variant.variant_name,
            "sku": variant.product.sku,
            "barcode": variant.barcode,
            "hsn_code": variant.product.hsn_code,
            "selling_price": variant.selling_price,
            "wholesale_price": variant.wholesale_price,
            "cost_price": variant.cost_price,
            "tax_rate": variant.product.default_tax_rate,
            "stock_quantity": stock_quantity,
        }
        return Response(BarcodeLookupSerializer(data).data)
