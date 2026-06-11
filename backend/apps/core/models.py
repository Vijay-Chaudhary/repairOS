"""
Abstract base models shared by every tenant-DB app.

BaseModel           — UUID PK, created_at, updated_at.
SoftDeleteModel     — extends BaseModel with deleted_at / deleted_by.
Shop                — concrete; every tenant DB has this table.
TenantSettings      — singleton branding/bank config per tenant DB.
WhatsAppConnection  — singleton WhatsApp channel config per tenant DB.
NotificationTemplate — per-template active/body overrides.
"""

import uuid

from django.db import models
from django.utils import timezone


class BaseModel(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    created_at = models.DateTimeField(default=timezone.now, db_index=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True


class SoftDeleteQuerySet(models.QuerySet):
    def alive(self):
        return self.filter(deleted_at__isnull=True)

    def deleted(self):
        return self.filter(deleted_at__isnull=False)

    def soft_delete(self, user_id=None):
        return self.update(deleted_at=timezone.now(), deleted_by=user_id)


class SoftDeleteManager(models.Manager):
    def get_queryset(self):
        return SoftDeleteQuerySet(self.model, using=self._db).filter(deleted_at__isnull=True)


class AllObjectsManager(models.Manager):
    def get_queryset(self):
        return SoftDeleteQuerySet(self.model, using=self._db)


class SoftDeleteModel(BaseModel):
    deleted_at = models.DateTimeField(null=True, blank=True, db_index=True)
    # Stored as UUID rather than FK to avoid cross-module circular imports.
    deleted_by = models.UUIDField(null=True, blank=True)

    objects = SoftDeleteManager()
    all_objects = AllObjectsManager()

    class Meta:
        abstract = True

    def soft_delete(self, user_id=None) -> None:
        self.deleted_at = timezone.now()
        self.deleted_by = user_id
        self.save(update_fields=["deleted_at", "deleted_by"])

    def restore(self) -> None:
        self.deleted_at = None
        self.deleted_by = None
        self.save(update_fields=["deleted_at", "deleted_by"])

    @property
    def is_deleted(self) -> bool:
        return self.deleted_at is not None


class DocumentCounter(models.Model):
    """
    Atomic per-shop/year/document-type sequence counter.

    All document numbers (job tickets, estimates, invoices, POs …) call
    `DocumentCounter.next(shop, year, doc_type)` inside `SELECT FOR UPDATE`
    to guarantee uniqueness even under concurrent creation.
    """

    class DocType(models.TextChoices):
        JOB = "job", "Job Ticket"
        ESTIMATE = "estimate", "Estimate"
        LEAD_QUOTE = "lead_quote", "Lead Quote"
        REPAIR_INVOICE = "repair_invoice", "Repair Invoice"
        SALES_INVOICE = "sales_invoice", "Sales Invoice"
        SALES_RETURN = "sales_return", "Sales Return"
        PURCHASE_ORDER = "purchase_order", "Purchase Order"
        PURCHASE_RETURN = "purchase_return", "Purchase Return"
        GRN = "grn", "GRN"
        AMC = "amc", "AMC Contract"
        CREDIT_NOTE = "credit_note", "Credit Note"
        DEBIT_NOTE = "debit_note", "Debit Note"

    shop = models.ForeignKey("core.Shop", on_delete=models.CASCADE, related_name="counters")
    year = models.IntegerField()
    # 0 = yearly counter (jobs, estimates, POs …)
    # 1-12 = monthly counter (sales invoices, returns, credit notes …)
    month = models.IntegerField(default=0)
    doc_type = models.CharField(max_length=20, choices=DocType.choices)
    last_number = models.IntegerField(default=0)

    class Meta:
        app_label = "core"
        db_table = "document_counters"
        unique_together = [("shop", "year", "month", "doc_type")]

    @classmethod
    def next(cls, shop, year: int, doc_type: str, month: int = 0) -> int:
        """Return the next sequential number for this shop/year[/month]/doc_type, atomically."""
        from django.db import transaction
        from core.context import get_tenant_db_alias

        _db = get_tenant_db_alias() or "default"
        with transaction.atomic(using=_db):
            counter, _ = cls.objects.select_for_update().get_or_create(
                shop=shop, year=year, month=month, doc_type=doc_type,
                defaults={"last_number": 0},
            )
            counter.last_number += 1
            counter.save(update_fields=["last_number"])
            return counter.last_number


class Shop(BaseModel):
    """
    Physical shop location. One tenant may have many shops.
    `code` prefixes all job/invoice/PO numbers (e.g. HTA-2026-0001).
    """

    name = models.CharField(max_length=200)
    code = models.CharField(max_length=10, unique=True)
    address = models.TextField()
    city = models.CharField(max_length=100)
    state = models.CharField(max_length=100)
    state_code = models.CharField(max_length=2, help_text="GST state code, e.g. 09 = UP")
    phone = models.CharField(max_length=20)
    email = models.EmailField(null=True, blank=True)
    gstin = models.CharField(max_length=15, null=True, blank=True)
    lat = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    lng = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    is_active = models.BooleanField(default=True)
    working_hours = models.JSONField(
        default=dict,
        help_text='{"mon":{"open":"09:00","close":"19:00"}, ...}',
    )

    class Meta:
        app_label = "core"
        db_table = "shops"

    def __str__(self) -> str:
        return f"{self.name} ({self.code})"


# ──────────────────────────────────────────────────────────────────────────────
# Tenant-scoped singleton settings (stored in each tenant DB)
# ──────────────────────────────────────────────────────────────────────────────

_SETTINGS_SINGLETON = uuid.UUID("00000000-0000-0000-0000-000000000001")


class TenantSettings(BaseModel):
    """Singleton branding + bank details for this tenant. One row per tenant DB."""

    logo_url = models.CharField(max_length=500, null=True, blank=True)
    invoice_footer = models.TextField(blank=True, default="")
    bank_name = models.CharField(max_length=200, null=True, blank=True)
    bank_account_number = models.CharField(max_length=50, null=True, blank=True)
    bank_ifsc = models.CharField(max_length=20, null=True, blank=True)

    class Meta:
        app_label = "core"
        db_table = "tenant_settings"

    @classmethod
    def get_or_create_singleton(cls) -> "TenantSettings":
        obj, _ = cls.objects.get_or_create(id=_SETTINGS_SINGLETON)
        return obj


class WhatsAppConnection(BaseModel):
    """Singleton WhatsApp channel config for this tenant."""

    phone_number = models.CharField(max_length=20, null=True, blank=True)
    is_connected = models.BooleanField(default=False)
    connected_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        app_label = "core"
        db_table = "whatsapp_connections"

    @classmethod
    def get_or_create_singleton(cls) -> "WhatsAppConnection":
        _wa_singleton = uuid.UUID("00000000-0000-0000-0000-000000000002")
        obj, _ = cls.objects.get_or_create(id=_wa_singleton)
        return obj


class NotificationTemplate(BaseModel):
    """
    Per-template on/off switch and optional custom body override.
    One row per template_name that a tenant has customised.
    If a template has no row here it is treated as active with no body override.
    """

    template_name = models.CharField(max_length=100, unique=True)
    is_active = models.BooleanField(default=True)
    custom_body = models.TextField(null=True, blank=True)

    class Meta:
        app_label = "core"
        db_table = "notification_templates"

    def __str__(self) -> str:
        return self.template_name


class NotificationLog(BaseModel):
    """
    Audit trail for every notification send attempt (WhatsApp, email, SMS).
    One row per attempt; status updated in-place as the Celery task progresses.
    """

    class Status(models.TextChoices):
        QUEUED = "queued", "Queued"
        SENT = "sent", "Sent"
        DELIVERED = "delivered", "Delivered"
        READ = "read", "Read"
        FAILED = "failed", "Failed"

    class Channel(models.TextChoices):
        WHATSAPP = "whatsapp", "WhatsApp"
        EMAIL = "email", "Email"
        SMS = "sms", "SMS"

    # Optional FKs stored as UUID to avoid cross-app circular imports.
    customer_id = models.UUIDField(null=True, blank=True, db_index=True)
    lead_id = models.UUIDField(null=True, blank=True, db_index=True)

    template_name = models.CharField(max_length=100, db_index=True)
    channel = models.CharField(max_length=10, choices=Channel.choices, default=Channel.WHATSAPP)
    recipient_phone = models.CharField(max_length=20, blank=True, default="")
    recipient_email = models.EmailField(blank=True, default="")
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.QUEUED)

    whatsapp_message_id = models.CharField(max_length=100, blank=True, default="")
    attempt_count = models.IntegerField(default=0)
    last_attempt_at = models.DateTimeField(null=True, blank=True)
    sent_at = models.DateTimeField(null=True, blank=True)
    delivered_at = models.DateTimeField(null=True, blank=True)
    failed_reason = models.TextField(blank=True, default="")

    class Meta:
        app_label = "core"
        db_table = "notification_logs"
        indexes = [
            models.Index(fields=["template_name", "status"]),
            models.Index(fields=["created_at"]),
        ]

    def __str__(self) -> str:
        return f"{self.channel}/{self.template_name} → {self.recipient_phone or self.recipient_email} [{self.status}]"
