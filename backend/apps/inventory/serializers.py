from decimal import Decimal

from rest_framework import serializers

from core.models import Shop

from .models import (
    InventoryStock,
    InventoryTransaction,
    Product,
    ProductCategory,
    ProductVariant,
)


# ──────────────────────────────────────────────────────────────────────────────
# Product catalogue
# ──────────────────────────────────────────────────────────────────────────────


class ProductCategorySerializer(serializers.ModelSerializer):
    class Meta:
        model = ProductCategory
        fields = ["id", "name", "parent"]


class ProductVariantSerializer(serializers.ModelSerializer):
    product_name = serializers.CharField(source="product.name", read_only=True)
    hsn_code = serializers.CharField(source="product.hsn_code", read_only=True)
    tax_rate = serializers.DecimalField(
        source="product.default_tax_rate", max_digits=5, decimal_places=2, read_only=True
    )

    class Meta:
        model = ProductVariant
        fields = [
            "id", "product", "product_name", "variant_name", "attributes",
            "barcode", "cost_price", "selling_price", "wholesale_price",
            "minimum_order_qty", "is_active",
            "hsn_code", "tax_rate",
            "created_at",
        ]
        read_only_fields = ["id", "product", "created_at"]
        extra_kwargs = {
            # barcode is nullable-unique; suppress DRF's auto-UniqueValidator
            "barcode": {"validators": []},
        }

    def validate_barcode(self, value):
        if not value:
            return None
        qs = ProductVariant.objects.filter(barcode=value)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError("A variant with this barcode already exists.")
        return value


class ProductSerializer(serializers.ModelSerializer):
    variants = ProductVariantSerializer(many=True, read_only=True)

    class Meta:
        model = Product
        fields = [
            "id", "category", "name", "sku", "brand", "description",
            "hsn_code", "default_tax_rate",
            "is_for_sale", "is_for_repair_use", "is_active",
            "variants", "created_at",
        ]
        read_only_fields = ["id", "variants", "created_at"]
        extra_kwargs = {"sku": {"validators": []}}

    def validate_sku(self, value):
        qs = Product.objects.filter(sku=value)
        if self.instance:
            qs = qs.exclude(pk=self.instance.pk)
        if qs.exists():
            raise serializers.ValidationError("A product with this SKU already exists.")
        return value


class CreateVariantSerializer(serializers.ModelSerializer):
    class Meta:
        model = ProductVariant
        fields = [
            "variant_name", "attributes", "barcode",
            "cost_price", "selling_price", "wholesale_price",
            "minimum_order_qty", "is_active",
        ]
        extra_kwargs = {"barcode": {"validators": []}}

    def validate_barcode(self, value):
        if not value:
            return None
        if ProductVariant.objects.filter(barcode=value).exists():
            raise serializers.ValidationError("A variant with this barcode already exists.")
        return value


# ──────────────────────────────────────────────────────────────────────────────
# Barcode lookup response
# ──────────────────────────────────────────────────────────────────────────────


class BarcodeLookupSerializer(serializers.ModelSerializer):
    product_name = serializers.CharField(source="product.name", read_only=True)
    hsn_code = serializers.CharField(source="product.hsn_code", read_only=True)
    tax_rate = serializers.DecimalField(
        source="product.default_tax_rate", max_digits=5, decimal_places=2, read_only=True
    )

    class Meta:
        model = ProductVariant
        fields = [
            "id", "barcode", "variant_name", "product_name",
            "cost_price", "selling_price", "wholesale_price",
            "hsn_code", "tax_rate",
        ]


# ──────────────────────────────────────────────────────────────────────────────
# Stock
# ──────────────────────────────────────────────────────────────────────────────


class InventoryStockSerializer(serializers.ModelSerializer):
    variant_name = serializers.CharField(source="variant.variant_name", read_only=True)
    product_name = serializers.CharField(source="variant.product.name", read_only=True)
    barcode = serializers.CharField(source="variant.barcode", read_only=True)

    class Meta:
        model = InventoryStock
        fields = [
            "id", "shop", "variant", "variant_name", "product_name", "barcode",
            "quantity_in_stock", "reorder_level",
        ]


# ──────────────────────────────────────────────────────────────────────────────
# Operations
# ──────────────────────────────────────────────────────────────────────────────


class AdjustmentSerializer(serializers.Serializer):
    shop_id = serializers.PrimaryKeyRelatedField(source="shop", queryset=Shop.objects.all())
    variant_id = serializers.PrimaryKeyRelatedField(
        source="variant", queryset=ProductVariant.objects.filter(is_active=True)
    )
    quantity = serializers.DecimalField(max_digits=12, decimal_places=3)
    note = serializers.CharField(min_length=3)

    def validate_quantity(self, value):
        if value == 0:
            raise serializers.ValidationError("Quantity cannot be zero.")
        return value


class TransferSerializer(serializers.Serializer):
    source_shop_id = serializers.PrimaryKeyRelatedField(
        source="source_shop", queryset=Shop.objects.all()
    )
    dest_shop_id = serializers.PrimaryKeyRelatedField(
        source="dest_shop", queryset=Shop.objects.all()
    )
    variant_id = serializers.PrimaryKeyRelatedField(
        source="variant", queryset=ProductVariant.objects.filter(is_active=True)
    )
    quantity = serializers.DecimalField(max_digits=12, decimal_places=3, min_value=Decimal("0.001"))
    note = serializers.CharField(required=False, allow_blank=True, default="")

    def validate(self, attrs):
        if attrs["source_shop"] == attrs["dest_shop"]:
            raise serializers.ValidationError("Source and destination shops must differ.")
        return attrs


class OpeningStockSerializer(serializers.Serializer):
    shop_id = serializers.PrimaryKeyRelatedField(source="shop", queryset=Shop.objects.all())
    variant_id = serializers.PrimaryKeyRelatedField(
        source="variant", queryset=ProductVariant.objects.filter(is_active=True)
    )
    quantity = serializers.DecimalField(
        max_digits=12, decimal_places=3, min_value=Decimal("0.001")
    )


# ──────────────────────────────────────────────────────────────────────────────
# Ledger
# ──────────────────────────────────────────────────────────────────────────────


class InventoryTransactionSerializer(serializers.ModelSerializer):
    variant_name = serializers.CharField(source="variant.variant_name", read_only=True)
    product_name = serializers.CharField(source="variant.product.name", read_only=True)
    created_by_name = serializers.CharField(source="created_by.full_name", read_only=True)

    class Meta:
        model = InventoryTransaction
        fields = [
            "id", "shop", "variant", "variant_name", "product_name",
            "type", "quantity", "reference_type", "reference_id",
            "note", "created_by", "created_by_name", "created_at",
        ]
