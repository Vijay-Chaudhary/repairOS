import uuid

from django.conf import settings
from django.db import models
from django.utils import timezone

from core.models import BaseModel


class CommissionRule(BaseModel):
    """
    Defines how commission is calculated. Rate is % of service charge.
    lead_tech_share: % of total pool allocated to the lead tech when 2+ techs.
    applies_to_job_type: NULL matches all job types (device_type).
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=100)
    rate = models.DecimalField(max_digits=5, decimal_places=2)
    lead_tech_share = models.DecimalField(max_digits=5, decimal_places=2, default=50)
    applies_to_job_type = models.CharField(max_length=100, null=True, blank=True)
    effective_from = models.DateField()
    effective_to = models.DateField(null=True, blank=True)

    class Meta:
        app_label = "commissions"
        db_table = "commission_rules"
        indexes = [models.Index(fields=["effective_from", "effective_to"])]

    def __str__(self) -> str:
        return f"{self.name} ({self.rate}%)"


class CommissionPayout(BaseModel):
    """Batch payout for a technician over a period."""

    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        APPROVED = "approved", "Approved"
        PAID = "paid", "Paid"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    technician = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="commission_payouts"
    )
    period_start = models.DateField()
    period_end = models.DateField()
    total_commission = models.DecimalField(max_digits=12, decimal_places=2)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.DRAFT)
    paid_at = models.DateTimeField(null=True, blank=True)
    paid_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True, blank=True,
        on_delete=models.SET_NULL,
        related_name="commission_payouts_approved",
    )
    pdf_url = models.CharField(max_length=500, blank=True, default="")

    class Meta:
        app_label = "commissions"
        db_table = "commission_payouts"

    def __str__(self) -> str:
        return f"Payout {self.technician_id} {self.period_start}–{self.period_end}"


class TechnicianCommission(BaseModel):
    """One accrued commission row per technician per job."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    job = models.ForeignKey(
        "repair.JobTicket", on_delete=models.PROTECT, related_name="commissions"
    )
    technician = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="commissions"
    )
    stage = models.ForeignKey(
        "repair.JobStage", null=True, blank=True, on_delete=models.SET_NULL,
        related_name="commissions"
    )
    rule = models.ForeignKey(
        CommissionRule, null=True, blank=True, on_delete=models.SET_NULL,
        related_name="commissions"
    )
    is_lead = models.BooleanField(default=False)
    sc_amount = models.DecimalField(max_digits=10, decimal_places=2)
    rate = models.DecimalField(max_digits=5, decimal_places=2)
    commission_amount = models.DecimalField(max_digits=10, decimal_places=2)
    is_paid = models.BooleanField(default=False)
    payout = models.ForeignKey(
        CommissionPayout, null=True, blank=True, on_delete=models.SET_NULL,
        related_name="commissions"
    )

    class Meta:
        app_label = "commissions"
        db_table = "technician_commissions"
        unique_together = [("job", "technician")]
        indexes = [
            models.Index(fields=["technician", "is_paid"]),
            models.Index(fields=["job"]),
        ]

    def __str__(self) -> str:
        return f"Commission {self.technician_id} job {self.job_id}: {self.commission_amount}"
