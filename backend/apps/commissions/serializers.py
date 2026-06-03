from rest_framework import serializers

from .models import CommissionPayout, CommissionRule, TechnicianCommission


class CommissionRuleSerializer(serializers.ModelSerializer):
    class Meta:
        model = CommissionRule
        fields = [
            "id", "name", "rate", "lead_tech_share",
            "applies_to_job_type", "effective_from", "effective_to",
        ]


class TechnicianCommissionSerializer(serializers.ModelSerializer):
    job_number = serializers.CharField(source="job.job_number", read_only=True)

    class Meta:
        model = TechnicianCommission
        fields = [
            "id", "job_number", "sc_amount", "rate", "commission_amount",
            "is_lead", "is_paid", "payout_id",
        ]


class CommissionPayoutSerializer(serializers.ModelSerializer):
    class Meta:
        model = CommissionPayout
        fields = [
            "id", "technician", "period_start", "period_end",
            "total_commission", "status", "paid_at", "pdf_url",
        ]


class CreatePayoutSerializer(serializers.Serializer):
    technician_id = serializers.UUIDField()
    period_start = serializers.DateField()
    period_end = serializers.DateField()

    def validate(self, data):
        if data["period_end"] < data["period_start"]:
            raise serializers.ValidationError("period_end must be >= period_start.")
        return data
