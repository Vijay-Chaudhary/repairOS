"""
AMC (Annual Maintenance Contracts) data models — tenant DB.

amc_contracts       — master contract; soft-delete.
amc_visits          — service visits auto-scheduled from contract.
amc_renewal_invoices— links a renewal event to its invoice (billing stub).

visit_interval_days = floor(365 / visits_per_year).
photos stored as JSONField (list of S3 keys) for cross-DB compatibility.
"""

import math
import uuid

from django.conf import settings
from django.db import models
from django.utils import timezone

from core.models import BaseModel, SoftDeleteModel


# ──────────────────────────────────────────────────────────────────────────────
# AMC Contract
# ──────────────────────────────────────────────────────────────────────────────


class AMCContract(SoftDeleteModel):
    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        EXPIRED = "expired", "Expired"
        CANCELLED = "cancelled", "Cancelled"
        PENDING_RENEWAL = "pending_renewal", "Pending Renewal"

    class PaymentTerms(models.TextChoices):
        UPFRONT = "upfront", "Upfront"
        QUARTERLY = "quarterly", "Quarterly"
        MONTHLY = "monthly", "Monthly"

    shop = models.ForeignKey("core.Shop", on_delete=models.PROTECT, related_name="amc_contracts")
    customer = models.ForeignKey(
        "crm.Customer", on_delete=models.PROTECT, related_name="amc_contracts"
    )
    contract_number = models.CharField(max_length=30, unique=True)
    title = models.CharField(max_length=200)
    description = models.TextField(blank=True, default="")
    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.ACTIVE, db_index=True
    )

    start_date = models.DateField()
    end_date = models.DateField()
    value = models.DecimalField(max_digits=12, decimal_places=2)
    payment_terms = models.CharField(max_length=50, choices=PaymentTerms.choices)

    visits_per_year = models.IntegerField(default=0)
    # floor(365 / visits_per_year) — computed and stored at creation
    visit_interval_days = models.IntegerField(default=0)

    auto_renew = models.BooleanField(default=False)
    renewal_reminder_days = models.IntegerField(default=30)
    next_renewal_notified_at = models.DateTimeField(null=True, blank=True)

    location_address = models.TextField(blank=True, default="")
    location_lat = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    location_lng = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)

    assigned_technician = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="amc_contracts",
    )
    notes = models.TextField(blank=True, default="")
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="created_amc_contracts"
    )

    class Meta:
        app_label = "amc"
        db_table = "amc_contracts"
        indexes = [
            models.Index(fields=["shop", "status"]),
            models.Index(fields=["customer"]),
            models.Index(fields=["end_date"]),
        ]

    def __str__(self) -> str:
        return f"{self.contract_number}: {self.title}"

    @staticmethod
    def compute_interval(visits_per_year: int) -> int:
        if visits_per_year <= 0:
            return 0
        return math.floor(365 / visits_per_year)


# ──────────────────────────────────────────────────────────────────────────────
# AMC Visit
# ──────────────────────────────────────────────────────────────────────────────


class AMCVisit(BaseModel):
    class Status(models.TextChoices):
        SCHEDULED = "scheduled", "Scheduled"
        COMPLETED = "completed", "Completed"
        MISSED = "missed", "Missed"
        RESCHEDULED = "rescheduled", "Rescheduled"
        CANCELLED = "cancelled", "Cancelled"

    contract = models.ForeignKey(AMCContract, on_delete=models.CASCADE, related_name="visits")
    visit_number = models.IntegerField()  # sequential per contract, 1-based
    scheduled_date = models.DateField(db_index=True)
    actual_date = models.DateField(null=True, blank=True)
    status = models.CharField(
        max_length=15, choices=Status.choices, default=Status.SCHEDULED, db_index=True
    )
    technician = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="amc_visits",
    )
    work_done = models.TextField(blank=True, default="")
    issues_found = models.TextField(blank=True, default="")
    next_visit_date = models.DateField(null=True, blank=True)
    customer_signature_url = models.CharField(max_length=500, blank=True, default="")
    # S3 keys: /{slug}/amc/{contract_id}/visit_{n}/...
    photos = models.JSONField(default=list, blank=True)
    # job_id — plain UUID; set when a repair job is created from this visit
    job_id = models.UUIDField(null=True, blank=True)

    class Meta:
        app_label = "amc"
        db_table = "amc_visits"
        unique_together = [("contract", "visit_number")]
        ordering = ["scheduled_date"]

    def __str__(self) -> str:
        return f"Visit #{self.visit_number} for {self.contract.contract_number} ({self.scheduled_date})"


# ──────────────────────────────────────────────────────────────────────────────
# AMC Renewal Invoice
# ──────────────────────────────────────────────────────────────────────────────


class AMCRenewalInvoice(BaseModel):
    contract = models.ForeignKey(AMCContract, on_delete=models.CASCADE, related_name="renewal_invoices")
    # invoice_id — plain UUID until billing module is built (will FK to repair_invoices)
    invoice_id = models.UUIDField(null=True, blank=True)
    renewal_period_start = models.DateField()
    renewal_period_end = models.DateField()
    sent_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        app_label = "amc"
        db_table = "amc_renewal_invoices"
        ordering = ["-renewal_period_start"]

    def __str__(self) -> str:
        return (
            f"Renewal for {self.contract.contract_number} "
            f"({self.renewal_period_start}–{self.renewal_period_end})"
        )
