"""
CRM data model — tenant DB.
All mutable tables extend SoftDeleteModel (deleted_at + deleted_by).

tags is stored as JSONField (list of strings) rather than PostgreSQL TEXT[]
so the test suite can run against SQLite. Functionally identical in all ORM
queries used in this module.
"""

import uuid

from django.conf import settings
from django.db import models
from django.utils import timezone

from core.models import BaseModel, SoftDeleteModel


# ──────────────────────────────────────────────────────────────────────────────
# Lead
# ──────────────────────────────────────────────────────────────────────────────


class Lead(SoftDeleteModel):
    class Status(models.TextChoices):
        NEW = "new", "New"
        CONTACTED = "contacted", "Contacted"
        INTERESTED = "interested", "Interested"
        QUOTED = "quoted", "Quoted"
        CONVERTED = "converted", "Converted"
        LOST = "lost", "Lost"

    class Source(models.TextChoices):
        WALK_IN = "walk_in", "Walk-In"
        WHATSAPP = "whatsapp", "WhatsApp"
        REFERRAL = "referral", "Referral"
        GOOGLE = "google", "Google"
        FACEBOOK = "facebook", "Facebook"
        OTHER = "other", "Other"

    shop = models.ForeignKey("core.Shop", on_delete=models.PROTECT, related_name="leads")
    name = models.CharField(max_length=200)
    phone = models.CharField(max_length=20)
    email = models.EmailField(null=True, blank=True)
    source = models.CharField(max_length=50, choices=Source.choices, default=Source.OTHER)
    status = models.CharField(max_length=30, choices=Status.choices, default=Status.NEW, db_index=True)
    lost_reason = models.TextField(null=True, blank=True)
    device_type = models.CharField(max_length=100, null=True, blank=True)
    notes = models.TextField(null=True, blank=True)
    assigned_to = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="assigned_leads",
    )
    converted_customer = models.ForeignKey(
        "Customer",
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name="lead_conversions",
    )
    converted_at = models.DateTimeField(null=True, blank=True)
    # Saved when the lead is marked lost so re-open can restore the exact prior stage.
    status_before_lost = models.CharField(max_length=30, null=True, blank=True)

    class Meta:
        app_label = "crm"
        db_table = "leads"
        indexes = [
            models.Index(fields=["shop", "status"]),
            models.Index(fields=["assigned_to"]),
        ]


# ──────────────────────────────────────────────────────────────────────────────
# Lead quote
# ──────────────────────────────────────────────────────────────────────────────


class LeadQuote(BaseModel):
    """
    A price quote sent to a lead before converting them to a customer.
    Sending a quote transitions the lead to status='quoted' and fires
    a WhatsApp notification.
    """

    lead = models.ForeignKey(Lead, on_delete=models.CASCADE, related_name="quotes")
    quote_number = models.CharField(max_length=50, unique=True)
    # Line items: [{"description": "Screen replacement", "amount": "4500.00"}, ...]
    items = models.JSONField(default=list)
    total_amount = models.DecimalField(max_digits=12, decimal_places=2)
    valid_until = models.DateField()
    notes = models.TextField(blank=True, default="")
    sent_via_whatsapp = models.BooleanField(default=False)
    sent_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="sent_lead_quotes",
    )

    class Meta:
        app_label = "crm"
        db_table = "lead_quotes"
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.name} ({self.phone}) — {self.status}"


# ──────────────────────────────────────────────────────────────────────────────
# Customer
# ──────────────────────────────────────────────────────────────────────────────


class Customer(SoftDeleteModel):
    class CustomerType(models.TextChoices):
        INDIVIDUAL = "individual", "Individual"
        BUSINESS = "business", "Business"

    shop = models.ForeignKey("core.Shop", on_delete=models.PROTECT, related_name="customers")
    name = models.CharField(max_length=200)
    phone = models.CharField(max_length=20, db_index=True)
    alternate_phone = models.CharField(max_length=20, null=True, blank=True)
    email = models.EmailField(null=True, blank=True)
    address = models.TextField(null=True, blank=True)
    city = models.CharField(max_length=100, null=True, blank=True)
    gstin = models.CharField(max_length=15, null=True, blank=True)
    customer_type = models.CharField(
        max_length=20, choices=CustomerType.choices, default=CustomerType.INDIVIDUAL
    )
    credit_limit = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    # Tags stored as JSON list of strings (e.g. ["vip", "cctv", "laptop"])
    tags = models.JSONField(default=list, blank=True)
    # Denormalized counters — updated by Repair/Billing signals
    total_jobs = models.IntegerField(default=0)
    total_billed = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    total_outstanding = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    last_visit = models.DateTimeField(null=True, blank=True)
    whatsapp_optout = models.BooleanField(default=False)
    source_lead = models.ForeignKey(
        Lead, null=True, blank=True, on_delete=models.SET_NULL, related_name="customers"
    )

    class Meta:
        app_label = "crm"
        db_table = "customers"
        indexes = [
            models.Index(fields=["shop", "customer_type"]),
        ]
        constraints = [
            # Phone must be unique among non-deleted customers.
            # Partial index — only honoured by PostgreSQL; SQLite ignores the condition
            # but application-layer validation in the serializer enforces it everywhere.
            models.UniqueConstraint(
                fields=["phone"],
                condition=models.Q(deleted_at__isnull=True),
                name="unique_customer_phone_active",
            )
        ]

    def __str__(self) -> str:
        return f"{self.name} ({self.phone})"


# ──────────────────────────────────────────────────────────────────────────────
# Communication log
# ──────────────────────────────────────────────────────────────────────────────


class CommunicationLog(SoftDeleteModel):
    class CommType(models.TextChoices):
        CALL = "call", "Call"
        WHATSAPP = "whatsapp", "WhatsApp"
        VISIT = "visit", "Visit"
        EMAIL = "email", "Email"
        SMS = "sms", "SMS"
        NOTE = "note", "Note"

    class Direction(models.TextChoices):
        INBOUND = "inbound", "Inbound"
        OUTBOUND = "outbound", "Outbound"

    customer = models.ForeignKey(
        Customer, null=True, blank=True, on_delete=models.CASCADE, related_name="comms"
    )
    lead = models.ForeignKey(
        Lead, null=True, blank=True, on_delete=models.CASCADE, related_name="comms"
    )
    type = models.CharField(max_length=30, choices=CommType.choices)
    direction = models.CharField(max_length=10, choices=Direction.choices, null=True, blank=True)
    summary = models.TextField()
    duration_minutes = models.IntegerField(null=True, blank=True)
    logged_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="comm_logs"
    )
    logged_at = models.DateTimeField()

    class Meta:
        app_label = "crm"
        db_table = "communication_logs"
        ordering = ["-logged_at"]
        constraints = [
            models.CheckConstraint(
                condition=models.Q(customer__isnull=False) | models.Q(lead__isnull=False),
                name="comm_log_requires_customer_or_lead",
            )
        ]

    def clean(self):
        from django.core.exceptions import ValidationError
        if self.customer_id is None and self.lead_id is None:
            raise ValidationError("A communication log must be linked to a customer or a lead.")

    def __str__(self) -> str:
        target = self.customer or self.lead
        return f"{self.type} — {target} @ {self.logged_at}"


# ──────────────────────────────────────────────────────────────────────────────
# Follow-up task
# ──────────────────────────────────────────────────────────────────────────────


class FollowUpTask(SoftDeleteModel):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        IN_PROGRESS = "in_progress", "In Progress"
        COMPLETED = "completed", "Completed"
        CANCELLED = "cancelled", "Cancelled"
        OVERDUE = "overdue", "Overdue"

    class Priority(models.TextChoices):
        LOW = "low", "Low"
        NORMAL = "normal", "Normal"
        HIGH = "high", "High"

    customer = models.ForeignKey(
        Customer, null=True, blank=True, on_delete=models.SET_NULL, related_name="tasks"
    )
    lead = models.ForeignKey(
        Lead, null=True, blank=True, on_delete=models.SET_NULL, related_name="tasks"
    )
    # job_id is a plain UUID — filled when Repair module creates tasks; no FK yet
    job_id = models.UUIDField(null=True, blank=True)
    title = models.CharField(max_length=200)
    description = models.TextField(null=True, blank=True)
    due_date = models.DateField()
    due_time = models.TimeField(null=True, blank=True)
    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.PENDING, db_index=True
    )
    priority = models.CharField(max_length=10, choices=Priority.choices, default=Priority.NORMAL)
    assigned_to = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="tasks"
    )
    completed_at = models.DateTimeField(null=True, blank=True)
    completed_by = models.UUIDField(null=True, blank=True)

    class Meta:
        app_label = "crm"
        db_table = "follow_up_tasks"
        ordering = ["due_date", "due_time"]
        indexes = [
            models.Index(fields=["assigned_to", "status"]),
            models.Index(fields=["due_date"]),
        ]

    def __str__(self) -> str:
        return f"{self.title} (due {self.due_date})"


# ──────────────────────────────────────────────────────────────────────────────
# Customer segments
# ──────────────────────────────────────────────────────────────────────────────


class CustomerSegment(SoftDeleteModel):
    name = models.CharField(max_length=200)
    description = models.TextField(blank=True, default="")
    # e.g. {"tags":["cctv"],"min_total_billed":10000,"customer_type":"business","city":"Delhi"}
    filter_rules = models.JSONField(default=dict)
    is_dynamic = models.BooleanField(default=True)

    class Meta:
        app_label = "crm"
        db_table = "customer_segments"

    def __str__(self) -> str:
        return self.name


class CustomerSegmentMember(BaseModel):
    segment = models.ForeignKey(
        CustomerSegment, on_delete=models.CASCADE, related_name="members"
    )
    customer = models.ForeignKey(Customer, on_delete=models.CASCADE, related_name="segment_memberships")
    added_at = models.DateTimeField(default=timezone.now)

    class Meta:
        app_label = "crm"
        db_table = "customer_segment_members"
        unique_together = [("segment", "customer")]


# ──────────────────────────────────────────────────────────────────────────────
# Campaign (bulk-WhatsApp history)
# ──────────────────────────────────────────────────────────────────────────────


class Campaign(SoftDeleteModel):
    """
    A tracked bulk-WhatsApp send to a segment. The send itself is fire-and-forget
    via the existing Celery task; this row is the durable history record.
    """

    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        SENDING = "sending", "Sending"
        SENT = "sent", "Sent"
        FAILED = "failed", "Failed"

    name = models.CharField(max_length=200)
    segment = models.ForeignKey(
        CustomerSegment, on_delete=models.PROTECT, related_name="campaigns"
    )
    template = models.CharField(max_length=100)
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.SENT)
    recipient_count = models.IntegerField(default=0)
    excluded_optout_count = models.IntegerField(default=0)
    sent_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT, related_name="created_campaigns"
    )

    class Meta:
        app_label = "crm"
        db_table = "campaigns"
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.name} → {self.segment_id} ({self.status})"


class Contact(SoftDeleteModel):
    """A contact person belonging to a customer (many per customer)."""

    shop = models.ForeignKey("core.Shop", on_delete=models.PROTECT, related_name="contacts")
    customer = models.ForeignKey("Customer", on_delete=models.CASCADE, related_name="contacts")
    name = models.CharField(max_length=200)
    designation = models.CharField(max_length=100, blank=True, default="")
    email = models.EmailField(null=True, blank=True)
    phone = models.CharField(max_length=20, blank=True, default="")
    notes = models.TextField(blank=True, default="")
    is_primary = models.BooleanField(default=False)

    class Meta:
        app_label = "crm"
        db_table = "contacts"
        indexes = [models.Index(fields=["customer", "is_primary"])]

    def __str__(self) -> str:
        return f"{self.name} ({self.customer_id})"


class Deal(SoftDeleteModel):
    """A sales opportunity moving through fixed pipeline stages."""

    class Stage(models.TextChoices):
        QUALIFICATION = "qualification", "Qualification"
        PROPOSAL = "proposal", "Proposal"
        NEGOTIATION = "negotiation", "Negotiation"
        WON = "won", "Won"
        LOST = "lost", "Lost"

    shop = models.ForeignKey("core.Shop", on_delete=models.PROTECT, related_name="deals")
    title = models.CharField(max_length=200)
    customer = models.ForeignKey("Customer", null=True, blank=True, on_delete=models.SET_NULL, related_name="deals")
    contact = models.ForeignKey("Contact", null=True, blank=True, on_delete=models.SET_NULL, related_name="deals")
    stage = models.CharField(max_length=20, choices=Stage.choices, default=Stage.QUALIFICATION, db_index=True)
    expected_revenue = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    probability = models.IntegerField(default=0)
    expected_close_date = models.DateField(null=True, blank=True)
    assigned_to = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True,
                                    on_delete=models.SET_NULL, related_name="assigned_deals")
    lost_reason = models.TextField(blank=True, default="")
    closed_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True,
                                   on_delete=models.SET_NULL, related_name="created_deals")

    OPEN_STAGES = ["qualification", "proposal", "negotiation"]

    class Meta:
        app_label = "crm"
        db_table = "deals"
        indexes = [models.Index(fields=["shop", "stage"]), models.Index(fields=["assigned_to"])]

    def __str__(self) -> str:
        return f"{self.title} [{self.stage}]"
