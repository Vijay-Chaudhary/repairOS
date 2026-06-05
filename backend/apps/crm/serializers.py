import re

from django.utils import timezone
from rest_framework import serializers

from core.models import Shop

from .models import (
    CommunicationLog,
    Customer,
    CustomerSegment,
    CustomerSegmentMember,
    FollowUpTask,
    Lead,
)

_PHONE_RE = re.compile(r"^\+[1-9]\d{6,14}$")


def _validate_e164(value: str) -> str:
    if not _PHONE_RE.match(value):
        raise serializers.ValidationError("Phone must be in E.164 format (+countrycodeXXXXXXXX).")
    return value


# ──────────────────────────────────────────────────────────────────────────────
# Lead
# ──────────────────────────────────────────────────────────────────────────────


class LeadSerializer(serializers.ModelSerializer):
    shop_id = serializers.PrimaryKeyRelatedField(source="shop", queryset=Shop.objects.all())
    assigned_to_name = serializers.CharField(source="assigned_to.full_name", read_only=True, default="")
    converted_customer_id = serializers.UUIDField(read_only=True, default=None)

    class Meta:
        model = Lead
        fields = [
            "id", "shop_id", "name", "phone", "email", "source", "status",
            "lost_reason", "device_type", "notes", "assigned_to", "assigned_to_name",
            "converted_customer_id", "converted_at", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "status", "converted_customer_id", "converted_at", "created_at", "updated_at"]

    def validate_phone(self, value):
        return _validate_e164(value)

    def validate(self, attrs):
        if attrs.get("status") == Lead.Status.LOST and not attrs.get("lost_reason"):
            raise serializers.ValidationError({"lost_reason": "Required when status is 'lost'."})
        return attrs


class LeadStatusSerializer(serializers.Serializer):
    to_status = serializers.ChoiceField(choices=Lead.Status.choices)
    reason = serializers.CharField(required=False, allow_blank=True, default="")


# ──────────────────────────────────────────────────────────────────────────────
# Customer
# ──────────────────────────────────────────────────────────────────────────────


class CustomerSerializer(serializers.ModelSerializer):
    shop_id = serializers.PrimaryKeyRelatedField(source="shop", queryset=Shop.objects.all())

    class Meta:
        model = Customer
        fields = [
            "id", "shop_id", "name", "phone", "alternate_phone", "email",
            "address", "city", "gstin", "customer_type", "credit_limit",
            "tags", "total_jobs", "total_billed", "total_outstanding",
            "whatsapp_optout", "source_lead", "created_at", "updated_at",
        ]
        read_only_fields = [
            "id", "total_jobs", "total_billed", "total_outstanding",
            "created_at", "updated_at",
        ]
        # DRF 3.15 auto-generates a UniqueValidator from the UniqueConstraint.
        # We disable it here and check uniqueness in the view (create/partial_update)
        # so we can return the spec-required DUPLICATE_PHONE error code.
        extra_kwargs = {"phone": {"validators": []}}

    def validate_phone(self, value):
        # Format validation only — uniqueness is enforced in the view's perform_create/update.
        return _validate_e164(value)

    def validate_gstin(self, value):
        if value and len(value) != 15:
            # Spec OQ-09: soft warning, not a hard block
            pass
        return value


class CustomerMergeSerializer(serializers.Serializer):
    source_id = serializers.UUIDField()
    target_id = serializers.UUIDField()

    def validate(self, attrs):
        if attrs["source_id"] == attrs["target_id"]:
            raise serializers.ValidationError("source_id and target_id must be different.")
        return attrs


# ──────────────────────────────────────────────────────────────────────────────
# Communication log
# ──────────────────────────────────────────────────────────────────────────────


class CommunicationLogSerializer(serializers.ModelSerializer):
    logged_by_name = serializers.CharField(source="logged_by.full_name", read_only=True)
    logged_at = serializers.DateTimeField(required=False, default=timezone.now)
    # Accept _id suffix variants that the frontend sends
    customer_id = serializers.UUIDField(write_only=True, required=False, allow_null=True)
    lead_id = serializers.UUIDField(write_only=True, required=False, allow_null=True)

    class Meta:
        model = CommunicationLog
        fields = [
            "id", "customer", "customer_id", "lead", "lead_id", "type", "direction",
            "summary", "duration_minutes", "logged_by", "logged_by_name", "logged_at",
            "created_at",
        ]
        read_only_fields = ["id", "customer", "lead", "logged_by", "created_at"]

    def validate(self, attrs):
        # Resolve _id fields to FK instances
        if attrs.get("customer_id"):
            attrs["customer"] = Customer.objects.get(pk=attrs.pop("customer_id"))
        else:
            attrs.pop("customer_id", None)

        if attrs.get("lead_id"):
            attrs["lead"] = Lead.objects.get(pk=attrs.pop("lead_id"))
        else:
            attrs.pop("lead_id", None)

        if not attrs.get("customer") and not attrs.get("lead"):
            raise serializers.ValidationError(
                "One of 'customer_id' or 'lead_id' must be provided."
            )
        return attrs

    def create(self, validated_data):
        validated_data["logged_by"] = self.context["request"].user
        return super().create(validated_data)


# ──────────────────────────────────────────────────────────────────────────────
# Follow-up task
# ──────────────────────────────────────────────────────────────────────────────


class FollowUpTaskSerializer(serializers.ModelSerializer):
    assigned_to_name = serializers.CharField(source="assigned_to.full_name", read_only=True)

    class Meta:
        model = FollowUpTask
        fields = [
            "id", "customer", "lead", "job_id", "title", "description",
            "due_date", "due_time", "status", "priority",
            "assigned_to", "assigned_to_name",
            "completed_at", "completed_by", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "completed_at", "completed_by", "created_at", "updated_at"]

    def validate_status(self, value):
        # Users may only set pending/completed/cancelled.
        # 'overdue' is set automatically by Celery.
        if value == FollowUpTask.Status.OVERDUE:
            raise serializers.ValidationError(
                "Cannot set status to 'overdue' directly; it is set automatically."
            )
        return value

    def validate_due_date(self, value):
        if self.instance is None and value < timezone.now().date():
            raise serializers.ValidationError("Due date cannot be in the past.")
        return value


class TaskCompleteSerializer(serializers.Serializer):
    notes = serializers.CharField(required=False, allow_blank=True, default="")


# ──────────────────────────────────────────────────────────────────────────────
# Customer segment
# ──────────────────────────────────────────────────────────────────────────────


class CustomerSegmentSerializer(serializers.ModelSerializer):
    class Meta:
        model = CustomerSegment
        fields = ["id", "name", "description", "filter_rules", "is_dynamic", "created_at", "updated_at"]
        read_only_fields = ["id", "created_at", "updated_at"]


class CustomerSegmentMemberSerializer(serializers.ModelSerializer):
    customer_name = serializers.CharField(source="customer.name", read_only=True)
    customer_phone = serializers.CharField(source="customer.phone", read_only=True)

    class Meta:
        model = CustomerSegmentMember
        fields = ["id", "customer", "customer_name", "customer_phone", "added_at"]
        read_only_fields = ["id", "added_at"]


class BulkWhatsAppSerializer(serializers.Serializer):
    template_name = serializers.CharField(max_length=100)
    variables = serializers.DictField(child=serializers.CharField(), required=False, default=dict)
