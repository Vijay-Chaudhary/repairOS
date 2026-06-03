"""
Procurement serializers.
"""

from decimal import Decimal

from rest_framework import serializers

from .models import (
    DebitNote,
    GoodsReceiptNote,
    GRNItem,
    PurchaseInvoice,
    PurchaseOrder,
    PurchaseOrderItem,
    PurchasePayment,
    PurchaseReturn,
    PurchaseReturnItem,
    Supplier,
)


# ──────────────────────────────────────────────────────────────────────────────
# Supplier
# ──────────────────────────────────────────────────────────────────────────────


class SupplierSerializer(serializers.ModelSerializer):
    bank_account_number = serializers.CharField(
        write_only=True, required=False, allow_blank=True, default=""
    )

    class Meta:
        model = Supplier
        fields = [
            "id", "name", "contact_person", "phone", "email",
            "address", "state", "state_code", "gstin",
            "payment_terms_days", "credit_limit",
            "bank_account_number",  # write-only (encrypted on save)
            "bank_ifsc", "is_active",
            "created_at",
        ]
        read_only_fields = ["id", "created_at"]

    def create(self, validated_data):
        bank_number = validated_data.pop("bank_account_number", "")
        supplier = Supplier(**validated_data)
        supplier.set_bank_account(bank_number)
        supplier.save()
        return supplier

    def update(self, instance, validated_data):
        if "bank_account_number" in validated_data:
            instance.set_bank_account(validated_data.pop("bank_account_number"))
        for attr, value in validated_data.items():
            setattr(instance, attr, value)
        instance.save()
        return instance


class SupplierLedgerSerializer(serializers.Serializer):
    invoices = serializers.ListField()
    total_invoiced = serializers.DecimalField(max_digits=14, decimal_places=2)
    total_paid = serializers.DecimalField(max_digits=14, decimal_places=2)
    outstanding = serializers.DecimalField(max_digits=14, decimal_places=2)


# ──────────────────────────────────────────────────────────────────────────────
# Purchase Order
# ──────────────────────────────────────────────────────────────────────────────


class POItemSerializer(serializers.ModelSerializer):
    variant_id = serializers.UUIDField(source="variant.id", read_only=True)

    class Meta:
        model = PurchaseOrderItem
        fields = [
            "id", "variant_id", "quantity_ordered",
            "unit_cost", "tax_rate", "hsn_code", "line_total",
        ]
        read_only_fields = ["id", "variant_id", "line_total"]


class POItemCreateSerializer(serializers.Serializer):
    variant_id = serializers.UUIDField()
    quantity_ordered = serializers.DecimalField(max_digits=10, decimal_places=3, min_value=Decimal("0.001"))
    unit_cost = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal("0"))
    tax_rate = serializers.DecimalField(max_digits=5, decimal_places=2, default=18)
    hsn_code = serializers.CharField(max_length=20, required=False, default="")


class PurchaseOrderSerializer(serializers.ModelSerializer):
    items = POItemSerializer(many=True, read_only=True)
    supplier_name = serializers.CharField(source="supplier.name", read_only=True)

    class Meta:
        model = PurchaseOrder
        fields = [
            "id", "shop", "supplier", "supplier_name", "po_number",
            "status", "expected_delivery_date", "notes", "items",
            "created_at",
        ]
        read_only_fields = ["id", "po_number", "status", "supplier_name", "items", "created_at"]


class CreatePurchaseOrderSerializer(serializers.Serializer):
    shop_id = serializers.UUIDField()
    supplier_id = serializers.UUIDField()
    expected_delivery_date = serializers.DateField(required=False, allow_null=True)
    notes = serializers.CharField(required=False, default="", allow_blank=True)
    items = POItemCreateSerializer(many=True, min_length=1)


class UpdatePurchaseOrderSerializer(serializers.Serializer):
    status = serializers.ChoiceField(
        choices=PurchaseOrder.Status.choices, required=False
    )
    expected_delivery_date = serializers.DateField(required=False, allow_null=True)
    notes = serializers.CharField(required=False, allow_blank=True)


# ──────────────────────────────────────────────────────────────────────────────
# GRN
# ──────────────────────────────────────────────────────────────────────────────


class GRNItemInputSerializer(serializers.Serializer):
    po_item_id = serializers.UUIDField()
    quantity_received = serializers.DecimalField(max_digits=10, decimal_places=3, min_value=Decimal("0.001"))
    quantity_accepted = serializers.DecimalField(max_digits=10, decimal_places=3, min_value=Decimal("0"))
    quantity_rejected = serializers.DecimalField(max_digits=10, decimal_places=3, default=0, min_value=Decimal("0"))
    rejection_reason = serializers.CharField(required=False, default="", allow_blank=True)

    def validate(self, data):
        accepted = data.get("quantity_accepted", Decimal("0"))
        rejected = data.get("quantity_rejected", Decimal("0"))
        received = data["quantity_received"]
        if accepted + rejected != received:
            raise serializers.ValidationError(
                "quantity_accepted + quantity_rejected must equal quantity_received."
            )
        if rejected > 0 and not data.get("rejection_reason"):
            raise serializers.ValidationError(
                "rejection_reason is required when quantity_rejected > 0."
            )
        return data


class CreateGRNSerializer(serializers.Serializer):
    po_id = serializers.UUIDField()
    received_date = serializers.DateField()
    challan_number = serializers.CharField(required=False, default="", allow_blank=True)
    notes = serializers.CharField(required=False, default="", allow_blank=True)
    items = GRNItemInputSerializer(many=True, min_length=1)


class GRNItemSerializer(serializers.ModelSerializer):
    variant_id = serializers.UUIDField(source="po_item.variant.id", read_only=True)
    variant_name = serializers.CharField(source="po_item.variant.variant_name", read_only=True)

    class Meta:
        model = GRNItem
        fields = [
            "id", "po_item", "variant_id", "variant_name",
            "quantity_received", "quantity_accepted", "quantity_rejected", "rejection_reason",
        ]


class GRNSerializer(serializers.ModelSerializer):
    items = GRNItemSerializer(many=True, read_only=True)

    class Meta:
        model = GoodsReceiptNote
        fields = [
            "id", "shop", "po", "grn_number", "received_date",
            "received_by", "challan_number", "notes", "items",
            "created_at",
        ]
        read_only_fields = ["id", "grn_number", "received_by", "created_at"]


# ──────────────────────────────────────────────────────────────────────────────
# Purchase Invoice
# ──────────────────────────────────────────────────────────────────────────────


class PurchaseInvoiceSerializer(serializers.ModelSerializer):
    supplier_name = serializers.CharField(source="supplier.name", read_only=True)

    class Meta:
        model = PurchaseInvoice
        fields = [
            "id", "shop", "supplier", "supplier_name", "grn",
            "bill_number", "bill_date",
            "subtotal", "cgst", "sgst", "igst", "grand_total",
            "payment_status", "due_date", "amount_paid",
            "created_at",
        ]
        read_only_fields = [
            "id", "supplier_name", "subtotal", "cgst", "sgst", "igst",
            "grand_total", "payment_status", "amount_paid", "created_at",
        ]


class CreatePurchaseInvoiceSerializer(serializers.Serializer):
    shop_id = serializers.UUIDField()
    supplier_id = serializers.UUIDField()
    grn_id = serializers.UUIDField(required=False, allow_null=True)
    bill_number = serializers.CharField(max_length=100)
    bill_date = serializers.DateField()
    subtotal = serializers.DecimalField(max_digits=14, decimal_places=2, min_value=Decimal("0"))
    tax_rate = serializers.DecimalField(max_digits=5, decimal_places=2, default=18)
    due_date = serializers.DateField(required=False, allow_null=True)


# ──────────────────────────────────────────────────────────────────────────────
# Purchase Payment
# ──────────────────────────────────────────────────────────────────────────────


class PurchasePaymentSerializer(serializers.ModelSerializer):
    class Meta:
        model = PurchasePayment
        fields = ["id", "purchase_invoice", "amount", "method", "reference_id", "paid_at", "created_at"]
        read_only_fields = ["id", "paid_at", "created_at"]


class CreatePurchasePaymentSerializer(serializers.Serializer):
    purchase_invoice_id = serializers.UUIDField()
    amount = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal("0.01"))
    method = serializers.ChoiceField(choices=PurchasePayment.Method.choices)
    reference_id = serializers.CharField(required=False, default="", allow_blank=True)


# ──────────────────────────────────────────────────────────────────────────────
# Purchase Return
# ──────────────────────────────────────────────────────────────────────────────


class ReturnItemInputSerializer(serializers.Serializer):
    variant_id = serializers.UUIDField()
    quantity = serializers.DecimalField(max_digits=10, decimal_places=3, min_value=Decimal("0.001"))
    unit_cost = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal("0"))


class CreatePurchaseReturnSerializer(serializers.Serializer):
    purchase_invoice_id = serializers.UUIDField()
    reason = serializers.CharField()
    items = ReturnItemInputSerializer(many=True, min_length=1)


class PurchaseReturnItemSerializer(serializers.ModelSerializer):
    variant_name = serializers.CharField(source="variant.variant_name", read_only=True)

    class Meta:
        model = PurchaseReturnItem
        fields = ["id", "variant", "variant_name", "quantity", "unit_cost", "line_total"]


class PurchaseReturnSerializer(serializers.ModelSerializer):
    items = PurchaseReturnItemSerializer(many=True, read_only=True)
    debit_note_number = serializers.SerializerMethodField()

    class Meta:
        model = PurchaseReturn
        fields = [
            "id", "purchase_invoice", "return_number", "reason",
            "status", "total_amount", "items", "debit_note_number",
            "created_at",
        ]
        read_only_fields = ["id", "return_number", "status", "total_amount", "created_at"]

    def get_debit_note_number(self, obj):
        try:
            return obj.debit_note.debit_note_number
        except DebitNote.DoesNotExist:
            return None


class DebitNoteSerializer(serializers.ModelSerializer):
    class Meta:
        model = DebitNote
        fields = ["id", "purchase_return", "debit_note_number", "amount", "pdf_url", "created_at"]
        read_only_fields = ["id", "debit_note_number", "created_at"]
