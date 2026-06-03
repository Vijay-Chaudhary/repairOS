"""
Finance module models — petty cash, expenses, budgets, and assets.
"""

import uuid

from django.conf import settings
from django.db import models
from django.utils import timezone

from core.models import BaseModel


class PettyCashAccount(BaseModel):
    """One petty cash account per shop."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    shop = models.OneToOneField(
        "core.Shop", on_delete=models.PROTECT, related_name="petty_cash_account"
    )
    name = models.CharField(max_length=100, default="Petty Cash")
    current_balance = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    low_balance_threshold = models.DecimalField(max_digits=10, decimal_places=2, default=500)

    class Meta:
        app_label = "finance"
        db_table = "petty_cash_accounts"

    def __str__(self) -> str:
        return f"{self.shop.code} Petty Cash (₹{self.current_balance})"


class PettyCashTransaction(BaseModel):
    """Immutable running-ledger entry. balance_after is computed at creation time."""

    class TxnType(models.TextChoices):
        CREDIT = "credit", "Credit"
        DEBIT = "debit", "Debit"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    account = models.ForeignKey(
        PettyCashAccount, on_delete=models.PROTECT, related_name="transactions"
    )
    txn_type = models.CharField(max_length=10, choices=TxnType.choices)
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    category = models.CharField(max_length=100, blank=True, default="")
    description = models.TextField(blank=True, default="")
    receipt_url = models.CharField(max_length=500, blank=True, default="")
    date = models.DateField()
    recorded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True, blank=True,
        on_delete=models.SET_NULL,
        related_name="petty_cash_transactions",
    )
    balance_after = models.DecimalField(max_digits=12, decimal_places=2)

    class Meta:
        app_label = "finance"
        db_table = "petty_cash_transactions"
        indexes = [models.Index(fields=["account", "date"])]

    def __str__(self) -> str:
        return f"{self.txn_type} ₹{self.amount} ({self.date}) → {self.balance_after}"


class BudgetHead(BaseModel):
    """Budget category / cost centre."""

    class Category(models.TextChoices):
        FIXED = "fixed", "Fixed"
        VARIABLE = "variable", "Variable"
        CAPITAL = "capital", "Capital"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    shop = models.ForeignKey("core.Shop", on_delete=models.PROTECT, related_name="budget_heads")
    name = models.CharField(max_length=200)
    category = models.CharField(max_length=20, choices=Category.choices)

    class Meta:
        app_label = "finance"
        db_table = "budget_heads"

    def __str__(self) -> str:
        return f"{self.name} ({self.category})"


class BudgetAllocation(BaseModel):
    """Monthly budget plan + actual for a BudgetHead. variance = actual − budgeted."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    head = models.ForeignKey(BudgetHead, on_delete=models.PROTECT, related_name="allocations")
    month = models.IntegerField()
    year = models.IntegerField()
    budgeted_amount = models.DecimalField(max_digits=12, decimal_places=2)
    actual_amount = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    variance = models.DecimalField(max_digits=12, decimal_places=2, default=0)

    class Meta:
        app_label = "finance"
        db_table = "budget_allocations"
        unique_together = [("head", "month", "year")]
        indexes = [models.Index(fields=["head", "year", "month"])]

    def __str__(self) -> str:
        return f"{self.head.name} {self.month}/{self.year}: {self.variance:+}"


class Expense(BaseModel):
    """Accounting expense record. Optionally linked to a BudgetHead."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    shop = models.ForeignKey("core.Shop", on_delete=models.PROTECT, related_name="expenses")
    budget_head = models.ForeignKey(
        BudgetHead, null=True, blank=True, on_delete=models.SET_NULL, related_name="expenses"
    )
    category = models.CharField(max_length=100, blank=True, default="")
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    description = models.TextField(blank=True, default="")
    receipt_url = models.CharField(max_length=500, blank=True, default="")
    date = models.DateField()
    recorded_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True, blank=True,
        on_delete=models.SET_NULL,
        related_name="expenses",
    )

    class Meta:
        app_label = "finance"
        db_table = "expenses"
        indexes = [models.Index(fields=["shop", "date"])]

    def __str__(self) -> str:
        return f"Expense ₹{self.amount} {self.category} ({self.date})"


class ShopAsset(BaseModel):
    """Fixed-asset register entry for a shop."""

    class Condition(models.TextChoices):
        GOOD = "good", "Good"
        FAIR = "fair", "Fair"
        POOR = "poor", "Poor"
        UNDER_REPAIR = "under_repair", "Under Repair"
        DISPOSED = "disposed", "Disposed"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    shop = models.ForeignKey("core.Shop", on_delete=models.PROTECT, related_name="assets")
    name = models.CharField(max_length=200)
    category = models.CharField(max_length=100)
    asset_code = models.CharField(max_length=50, unique=True)
    purchase_date = models.DateField()
    purchase_cost = models.DecimalField(max_digits=12, decimal_places=2)
    supplier = models.ForeignKey(
        "procurement.Supplier",
        null=True, blank=True,
        on_delete=models.SET_NULL,
        related_name="assets",
    )
    warranty_expiry = models.DateField(null=True, blank=True)
    condition = models.CharField(
        max_length=20, choices=Condition.choices, default=Condition.GOOD
    )
    location_description = models.TextField(blank=True, default="")
    notes = models.TextField(blank=True, default="")
    is_active = models.BooleanField(default=True)

    class Meta:
        app_label = "finance"
        db_table = "shop_assets"
        indexes = [
            models.Index(fields=["shop", "is_active"]),
            models.Index(fields=["asset_code"]),
        ]

    def __str__(self) -> str:
        return f"{self.asset_code} — {self.name} ({self.condition})"
