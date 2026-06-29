import uuid

from django.conf import settings
from django.db import models
from django.utils import timezone

from core.models import BaseModel, SoftDeleteModel


class RepairInvoice(SoftDeleteModel):
    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        ISSUED = "issued", "Issued"
        PARTIALLY_PAID = "partially_paid", "Partially Paid"
        PAID = "paid", "Paid"
        CANCELLED = "cancelled", "Cancelled"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    shop = models.ForeignKey("core.Shop", on_delete=models.PROTECT, related_name="repair_invoices")
    job = models.OneToOneField(
        "repair.JobTicket", on_delete=models.PROTECT, related_name="invoice"
    )
    customer = models.ForeignKey(
        "crm.Customer", on_delete=models.PROTECT, related_name="repair_invoices"
    )
    invoice_number = models.CharField(max_length=30, unique=True)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.ISSUED)
    subtotal = models.DecimalField(max_digits=12, decimal_places=2)
    discount_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    cgst = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    sgst = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    igst = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    grand_total = models.DecimalField(max_digits=12, decimal_places=2)
    amount_paid = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    amount_outstanding = models.DecimalField(max_digits=12, decimal_places=2)
    due_date = models.DateField(null=True, blank=True)
    pdf_url = models.CharField(max_length=500, blank=True, default="")
    created_at = models.DateTimeField(default=timezone.now, db_index=True)

    class Meta:
        app_label = "billing"
        db_table = "repair_invoices"
        indexes = [
            models.Index(fields=["shop", "status"]),
            models.Index(fields=["customer"]),
        ]

    def __str__(self) -> str:
        return f"{self.invoice_number} ({self.status})"


class RepairInvoiceItem(BaseModel):
    class ItemType(models.TextChoices):
        LABOR = "labor", "Labor"
        COMPONENT = "component", "Component"
        CUSTOM = "custom", "Custom"

    invoice = models.ForeignKey(
        RepairInvoice, on_delete=models.CASCADE, related_name="items"
    )
    item_type = models.CharField(max_length=20, choices=ItemType.choices)
    description = models.CharField(max_length=300)
    sac_code = models.CharField(max_length=10, blank=True, default="")
    hsn_code = models.CharField(max_length=10, blank=True, default="")
    quantity = models.DecimalField(max_digits=10, decimal_places=3, default=1)
    unit_price = models.DecimalField(max_digits=12, decimal_places=2)
    tax_rate = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    line_total = models.DecimalField(max_digits=12, decimal_places=2)

    class Meta:
        app_label = "billing"
        db_table = "repair_invoice_items"


class Payment(BaseModel):
    class Method(models.TextChoices):
        CASH = "cash", "Cash"
        UPI = "upi", "UPI"
        CARD = "card", "Card"
        CHEQUE = "cheque", "Cheque"
        NEFT = "neft", "NEFT"
        OTHER = "other", "Other"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    invoice = models.ForeignKey(
        RepairInvoice, on_delete=models.PROTECT, related_name="payments"
    )
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    method = models.CharField(max_length=20, choices=Method.choices)
    reference_id = models.CharField(max_length=200, blank=True, default="")
    razorpay_payment_id = models.CharField(max_length=100, unique=True, null=True, blank=True)
    razorpay_order_id = models.CharField(max_length=100, blank=True, default="")
    paid_at = models.DateTimeField(default=timezone.now)
    recorded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True, blank=True,
        on_delete=models.SET_NULL,
        related_name="billing_payments",
    )
    notes = models.TextField(blank=True, default="")

    class Meta:
        app_label = "billing"
        db_table = "payments"

    def __str__(self) -> str:
        return f"Payment {self.amount} for {self.invoice.invoice_number}"


class TaxRate(BaseModel):
    """GST tax-rate slab master (config). One row per named slab per tenant DB."""

    class TaxType(models.TextChoices):
        GST = "gst", "GST (CGST + SGST)"
        IGST = "igst", "IGST (inter-state)"
        EXEMPT = "exempt", "Exempt"

    name = models.CharField(max_length=50, unique=True)
    rate = models.DecimalField(max_digits=5, decimal_places=2)
    tax_type = models.CharField(max_length=10, choices=TaxType.choices, default=TaxType.GST)
    is_active = models.BooleanField(default=True)

    class Meta:
        app_label = "billing"
        db_table = "tax_rates"
        ordering = ["rate"]

    def __str__(self) -> str:
        return f"{self.name} ({self.rate}%)"
