"""Accounts serializers."""

from rest_framework import serializers

from .models import Account


class AccountSerializer(serializers.ModelSerializer):
    parent_id = serializers.UUIDField(source="parent.id", read_only=True, allow_null=True)
    normal_balance = serializers.CharField(read_only=True)

    class Meta:
        model = Account
        fields = [
            "id", "code", "name", "account_type", "parent_id",
            "is_active", "is_system", "normal_balance",
        ]


class CreateAccountSerializer(serializers.Serializer):
    code = serializers.CharField(max_length=20)
    name = serializers.CharField(max_length=120)
    account_type = serializers.ChoiceField(choices=Account.AccountType.choices)
    parent_id = serializers.UUIDField(required=False, allow_null=True)
    shop_id = serializers.UUIDField(required=False)


class UpdateAccountSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=120, required=False)
    parent_id = serializers.UUIDField(required=False, allow_null=True)
    is_active = serializers.BooleanField(required=False)
