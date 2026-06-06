"""
Inventory views — 7 API endpoints from modules/05-inventory §6.

GET/POST  /inventory/products/                — list / create products
GET/PATCH /inventory/products/{id}/           — detail / update
GET/POST  /inventory/products/{id}/variants/  — list / create variants
PATCH     /inventory/products/variants/{id}/  — update variant
GET       /inventory/products/barcode/{code}/ — barcode lookup (replaces POS stub)
POST      /inventory/products/bulk-import/    — CSV import
GET       /inventory/stock/                   — list stock levels
POST      /inventory/stock/opening/           — set opening stock
POST      /inventory/adjustment/              — manual stock adjustment
POST      /inventory/transfer/                — inter-shop transfer
GET       /inventory/transactions/            — ledger (read-only)
"""

import logging

from django.db.models import Count, Q
from rest_framework import status
from rest_framework.decorators import action
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.viewsets import GenericViewSet

from authentication.permissions import require_permission
from core.pagination import RepairOSCursorPagination
from crm.views import ShopScopedMixin

from . import services
from .models import InventoryStock, InventoryTransaction, Product, ProductCategory, ProductVariant
from .serializers import (
    AdjustmentSerializer,
    BarcodeLookupSerializer,
    CreateVariantSerializer,
    InventoryStockSerializer,
    InventoryTransactionSerializer,
    OpeningStockSerializer,
    ProductCategorySerializer,
    ProductSerializer,
    ProductVariantSerializer,
    TransferSerializer,
)

logger = logging.getLogger(__name__)


# ──────────────────────────────────────────────────────────────────────────────
# Products
# ──────────────────────────────────────────────────────────────────────────────


class ProductViewSet(GenericViewSet):
    pagination_class = RepairOSCursorPagination
    http_method_names = ["get", "post", "patch", "head", "options"]

    def get_permissions(self):
        if self.action in ("list", "retrieve"):
            return [require_permission("erp.inventory.view")()]
        return [require_permission("erp.inventory.adjust")()]

    def get_queryset(self):
        qs = Product.objects.select_related("category").prefetch_related("variants").annotate(
            variant_count=Count("variants")
        )

        qp = self.request.query_params
        if q := qp.get("search"):
            qs = qs.filter(Q(name__icontains=q) | Q(sku__icontains=q))
        if cat_id := qp.get("category_id"):
            qs = qs.filter(category_id=cat_id)
        if is_sale := qp.get("is_for_sale"):
            qs = qs.filter(is_for_sale=is_sale.lower() == "true")
        if is_repair := qp.get("is_for_repair_use"):
            qs = qs.filter(is_for_repair_use=is_repair.lower() == "true")
        if active := qp.get("is_active"):
            qs = qs.filter(is_active=active.lower() == "true")
        return qs

    def list(self, request, *args, **kwargs):
        qs = self.get_queryset()
        page = self.paginate_queryset(qs)
        data = ProductSerializer(page if page is not None else qs, many=True).data
        if page is not None:
            return self.get_paginated_response(data)
        return Response(data)

    def create(self, request, *args, **kwargs):
        serializer = ProductSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        product = serializer.save()
        return Response(ProductSerializer(product).data, status=status.HTTP_201_CREATED)

    def retrieve(self, request, pk=None):
        product = self._get_product(pk)
        return Response(ProductSerializer(product).data)

    def partial_update(self, request, pk=None):
        product = self._get_product(pk)
        serializer = ProductSerializer(product, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        product = serializer.save()
        return Response(ProductSerializer(product).data)

    @action(detail=True, methods=["get", "post"], url_path="variants")
    def variants(self, request, pk=None):
        product = self._get_product(pk)

        if request.method == "GET":
            qs = product.variants.filter(is_active=True)
            return Response(ProductVariantSerializer(qs, many=True).data)

        serializer = CreateVariantSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        variant = serializer.save(product=product)
        return Response(ProductVariantSerializer(variant).data, status=status.HTTP_201_CREATED)

    def _get_product(self, pk):
        try:
            return self.get_queryset().get(pk=pk)
        except Product.DoesNotExist:
            from rest_framework.exceptions import NotFound
            raise NotFound("Product not found.")


class ProductVariantUpdateView(APIView):
    def get_permissions(self):
        return [require_permission("erp.inventory.adjust")()]

    def patch(self, request, pk):
        try:
            variant = ProductVariant.objects.get(pk=pk)
        except ProductVariant.DoesNotExist:
            from rest_framework.exceptions import NotFound
            raise NotFound("Variant not found.")

        serializer = ProductVariantSerializer(variant, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        variant = serializer.save()
        return Response(ProductVariantSerializer(variant).data)


class BarcodeView(APIView):
    def get_permissions(self):
        return [require_permission("pos.counter_sale.create")()]

    def get(self, request, barcode):
        try:
            variant = ProductVariant.objects.select_related("product").get(
                barcode=barcode, is_active=True
            )
        except ProductVariant.DoesNotExist:
            from rest_framework.exceptions import NotFound
            raise NotFound(f"No active variant found with barcode '{barcode}'.")

        return Response(BarcodeLookupSerializer(variant).data)


class BulkImportView(APIView):
    parser_classes = [MultiPartParser]

    def get_permissions(self):
        return [require_permission("erp.inventory.adjust")()]

    def post(self, request):
        csv_file = request.FILES.get("file")
        if not csv_file:
            from rest_framework.exceptions import ValidationError
            raise ValidationError({"file": "A CSV file is required."})

        csv_text = csv_file.read().decode("utf-8", errors="replace")
        result = services.bulk_import_products(csv_text, request.user)
        return Response(result, status=status.HTTP_200_OK)


# ──────────────────────────────────────────────────────────────────────────────
# Stock
# ──────────────────────────────────────────────────────────────────────────────


class InventoryStockViewSet(ShopScopedMixin, GenericViewSet):
    pagination_class = RepairOSCursorPagination

    def get_permissions(self):
        return [require_permission("erp.inventory.view")()]

    def get_queryset(self):
        qs = InventoryStock.objects.filter(
            shop__in=self._shop_ids()
        ).select_related("variant__product", "shop")

        qp = self.request.query_params
        if shop_id := qp.get("shop_id"):
            qs = qs.filter(shop_id=shop_id)
        if variant_id := qp.get("variant_id"):
            qs = qs.filter(variant_id=variant_id)
        if low := qp.get("low_stock") or qp.get("low_stock_only"):
            if low.lower() == "true":
                from django.db.models import F
                qs = qs.filter(quantity_in_stock__lt=F("reorder_level"))
        if q := qp.get("search"):
            qs = qs.filter(
                Q(variant__product__name__icontains=q) | Q(variant__product__sku__icontains=q)
            )
        if cat_id := qp.get("category_id"):
            qs = qs.filter(variant__product__category_id=cat_id)
        return qs

    def list(self, request, *args, **kwargs):
        qs = self.get_queryset()
        page = self.paginate_queryset(qs)
        data = InventoryStockSerializer(page if page is not None else qs, many=True).data
        if page is not None:
            return self.get_paginated_response(data)
        return Response(data)

    def _shop_ids(self):
        token = getattr(self.request, "auth", None)
        if token and (token.get("is_tenant_wide") or token.get("is_platform_admin")):
            from core.models import Shop
            return Shop.objects.values_list("id", flat=True)
        return token.get("shop_ids", []) if token else []


class OpeningStockView(APIView):
    def get_permissions(self):
        return [require_permission("erp.inventory.adjust")()]

    def post(self, request):
        serializer = OpeningStockSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        vd = serializer.validated_data
        stock = services.opening_stock(
            shop=vd["shop"], variant=vd["variant"],
            qty=vd["quantity"], user=request.user,
        )
        return Response(InventoryStockSerializer(stock).data, status=status.HTTP_201_CREATED)


# ──────────────────────────────────────────────────────────────────────────────
# Operations
# ──────────────────────────────────────────────────────────────────────────────


class AdjustmentView(APIView):
    def get_permissions(self):
        return [require_permission("erp.inventory.adjust")()]

    def post(self, request):
        serializer = AdjustmentSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        vd = serializer.validated_data
        stock, new_qty = services.adjust_stock(
            shop=vd["shop"], variant=vd["variant"],
            quantity_delta=vd["quantity"], note=vd["note"],
            user=request.user,
        )
        txn = (
            InventoryTransaction.objects.select_related("variant__product", "created_by")
            .filter(
                shop=vd["shop"],
                variant=vd["variant"],
                type=InventoryTransaction.TxnType.ADJUSTMENT,
            )
            .order_by("-created_at")
            .first()
        )
        return Response(
            {
                "new_qty": float(new_qty),
                "transaction": InventoryTransactionSerializer(txn).data if txn else None,
            },
            status=status.HTTP_201_CREATED,
        )


class TransferView(APIView):
    def get_permissions(self):
        return [require_permission("erp.inventory.adjust")()]

    def post(self, request):
        serializer = TransferSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        vd = serializer.validated_data
        _src_stock, _dst_stock, transfer_ref = services.inter_shop_transfer(
            source_shop=vd["source_shop"],
            dest_shop=vd["dest_shop"],
            variant=vd["variant"],
            qty=vd["quantity"],
            note=vd.get("note", ""),
            user=request.user,
        )
        txns = InventoryTransaction.objects.select_related(
            "variant__product", "created_by"
        ).filter(reference_id=transfer_ref)
        return Response(
            {"transactions": InventoryTransactionSerializer(txns, many=True).data},
            status=status.HTTP_201_CREATED,
        )


# ──────────────────────────────────────────────────────────────────────────────
# Ledger (read-only)
# ──────────────────────────────────────────────────────────────────────────────


class InventoryTransactionViewSet(ShopScopedMixin, GenericViewSet):
    pagination_class = RepairOSCursorPagination

    def get_permissions(self):
        return [require_permission("erp.inventory.view")()]

    def get_queryset(self):
        qs = InventoryTransaction.objects.filter(
            shop__in=self._shop_ids()
        ).select_related("variant__product", "created_by")

        qp = self.request.query_params
        if shop_id := qp.get("shop_id"):
            qs = qs.filter(shop_id=shop_id)
        if variant_id := qp.get("variant_id"):
            qs = qs.filter(variant_id=variant_id)
        if txn_type := qp.get("type"):
            qs = qs.filter(type=txn_type)
        if date_from := qp.get("date_from"):
            qs = qs.filter(created_at__date__gte=date_from)
        if date_to := qp.get("date_to"):
            qs = qs.filter(created_at__date__lte=date_to)
        return qs

    def list(self, request, *args, **kwargs):
        qs = self.get_queryset()
        page = self.paginate_queryset(qs)
        data = InventoryTransactionSerializer(
            page if page is not None else qs, many=True
        ).data
        if page is not None:
            return self.get_paginated_response(data)
        return Response(data)

    def _shop_ids(self):
        token = getattr(self.request, "auth", None)
        if token and (token.get("is_tenant_wide") or token.get("is_platform_admin")):
            from core.models import Shop
            return Shop.objects.values_list("id", flat=True)
        return token.get("shop_ids", []) if token else []


# ──────────────────────────────────────────────────────────────────────────────
# Categories
# ──────────────────────────────────────────────────────────────────────────────


class CategoryListView(APIView):
    def get_permissions(self):
        return [require_permission("erp.inventory.view")()]

    def get(self, request):
        categories = ProductCategory.objects.select_related("parent").order_by("name")
        return Response({"items": ProductCategorySerializer(categories, many=True).data})
