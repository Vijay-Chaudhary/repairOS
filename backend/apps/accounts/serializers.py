"""Accounts serializers."""

from rest_framework import serializers

from .models import Account, JournalEntry, JournalLine


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


class JournalLineSerializer(serializers.ModelSerializer):
    account_id = serializers.UUIDField(source="account.id", read_only=True)
    account_code = serializers.CharField(source="account.code", read_only=True)
    account_name = serializers.CharField(source="account.name", read_only=True)

    class Meta:
        model = JournalLine
        fields = ["id", "account_id", "account_code", "account_name", "debit", "credit", "line_narration"]


class JournalEntrySerializer(serializers.ModelSerializer):
    lines = JournalLineSerializer(many=True, read_only=True)

    class Meta:
        model = JournalEntry
        fields = [
            "id", "entry_number", "date", "narration", "reference",
            "status", "posted_by", "posted_at", "lines",
        ]


class CreateJournalLineSerializer(serializers.Serializer):
    account_id = serializers.UUIDField()
    debit = serializers.DecimalField(max_digits=14, decimal_places=2, required=False, default=0)
    credit = serializers.DecimalField(max_digits=14, decimal_places=2, required=False, default=0)
    line_narration = serializers.CharField(max_length=255, required=False, allow_blank=True)


class CreateJournalEntrySerializer(serializers.Serializer):
    date = serializers.DateField()
    narration = serializers.CharField(max_length=255, required=False, allow_blank=True)
    reference = serializers.CharField(max_length=120, required=False, allow_blank=True)
    shop_id = serializers.UUIDField(required=False)
    lines = CreateJournalLineSerializer(many=True)


class UpdateJournalEntrySerializer(serializers.Serializer):
    date = serializers.DateField(required=False)
    narration = serializers.CharField(max_length=255, required=False, allow_blank=True)
    reference = serializers.CharField(max_length=120, required=False, allow_blank=True)


class LedgerRowSerializer(serializers.Serializer):
    line_id = serializers.UUIDField()
    entry_id = serializers.UUIDField()
    entry_number = serializers.CharField()
    date = serializers.DateField()
    narration = serializers.CharField(allow_blank=True)
    debit = serializers.DecimalField(max_digits=14, decimal_places=2)
    credit = serializers.DecimalField(max_digits=14, decimal_places=2)
    running_balance = serializers.DecimalField(max_digits=16, decimal_places=2)


class StatementRowSerializer(serializers.Serializer):
    # account_id/code are null for synthetic rows (e.g. Current Period Earnings).
    account_id = serializers.UUIDField(allow_null=True)
    code = serializers.CharField(allow_null=True)
    name = serializers.CharField()
    amount = serializers.DecimalField(max_digits=16, decimal_places=2)
    level = serializers.IntegerField()
    # Own + descendant amounts; null on rows without children.
    total = serializers.DecimalField(max_digits=16, decimal_places=2, allow_null=True)


class StatementSectionSerializer(serializers.Serializer):
    rows = StatementRowSerializer(many=True)
    subtotal = serializers.DecimalField(max_digits=16, decimal_places=2)


class TrialBalanceRowSerializer(serializers.Serializer):
    account_id = serializers.UUIDField()
    code = serializers.CharField()
    name = serializers.CharField()
    account_type = serializers.CharField()
    debit = serializers.DecimalField(max_digits=16, decimal_places=2)
    credit = serializers.DecimalField(max_digits=16, decimal_places=2)
