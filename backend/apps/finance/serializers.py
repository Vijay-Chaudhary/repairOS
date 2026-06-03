from decimal import Decimal

from rest_framework import serializers

from .models import (
    BudgetAllocation,
    BudgetHead,
    Expense,
    PettyCashAccount,
    PettyCashTransaction,
    ShopAsset,
)


class PettyCashAccountSerializer(serializers.ModelSerializer):
    class Meta:
        model = PettyCashAccount
        fields = ["id", "shop", "name", "current_balance", "low_balance_threshold"]


class CreatePettyCashTxnSerializer(serializers.Serializer):
    account_id = serializers.UUIDField()
    txn_type = serializers.ChoiceField(choices=PettyCashTransaction.TxnType.choices)
    amount = serializers.DecimalField(max_digits=10, decimal_places=2, min_value=Decimal("0.01"))
    category = serializers.CharField(required=False, default="", allow_blank=True)
    description = serializers.CharField(required=False, default="", allow_blank=True)
    receipt_url = serializers.CharField(required=False, default="", allow_blank=True)
    date = serializers.DateField()


class PettyCashTransactionSerializer(serializers.ModelSerializer):
    class Meta:
        model = PettyCashTransaction
        fields = [
            "id", "account", "txn_type", "amount", "category",
            "description", "date", "balance_after",
        ]


class BudgetHeadSerializer(serializers.ModelSerializer):
    class Meta:
        model = BudgetHead
        fields = ["id", "shop", "name", "category"]


class BudgetAllocationSerializer(serializers.ModelSerializer):
    class Meta:
        model = BudgetAllocation
        fields = [
            "id", "head", "month", "year",
            "budgeted_amount", "actual_amount", "variance",
        ]


class CreateBudgetAllocationSerializer(serializers.Serializer):
    head_id = serializers.UUIDField()
    month = serializers.IntegerField(min_value=1, max_value=12)
    year = serializers.IntegerField(min_value=2020, max_value=2100)
    budgeted_amount = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal("0"))


class CreateExpenseSerializer(serializers.Serializer):
    shop_id = serializers.UUIDField()
    budget_head_id = serializers.UUIDField(required=False, allow_null=True)
    category = serializers.CharField(required=False, default="", allow_blank=True)
    amount = serializers.DecimalField(max_digits=10, decimal_places=2, min_value=Decimal("0.01"))
    description = serializers.CharField(required=False, default="", allow_blank=True)
    receipt_url = serializers.CharField(required=False, default="", allow_blank=True)
    date = serializers.DateField()


class ExpenseSerializer(serializers.ModelSerializer):
    class Meta:
        model = Expense
        fields = [
            "id", "shop", "budget_head", "category",
            "amount", "description", "date",
        ]


class ShopAssetSerializer(serializers.ModelSerializer):
    class Meta:
        model = ShopAsset
        fields = [
            "id", "shop", "name", "category", "asset_code",
            "purchase_date", "purchase_cost", "warranty_expiry",
            "condition", "location_description", "notes", "is_active",
        ]


class CreateAssetSerializer(serializers.Serializer):
    shop_id = serializers.UUIDField()
    name = serializers.CharField(max_length=200)
    category = serializers.CharField(max_length=100)
    asset_code = serializers.CharField(max_length=50)
    purchase_date = serializers.DateField()
    purchase_cost = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal("0"))
    warranty_expiry = serializers.DateField(required=False, allow_null=True)
    condition = serializers.ChoiceField(
        choices=ShopAsset.Condition.choices, default=ShopAsset.Condition.GOOD
    )
    location_description = serializers.CharField(required=False, default="", allow_blank=True)
    notes = serializers.CharField(required=False, default="", allow_blank=True)


class UpdateAssetSerializer(serializers.Serializer):
    condition = serializers.ChoiceField(choices=ShopAsset.Condition.choices, required=False)
    location_description = serializers.CharField(required=False, allow_blank=True)
    notes = serializers.CharField(required=False, allow_blank=True)
    is_active = serializers.BooleanField(required=False)
