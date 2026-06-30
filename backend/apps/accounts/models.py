"""Accounting models — Chart of Accounts (Journal/Ledger added in later tasks)."""

from django.db import models

from core.models import BaseModel


class Account(BaseModel):
    """A node in the shop's hierarchical Chart of Accounts."""

    class AccountType(models.TextChoices):
        ASSET = "asset", "Asset"
        LIABILITY = "liability", "Liability"
        EQUITY = "equity", "Equity"
        INCOME = "income", "Income"
        EXPENSE = "expense", "Expense"

    # Asset & expense accounts carry a debit normal balance; the rest are credit.
    _DEBIT_TYPES = {AccountType.ASSET, AccountType.EXPENSE}

    shop = models.ForeignKey(
        "core.Shop", on_delete=models.PROTECT, related_name="accounts"
    )
    code = models.CharField(max_length=20)
    name = models.CharField(max_length=120)
    account_type = models.CharField(max_length=12, choices=AccountType.choices)
    parent = models.ForeignKey(
        "self", null=True, blank=True, on_delete=models.SET_NULL, related_name="children"
    )
    is_active = models.BooleanField(default=True)
    is_system = models.BooleanField(default=False)

    class Meta:
        unique_together = (("shop", "code"),)
        ordering = ["code"]
        indexes = [
            models.Index(fields=["shop", "account_type"]),
        ]

    def __str__(self) -> str:
        return f"{self.code} {self.name}"

    @property
    def normal_balance(self) -> str:
        return "debit" if self.account_type in self._DEBIT_TYPES else "credit"
