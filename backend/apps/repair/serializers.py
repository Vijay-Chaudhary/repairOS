from decimal import Decimal

from django.conf import settings
from rest_framework import serializers

from core.models import Shop

from .models import (
    FaultTemplate,
    FaultTemplatePart,
    JobCheckinCondition,
    JobEstimate,
    JobSparePartRequest,
    JobStage,
    JobTicket,
)


# ──────────────────────────────────────────────────────────────────────────────
# Fault templates
# ──────────────────────────────────────────────────────────────────────────────


class FaultTemplatePartSerializer(serializers.ModelSerializer):
    class Meta:
        model = FaultTemplatePart
        fields = ["id", "variant_id", "custom_part_name", "quantity"]

    def validate(self, attrs):
        if not attrs.get("variant_id") and not attrs.get("custom_part_name"):
            raise serializers.ValidationError("Provide either variant_id or custom_part_name.")
        return attrs


class FaultTemplateSerializer(serializers.ModelSerializer):
    shop_id = serializers.PrimaryKeyRelatedField(source="shop", queryset=Shop.objects.all())
    parts = FaultTemplatePartSerializer(many=True, required=False, default=list)

    class Meta:
        model = FaultTemplate
        fields = [
            "id", "shop_id", "name", "device_type", "device_brand",
            "problem_description", "default_sc", "estimated_duration_hours",
            "is_active", "parts", "created_at",
        ]
        read_only_fields = ["id", "created_at"]


# ──────────────────────────────────────────────────────────────────────────────
# Job ticket
# ──────────────────────────────────────────────────────────────────────────────


class JobTicketListSerializer(serializers.ModelSerializer):
    customer_id = serializers.UUIDField(read_only=True)
    customer_name = serializers.CharField(source="customer.name", read_only=True)
    customer_phone = serializers.CharField(source="customer.phone", read_only=True, default="")
    shop_id = serializers.UUIDField(read_only=True)
    assigned_technician_name = serializers.SerializerMethodField()

    class Meta:
        model = JobTicket
        fields = [
            "id", "job_number", "customer_id", "customer_name", "customer_phone",
            "device_type", "device_brand", "device_model", "status", "priority",
            "service_charge", "advance_paid", "intake_date", "expected_delivery_date",
            "assigned_technician_name", "shop_id",
        ]

    def get_assigned_technician_name(self, obj) -> str | None:
        stage = obj.stages.filter(status="in_progress").first()
        if stage is None:
            stage = obj.stages.order_by("stage_order").first()
        if stage and stage.assigned_technician:
            return stage.assigned_technician.full_name
        return None


class JobTicketSerializer(serializers.ModelSerializer):
    shop_id = serializers.PrimaryKeyRelatedField(source="shop", queryset=Shop.objects.all())
    customer_id = serializers.PrimaryKeyRelatedField(
        source="customer",
        queryset=__import__("crm.models", fromlist=["Customer"]).Customer.objects.all(),
    )
    template_id = serializers.PrimaryKeyRelatedField(
        source="template",
        queryset=FaultTemplate.objects.filter(is_active=True),
        required=False,
        allow_null=True,
        default=None,
    )
    customer_name = serializers.CharField(source="customer.name", read_only=True)

    class Meta:
        model = JobTicket
        fields = [
            "id", "shop_id", "customer_id", "customer_name", "template_id",
            "job_number", "status", "priority",
            "device_type", "device_brand", "device_model", "serial_number", "imei",
            "problem_description", "is_field_job",
            "location_lat", "location_lng", "location_address",
            "intake_date", "expected_delivery_date",
            "service_charge", "advance_paid", "notes",
            "warranty_of_job", "warranty_days", "warranty_expires_at",
            "created_at", "updated_at",
        ]
        read_only_fields = [
            "id", "job_number", "status", "warranty_days", "warranty_expires_at",
            "created_at", "updated_at",
        ]

    def validate_problem_description(self, value: str) -> str:
        if len(value.strip()) < 10:
            raise serializers.ValidationError("Problem description must be at least 10 characters.")
        return value

    def validate(self, attrs):
        if attrs.get("is_field_job"):
            if not attrs.get("location_lat") or not attrs.get("location_lng"):
                raise serializers.ValidationError(
                    "location_lat and location_lng are required for field jobs."
                )
        return attrs


class JobTicketDetailSerializer(JobTicketSerializer):
    """Full detail response — includes nested checkin, estimates, stages, spare parts."""
    checkin = serializers.SerializerMethodField()
    estimates = serializers.SerializerMethodField()
    stages = serializers.SerializerMethodField()
    spare_part_requests = serializers.SerializerMethodField()
    allowed_transitions = serializers.SerializerMethodField()

    class Meta(JobTicketSerializer.Meta):
        fields = JobTicketSerializer.Meta.fields + [
            "checkin", "estimates", "stages", "spare_part_requests", "allowed_transitions"
        ]

    def get_checkin(self, obj):
        try:
            return JobCheckinConditionSerializer(obj.checkin).data
        except JobCheckinCondition.DoesNotExist:
            return None

    def get_estimates(self, obj):
        return JobEstimateSerializer(obj.estimates.all(), many=True).data

    def get_stages(self, obj):
        return JobStageSerializer(obj.stages.order_by("stage_order"), many=True).data

    def get_spare_part_requests(self, obj):
        return JobSparePartRequestSerializer(obj.spare_part_requests.all(), many=True).data

    def get_allowed_transitions(self, obj):
        from repair.services import VALID_TRANSITIONS
        return sorted(VALID_TRANSITIONS.get(obj.status, set()))


# ──────────────────────────────────────────────────────────────────────────────
# Status transition
# ──────────────────────────────────────────────────────────────────────────────


class JobStatusSerializer(serializers.Serializer):
    to_status = serializers.ChoiceField(choices=JobTicket.Status.choices)
    reason = serializers.CharField(required=False, allow_blank=True, default="")


# ──────────────────────────────────────────────────────────────────────────────
# Check-in
# ──────────────────────────────────────────────────────────────────────────────


class JobCheckinConditionSerializer(serializers.ModelSerializer):
    # Model field is a non-nullable CharField (default ""); the frontend submits
    # `null` when no signature was captured, so accept null and normalize to "".
    customer_signature_url = serializers.CharField(required=False, allow_blank=True, allow_null=True)

    class Meta:
        model = JobCheckinCondition
        fields = [
            "id", "physical_condition",
            "has_scratches", "has_cracks", "has_liquid_damage", "has_missing_parts",
            "accessory_received", "customer_description", "technician_notes",
            "photos", "customer_signature_url", "acknowledged_at",
        ]
        read_only_fields = ["id", "acknowledged_at"]

    def validate_customer_signature_url(self, value):
        return value or ""


# ──────────────────────────────────────────────────────────────────────────────
# Estimates
# ──────────────────────────────────────────────────────────────────────────────


class JobEstimateSerializer(serializers.ModelSerializer):
    class Meta:
        model = JobEstimate
        fields = [
            "id", "estimate_number", "labor_charge", "parts_cost", "total_estimate",
            "valid_until", "notes", "status", "sent_at",
            "customer_response_at", "customer_response_method",
        ]
        read_only_fields = [
            "id", "estimate_number", "total_estimate", "status",
            "sent_at", "customer_response_at",
        ]


class CreateEstimateSerializer(serializers.Serializer):
    labor_charge = serializers.DecimalField(max_digits=10, decimal_places=2)
    parts_cost = serializers.DecimalField(max_digits=10, decimal_places=2, default=0)
    valid_until = serializers.DateField(required=False, allow_null=True)
    notes = serializers.CharField(required=False, allow_blank=True, default="")
    send_via = serializers.ChoiceField(
        choices=["whatsapp", "sms", "email"], required=False, allow_null=True, allow_blank=True
    )


class EstimateResponseSerializer(serializers.Serializer):
    response = serializers.ChoiceField(choices=["approved", "rejected"])
    method = serializers.ChoiceField(choices=JobEstimate.ResponseMethod.choices)


# ──────────────────────────────────────────────────────────────────────────────
# Stages
# ──────────────────────────────────────────────────────────────────────────────


class JobStageSerializer(serializers.ModelSerializer):
    assigned_technician_id = serializers.UUIDField(read_only=True)
    assigned_technician_name = serializers.CharField(
        source="assigned_technician.full_name", read_only=True, default=""
    )

    class Meta:
        model = JobStage
        fields = [
            "id", "stage_order", "stage_type",
            "assigned_technician_id", "assigned_technician_name",
            "status", "started_at", "completed_at", "notes",
        ]
        read_only_fields = ["id", "status", "started_at", "completed_at"]


class StageDefinitionSerializer(serializers.Serializer):
    stage_order = serializers.IntegerField(min_value=1)
    stage_type = serializers.ChoiceField(choices=JobStage.StageType.choices)
    assigned_technician_id = serializers.UUIDField()


class SetStagesSerializer(serializers.Serializer):
    stages = StageDefinitionSerializer(many=True)

    def validate_stages(self, value):
        orders = [s["stage_order"] for s in value]
        if len(orders) != len(set(orders)):
            raise serializers.ValidationError("stage_order values must be unique.")
        return value


class AdvanceStageSerializer(serializers.Serializer):
    stage_id = serializers.UUIDField()
    action = serializers.ChoiceField(choices=["complete", "skip"])
    notes = serializers.CharField(required=False, allow_blank=True, default="")


# ──────────────────────────────────────────────────────────────────────────────
# Spare-part requests
# ──────────────────────────────────────────────────────────────────────────────


class JobSparePartRequestSerializer(serializers.ModelSerializer):
    requested_by_name = serializers.CharField(source="requested_by.full_name", read_only=True)

    class Meta:
        model = JobSparePartRequest
        fields = [
            "id", "variant_id", "custom_part_name", "quantity",
            "is_urgent", "status", "requested_by", "requested_by_name",
            "reviewed_by", "po_id", "created_at",
        ]
        read_only_fields = ["id", "status", "requested_by", "reviewed_by", "po_id", "created_at"]

    def validate(self, attrs):
        if not attrs.get("variant_id") and not attrs.get("custom_part_name"):
            raise serializers.ValidationError("Provide either variant_id or custom_part_name.")
        return attrs


class ReviewSparePartSerializer(serializers.Serializer):
    status = serializers.ChoiceField(
        choices=["approved", "rejected", "ordered", "received"]
    )
    po_id = serializers.UUIDField(required=False, allow_null=True)
