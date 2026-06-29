from decimal import Decimal

from rest_framework import serializers

from .models import Payment, RepairInvoice, RepairInvoiceItem, TaxRate


class RepairInvoiceItemSerializer(serializers.ModelSerializer):
    class Meta:
        model = RepairInvoiceItem
        fields = [
            "id", "item_type", "description", "sac_code", "hsn_code",
            "quantity", "unit_price", "tax_rate", "line_total",
        ]


class PaymentSerializer(serializers.ModelSerializer):
    # FK field aliases expected by the FE contract
    # (source omitted — field name 'invoice_id' maps to Payment.invoice_id directly)
    invoice_id = serializers.UUIDField(read_only=True)
    recorded_by_name = serializers.SerializerMethodField()

    class Meta:
        model = Payment
        fields = [
            "id", "invoice_id", "amount", "method", "reference_id",
            "razorpay_payment_id", "razorpay_order_id", "paid_at", "notes",
            "recorded_by_name",
        ]

    def get_recorded_by_name(self, obj) -> str:
        if obj.recorded_by:
            return obj.recorded_by.full_name or ""
        return ""


class RepairInvoiceListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for invoice list views — no line items."""
    # FK _id aliases: field name matches the Django FK _id attrib — no source needed
    shop_id = serializers.UUIDField(read_only=True)
    job_id = serializers.UUIDField(read_only=True)
    customer_id = serializers.UUIDField(read_only=True)
    customer_name = serializers.CharField(source="customer.name", read_only=True)
    customer_phone = serializers.CharField(source="customer.phone", read_only=True)
    job_number = serializers.CharField(source="job.job_number", read_only=True)

    class Meta:
        model = RepairInvoice
        fields = [
            "id", "invoice_number", "status",
            "shop_id", "job_id", "customer_id",
            "customer_name", "customer_phone", "job_number",
            "grand_total", "amount_paid", "amount_outstanding",
            "due_date", "pdf_url", "created_at",
        ]


class RepairInvoiceDetailSerializer(serializers.ModelSerializer):
    """Full serializer for invoice detail view — includes items and payments."""
    items = RepairInvoiceItemSerializer(many=True, read_only=True)
    # related_name="payments" on Payment.invoice — field name matches, no source needed
    payments = PaymentSerializer(many=True, read_only=True)
    # FK _id aliases: field name matches the Django FK _id attrib — no source needed
    shop_id = serializers.UUIDField(read_only=True)
    job_id = serializers.UUIDField(read_only=True)
    customer_id = serializers.UUIDField(read_only=True)
    customer_name = serializers.CharField(source="customer.name", read_only=True)
    customer_phone = serializers.CharField(source="customer.phone", read_only=True)
    customer_gstin = serializers.CharField(source="customer.gstin", read_only=True)
    job_number = serializers.CharField(source="job.job_number", read_only=True)
    shop_name = serializers.CharField(source="shop.name", read_only=True)

    class Meta:
        model = RepairInvoice
        fields = [
            "id", "invoice_number", "status",
            "shop_id", "job_id", "customer_id",
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
    paid_at = serializers.DateTimeField(required=False, allow_null=True)


class OutstandingInvoiceSerializer(serializers.ModelSerializer):
    customer_name = serializers.CharField(source="customer.name", read_only=True)
    customer_phone = serializers.CharField(source="customer.phone", read_only=True)
    days_overdue = serializers.SerializerMethodField()
    bucket = serializers.SerializerMethodField()

    class Meta:
        model = RepairInvoice
        fields = [
            "id", "invoice_number", "status", "customer_name", "customer_phone",
            "grand_total", "amount_paid", "amount_outstanding", "due_date",
            "days_overdue", "bucket",
        ]

    def _aging(self, obj):
        from django.utils import timezone

        from .services import aging_bucket
        return aging_bucket(obj.due_date, timezone.now().date())

    def get_days_overdue(self, obj) -> int:
        return self._aging(obj)[1]

    def get_bucket(self, obj) -> str:
        return self._aging(obj)[0]


class TaxRateSerializer(serializers.ModelSerializer):
    class Meta:
        model = TaxRate
        fields = ["id", "name", "rate", "tax_type", "is_active", "created_at"]
        read_only_fields = ["id", "created_at"]

    def validate_rate(self, value):
        if value < 0 or value > 100:
            raise serializers.ValidationError("Rate must be between 0 and 100.")
        return value
