"""Accounting models — Chart of Accounts + Journal Entries (double-entry)."""

from django.conf import settings
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


class JournalEntry(BaseModel):
    """A balanced double-entry transaction. Immutable once posted."""

    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        POSTED = "posted", "Posted"

    shop = models.ForeignKey(
        "core.Shop", on_delete=models.PROTECT, related_name="journal_entries"
    )
    entry_number = models.CharField(max_length=30)
    date = models.DateField()
    narration = models.CharField(max_length=255, blank=True)
    reference = models.CharField(max_length=120, blank=True)
    status = models.CharField(max_length=10, choices=Status.choices, default=Status.DRAFT)
    posted_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True,
        on_delete=models.SET_NULL, related_name="posted_journal_entries",
    )
    posted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        unique_together = (("shop", "entry_number"),)
        ordering = ["-date", "-entry_number"]
        indexes = [
            models.Index(fields=["shop", "status"]),
            models.Index(fields=["shop", "date"]),
        ]

    def __str__(self) -> str:
        return f"{self.entry_number} ({self.status})"

    @property
    def is_posted(self) -> bool:
        return self.status == self.Status.POSTED


class JournalLine(BaseModel):
    """One debit-or-credit leg of a journal entry."""

    entry = models.ForeignKey(JournalEntry, on_delete=models.CASCADE, related_name="lines")
    account = models.ForeignKey(Account, on_delete=models.PROTECT, related_name="journal_lines")
    debit = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    credit = models.DecimalField(max_digits=14, decimal_places=2, default=0)
    line_narration = models.CharField(max_length=255, blank=True)

    class Meta:
        ordering = ["created_at"]
        indexes = [
            models.Index(fields=["account"]),
        ]

    def __str__(self) -> str:
        return f"{self.account_id}: Dr {self.debit} / Cr {self.credit}"
