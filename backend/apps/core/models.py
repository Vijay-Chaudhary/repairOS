"""
Abstract base models shared by every tenant-DB app.

BaseModel        — UUID PK, created_at, updated_at.
SoftDeleteModel  — extends BaseModel with deleted_at / deleted_by (UUID, not FK,
                   to avoid cross-app FK issues between modules).
Shop             — concrete; every tenant DB has this table.
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
