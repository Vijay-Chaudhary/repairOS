"""
Inventory & Products data models — tenant DB.

product_categories  — hierarchical categories (no soft-delete; config data).
products            — what the shop sells/uses; soft-delete.
product_variants    — purchasable SKU with prices, barcode; soft-delete.
inventory_stock     — current qty per shop/variant; CHECK >= 0.
inventory_transactions — immutable stock-movement ledger.
"""

import uuid

from django.conf import settings
from django.db import models
from django.utils import timezone

from core.models import BaseModel, SoftDeleteModel


# ──────────────────────────────────────────────────────────────────────────────
# Product catalogue
# ──────────────────────────────────────────────────────────────────────────────


class ProductCategory(BaseModel):
    name = models.CharField(max_length=200)
    parent = models.ForeignKey(
        "self", null=True, blank=True, on_delete=models.SET_NULL, related_name="children"
    )

    class Meta:
        app_label = "inventory"
        db_table = "product_categories"
        verbose_name_plural = "product categories"

    def __str__(self) -> str:
        return self.name


class Product(SoftDeleteModel):
    category = models.ForeignKey(
        ProductCategory, null=True, blank=True, on_delete=models.SET_NULL, related_name="products"
    )
    name = models.CharField(max_length=200)
    sku = models.CharField(max_length=100, unique=True)
    brand = models.CharField(max_length=100, blank=True, default="")
    description = models.TextField(blank=True, default="")
    hsn_code = models.CharField(max_length=20, blank=True, default="", help_text="HSN code for GST")
    default_tax_rate = models.DecimalField(max_digits=5, decimal_places=2, default=18)
    is_for_sale = models.BooleanField(default=True, help_text="Visible in POS")
    is_for_repair_use = models.BooleanField(default=False, help_text="Visible in repair parts picker")
    is_active = models.BooleanField(default=True)

    class Meta:
        app_label = "inventory"
        db_table = "products"
        indexes = [models.Index(fields=["sku"])]

    def __str__(self) -> str:
        return f"{self.name} ({self.sku})"


class ProductVariant(SoftDeleteModel):
    product = models.ForeignKey(Product, on_delete=models.CASCADE, related_name="variants")
    variant_name = models.CharField(max_length=200)
    # e.g. {"color": "Black", "resolution": "2MP"}
    attributes = models.JSONField(default=dict, blank=True)
    barcode = models.CharField(max_length=100, unique=True, null=True, blank=True)
    cost_price = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    selling_price = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    wholesale_price = models.DecimalField(max_digits=12, decimal_places=2, null=True, blank=True)
    minimum_order_qty = models.IntegerField(default=1)
    is_active = models.BooleanField(default=True)

    class Meta:
        app_label = "inventory"
        db_table = "product_variants"
        indexes = [models.Index(fields=["barcode"])]
        # DRF 3.15 auto-generates a UniqueValidator from the barcode unique constraint.
        # Views suppress it via extra_kwargs since barcode is nullable.

    def __str__(self) -> str:
        return f"{self.product.name} — {self.variant_name}"


# ──────────────────────────────────────────────────────────────────────────────
# Stock
# ──────────────────────────────────────────────────────────────────────────────


class InventoryStock(BaseModel):
    shop = models.ForeignKey("core.Shop", on_delete=models.CASCADE, related_name="stock")
    variant = models.ForeignKey(ProductVariant, on_delete=models.CASCADE, related_name="stock")
    quantity_in_stock = models.DecimalField(max_digits=12, decimal_places=3, default=0)
    reorder_level = models.DecimalField(max_digits=10, decimal_places=3, default=5)

    class Meta:
        app_label = "inventory"
        db_table = "inventory_stock"
        unique_together = [("shop", "variant")]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(quantity_in_stock__gte=0),
                name="stock_quantity_non_negative",
            )
        ]

    def __str__(self) -> str:
        return f"{self.variant} @ {self.shop.code}: {self.quantity_in_stock}"


# ──────────────────────────────────────────────────────────────────────────────
# Immutable transaction ledger
# ──────────────────────────────────────────────────────────────────────────────


class InventoryTransaction(models.Model):
    class TxnType(models.TextChoices):
        PURCHASE_IN = "purchase_in", "Purchase In"
        SALE_OUT = "sale_out", "Sale Out"
        REPAIR_OUT = "repair_out", "Repair Out"
        RETURN_IN = "return_in", "Return In"
        RETURN_OUT = "return_out", "Return Out (to Supplier)"
        TRANSFER_IN = "transfer_in", "Transfer In"
        TRANSFER_OUT = "transfer_out", "Transfer Out"
        ADJUSTMENT = "adjustment", "Manual Adjustment"
        OPENING_STOCK = "opening_stock", "Opening Stock"

    class RefType(models.TextChoices):
        GRN = "grn", "GRN"
        SALE = "sale", "Sale"
        JOB = "job", "Repair Job"
        TRANSFER = "transfer", "Transfer"
        ADJUSTMENT = "adjustment", "Adjustment"
        RETURN = "return", "Return"
        OPENING = "opening", "Opening Stock"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    shop = models.ForeignKey("core.Shop", on_delete=models.PROTECT, related_name="inventory_transactions")
    variant = models.ForeignKey(ProductVariant, on_delete=models.PROTECT, related_name="transactions")
    type = models.CharField(max_length=20, choices=TxnType.choices, db_index=True)
    # Signed quantity: positive = stock IN, negative = stock OUT
    quantity = models.DecimalField(max_digits=12, decimal_places=3)
    reference_type = models.CharField(max_length=20, choices=RefType.choices)
    reference_id = models.UUIDField(null=True, blank=True, db_index=True)
    note = models.TextField(blank=True, default="")
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="inventory_transactions"
    )
    created_at = models.DateTimeField(default=timezone.now, db_index=True)

    class Meta:
        app_label = "inventory"
        db_table = "inventory_transactions"
        ordering = ["-created_at"]
        indexes = [
            models.Index(fields=["shop", "variant"]),
            models.Index(fields=["type"]),
        ]

    def __str__(self) -> str:
        sign = "+" if self.quantity >= 0 else ""
        return f"{self.type} {sign}{self.quantity} {self.variant}"

    # Enforce immutability at Python level
    def save(self, *args, **kwargs):
        if self.pk and InventoryTransaction.objects.filter(pk=self.pk).exists():
            raise RuntimeError("InventoryTransaction records are immutable.")
        super().save(*args, **kwargs)

    def delete(self, *args, **kwargs):
        raise RuntimeError("InventoryTransaction records cannot be deleted.")
