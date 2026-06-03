"""
Repair module data models — tenant DB.

All mutable tables extend SoftDeleteModel (deleted_at + deleted_by).

accessory_received / photos — stored as JSONField (list of strings) rather
than PostgreSQL TEXT[] for cross-DB test compatibility.
"""

import uuid

from django.conf import settings
from django.db import models
from django.utils import timezone

from core.models import BaseModel, SoftDeleteModel


# ──────────────────────────────────────────────────────────────────────────────
# Fault templates
# ──────────────────────────────────────────────────────────────────────────────


class FaultTemplate(SoftDeleteModel):
    shop = models.ForeignKey("core.Shop", on_delete=models.CASCADE, related_name="fault_templates")
    name = models.CharField(max_length=200)
    device_type = models.CharField(max_length=100)
    device_brand = models.CharField(max_length=100, blank=True, default="")
    problem_description = models.TextField()
    default_sc = models.DecimalField(max_digits=10, decimal_places=2)
    estimated_duration_hours = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)
    is_active = models.BooleanField(default=True)

    class Meta:
        app_label = "repair"
        db_table = "fault_templates"
        indexes = [models.Index(fields=["shop", "is_active"])]

    def __str__(self) -> str:
        return f"{self.name} ({self.device_type})"


class FaultTemplatePart(BaseModel):
    template = models.ForeignKey(FaultTemplate, on_delete=models.CASCADE, related_name="parts")
    # variant_id — plain UUID until inventory module is built
    variant_id = models.UUIDField(null=True, blank=True)
    custom_part_name = models.CharField(max_length=200, blank=True, default="")
    quantity = models.IntegerField(default=1)

    class Meta:
        app_label = "repair"
        db_table = "fault_template_parts"
        constraints = [
            models.CheckConstraint(
                condition=models.Q(variant_id__isnull=False) | ~models.Q(custom_part_name=""),
                name="template_part_needs_variant_or_name",
            ),
            models.CheckConstraint(
                condition=models.Q(quantity__gt=0),
                name="template_part_quantity_positive",
            ),
        ]

    def __str__(self) -> str:
        return self.custom_part_name or str(self.variant_id)


# ──────────────────────────────────────────────────────────────────────────────
# Job ticket
# ──────────────────────────────────────────────────────────────────────────────


class JobTicket(SoftDeleteModel):
    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        OPEN = "open", "Open"
        ESTIMATED = "estimated", "Estimated"
        ESTIMATE_SENT = "estimate_sent", "Estimate Sent"
        ESTIMATE_APPROVED = "estimate_approved", "Estimate Approved"
        ESTIMATE_REJECTED = "estimate_rejected", "Estimate Rejected"
        IN_PROGRESS = "in_progress", "In Progress"
        ON_HOLD = "on_hold", "On Hold"
        READY_FOR_QC = "ready_for_qc", "Ready for QC"
        QC_FAILED = "qc_failed", "QC Failed"
        READY_FOR_PICKUP = "ready_for_pickup", "Ready for Pickup"
        DELIVERED = "delivered", "Delivered"
        CLOSED = "closed", "Closed"
        CANCELLED = "cancelled", "Cancelled"

    class Priority(models.TextChoices):
        NORMAL = "normal", "Normal"
        URGENT = "urgent", "Urgent"
        VIP = "vip", "VIP"

    shop = models.ForeignKey("core.Shop", on_delete=models.PROTECT, related_name="jobs")
    customer = models.ForeignKey("crm.Customer", on_delete=models.PROTECT, related_name="jobs")
    job_number = models.CharField(max_length=30, unique=True)
    template = models.ForeignKey(
        FaultTemplate, null=True, blank=True, on_delete=models.SET_NULL, related_name="jobs"
    )
    status = models.CharField(
        max_length=40, choices=Status.choices, default=Status.DRAFT, db_index=True
    )
    priority = models.CharField(
        max_length=20, choices=Priority.choices, default=Priority.NORMAL
    )
    device_type = models.CharField(max_length=100)
    device_brand = models.CharField(max_length=100, blank=True, default="")
    device_model = models.CharField(max_length=100, blank=True, default="")
    serial_number = models.CharField(max_length=100, blank=True, default="")
    imei = models.CharField(max_length=20, blank=True, default="")
    problem_description = models.TextField()
    is_field_job = models.BooleanField(default=False)
    location_lat = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    location_lng = models.DecimalField(max_digits=9, decimal_places=6, null=True, blank=True)
    location_address = models.TextField(blank=True, default="")
    intake_date = models.DateTimeField(default=timezone.now)
    expected_delivery_date = models.DateField(null=True, blank=True)
    service_charge = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    advance_paid = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    notes = models.TextField(blank=True, default="")
    warranty_of_job = models.ForeignKey(
        "self", null=True, blank=True, on_delete=models.SET_NULL, related_name="warranty_jobs"
    )
    # warranty_days and warranty_expires_at are set on closure.
    # warranty_days default: 30 days. Replace with shop/device-type settings lookup
    # when the settings module (part of platform-admin) is built.
    warranty_days = models.IntegerField(null=True, blank=True)
    warranty_expires_at = models.DateField(null=True, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="created_jobs"
    )

    class Meta:
        app_label = "repair"
        db_table = "job_tickets"
        indexes = [
            models.Index(fields=["shop", "status"]),
            models.Index(fields=["customer"]),
            models.Index(fields=["job_number"]),
            models.Index(fields=["intake_date"]),
        ]

    def __str__(self) -> str:
        return f"{self.job_number} ({self.status})"


# ──────────────────────────────────────────────────────────────────────────────
# Check-in condition
# ──────────────────────────────────────────────────────────────────────────────


class JobCheckinCondition(BaseModel):
    class PhysicalCondition(models.TextChoices):
        EXCELLENT = "excellent", "Excellent"
        GOOD = "good", "Good"
        FAIR = "fair", "Fair"
        DAMAGED = "damaged", "Damaged"

    job = models.OneToOneField(JobTicket, on_delete=models.CASCADE, related_name="checkin")
    physical_condition = models.CharField(max_length=30, choices=PhysicalCondition.choices)
    has_scratches = models.BooleanField(default=False)
    has_cracks = models.BooleanField(default=False)
    has_liquid_damage = models.BooleanField(default=False)
    has_missing_parts = models.BooleanField(default=False)
    # Stored as JSON list of strings (e.g. ["charger", "case"])
    accessory_received = models.JSONField(default=list, blank=True)
    customer_description = models.TextField(blank=True, default="")
    technician_notes = models.TextField(blank=True, default="")
    # S3 keys: /{slug}/jobs/{job_id}/checkin/photo_n.jpg
    photos = models.JSONField(default=list, blank=True)
    customer_signature_url = models.CharField(max_length=500, blank=True, default="")
    acknowledged_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        app_label = "repair"
        db_table = "job_checkin_conditions"

    def __str__(self) -> str:
        return f"Checkin for {self.job.job_number}"


# ──────────────────────────────────────────────────────────────────────────────
# Estimate
# ──────────────────────────────────────────────────────────────────────────────


class JobEstimate(BaseModel):
    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        SENT = "sent", "Sent"
        APPROVED = "approved", "Approved"
        REJECTED = "rejected", "Rejected"
        EXPIRED = "expired", "Expired"

    class ResponseMethod(models.TextChoices):
        WHATSAPP = "whatsapp", "WhatsApp"
        IN_PERSON = "in_person", "In Person"
        CALL = "call", "Call"
        EMAIL = "email", "Email"

    job = models.ForeignKey(JobTicket, on_delete=models.CASCADE, related_name="estimates")
    estimate_number = models.CharField(max_length=30, unique=True)
    labor_charge = models.DecimalField(max_digits=10, decimal_places=2)
    parts_cost = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    total_estimate = models.DecimalField(max_digits=10, decimal_places=2)
    valid_until = models.DateField(null=True, blank=True)
    notes = models.TextField(blank=True, default="")
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.DRAFT)
    sent_at = models.DateTimeField(null=True, blank=True)
    customer_response_at = models.DateTimeField(null=True, blank=True)
    customer_response_method = models.CharField(
        max_length=30, choices=ResponseMethod.choices, blank=True, default=""
    )

    class Meta:
        app_label = "repair"
        db_table = "job_estimates"
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.estimate_number} ({self.status})"


# ──────────────────────────────────────────────────────────────────────────────
# Job stages
# ──────────────────────────────────────────────────────────────────────────────


class JobStage(BaseModel):
    class StageType(models.TextChoices):
        DIAGNOSIS = "diagnosis", "Diagnosis"
        REPAIR = "repair", "Repair"
        PARTS_INSTALL = "parts_install", "Parts Install"
        TESTING = "testing", "Testing"
        QC = "qc", "QC"
        PACKING = "packing", "Packing"

    class StageStatus(models.TextChoices):
        PENDING = "pending", "Pending"
        IN_PROGRESS = "in_progress", "In Progress"
        COMPLETED = "completed", "Completed"
        SKIPPED = "skipped", "Skipped"

    job = models.ForeignKey(JobTicket, on_delete=models.CASCADE, related_name="stages")
    stage_order = models.IntegerField()
    stage_type = models.CharField(max_length=30, choices=StageType.choices)
    assigned_technician = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="repair_stages"
    )
    status = models.CharField(
        max_length=20, choices=StageStatus.choices, default=StageStatus.PENDING
    )
    started_at = models.DateTimeField(null=True, blank=True)
    completed_at = models.DateTimeField(null=True, blank=True)
    notes = models.TextField(blank=True, default="")

    class Meta:
        app_label = "repair"
        db_table = "job_stages"
        unique_together = [("job", "stage_order")]
        indexes = [models.Index(fields=["job", "status"])]
        # Partial unique index: at most one in_progress stage per job.
        # Enforced at DB level (PostgreSQL) and in service layer (for SQLite tests).
        constraints = [
            models.UniqueConstraint(
                fields=["job"],
                condition=models.Q(status="in_progress"),
                name="unique_in_progress_stage_per_job",
            )
        ]

    def __str__(self) -> str:
        return f"{self.job.job_number} stage {self.stage_order}: {self.stage_type}"


# ──────────────────────────────────────────────────────────────────────────────
# Spare-part requests
# ──────────────────────────────────────────────────────────────────────────────


class JobSparePartRequest(BaseModel):
    class RequestStatus(models.TextChoices):
        REQUESTED = "requested", "Requested"
        APPROVED = "approved", "Approved"
        REJECTED = "rejected", "Rejected"
        ORDERED = "ordered", "Ordered"
        RECEIVED = "received", "Received"

    job = models.ForeignKey(JobTicket, on_delete=models.CASCADE, related_name="spare_part_requests")
    requested_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="spare_part_requests"
    )
    # variant_id — plain UUID until inventory module is built
    variant_id = models.UUIDField(null=True, blank=True)
    custom_part_name = models.CharField(max_length=200, blank=True, default="")
    quantity = models.IntegerField()
    is_urgent = models.BooleanField(default=False)
    status = models.CharField(
        max_length=20, choices=RequestStatus.choices, default=RequestStatus.REQUESTED
    )
    reviewed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True, blank=True,
        on_delete=models.SET_NULL,
        related_name="reviewed_spare_part_requests",
    )
    # po_id — plain UUID until procurement module is built
    po_id = models.UUIDField(null=True, blank=True)

    class Meta:
        app_label = "repair"
        db_table = "job_spare_part_requests"
        constraints = [
            models.CheckConstraint(
                condition=models.Q(variant_id__isnull=False) | ~models.Q(custom_part_name=""),
                name="spare_part_needs_variant_or_name",
            ),
            models.CheckConstraint(
                condition=models.Q(quantity__gt=0),
                name="spare_part_quantity_positive",
            ),
        ]

    def __str__(self) -> str:
        part = self.custom_part_name or str(self.variant_id)
        return f"{part} x{self.quantity} for {self.job.job_number}"
