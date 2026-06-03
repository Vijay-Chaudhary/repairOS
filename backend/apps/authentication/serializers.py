import re

from django.conf import settings
from django.contrib.auth import authenticate
from django.utils import timezone
from rest_framework import serializers

from .models import AuditLog, User


# ──────────────────────────────────────────────────────────────────────────────
# Login
# ──────────────────────────────────────────────────────────────────────────────


class LoginSerializer(serializers.Serializer):
    email = serializers.EmailField()
    password = serializers.CharField(write_only=True)

    def validate(self, attrs):
        from core.exceptions import AccountLocked

        try:
            user = User.objects.get(email=attrs["email"].lower())
        except User.DoesNotExist:
            raise serializers.ValidationError({"email": ["No account found with this email."]})

        if user.is_locked:
            raise AccountLocked(user.locked_until)

        auth_user = authenticate(
            request=self.context.get("request"),
            email=attrs["email"].lower(),
            password=attrs["password"],
        )

        if auth_user is None:
            user.failed_login_attempts += 1
            max_attempts = settings.AUTH_MAX_FAILED_ATTEMPTS
            if user.failed_login_attempts >= max_attempts:
                user.locked_until = timezone.now() + timezone.timedelta(
                    minutes=settings.AUTH_LOCKOUT_DURATION_MINUTES
                )
                user.save(update_fields=["failed_login_attempts", "locked_until"])
                raise AccountLocked(user.locked_until)

            user.save(update_fields=["failed_login_attempts"])
            raise serializers.ValidationError({"non_field_errors": ["Invalid credentials."]})

        if not auth_user.is_active:
            raise serializers.ValidationError({"non_field_errors": ["This account has been deactivated."]})

        # Reset failed attempts on success
        if auth_user.failed_login_attempts > 0:
            auth_user.failed_login_attempts = 0
            auth_user.locked_until = None
            auth_user.save(update_fields=["failed_login_attempts", "locked_until"])

        attrs["user"] = auth_user
        return attrs


# ──────────────────────────────────────────────────────────────────────────────
# OTP
# ──────────────────────────────────────────────────────────────────────────────

_PHONE_REGEX = re.compile(r"^\+91[6-9]\d{9}$")


class OTPRequestSerializer(serializers.Serializer):
    phone = serializers.CharField(max_length=20)

    def validate_phone(self, value: str) -> str:
        if not _PHONE_REGEX.match(value):
            raise serializers.ValidationError("Phone must be in the format +91XXXXXXXXXX (Indian mobile).")
        return value


class OTPVerifySerializer(serializers.Serializer):
    phone = serializers.CharField(max_length=20)
    otp = serializers.CharField(min_length=6, max_length=6)

    def validate_phone(self, value: str) -> str:
        if not _PHONE_REGEX.match(value):
            raise serializers.ValidationError("Phone must be in the format +91XXXXXXXXXX.")
        return value


# ──────────────────────────────────────────────────────────────────────────────
# Password
# ──────────────────────────────────────────────────────────────────────────────


class PasswordChangeSerializer(serializers.Serializer):
    old_password = serializers.CharField(write_only=True)
    new_password = serializers.CharField(write_only=True, min_length=8)

    _PASSWORD_POLICY = re.compile(r'^(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*()_+\-=\[\]{};\':"\\|,.<>\/?]).{8,}$')

    def validate_new_password(self, value: str) -> str:
        if not self._PASSWORD_POLICY.match(value):
            raise serializers.ValidationError(
                "Password must be at least 8 characters and include at least one uppercase letter, "
                "one number, and one special character."
            )
        return value

    def validate(self, attrs):
        user = self.context["request"].user
        if not user.check_password(attrs["old_password"]):
            raise serializers.ValidationError({"old_password": ["Current password is incorrect."]})
        return attrs


# ──────────────────────────────────────────────────────────────────────────────
# User detail
# ──────────────────────────────────────────────────────────────────────────────


class UserSerializer(serializers.ModelSerializer):
    class Meta:
        model = User
        fields = ["id", "email", "phone", "full_name", "avatar_url", "is_active", "created_at"]
        read_only_fields = ["id", "email", "created_at"]
