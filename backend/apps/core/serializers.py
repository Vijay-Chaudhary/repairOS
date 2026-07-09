from rest_framework import serializers

from .models import Notification


class NotificationSerializer(serializers.ModelSerializer):
    class Meta:
        model = Notification
        fields = ["id", "type", "title", "body", "route", "read_at", "created_at"]


class ShopCreateSerializer(serializers.Serializer):
    """POST /shops/ payload — full shop details, unlike the minimal registration form."""

    name = serializers.CharField(max_length=200)
    code = serializers.CharField(max_length=10, required=False, allow_blank=True)
    address = serializers.CharField()
    city = serializers.CharField(max_length=100)
    state = serializers.CharField(max_length=100)
    state_code = serializers.RegexField(
        regex=r"^[0-9]{2}$",
        error_messages={"invalid": "State code must be exactly 2 digits."},
    )
    phone = serializers.CharField(max_length=20)
