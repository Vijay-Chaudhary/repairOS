from rest_framework import serializers

from core.models import Shop

from .models import AMCContract, AMCRenewalInvoice, AMCVisit


# ──────────────────────────────────────────────────────────────────────────────
# Visit
# ──────────────────────────────────────────────────────────────────────────────


class AMCVisitSerializer(serializers.ModelSerializer):
    contract_id = serializers.UUIDField(read_only=True)
    technician_id = serializers.UUIDField(read_only=True, allow_null=True)
    technician_name = serializers.CharField(
        source="technician.full_name", read_only=True, default=""
    )

    class Meta:
        model = AMCVisit
        fields = [
            "id", "contract_id", "visit_number", "scheduled_date", "actual_date",
            "status", "technician_id", "technician_name",
            "work_done", "issues_found", "next_visit_date",
            "customer_signature_url", "photos", "job_id",
            "created_at",
        ]
        read_only_fields = [
            "id", "contract_id", "visit_number", "actual_date", "status",
            "next_visit_date", "created_at",
        ]


class CompleteVisitSerializer(serializers.Serializer):
    work_done = serializers.CharField(min_length=5)
    issues_found = serializers.CharField(required=False, allow_blank=True, default="")
    customer_signature_url = serializers.CharField(
        max_length=500, required=False, allow_blank=True, default=""
    )
    photos = serializers.ListField(
        child=serializers.CharField(), required=False, default=list
    )
    job_id = serializers.UUIDField(required=False, allow_null=True)


class RescheduleVisitSerializer(serializers.Serializer):
    new_date = serializers.DateField()
    reason = serializers.CharField(required=False, allow_blank=True, default="")


class RenewContractSerializer(serializers.Serializer):
    new_end_date = serializers.DateField(required=False, allow_null=True)
    new_value = serializers.DecimalField(
        max_digits=12, decimal_places=2, required=False, allow_null=True
    )


# ──────────────────────────────────────────────────────────────────────────────
# Contract
# ──────────────────────────────────────────────────────────────────────────────


class AMCRenewalInvoiceSerializer(serializers.ModelSerializer):
    class Meta:
        model = AMCRenewalInvoice
        fields = ["id", "invoice_id", "renewal_period_start", "renewal_period_end", "sent_at"]


class AMCContractSerializer(serializers.ModelSerializer):
    shop_id = serializers.PrimaryKeyRelatedField(source="shop", queryset=Shop.objects.all())
    customer_id = serializers.PrimaryKeyRelatedField(
        source="customer",
        queryset=__import__("crm.models", fromlist=["Customer"]).Customer.objects.all(),
    )
    customer_name = serializers.CharField(source="customer.name", read_only=True)
    assigned_technician_id = serializers.PrimaryKeyRelatedField(
        source="assigned_technician",
        queryset=__import__("authentication.models", fromlist=["User"]).User.objects.all(),
        required=False,
        allow_null=True,
    )
    assigned_technician_name = serializers.CharField(
        source="assigned_technician.full_name", read_only=True, default="", allow_null=True
    )
    visits_count = serializers.IntegerField(source="visits.count", read_only=True)
    renewal_invoices = AMCRenewalInvoiceSerializer(many=True, read_only=True)

    class Meta:
        model = AMCContract
        fields = [
            "id", "shop_id", "customer_id", "customer_name",
            "contract_number", "title", "description", "status",
            "start_date", "end_date", "value", "payment_terms",
            "visits_per_year", "visit_interval_days",
            "auto_renew", "renewal_reminder_days",
            "location_address", "location_lat", "location_lng",
            "assigned_technician_id", "assigned_technician_name", "notes",
            "visits_count", "renewal_invoices",
            "created_at", "updated_at",
        ]
        read_only_fields = [
            "id", "contract_number", "visit_interval_days",
            "visits_count", "renewal_invoices",
            "created_at", "updated_at",
        ]
        # DRF 3.15 would auto-generate UniqueValidator from the unique contract_number field.
        # We suppress it since the number is auto-assigned by the service.
        extra_kwargs = {"contract_number": {"validators": []}}

    def validate(self, attrs):
        start = attrs.get("start_date")
        end = attrs.get("end_date")
        if start and end and end <= start:
            raise serializers.ValidationError(
                {"end_date": "end_date must be after start_date."}
            )
        return attrs


class AMCContractListSerializer(serializers.ModelSerializer):
    customer_name = serializers.CharField(source="customer.name", read_only=True)
    # next_visit_date is injected as a queryset annotation in AMCContractViewSet.get_queryset
    next_visit_date = serializers.DateField(read_only=True, allow_null=True)

    class Meta:
        model = AMCContract
        fields = [
            "id", "contract_number", "title", "status",
            "customer_name", "start_date", "end_date", "value",
            "visits_per_year", "next_visit_date",
        ]
