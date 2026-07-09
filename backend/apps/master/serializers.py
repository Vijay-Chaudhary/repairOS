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
    db_status = serializers.SerializerMethodField()
    plan_id = serializers.SerializerMethodField()
    plan_name = serializers.SerializerMethodField()
    subscription_status = serializers.SerializerMethodField()
    is_active = serializers.SerializerMethodField()
    trial_ends_at = serializers.SerializerMethodField()

    class Meta:
        model = Tenant
        fields = [
            "id", "name", "slug",
            "db_status", "plan_id", "plan_name",
            "subscription_status", "is_active", "trial_ends_at",
            "owner_email", "owner_phone", "created_at",
        ]

    def _latest_sub(self, obj):
        # Subscriptions prefetched by the view as `_prefetched_subscriptions`
        subs = getattr(obj, "_prefetched_subscriptions", None)
        if subs is not None:
            return subs[0] if subs else None
        return obj.subscriptions.select_related("plan").order_by("-created_at").first()

    def get_db_status(self, obj) -> str:
        if obj.status == Tenant.Status.DELETED:
            return "deleted"
        try:
            db = obj.database
        except TenantDatabase.DoesNotExist:
            return "provisioning"
        return "active" if db.is_active else "suspended"

    def get_plan_id(self, obj) -> str | None:
        sub = self._latest_sub(obj)
        return str(sub.plan_id) if sub else None

    def get_plan_name(self, obj) -> str:
        sub = self._latest_sub(obj)
        if sub:
            return sub.plan.name
        return obj.get_plan_display()

    def get_subscription_status(self, obj) -> str | None:
        sub = self._latest_sub(obj)
        return sub.status if sub else None

    def get_is_active(self, obj) -> bool:
        return obj.status == Tenant.Status.ACTIVE

    def get_trial_ends_at(self, obj) -> str | None:
        sub = self._latest_sub(obj)
        if sub and sub.status == TenantSubscription.Status.TRIALING:
            return sub.current_period_end.isoformat()
        return None


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
    shop_name = serializers.CharField(max_length=200, required=False, allow_blank=True)
    slug = serializers.RegexField(
        regex=r"^[a-z0-9_]{3,50}$",
        error_messages={"invalid": "Slug must be 3–50 lowercase letters, digits, or underscores."},
    )
    owner_name = serializers.CharField(max_length=200)
    phone = serializers.CharField(max_length=20)
    email = serializers.EmailField()
    password = serializers.CharField(min_length=8, write_only=True)
    plan_id = serializers.UUIDField(required=False, allow_null=True)


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


class PlatformAdminLoginSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True)

    def validate(self, attrs):
        from django.conf import settings
        from django.utils import timezone

        from core.exceptions import AccountLocked

        from .models import PlatformAdminUser

        # Deliberately generic errors (no "no account found" distinction) — these
        # are superuser accounts, so we don't want to help enumerate valid emails.
        generic_error = serializers.ValidationError({"non_field_errors": ["Invalid credentials."]})

        try:
            admin = PlatformAdminUser.objects.using("default").get(email=attrs["email"].lower())
        except PlatformAdminUser.DoesNotExist:
            raise generic_error

        if admin.is_locked:
            raise AccountLocked(admin.locked_until)

        if not admin.check_password(attrs["password"]):
            admin.failed_login_attempts += 1
            max_attempts = settings.AUTH_MAX_FAILED_ATTEMPTS
            if admin.failed_login_attempts >= max_attempts:
                admin.locked_until = timezone.now() + timezone.timedelta(
                    minutes=settings.AUTH_LOCKOUT_DURATION_MINUTES
                )
                admin.save(using="default", update_fields=["failed_login_attempts", "locked_until"])
                raise AccountLocked(admin.locked_until)
            admin.save(using="default", update_fields=["failed_login_attempts"])
            raise generic_error

        if not admin.is_active:
            raise serializers.ValidationError({"non_field_errors": ["This account has been deactivated."]})

        if admin.failed_login_attempts > 0:
            admin.failed_login_attempts = 0
            admin.locked_until = None
            admin.save(using="default", update_fields=["failed_login_attempts", "locked_until"])

        attrs["admin"] = admin
        return attrs
