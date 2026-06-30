"""Accounts business logic — Chart of Accounts, Journal, Ledger."""

from django.db import transaction

from .models import Account

# Standard Indian-SMB default chart. (code, name, account_type)
DEFAULT_CHART: list[tuple[str, str, str]] = [
    # Assets
    ("1000", "Cash", Account.AccountType.ASSET),
    ("1010", "Bank", Account.AccountType.ASSET),
    ("1100", "Sundry Debtors", Account.AccountType.ASSET),
    ("1200", "GST Input Credit", Account.AccountType.ASSET),
    ("1300", "Inventory", Account.AccountType.ASSET),
    # Liabilities
    ("2000", "Sundry Creditors", Account.AccountType.LIABILITY),
    ("2100", "GST Payable", Account.AccountType.LIABILITY),
    # Equity
    ("3000", "Capital", Account.AccountType.EQUITY),
    ("3100", "Retained Earnings", Account.AccountType.EQUITY),
    # Income
    ("4000", "Sales", Account.AccountType.INCOME),
    ("4100", "Other Income", Account.AccountType.INCOME),
    # Expenses
    ("5000", "Purchases", Account.AccountType.EXPENSE),
    ("5100", "Salaries", Account.AccountType.EXPENSE),
    ("5200", "Rent", Account.AccountType.EXPENSE),
    ("5300", "Utilities", Account.AccountType.EXPENSE),
    ("5400", "Bank Charges", Account.AccountType.EXPENSE),
    ("5900", "Miscellaneous Expenses", Account.AccountType.EXPENSE),
]


@transaction.atomic
def seed_default_chart(shop) -> int:
    """Create the default chart for a shop. Idempotent — no-op if it already has accounts.

    Returns the number of accounts created (0 on the idempotent no-op path).
    """
    if Account.objects.filter(shop=shop).exists():
        return 0

    Account.objects.bulk_create(
        [
            Account(shop=shop, code=code, name=name, account_type=acct_type, is_system=True)
            for code, name, acct_type in DEFAULT_CHART
        ]
    )
    return len(DEFAULT_CHART)
