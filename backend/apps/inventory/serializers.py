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
    product_id = serializers.UUIDField(read_only=True)
    product_name = serializers.CharField(source="product.name", read_only=True)
    hsn_code = serializers.CharField(source="product.hsn_code", read_only=True)
    tax_rate = serializers.DecimalField(
        source="product.default_tax_rate", max_digits=5, decimal_places=2, read_only=True
    )

    class Meta:
        model = ProductVariant
        fields = [
            "id", "product_id", "product_name", "variant_name", "attributes",
            "barcode", "cost_price", "selling_price", "wholesale_price",
            "minimum_order_qty", "is_active",
            "hsn_code", "tax_rate",
            "created_at",
        ]
        read_only_fields = ["id", "product_id", "created_at"]
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
    category_id = serializers.UUIDField(read_only=True, allow_null=True)
    category_name = serializers.CharField(source="category.name", read_only=True, allow_null=True, default=None)
    variant_count = serializers.SerializerMethodField()
    variants = ProductVariantSerializer(many=True, read_only=True)

    class Meta:
        model = Product
        fields = [
            "id", "category_id", "category_name", "name", "sku", "brand", "description",
            "hsn_code", "default_tax_rate",
            "is_for_sale", "is_for_repair_use", "is_active",
            "variant_count", "variants", "created_at",
        ]
        read_only_fields = ["id", "category_id", "category_name", "variant_count", "variants", "created_at"]
        extra_kwargs = {"sku": {"validators": []}}

    def get_variant_count(self, obj) -> int:
        if hasattr(obj, "variant_count"):
            return obj.variant_count
        return obj.variants.count()

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
    shop_id = serializers.UUIDField(read_only=True)
    variant_id = serializers.UUIDField(read_only=True)
    product_id = serializers.UUIDField(source="variant.product_id", read_only=True)
    variant_name = serializers.CharField(source="variant.variant_name", read_only=True)
    product_name = serializers.CharField(source="variant.product.name", read_only=True)
    sku = serializers.CharField(source="variant.product.sku", read_only=True)
    barcode = serializers.CharField(source="variant.barcode", read_only=True)
    is_low_stock = serializers.SerializerMethodField()
    cost_price = serializers.DecimalField(source="variant.cost_price", max_digits=12, decimal_places=2, read_only=True)
    selling_price = serializers.DecimalField(source="variant.selling_price", max_digits=12, decimal_places=2, read_only=True)

    class Meta:
        model = InventoryStock
        fields = [
            "id", "shop_id", "variant_id", "product_id",
            "variant_name", "product_name", "sku", "barcode",
            "quantity_in_stock", "reorder_level",
            "is_low_stock", "cost_price", "selling_price",
        ]

    def get_is_low_stock(self, obj) -> bool:
        return obj.quantity_in_stock < obj.reorder_level


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
    shop_id = serializers.UUIDField(read_only=True)
    variant_id = serializers.UUIDField(read_only=True)
    variant_name = serializers.CharField(source="variant.variant_name", read_only=True)
    product_name = serializers.CharField(source="variant.product.name", read_only=True)
    created_by_name = serializers.CharField(source="created_by.full_name", read_only=True)

    class Meta:
        model = InventoryTransaction
        fields = [
            "id", "shop_id", "variant_id", "variant_name", "product_name",
            "type", "quantity", "reference_type", "reference_id",
            "note", "created_by_name", "created_at",
        ]
