"""Phase 8b auto-posting engine.

Pure recipe functions turn a business object into balanced journal lines;
``post_event`` / ``reverse_event`` persist and post them via the 8a services.
All amounts are ``Decimal`` at 2dp; every recipe balances Σdebit == Σcredit.
"""
from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal

from django.db import transaction

from core.exceptions import BusinessRuleViolation

from . import services
from .models import Account, AccountMapping, JournalEntry

TWO = Decimal("0.01")
ZERO = Decimal("0.00")


# ── Mapping resolution ────────────────────────────────────────────────────────
def accounting_enabled(shop) -> bool:
    """A shop has opted into auto-posting once it has any account mapping."""
    return AccountMapping.objects.filter(shop=shop).exists()


def resolve(shop, key: str) -> Account:
    """Resolve a semantic key to the shop's account. Raises when unmapped —
    surfaces misconfiguration and rolls the event's transaction back."""
    mapping = (
        AccountMapping.objects.select_related("account")
        .filter(shop=shop, key=key)
        .first()
    )
    if mapping is None:
        raise BusinessRuleViolation(f"No account mapped for '{key}'.")
    return mapping.account


def resolve_optional(shop, key: str) -> Account | None:
    """Non-raising lookup for optional keys (e.g. per-category expense accounts)."""
    mapping = (
        AccountMapping.objects.select_related("account")
        .filter(shop=shop, key=key)
        .first()
    )
    return mapping.account if mapping else None


def _cash_or_bank(method: str) -> str:
    return "cash" if method == "cash" else "bank"


def _q(value) -> Decimal:
    return Decimal(str(value)).quantize(TWO, rounding=ROUND_HALF_UP)


def _line(account_id, *, debit=ZERO, credit=ZERO) -> dict:
    return {"account_id": account_id, "debit": debit, "credit": credit}


def _assert_balanced(lines: list[dict]) -> list[dict]:
    total_debit = sum((l["debit"] for l in lines), ZERO)
    total_credit = sum((l["credit"] for l in lines), ZERO)
    if total_debit != total_credit:
        raise BusinessRuleViolation(
            f"Recipe produced an unbalanced entry: {total_debit} != {total_credit}."
        )
    return lines


# ── Recipes (pure) ────────────────────────────────────────────────────────────
def lines_for_repair_invoice(invoice, resolve) -> list[dict]:
    taxable = _q(invoice.subtotal - invoice.discount_amount)
    tax = _q(invoice.cgst + invoice.sgst + invoice.igst)
    lines = [_line(resolve("debtors").id, debit=_q(invoice.grand_total))]
    if taxable > 0:
        lines.append(_line(resolve("sales").id, credit=taxable))
    if tax > 0:
        lines.append(_line(resolve("gst_output").id, credit=tax))
    return _assert_balanced(lines)


def lines_for_billing_payment(payment, resolve) -> list[dict]:
    amount = _q(payment.amount)
    return _assert_balanced([
        _line(resolve(_cash_or_bank(payment.method)).id, debit=amount),
        _line(resolve("debtors").id, credit=amount),
    ])


def lines_for_pos_sale(sale, resolve) -> list[dict]:
    taxable = _q(sale.subtotal - sale.discount_amount)
    tax = _q(sale.cgst + sale.sgst + sale.igst)
    lines: list[dict] = []
    if sale.amount_paid > 0:
        lines.append(_line(resolve("cash").id, debit=_q(sale.amount_paid)))
    if sale.amount_outstanding > 0:
        lines.append(_line(resolve("debtors").id, debit=_q(sale.amount_outstanding)))
    if taxable > 0:
        lines.append(_line(resolve("sales").id, credit=taxable))
    if tax > 0:
        lines.append(_line(resolve("gst_output").id, credit=tax))
    return _assert_balanced(lines)


def lines_for_pos_payment(payment, resolve) -> list[dict]:
    amount = _q(payment.amount)
    return _assert_balanced([
        _line(resolve(_cash_or_bank(payment.method)).id, debit=amount),
        _line(resolve("debtors").id, credit=amount),
    ])


def _expense_key(category: str) -> str:
    return "expense_" + category.strip().lower().replace(" ", "_")


def lines_for_expense(expense, resolve) -> list[dict]:
    amount = _q(expense.amount)
    account = None
    if expense.category:
        account = resolve_optional(expense.shop, _expense_key(expense.category))
    if account is None:
        account = resolve("expense_default")
    return _assert_balanced([
        _line(account.id, debit=amount),
        _line(resolve("cash").id, credit=amount),  # Expense has no method → cash
    ])


def lines_for_refund(refund, resolve) -> list[dict]:
    amount = _q(refund.amount)
    return _assert_balanced([
        _line(resolve("debtors").id, debit=amount),
        _line(resolve(_cash_or_bank(refund.method)).id, credit=amount),
    ])


# ── Posting ───────────────────────────────────────────────────────────────────
def post_event(shop, source_type, source_id, *, date, narration, lines,
               user=None, reverses=None) -> JournalEntry | None:
    """Idempotently create + post a journal entry for one business event.

    Silent no-op (returns None) when accounting is disabled for the shop.
    Returns the existing posted entry when one already exists for the key; if a
    prior attempt left an unposted draft, it is posted now (single transaction).
    """
    if not accounting_enabled(shop):
        return None
    source_ref = f"{source_type}:{source_id}"
    with transaction.atomic():
        existing = JournalEntry.objects.filter(
            shop=shop, source_type=source_type, source_id=source_id
        ).first()
        if existing is not None:
            if existing.is_posted:
                return existing
            return services.post_journal_entry(existing, user, source_ref=source_ref)
        entry = services.create_journal_entry(shop, {
            "date": date,
            "narration": narration,
            "lines": lines,
            "source_type": source_type,
            "source_id": source_id,
            "reverses": reverses,
        })
        return services.post_journal_entry(entry, user, source_ref=source_ref)


def reverse_event(shop, *, original_source_type, original_source_id,
                  new_source_type, new_source_id, date, narration,
                  amount=None, user=None) -> JournalEntry | None:
    """Post a reversing entry (original lines with Dr/Cr swapped) for the reversed
    amount, linked via ``reverses``. Full reversal when ``amount`` is None.
    Returns None when accounting is disabled or the original posted entry is absent.
    The original entry is never mutated (8a immutability)."""
    if not accounting_enabled(shop):
        return None
    original = (
        JournalEntry.objects.filter(
            shop=shop, source_type=original_source_type,
            source_id=original_source_id, status=JournalEntry.Status.POSTED,
        )
        .prefetch_related("lines")
        .first()
    )
    if original is None:
        return None

    orig_lines = list(original.lines.all())
    original_total = sum((ln.debit for ln in orig_lines), ZERO)
    if amount is None or _q(amount) >= original_total or original_total == 0:
        scale = Decimal("1")
    else:
        scale = _q(amount) / original_total

    swapped = [
        _line(
            ln.account_id,
            debit=(ln.credit if scale == 1 else _q(ln.credit * scale)),
            credit=(ln.debit if scale == 1 else _q(ln.debit * scale)),
        )
        for ln in orig_lines
    ]
    _absorb_rounding(shop, swapped)
    return post_event(
        shop, new_source_type, new_source_id,
        date=date, narration=narration, lines=swapped, user=user, reverses=original,
    )


def _absorb_rounding(shop, lines: list[dict]) -> None:
    """Push any per-cent scaling residue onto a plug leg so the reversing entry
    still satisfies Σdebit == Σcredit. Plug preference is debtors → cash → bank
    (deterministic, independent of line order)."""
    residual = sum((l["debit"] for l in lines), ZERO) - sum((l["credit"] for l in lines), ZERO)
    if residual == 0:
        return
    key_by_account = {
        m.account_id: m.key
        for m in AccountMapping.objects.filter(shop=shop, key__in=("debtors", "cash", "bank"))
    }
    priority = {"debtors": 0, "cash": 1, "bank": 2}
    plug_line = None
    plug_rank = None
    for line in lines:
        key = key_by_account.get(line["account_id"])
        if key is None:
            continue
        rank = priority[key]
        if plug_rank is None or rank < plug_rank:
            plug_line, plug_rank = line, rank
    if plug_line is None:
        return
    if plug_line["credit"] > 0:
        plug_line["credit"] = _q(plug_line["credit"] + residual)
    else:
        plug_line["debit"] = _q(plug_line["debit"] - residual)
