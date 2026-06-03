import re
import uuid

from cryptography.fernet import Fernet
from django.conf import settings
from django.core.validators import RegexValidator
from django.db import models


slug_validator = RegexValidator(
    regex=r"^[a-z0-9_]{3,50}$",
    message="Slug must be 3–50 lowercase alphanumeric characters or underscores.",
)


class Tenant(models.Model):
    class Status(models.TextChoices):
        PROVISIONING = "provisioning", "Provisioning"
        ACTIVE = "active", "Active"
        SUSPENDED = "suspended", "Suspended"
        PROVISIONING_FAILED = "provisioning_failed", "Provisioning Failed"
        DELETED = "deleted", "Deleted"

    class Plan(models.TextChoices):
        STARTER = "starter", "Starter"
        PROFESSIONAL = "professional", "Professional"
        ENTERPRISE = "enterprise", "Enterprise"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=200)
    slug = models.CharField(max_length=50, unique=True, validators=[slug_validator])
    status = models.CharField(max_length=25, choices=Status.choices, default=Status.PROVISIONING)
    plan = models.CharField(max_length=20, choices=Plan.choices, default=Plan.STARTER)
    owner_email = models.EmailField()
    owner_phone = models.CharField(max_length=20)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        app_label = "master"
        db_table = "tenants"

    def __str__(self) -> str:
        return f"{self.name} ({self.slug})"

    @property
    def db_name(self) -> str:
        return f"repaiross_tenant_{self.slug}"

    @property
    def db_user(self) -> str:
        return f"repaiross_{self.slug}_user"


class TenantDatabase(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tenant = models.OneToOneField(Tenant, on_delete=models.CASCADE, related_name="database")
    db_name = models.CharField(max_length=100)
    db_host = models.CharField(max_length=200)
    db_port = models.IntegerField(default=5432)
    db_user = models.CharField(max_length=100)
    db_password_encrypted = models.TextField()
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        app_label = "master"
        db_table = "tenant_databases"

    def encrypt_password(self, plaintext: str) -> None:
        key = settings.TENANT_CRED_ENCRYPTION_KEY.encode()
        self.db_password_encrypted = Fernet(key).encrypt(plaintext.encode()).decode()

    def decrypt_password(self) -> str:
        key = settings.TENANT_CRED_ENCRYPTION_KEY.encode()
        return Fernet(key).decrypt(self.db_password_encrypted.encode()).decode()

    def __str__(self) -> str:
        return f"{self.db_name}@{self.db_host}"


class SubscriptionPlan(models.Model):
    """
    Product catalogue for the SaaS offering.
    features JSONB drives per-tenant capability flags read by the app layer.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=100, unique=True)
    max_shops = models.IntegerField(null=True, blank=True)
    max_users = models.IntegerField(null=True, blank=True)
    max_products = models.IntegerField(null=True, blank=True)
    max_jobs_per_month = models.IntegerField(null=True, blank=True)
    features = models.JSONField(default=dict)
    price_monthly_inr = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        app_label = "master"
        db_table = "subscription_plans"

    def __str__(self) -> str:
        return f"{self.name} (₹{self.price_monthly_inr}/mo)"


class TenantSubscription(models.Model):
    class Status(models.TextChoices):
        ACTIVE = "active", "Active"
        TRIALING = "trialing", "Trialing"
        PAST_DUE = "past_due", "Past Due"
        CANCELLED = "cancelled", "Cancelled"
        PAUSED = "paused", "Paused"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    tenant = models.ForeignKey(Tenant, on_delete=models.CASCADE, related_name="subscriptions")
    plan = models.ForeignKey(SubscriptionPlan, on_delete=models.PROTECT, related_name="subscriptions")
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.TRIALING)
    current_period_start = models.DateField()
    current_period_end = models.DateField()
    razorpay_subscription_id = models.CharField(max_length=100, null=True, blank=True, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        app_label = "master"
        db_table = "tenant_subscriptions"

    def __str__(self) -> str:
        return f"{self.tenant.slug} — {self.plan.name} ({self.status})"


class AuditLogMaster(models.Model):
    """Platform-level audit log — lives in the master DB only."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    event_type = models.CharField(max_length=100, db_index=True)
    tenant = models.ForeignKey(
        Tenant, null=True, blank=True, on_delete=models.SET_NULL, related_name="audit_logs"
    )
    actor_email = models.CharField(max_length=254, blank=True, default="")
    payload = models.JSONField(default=dict)
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        app_label = "master"
        db_table = "audit_log_master"
        ordering = ["-created_at"]

    def __str__(self) -> str:
        return f"{self.event_type} @ {self.created_at:%Y-%m-%d %H:%M}"
