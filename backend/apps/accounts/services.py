"""Accounts business logic — Chart of Accounts, Journal, Ledger."""

from decimal import Decimal, InvalidOperation

from django.db import transaction
from django.utils import timezone

from core.exceptions import BusinessRuleViolation

from .models import Account, AccountMapping, JournalEntry, JournalLine

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
    seed_default_mappings(shop)
    return len(DEFAULT_CHART)


# Semantic mapping keys → default-chart codes (Phase 8b auto-posting).
DEFAULT_MAPPINGS: dict[str, str] = {
    "cash": "1000",
    "bank": "1010",
    "debtors": "1100",
    "creditors": "2000",
    "gst_output": "2100",
    "gst_input": "1200",
    "sales": "4000",
    "other_income": "4100",
    "expense_default": "5900",
}


@transaction.atomic
def seed_default_mappings(shop) -> int:
    """Create the default account mappings for a shop. Idempotent — no-op if the
    shop already has any mapping. Resolves each key to the shop's account by code;
    silently skips a key whose account is absent. Returns the number created."""
    if AccountMapping.objects.filter(shop=shop).exists():
        return 0

    by_code = {a.code: a for a in Account.objects.filter(shop=shop)}
    to_create = [
        AccountMapping(shop=shop, key=key, account=by_code[code])
        for key, code in DEFAULT_MAPPINGS.items()
        if code in by_code
    ]
    AccountMapping.objects.bulk_create(to_create)
    return len(to_create)


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


# ──────────────────────────────────────────────────────────────────────────────
# General Ledger + Trial Balance
# ──────────────────────────────────────────────────────────────────────────────


def _signed_movement(account: Account, debit: Decimal, credit: Decimal) -> Decimal:
    """Movement signed by the account's normal balance."""
    if account.normal_balance == "debit":
        return debit - credit
    return credit - debit


def account_ledger(account: Account, date_from=None, date_to=None) -> dict:
    """Return posted ledger rows for an account with a running balance respecting
    its normal balance, plus opening/closing balances. No N+1: a single query."""
    base = (
        JournalLine.objects.filter(
            account=account, entry__status=JournalEntry.Status.POSTED
        )
        .select_related("entry")
        .order_by("entry__date", "entry__entry_number", "created_at")
    )

    opening = Decimal("0.00")
    if date_from:
        from django.db.models import DecimalField, Sum
        from django.db.models.functions import Coalesce

        dec = DecimalField(max_digits=16, decimal_places=2)
        zero = Decimal("0.00")
        prior = base.filter(entry__date__lt=date_from).aggregate(
            d=Coalesce(Sum("debit"), zero, output_field=dec),
            c=Coalesce(Sum("credit"), zero, output_field=dec),
        )
        opening = _signed_movement(account, prior["d"], prior["c"])

    window = base
    if date_from:
        window = window.filter(entry__date__gte=date_from)
    if date_to:
        window = window.filter(entry__date__lte=date_to)

    running = opening
    rows = []
    for line in window:
        running += _signed_movement(account, line.debit, line.credit)
        rows.append({
            "line_id": line.id,
            "entry_id": line.entry_id,
            "entry_number": line.entry.entry_number,
            "date": line.entry.date,
            "narration": line.line_narration or line.entry.narration,
            "debit": line.debit,
            "credit": line.credit,
            "running_balance": running,
        })

    return {
        "opening_balance": opening.quantize(TWO_PLACES),
        "closing_balance": running.quantize(TWO_PLACES),
        "rows": rows,
    }


def trial_balance(shop, as_of=None) -> dict:
    """Per-account posted debit/credit totals where Σdebit == Σcredit. Single aggregated query."""
    from django.db.models import DecimalField, Q, Sum
    from django.db.models.functions import Coalesce

    line_q = Q(journal_lines__entry__status=JournalEntry.Status.POSTED)
    if as_of:
        line_q &= Q(journal_lines__entry__date__lte=as_of)

    zero = Decimal("0.00")
    dec = DecimalField(max_digits=16, decimal_places=2)
    accounts = (
        Account.objects.filter(shop=shop)
        .annotate(
            sum_debit=Coalesce(Sum("journal_lines__debit", filter=line_q), zero, output_field=dec),
            sum_credit=Coalesce(Sum("journal_lines__credit", filter=line_q), zero, output_field=dec),
        )
        .order_by("code")
    )

    rows = []
    total_debit = Decimal("0.00")
    total_credit = Decimal("0.00")
    for acct in accounts:
        net = (acct.sum_debit or zero) - (acct.sum_credit or zero)
        if net == 0:
            continue
        debit_col = net if net > 0 else zero
        credit_col = -net if net < 0 else zero
        total_debit += debit_col
        total_credit += credit_col
        rows.append({
            "account_id": acct.id,
            "code": acct.code,
            "name": acct.name,
            "account_type": acct.account_type,
            "debit": debit_col.quantize(TWO_PLACES),
            "credit": credit_col.quantize(TWO_PLACES),
        })

    return {
        "rows": rows,
        "total_debit": total_debit.quantize(TWO_PLACES),
        "total_credit": total_credit.quantize(TWO_PLACES),
    }
