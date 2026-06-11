from rest_framework import serializers

from .models import SubscriptionPlan, Tenant, TenantDatabase, TenantSubscription


class SubscriptionPlanSerializer(serializers.ModelSerializer):
    class Meta:
        model = SubscriptionPlan
        fields = [
            "id", "name", "max_shops", "max_users", "max_products",
            "max_jobs_per_month", "features", "price_monthly_inr",
        ]


class TenantSubscriptionSerializer(serializers.ModelSerializer):
    plan = SubscriptionPlanSerializer(read_only=True)

    class Meta:
        model = TenantSubscription
        fields = [
            "id", "plan", "status",
            "current_period_start", "current_period_end",
        ]


class TenantListSerializer(serializers.ModelSerializer):
    class Meta:
        model = Tenant
        fields = [
            "id", "name", "slug", "status", "plan",
            "owner_email", "owner_phone", "created_at",
        ]


class TenantDetailSerializer(serializers.ModelSerializer):
    subscription = serializers.SerializerMethodField()
    db_status = serializers.SerializerMethodField()

    class Meta:
        model = Tenant
        fields = [
            "id", "name", "slug", "status", "plan",
            "owner_email", "owner_phone", "created_at", "updated_at",
            "subscription", "db_status",
        ]

    def get_subscription(self, obj):
        sub = obj.subscriptions.order_by("-created_at").first()
        return TenantSubscriptionSerializer(sub).data if sub else None

    def get_db_status(self, obj):
        from .models import Tenant as T
        if obj.status == T.Status.DELETED:
            return "deleted"
        try:
            db = obj.database
        except TenantDatabase.DoesNotExist:
            return "provisioning"
        return "active" if db.is_active else "suspended"


class RegisterTenantSerializer(serializers.Serializer):
    business_name = serializers.CharField(max_length=200)
    slug = serializers.RegexField(
        regex=r"^[a-z0-9_]{3,50}$",
        error_messages={"invalid": "Slug must be 3–50 lowercase letters, digits, or underscores."},
    )
    owner_name = serializers.CharField(max_length=200)
    phone = serializers.CharField(max_length=20)
    email = serializers.EmailField()
    password = serializers.CharField(min_length=8, write_only=True)
    plan_id = serializers.UUIDField()


class RegisterVerifySerializer(serializers.Serializer):
    slug = serializers.RegexField(
        regex=r"^[a-z0-9_]{3,50}$",
        error_messages={"invalid": "Invalid slug format."},
    )
    phone_otp = serializers.RegexField(
        regex=r"^[0-9]{6}$",
        error_messages={"invalid": "OTP must be exactly 6 digits."},
    )
    email_code = serializers.RegexField(
        regex=r"^[0-9]{6}$",
        error_messages={"invalid": "Email code must be exactly 6 digits."},
    )
