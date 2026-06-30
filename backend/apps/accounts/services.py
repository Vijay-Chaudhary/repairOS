"""Accounts business logic — Chart of Accounts, Journal, Ledger."""

from decimal import Decimal, InvalidOperation

from django.db import transaction
from django.utils import timezone

from core.exceptions import BusinessRuleViolation

from .models import Account, JournalEntry, JournalLine

TWO_PLACES = Decimal("0.01")

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


# ──────────────────────────────────────────────────────────────────────────────
# Journal Entries
# ──────────────────────────────────────────────────────────────────────────────


def _to_amount(value, field: str) -> Decimal:
    """Coerce an incoming debit/credit value to a non-negative 2dp Decimal."""
    try:
        amount = Decimal(str(value if value is not None else "0")).quantize(TWO_PLACES)
    except (InvalidOperation, ValueError):
        raise BusinessRuleViolation(f"Invalid {field} amount.")
    if amount < 0:
        raise BusinessRuleViolation(f"{field.capitalize()} cannot be negative.")
    return amount


def _next_entry_number(shop) -> str:
    """Allocate the next per-shop journal voucher number (caller holds the txn)."""
    count = JournalEntry.objects.filter(shop=shop).count()
    return f"JV-{count + 1:05d}"


def _validate_lines(raw_lines: list[dict], shop) -> list[dict]:
    """Validate balance + debit-xor-credit and resolve accounts. Returns clean line dicts."""
    if not raw_lines or len(raw_lines) < 2:
        raise BusinessRuleViolation("A journal entry needs at least two lines.")

    account_ids = {ln.get("account_id") for ln in raw_lines}
    accounts = {
        str(a.id): a
        for a in Account.objects.filter(shop=shop, id__in=[i for i in account_ids if i])
    }

    total_debit = Decimal("0.00")
    total_credit = Decimal("0.00")
    clean: list[dict] = []
    for ln in raw_lines:
        account = accounts.get(str(ln.get("account_id")))
        if account is None:
            raise BusinessRuleViolation("Each line must reference an account in this shop.")
        debit = _to_amount(ln.get("debit", 0), "debit")
        credit = _to_amount(ln.get("credit", 0), "credit")
        # Exactly one of debit/credit must be > 0.
        if (debit > 0) == (credit > 0):
            raise BusinessRuleViolation("Each line must have either a debit or a credit, not both.")
        total_debit += debit
        total_credit += credit
        clean.append({
            "account": account,
            "debit": debit,
            "credit": credit,
            "line_narration": ln.get("line_narration", "") or "",
        })

    if total_debit <= 0:
        raise BusinessRuleViolation("A journal entry must have a positive total.")
    if total_debit != total_credit:
        raise BusinessRuleViolation(
            f"Entry is unbalanced: debit {total_debit} != credit {total_credit}."
        )
    return clean


@transaction.atomic
def create_journal_entry(shop, data: dict) -> JournalEntry:
    """Validate + create a draft journal entry with its lines."""
    clean_lines = _validate_lines(data.get("lines", []), shop)

    entry = JournalEntry.objects.create(
        shop=shop,
        entry_number=_next_entry_number(shop),
        date=data["date"],
        narration=data.get("narration", "") or "",
        reference=data.get("reference", "") or "",
        status=JournalEntry.Status.DRAFT,
    )
    JournalLine.objects.bulk_create(
        [
            JournalLine(
                entry=entry,
                account=ln["account"],
                debit=ln["debit"],
                credit=ln["credit"],
                line_narration=ln["line_narration"],
            )
            for ln in clean_lines
        ]
    )
    return entry


@transaction.atomic
def post_journal_entry(entry: JournalEntry, user, source_ref: str | None = None) -> JournalEntry:
    """Re-validate balance and transition a draft entry to posted (immutable thereafter).

    `source_ref` is accepted for future auto-posting (Phase 8b) and stored on `reference`
    only when the entry has no manual reference yet.
    """
    if entry.is_posted:
        raise BusinessRuleViolation("This entry is already posted.")

    lines = list(entry.lines.all())
    total_debit = sum((ln.debit for ln in lines), Decimal("0.00"))
    total_credit = sum((ln.credit for ln in lines), Decimal("0.00"))
    if len(lines) < 2 or total_debit <= 0 or total_debit != total_credit:
        raise BusinessRuleViolation("Cannot post an unbalanced entry.")

    entry.status = JournalEntry.Status.POSTED
    entry.posted_by = user
    entry.posted_at = timezone.now()
    if source_ref and not entry.reference:
        entry.reference = source_ref
    entry.save(update_fields=["status", "posted_by", "posted_at", "reference", "updated_at"])
    return entry
