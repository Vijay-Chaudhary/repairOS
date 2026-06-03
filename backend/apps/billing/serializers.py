from decimal import Decimal

from rest_framework import serializers

from .models import Payment, RepairInvoice, RepairInvoiceItem


class RepairInvoiceItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = RepairInvoiceItem
        fields = [
            "id", "item_type", "description", "sac_code", "hsn_code",
            "quantity", "unit_price", "tax_rate", "line_total",
        ]


class PaymentSerializer(serializers.ModelSerializer):
    class Meta:
        model = Payment
        fields = [
            "id", "invoice", "amount", "method", "reference_id",
            "razorpay_payment_id", "razorpay_order_id", "paid_at", "notes",
        ]


class RepairInvoiceListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for invoice list views — no line items."""
    customer_name = serializers.CharField(source="customer.name", read_only=True)
    customer_phone = serializers.CharField(source="customer.phone", read_only=True)
    job_number = serializers.CharField(source="job.job_number", read_only=True)

    class Meta:
        model = RepairInvoice
        fields = [
            "id", "invoice_number", "status",
            "customer_name", "customer_phone", "job_number",
            "grand_total", "amount_paid", "amount_outstanding",
            "due_date", "pdf_url", "created_at",
        ]


class RepairInvoiceDetailSerializer(serializers.ModelSerializer):
    """Full serializer for invoice detail view — includes items and payments."""
    items = RepairInvoiceItemSerializer(many=True, read_only=True)
    payments = PaymentSerializer(many=True, read_only=True, source="payment_set")
    customer_name = serializers.CharField(source="customer.name", read_only=True)
    customer_phone = serializers.CharField(source="customer.phone", read_only=True)
    customer_gstin = serializers.CharField(source="customer.gstin", read_only=True)
    job_number = serializers.CharField(source="job.job_number", read_only=True)
    shop_name = serializers.CharField(source="shop.name", read_only=True)

    class Meta:
        model = RepairInvoice
        fields = [
            "id", "invoice_number", "status",
            "customer_name", "customer_phone", "customer_gstin",
            "job_number", "shop_name",
            "subtotal", "discount_amount", "cgst", "sgst", "igst",
            "grand_total", "amount_paid", "amount_outstanding",
            "due_date", "pdf_url", "created_at",
            "items", "payments",
        ]


# Keep the original name as alias for the create response (used in tests)
RepairInvoiceSerializer = RepairInvoiceDetailSerializer


class CreateRepairInvoiceSerializer(serializers.Serializer):
    job_id = serializers.UUIDField()
    discount_amount = serializers.DecimalField(
        max_digits=10, decimal_places=2, default=Decimal("0"), min_value=Decimal("0")
    )
    due_date = serializers.DateField(required=False, allow_null=True)


class CreatePaymentSerializer(serializers.Serializer):
    invoice_id = serializers.UUIDField()
    amount = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal("0.01"))
    method = serializers.ChoiceField(choices=Payment.Method.choices)
    reference_id = serializers.CharField(required=False, default="", allow_blank=True)
    notes = serializers.CharField(required=False, default="", allow_blank=True)
