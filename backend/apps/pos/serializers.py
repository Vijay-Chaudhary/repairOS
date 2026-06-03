from decimal import Decimal

from rest_framework import serializers

from core.models import Shop

from .models import CreditNote, Sale, SaleItem, SalePayment, SalesReturn


# ──────────────────────────────────────────────────────────────────────────────
# Line items
# ──────────────────────────────────────────────────────────────────────────────


class SaleItemInputSerializer(serializers.Serializer):
    """Input-only: sent by the client when creating a sale."""
    variant_id = serializers.UUIDField(required=False, allow_null=True)
    product_name_snapshot = serializers.CharField(max_length=200)
    variant_name_snapshot = serializers.CharField(max_length=200, required=False, allow_blank=True, default="")
    hsn_code = serializers.CharField(max_length=20, required=False, allow_blank=True, default="")
    quantity = serializers.DecimalField(max_digits=10, decimal_places=3, min_value=Decimal("0.001"))
    unit_price = serializers.DecimalField(max_digits=10, decimal_places=2, min_value=Decimal("0"))
    discount_per_unit = serializers.DecimalField(max_digits=10, decimal_places=2, default=0)
    tax_rate = serializers.DecimalField(max_digits=5, decimal_places=2, default=0)


class SaleItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = SaleItem
        fields = [
            "id", "variant_id", "product_name_snapshot", "variant_name_snapshot",
            "hsn_code", "quantity", "unit_price", "discount_per_unit", "tax_rate",
            "line_subtotal", "line_tax", "line_total",
        ]


# ──────────────────────────────────────────────────────────────────────────────
# Payments
# ──────────────────────────────────────────────────────────────────────────────


class SalePaymentInputSerializer(serializers.Serializer):
    """Input-only: sent by the client when creating or adding a payment."""
    amount = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal("0.01"))
    method = serializers.ChoiceField(choices=SalePayment.Method.choices)
    reference_id = serializers.CharField(max_length=100, required=False, allow_blank=True, default="")
    razorpay_payment_id = serializers.CharField(max_length=100, required=False, allow_blank=True, default="")


class SalePaymentSerializer(serializers.ModelSerializer):
    class Meta:
        model = SalePayment
        fields = ["id", "amount", "method", "reference_id", "razorpay_payment_id", "paid_at"]


# ──────────────────────────────────────────────────────────────────────────────
# Sale
# ──────────────────────────────────────────────────────────────────────────────


class CreateSaleSerializer(serializers.Serializer):
    shop_id = serializers.PrimaryKeyRelatedField(source="shop", queryset=Shop.objects.all())
    sale_type = serializers.ChoiceField(choices=Sale.SaleType.choices)
    customer_id = serializers.PrimaryKeyRelatedField(
        source="customer",
        queryset=__import__("crm.models", fromlist=["Customer"]).Customer.objects.all(),
        required=False,
        allow_null=True,
    )
    job_id = serializers.UUIDField(required=False, allow_null=True)
    items = SaleItemInputSerializer(many=True)
    payments = SalePaymentInputSerializer(many=True, required=False, default=list)
    discount_type = serializers.ChoiceField(
        choices=Sale.DiscountType.choices, required=False, default=Sale.DiscountType.NONE
    )
    discount_value = serializers.DecimalField(
        max_digits=10, decimal_places=2, required=False, default=0
    )
    notes = serializers.CharField(required=False, allow_blank=True, default="")

    def validate_items(self, value):
        if not value:
            raise serializers.ValidationError("At least one item is required.")
        return value

    def validate(self, attrs):
        sale_type = attrs.get("sale_type")
        customer = attrs.get("customer")
        if sale_type == Sale.SaleType.WHOLESALE and not customer:
            raise serializers.ValidationError(
                {"customer_id": "Wholesale sales require a customer."}
            )
        if sale_type == Sale.SaleType.JOB_LINKED and not attrs.get("job_id"):
            raise serializers.ValidationError(
                {"job_id": "Job-linked sales require a job_id."}
            )
        return attrs


class SaleSerializer(serializers.ModelSerializer):
    items = SaleItemSerializer(many=True, read_only=True)
    payments = SalePaymentSerializer(many=True, read_only=True)
    customer_name = serializers.CharField(source="customer.name", read_only=True, default="")

    class Meta:
        model = Sale
        fields = [
            "id", "sale_number", "sale_type", "status",
            "customer", "customer_name", "job_id",
            "subtotal", "discount_type", "discount_value", "discount_amount",
            "cgst", "sgst", "igst", "grand_total",
            "amount_paid", "amount_outstanding",
            "sale_date", "notes", "items", "payments",
        ]


class SaleListSerializer(serializers.ModelSerializer):
    customer_name = serializers.CharField(source="customer.name", read_only=True, default="Guest")

    class Meta:
        model = Sale
        fields = [
            "id", "sale_number", "sale_type", "status",
            "customer_name", "grand_total", "amount_outstanding", "sale_date",
        ]


# ──────────────────────────────────────────────────────────────────────────────
# Add payment (to existing sale)
# ──────────────────────────────────────────────────────────────────────────────


class AddPaymentSerializer(SalePaymentInputSerializer):
    pass


# ──────────────────────────────────────────────────────────────────────────────
# Returns
# ──────────────────────────────────────────────────────────────────────────────


class CreateReturnSerializer(serializers.Serializer):
    reason = serializers.CharField(min_length=5)
    total_refund_amount = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal("0.01"))
    refund_method = serializers.ChoiceField(choices=SalesReturn.RefundMethod.choices)


class SalesReturnSerializer(serializers.ModelSerializer):
    credit_note_number = serializers.CharField(
        source="credit_note.credit_note_number", read_only=True, default=""
    )

    class Meta:
        model = SalesReturn
        fields = [
            "id", "return_number", "reason", "status",
            "total_refund_amount", "refund_method",
            "approved_by", "approved_at", "credit_note_number",
            "created_at",
        ]


class ReviewReturnSerializer(serializers.Serializer):
    action = serializers.ChoiceField(choices=["approve", "reject"])
