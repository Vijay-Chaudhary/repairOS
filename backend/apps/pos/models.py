"""
POS (Sales) module data models — tenant DB.

sales            — master sale record; soft-delete on this table only.
sale_items       — line items (snapshots freeze names at sale time).
sale_payments    — one or more payments per sale.
sales_returns    — customer return requests.
credit_notes     — issued after return approval.
"""

import uuid

from django.conf import settings
from django.db import models
from django.utils import timezone

from core.models import BaseModel, SoftDeleteModel


# ──────────────────────────────────────────────────────────────────────────────
# Sale
# ──────────────────────────────────────────────────────────────────────────────


class Sale(SoftDeleteModel):
    class SaleType(models.TextChoices):
        COUNTER = "counter", "Counter Sale"
        JOB_LINKED = "job_linked", "Job-Linked Sale"
        WHOLESALE = "wholesale", "Wholesale (B2B)"

    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        COMPLETED = "completed", "Completed"
        PARTIALLY_PAID = "partially_paid", "Partially Paid"
        CANCELLED = "cancelled", "Cancelled"
        RETURNED = "returned", "Returned"

    class DiscountType(models.TextChoices):
        FLAT = "flat", "Flat"
        PERCENTAGE = "percentage", "Percentage"
        NONE = "none", "None"

    shop = models.ForeignKey("core.Shop", on_delete=models.PROTECT, related_name="sales")
    sale_type = models.CharField(max_length=20, choices=SaleType.choices)
    customer = models.ForeignKey(
        "crm.Customer", null=True, blank=True, on_delete=models.PROTECT, related_name="sales"
    )
    # job_id — plain UUID until repair FK is added here; job_linked sales keep this reference.
    job_id = models.UUIDField(null=True, blank=True, db_index=True)
    sale_number = models.CharField(max_length=30, unique=True)
    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.DRAFT, db_index=True
    )

    subtotal = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    discount_type = models.CharField(
        max_length=15, choices=DiscountType.choices, default=DiscountType.NONE
    )
    discount_value = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    discount_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)

    # GST — split per foundation/03 §5 (intra-state → CGST+SGST; inter-state → IGST)
    cgst = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    sgst = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    igst = models.DecimalField(max_digits=10, decimal_places=2, default=0)

    grand_total = models.DecimalField(max_digits=12, decimal_places=2)
    amount_paid = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    amount_outstanding = models.DecimalField(max_digits=12, decimal_places=2, default=0)

    sale_date = models.DateTimeField(default=timezone.now)
    notes = models.TextField(blank=True, default="")
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="created_sales"
    )

    class Meta:
        app_label = "pos"
        db_table = "sales"
        indexes = [
            models.Index(fields=["shop", "status"]),
            models.Index(fields=["customer"]),
            models.Index(fields=["sale_date"]),
        ]

    def __str__(self) -> str:
        return f"{self.sale_number} ({self.status})"


# ──────────────────────────────────────────────────────────────────────────────
# Sale items
# ──────────────────────────────────────────────────────────────────────────────


class SaleItem(BaseModel):
    sale = models.ForeignKey(Sale, on_delete=models.CASCADE, related_name="items")
    # variant_id — plain UUID until inventory module is built
    variant_id = models.UUIDField(null=True, blank=True)

    # Snapshots freeze product details at sale time (§3.2)
    product_name_snapshot = models.CharField(max_length=200)
    variant_name_snapshot = models.CharField(max_length=200, blank=True, default="")
    hsn_code = models.CharField(max_length=20, blank=True, default="")

    quantity = models.DecimalField(max_digits=10, decimal_places=3)
    unit_price = models.DecimalField(max_digits=10, decimal_places=2)
    discount_per_unit = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    # Tax rate in % (e.g. 18.00 for 18% GST)
    tax_rate = models.DecimalField(max_digits=5, decimal_places=2, default=0)

    line_subtotal = models.DecimalField(max_digits=12, decimal_places=2)
    line_tax = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    line_total = models.DecimalField(max_digits=12, decimal_places=2)

    class Meta:
        app_label = "pos"
        db_table = "sale_items"

    def __str__(self) -> str:
        return f"{self.product_name_snapshot} x{self.quantity}"


# ──────────────────────────────────────────────────────────────────────────────
# Sale payments
# ──────────────────────────────────────────────────────────────────────────────


class SalePayment(BaseModel):
    class Method(models.TextChoices):
        CASH = "cash", "Cash"
        UPI = "upi", "UPI"
        CARD = "card", "Card"
        CHEQUE = "cheque", "Cheque"
        NEFT = "neft", "NEFT / RTGS"
        CREDIT = "credit", "Credit (B2B)"
        OTHER = "other", "Other"

    sale = models.ForeignKey(Sale, on_delete=models.CASCADE, related_name="payments")
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    method = models.CharField(max_length=10, choices=Method.choices)
    reference_id = models.CharField(max_length=100, blank=True, default="")
    # Razorpay payment id — unique to prevent double-recording via webhook
    razorpay_payment_id = models.CharField(max_length=100, blank=True, default="", unique=False)
    paid_at = models.DateTimeField(default=timezone.now)
    recorded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="recorded_payments"
    )

    class Meta:
        app_label = "pos"
        db_table = "sale_payments"
        constraints = [
            # Idempotency: same Razorpay payment id must not be recorded twice
            models.UniqueConstraint(
                fields=["razorpay_payment_id"],
                condition=~models.Q(razorpay_payment_id=""),
                name="unique_razorpay_payment_id",
            )
        ]

    def __str__(self) -> str:
        return f"{self.method} ₹{self.amount} for {self.sale.sale_number}"


# ──────────────────────────────────────────────────────────────────────────────
# Sales returns
# ──────────────────────────────────────────────────────────────────────────────


class SalesReturn(BaseModel):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        APPROVED = "approved", "Approved"
        REJECTED = "rejected", "Rejected"

    class RefundMethod(models.TextChoices):
        CASH = "cash", "Cash"
        ORIGINAL_PAYMENT = "original_payment", "Original Payment"
        STORE_CREDIT = "store_credit", "Store Credit"
        EXCHANGE = "exchange", "Exchange"

    sale = models.ForeignKey(Sale, on_delete=models.PROTECT, related_name="returns")
    return_number = models.CharField(max_length=30, unique=True)
    reason = models.TextField()
    status = models.CharField(
        max_length=15, choices=Status.choices, default=Status.PENDING, db_index=True
    )
    total_refund_amount = models.DecimalField(max_digits=12, decimal_places=2)
    refund_method = models.CharField(max_length=20, choices=RefundMethod.choices)
    approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True, blank=True,
        on_delete=models.SET_NULL,
        related_name="approved_returns",
    )
    approved_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        app_label = "pos"
        db_table = "sales_returns"

    def __str__(self) -> str:
        return f"{self.return_number} ({self.status})"


class SalesReturnItem(BaseModel):
    sales_return = models.ForeignKey(SalesReturn, on_delete=models.CASCADE, related_name="items")
    sale_item = models.ForeignKey(SaleItem, on_delete=models.PROTECT, related_name="return_items")
    quantity = models.DecimalField(max_digits=10, decimal_places=3)
    refund_amount = models.DecimalField(max_digits=12, decimal_places=2)

    class Meta:
        app_label = "pos"
        db_table = "sales_return_items"

    def __str__(self) -> str:
        return f"{self.sale_item.product_name_snapshot} x{self.quantity}"


# ──────────────────────────────────────────────────────────────────────────────
# Credit notes
# ──────────────────────────────────────────────────────────────────────────────


class CreditNote(BaseModel):
    return_record = models.OneToOneField(
        SalesReturn, on_delete=models.CASCADE, related_name="credit_note"
    )
    credit_note_number = models.CharField(max_length=30, unique=True)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    # S3 key for generated PDF
    pdf_url = models.CharField(max_length=500, blank=True, default="")

    class Meta:
        app_label = "pos"
        db_table = "credit_notes"

    def __str__(self) -> str:
        return f"{self.credit_note_number} ₹{self.amount}"
