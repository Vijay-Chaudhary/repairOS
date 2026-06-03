"""
Procurement data models — tenant DB.

suppliers             — supplier master (bank account AES-encrypted).
purchase_orders       — PO header; draft → sent → partially_received → received.
purchase_order_items  — line items on a PO.
goods_receipt_notes   — GRN header.
grn_items             — per-item receipt with QC accept/reject.
purchase_invoices     — supplier bill with GST breakdown.
purchase_payments     — payments against an invoice.
purchase_returns      — return goods to supplier (pending → approved → dispatched).
purchase_return_items — line items on a return.
debit_notes           — debit note generated on dispatch.
"""

import uuid
from decimal import Decimal

from cryptography.fernet import Fernet
from django.conf import settings
from django.db import models
from django.utils import timezone

from core.models import BaseModel, SoftDeleteModel


class Supplier(SoftDeleteModel):
    name = models.CharField(max_length=200)
    contact_person = models.CharField(max_length=200, blank=True, default="")
    phone = models.CharField(max_length=20)
    email = models.EmailField(null=True, blank=True)
    address = models.TextField(blank=True, default="")
    state = models.CharField(max_length=100, blank=True, default="")
    state_code = models.CharField(max_length=2, blank=True, default="")
    gstin = models.CharField(max_length=15, blank=True, default="")
    payment_terms_days = models.IntegerField(default=30)
    credit_limit = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    # Fernet-encrypted bank account number (AES-256)
    bank_account_number_encrypted = models.TextField(blank=True, default="")
    bank_ifsc = models.CharField(max_length=20, blank=True, default="")
    is_active = models.BooleanField(default=True)

    class Meta:
        app_label = "procurement"
        db_table = "suppliers"

    def __str__(self) -> str:
        return self.name

    def set_bank_account(self, plaintext: str) -> None:
        if not plaintext:
            self.bank_account_number_encrypted = ""
            return
        key = settings.TENANT_CRED_ENCRYPTION_KEY.encode()
        self.bank_account_number_encrypted = Fernet(key).encrypt(plaintext.encode()).decode()

    def get_bank_account(self) -> str:
        if not self.bank_account_number_encrypted:
            return ""
        key = settings.TENANT_CRED_ENCRYPTION_KEY.encode()
        return Fernet(key).decrypt(self.bank_account_number_encrypted.encode()).decode()


class PurchaseOrder(SoftDeleteModel):
    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        SENT = "sent", "Sent"
        PARTIALLY_RECEIVED = "partially_received", "Partially Received"
        RECEIVED = "received", "Received"
        CANCELLED = "cancelled", "Cancelled"

    shop = models.ForeignKey("core.Shop", on_delete=models.PROTECT, related_name="purchase_orders")
    supplier = models.ForeignKey(Supplier, on_delete=models.PROTECT, related_name="purchase_orders")
    po_number = models.CharField(max_length=50, unique=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.DRAFT)
    expected_delivery_date = models.DateField(null=True, blank=True)
    notes = models.TextField(blank=True, default="")
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="purchase_orders"
    )

    class Meta:
        app_label = "procurement"
        db_table = "purchase_orders"

    def __str__(self) -> str:
        return self.po_number


class PurchaseOrderItem(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    po = models.ForeignKey(PurchaseOrder, on_delete=models.CASCADE, related_name="items")
    variant = models.ForeignKey(
        "inventory.ProductVariant", on_delete=models.PROTECT, related_name="po_items"
    )
    quantity_ordered = models.DecimalField(max_digits=10, decimal_places=3)
    unit_cost = models.DecimalField(max_digits=12, decimal_places=2)
    tax_rate = models.DecimalField(max_digits=5, decimal_places=2, default=18)
    hsn_code = models.CharField(max_length=20, blank=True, default="")
    line_total = models.DecimalField(max_digits=14, decimal_places=2, default=0)

    class Meta:
        app_label = "procurement"
        db_table = "purchase_order_items"


class GoodsReceiptNote(BaseModel):
    shop = models.ForeignKey("core.Shop", on_delete=models.PROTECT, related_name="grns")
    po = models.ForeignKey(PurchaseOrder, on_delete=models.PROTECT, related_name="grns")
    grn_number = models.CharField(max_length=50, unique=True)
    received_date = models.DateField()
    received_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="grns_received"
    )
    challan_number = models.CharField(max_length=100, blank=True, default="")
    notes = models.TextField(blank=True, default="")

    class Meta:
        app_label = "procurement"
        db_table = "goods_receipt_notes"

    def __str__(self) -> str:
        return self.grn_number


class GRNItem(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    grn = models.ForeignKey(GoodsReceiptNote, on_delete=models.CASCADE, related_name="items")
    po_item = models.ForeignKey(PurchaseOrderItem, on_delete=models.PROTECT, related_name="grn_items")
    quantity_received = models.DecimalField(max_digits=10, decimal_places=3)
    quantity_accepted = models.DecimalField(max_digits=10, decimal_places=3)
    quantity_rejected = models.DecimalField(max_digits=10, decimal_places=3, default=0)
    rejection_reason = models.TextField(blank=True, default="")

    class Meta:
        app_label = "procurement"
        db_table = "grn_items"


class PurchaseInvoice(BaseModel):
    class PaymentStatus(models.TextChoices):
        UNPAID = "unpaid", "Unpaid"
        PARTIALLY_PAID = "partially_paid", "Partially Paid"
        PAID = "paid", "Paid"

    shop = models.ForeignKey("core.Shop", on_delete=models.PROTECT, related_name="purchase_invoices")
    supplier = models.ForeignKey(Supplier, on_delete=models.PROTECT, related_name="invoices")
    grn = models.ForeignKey(
        GoodsReceiptNote, on_delete=models.SET_NULL,
        null=True, blank=True, related_name="invoices"
    )
    bill_number = models.CharField(max_length=100)
    bill_date = models.DateField()
    subtotal = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    cgst = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    sgst = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    igst = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    grand_total = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    payment_status = models.CharField(
        max_length=20, choices=PaymentStatus.choices, default=PaymentStatus.UNPAID
    )
    due_date = models.DateField(null=True, blank=True)
    amount_paid = models.DecimalField(max_digits=14, decimal_places=2, default=0)

    class Meta:
        app_label = "procurement"
        db_table = "purchase_invoices"


class PurchasePayment(BaseModel):
    class Method(models.TextChoices):
        CASH = "cash", "Cash"
        UPI = "upi", "UPI"
        CARD = "card", "Card"
        CHEQUE = "cheque", "Cheque"
        NEFT = "neft", "NEFT"
        OTHER = "other", "Other"

    purchase_invoice = models.ForeignKey(
        PurchaseInvoice, on_delete=models.PROTECT, related_name="payments"
    )
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    method = models.CharField(max_length=10, choices=Method.choices)
    reference_id = models.CharField(max_length=100, blank=True, default="")
    paid_at = models.DateTimeField(default=timezone.now)
    recorded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="purchase_payments"
    )

    class Meta:
        app_label = "procurement"
        db_table = "purchase_payments"


class PurchaseReturn(BaseModel):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        APPROVED = "approved", "Approved"
        DISPATCHED = "dispatched", "Dispatched"

    purchase_invoice = models.ForeignKey(
        PurchaseInvoice, on_delete=models.PROTECT, related_name="returns"
    )
    return_number = models.CharField(max_length=50, unique=True)
    reason = models.TextField()
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    total_amount = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="purchase_returns"
    )

    class Meta:
        app_label = "procurement"
        db_table = "purchase_returns"


class PurchaseReturnItem(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    purchase_return = models.ForeignKey(PurchaseReturn, on_delete=models.CASCADE, related_name="items")
    variant = models.ForeignKey(
        "inventory.ProductVariant", on_delete=models.PROTECT, related_name="return_items"
    )
    quantity = models.DecimalField(max_digits=10, decimal_places=3)
    unit_cost = models.DecimalField(max_digits=12, decimal_places=2)
    line_total = models.DecimalField(max_digits=14, decimal_places=2, default=0)

    class Meta:
        app_label = "procurement"
        db_table = "purchase_return_items"


class DebitNote(BaseModel):
    purchase_return = models.OneToOneField(
        PurchaseReturn, on_delete=models.PROTECT, related_name="debit_note"
    )
    debit_note_number = models.CharField(max_length=50, unique=True)
    amount = models.DecimalField(max_digits=14, decimal_places=2)
    pdf_url = models.URLField(blank=True, default="")

    class Meta:
        app_label = "procurement"
        db_table = "debit_notes"

    def __str__(self) -> str:
        return self.debit_note_number
