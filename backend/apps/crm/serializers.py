import re

from django.utils import timezone
from rest_framework import serializers

from core.models import Shop

from .models import (
    Campaign,
    CommunicationLog,
    Contact,
    Customer,
    CustomerSegment,
    CustomerSegmentMember,
    FollowUpTask,
    Lead,
    LeadQuote,
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
            "lost_reason", "status_before_lost", "device_type", "notes",
            "assigned_to", "assigned_to_name",
            "converted_customer_id", "converted_at", "created_at", "updated_at",
        ]
        read_only_fields = [
            "id", "status", "status_before_lost",
            "converted_customer_id", "converted_at", "created_at", "updated_at",
        ]

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
    source_lead_id = serializers.UUIDField(read_only=True, allow_null=True)

    class Meta:
        model = Customer
        fields = [
            "id", "shop_id", "name", "phone", "alternate_phone", "email",
            "address", "city", "gstin", "customer_type", "credit_limit",
            "tags", "total_jobs", "total_billed", "total_outstanding", "last_visit",
            "whatsapp_optout", "source_lead_id", "created_at", "updated_at",
        ]
        read_only_fields = [
            "id", "total_jobs", "total_billed", "total_outstanding", "last_visit",
            "created_at", "updated_at",
        ]
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
    # EntityTimeline aliases: `description` maps to `summary`, `actor` maps to actor name
    description = serializers.CharField(source="summary", read_only=True)
    actor = serializers.CharField(source="logged_by.full_name", read_only=True, default="")
    # Activity feed: display names so rows can deep-link to the related customer/lead
    customer_name = serializers.CharField(source="customer.name", read_only=True, default=None)
    lead_name = serializers.CharField(source="lead.name", read_only=True, default=None)

    class Meta:
        model = CommunicationLog
        fields = [
            "id", "customer", "customer_id", "customer_name",
            "lead", "lead_id", "lead_name", "type", "direction",
            "summary", "description", "duration_minutes",
            "logged_by", "logged_by_name", "actor", "logged_at",
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
# Lead quote
# ──────────────────────────────────────────────────────────────────────────────


class QuoteItemSerializer(serializers.Serializer):
    description = serializers.CharField()
    amount = serializers.DecimalField(max_digits=12, decimal_places=2)


class LeadQuoteSerializer(serializers.ModelSerializer):
    items = QuoteItemSerializer(many=True)
    sent_by_name = serializers.CharField(source="sent_by.full_name", read_only=True)
    # Cross-lead worklist: lead identity so rows can show + deep-link the lead.
    lead_id = serializers.UUIDField(source="lead.id", read_only=True)
    lead_name = serializers.CharField(source="lead.name", read_only=True)
    lead_status = serializers.CharField(source="lead.status", read_only=True)

    class Meta:
        model = LeadQuote
        fields = [
            "id", "quote_number", "lead_id", "lead_name", "lead_status",
            "items", "total_amount", "valid_until",
            "notes", "sent_via_whatsapp", "sent_by", "sent_by_name", "created_at",
        ]
        read_only_fields = ["id", "quote_number", "sent_via_whatsapp", "sent_by", "created_at"]


class SendQuoteSerializer(serializers.Serializer):
    """Input-only serializer for the send_quote action."""
    items = QuoteItemSerializer(many=True)
    valid_until = serializers.DateField()
    notes = serializers.CharField(required=False, allow_blank=True, default="")

    def validate_items(self, value):
        if not value:
            raise serializers.ValidationError("At least one line item is required.")
        return value

    def validate(self, attrs):
        total = sum(item["amount"] for item in attrs["items"])
        attrs["total_amount"] = total
        return attrs


# ──────────────────────────────────────────────────────────────────────────────
# Follow-up task
# ──────────────────────────────────────────────────────────────────────────────


class FollowUpTaskSerializer(serializers.ModelSerializer):
    assigned_to_name = serializers.CharField(source="assigned_to.full_name", read_only=True)
    customer_id = serializers.UUIDField(read_only=True, allow_null=True)
    lead_id = serializers.UUIDField(read_only=True, allow_null=True)

    class Meta:
        model = FollowUpTask
        fields = [
            "id", "customer", "lead", "customer_id", "lead_id", "job_id", "title", "description",
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
    member_count = serializers.SerializerMethodField()

    class Meta:
        model = CustomerSegment
        fields = ["id", "name", "description", "filter_rules", "is_dynamic", "member_count", "created_at", "updated_at"]
        read_only_fields = ["id", "created_at", "updated_at"]

    def get_member_count(self, obj):
        if obj.is_dynamic:
            return None  # expensive to compute inline; clients should call /members/
        return obj.members.count()


class CustomerSegmentMemberSerializer(serializers.ModelSerializer):
    customer_id = serializers.UUIDField(source="customer_id", read_only=True)
    customer_name = serializers.CharField(source="customer.name", read_only=True)
    customer_phone = serializers.CharField(source="customer.phone", read_only=True)

    class Meta:
        model = CustomerSegmentMember
        fields = ["id", "customer_id", "customer_name", "customer_phone", "added_at"]
        read_only_fields = ["id", "added_at"]


class BulkWhatsAppSerializer(serializers.Serializer):
    template_name = serializers.CharField(max_length=100)
    variables = serializers.DictField(child=serializers.CharField(), required=False, default=dict)


# ──────────────────────────────────────────────────────────────────────────────
# Campaign
# ──────────────────────────────────────────────────────────────────────────────


class CampaignSerializer(serializers.ModelSerializer):
    segment_name = serializers.CharField(source="segment.name", read_only=True)
    created_by_name = serializers.CharField(source="created_by.full_name", read_only=True, default="")

    class Meta:
        model = Campaign
        fields = [
            "id", "name", "segment", "segment_name", "template", "status",
            "recipient_count", "excluded_optout_count", "sent_at",
            "created_by", "created_by_name", "created_at",
        ]
        read_only_fields = fields


class CampaignCreateSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=200)
    segment_id = serializers.UUIDField()
    template = serializers.CharField(max_length=100)
    variables = serializers.DictField(child=serializers.CharField(), required=False, default=dict)


class CrmOverviewKpisSerializer(serializers.Serializer):
    new_leads = serializers.IntegerField()
    tasks_due_today = serializers.IntegerField()
    tasks_overdue = serializers.IntegerField()
    conversions_30d = serializers.IntegerField()
    new_customers_30d = serializers.IntegerField()


class CrmPipelineCountSerializer(serializers.Serializer):
    status = serializers.CharField()
    count = serializers.IntegerField()


class CrmOverdueTaskSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    title = serializers.CharField()
    due_date = serializers.DateField()
    assigned_to_name = serializers.CharField(allow_null=True)
    customer_name = serializers.CharField(allow_null=True, default=None)


class CrmUnassignedLeadSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    name = serializers.CharField()
    phone = serializers.CharField()
    source = serializers.CharField()
    created_at = serializers.DateTimeField()


class CrmOverviewSerializer(serializers.Serializer):
    kpis = CrmOverviewKpisSerializer()
    pipeline = CrmPipelineCountSerializer(many=True)
    overdue_tasks = CrmOverdueTaskSerializer(many=True)
    unassigned_leads = CrmUnassignedLeadSerializer(many=True)


class ContactSerializer(serializers.ModelSerializer):
    customer_id = serializers.PrimaryKeyRelatedField(source="customer", queryset=Customer.objects.all())
    customer_name = serializers.CharField(source="customer.name", read_only=True)

    class Meta:
        model = Contact
        fields = ["id", "customer_id", "customer_name", "name", "designation",
                  "email", "phone", "notes", "is_primary", "created_at"]
        read_only_fields = ["id", "created_at"]
