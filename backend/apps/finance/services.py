"""
Finance business logic.

Petty cash: atomic balance update + immutable ledger row.
Expenses: update budget allocation actual + recompute variance.
Assets: condition lifecycle (disposed → is_active=False).
"""

import logging
from decimal import Decimal
from functools import partial

from django.db import transaction

from .models import (
    BudgetAllocation,
    BudgetHead,
    Expense,
    PettyCashAccount,
    PettyCashTransaction,
    ShopAsset,
)

logger = logging.getLogger(__name__)

_TWO = Decimal("0.01")


# ──────────────────────────────────────────────────────────────────────────────
# Petty cash
# ──────────────────────────────────────────────────────────────────────────────


def record_petty_cash_txn(account: PettyCashAccount, data: dict, user) -> PettyCashTransaction:
    """
    Atomically adjust current_balance and record an immutable ledger row.
    Uses SELECT FOR UPDATE to serialise concurrent transactions.
    """
    from core.context import get_tenant_db_alias

    amount = Decimal(str(data["amount"])).quantize(_TWO)
    _db = get_tenant_db_alias() or "default"

    with transaction.atomic(using=_db):
        account_locked = PettyCashAccount.objects.select_for_update().get(pk=account.pk)

        if data["txn_type"] == PettyCashTransaction.TxnType.CREDIT:
            new_balance = account_locked.current_balance + amount
        else:
            new_balance = account_locked.current_balance - amount
            if new_balance < Decimal("0"):
                from core.exceptions import BusinessRuleViolation
                raise BusinessRuleViolation(
                    f"Insufficient petty cash balance. Available: {account_locked.current_balance:.2f}, "
                    f"requested debit: {amount:.2f}."
                )

        new_balance = new_balance.quantize(_TWO)

        txn = PettyCashTransaction.objects.create(
            account=account_locked,
            txn_type=data["txn_type"],
            amount=amount,
            category=data.get("category", ""),
            description=data.get("description", ""),
            receipt_url=data.get("receipt_url", ""),
            date=data["date"],
            recorded_by=user,
            balance_after=new_balance,
        )

        account_locked.current_balance = new_balance
        account_locked.save(update_fields=["current_balance", "updated_at"])

    if new_balance < account_locked.low_balance_threshold:
        logger.info(
            "Petty cash low: shop %s balance %.2f < threshold %.2f",
            account_locked.shop_id, new_balance, account_locked.low_balance_threshold,
        )
        from core.notifications import send_whatsapp
        send_whatsapp(
            phone=account_locked.shop.phone,
            template_name="petty_cash_low",
            variables={
                "shop_name": account_locked.shop.name,
                "current_balance": f"{new_balance:.2f}",
                "threshold": f"{account_locked.low_balance_threshold:.2f}",
            },
        )

    return txn


# ──────────────────────────────────────────────────────────────────────────────
# Expenses
# ──────────────────────────────────────────────────────────────────────────────


def create_expense(shop, data: dict, user) -> Expense:
    """
    Record an expense and, if a budget_head is linked, atomically increment
    the matching BudgetAllocation.actual_amount and recompute variance.
    """
    import datetime as dt
    expense_date = data.get("date")
    if isinstance(expense_date, str):
        expense_date = dt.date.fromisoformat(expense_date)

    budget_head = None
    if data.get("budget_head_id") or data.get("budget_head"):
        head_id = data.get("budget_head_id") or data.get("budget_head")
        try:
            budget_head = BudgetHead.objects.get(id=head_id)
        except BudgetHead.DoesNotExist:
            pass

    amount = Decimal(str(data["amount"])).quantize(_TWO)

    with transaction.atomic():
        expense = Expense.objects.create(
            shop=shop,
            budget_head=budget_head,
            category=data.get("category", ""),
            amount=amount,
            description=data.get("description", ""),
            receipt_url=data.get("receipt_url", ""),
            date=expense_date,
            recorded_by=user,
        )

        if budget_head:
            _update_budget_allocation(budget_head, expense_date.month, expense_date.year, amount)

        from accounts import posting
        if posting.accounting_enabled(shop):
            resolve = partial(posting.resolve, shop)
            posting.post_event(
                shop, "finance.expense", expense.id,
                date=expense.date,
                narration=expense.description or f"Expense {expense.category}".strip(),
                lines=posting.lines_for_expense(expense, resolve),
                user=user,
            )

    return expense


def _update_budget_allocation(head: BudgetHead, month: int, year: int, amount: Decimal) -> None:
    """Increment actual_amount and recompute variance for the matching allocation."""
    from django.db.models import F

    alloc, _ = BudgetAllocation.objects.get_or_create(
        head=head, month=month, year=year,
        defaults={"budgeted_amount": Decimal("0"), "actual_amount": Decimal("0"), "variance": Decimal("0")},
    )

    BudgetAllocation.objects.filter(pk=alloc.pk).update(
        actual_amount=F("actual_amount") + amount,
    )
    alloc.refresh_from_db()
    BudgetAllocation.objects.filter(pk=alloc.pk).update(
        variance=F("actual_amount") - alloc.budgeted_amount,
    )

    alloc.refresh_from_db()
    if alloc.variance > 0:
        logger.info(
            "Budget exceeded: head '%s' %d/%d actual=%.2f budgeted=%.2f",
            head.name, month, year, alloc.actual_amount, alloc.budgeted_amount,
        )
        from core.notifications import send_whatsapp
        send_whatsapp(
            phone=head.shop.phone,
            template_name="budget_exceeded",
            variables={
                "head_name": head.name,
                "month": str(month),
                "year": str(year),
                "actual": f"{alloc.actual_amount:.2f}",
                "budgeted": f"{alloc.budgeted_amount:.2f}",
            },
        )


# ──────────────────────────────────────────────────────────────────────────────
# Assets
# ──────────────────────────────────────────────────────────────────────────────


def update_asset(asset: ShopAsset, data: dict) -> ShopAsset:
    """Update asset fields. Disposing an asset marks it inactive."""
    for field, value in data.items():
        setattr(asset, field, value)

    if asset.condition == ShopAsset.Condition.DISPOSED:
        asset.is_active = False

    asset.save()
    return asset


# ── Cash Book (read-only running ledger over petty cash) ────────────────────────


def build_cash_book(shop_ids, *, date_from=None, date_to=None, account_id=None) -> dict:
    """Running cash ledger over petty-cash transactions for the in-scope accounts.

    `shop_ids=None` means tenant-wide (no shop filter). Returns opening/closing
    balances, period credit/debit totals, and the ordered transactions (as model
    instances under "results" — the view serializes them).
    """
    from .models import PettyCashAccount, PettyCashTransaction

    accounts = PettyCashAccount.objects.all()
    if shop_ids is not None:
        accounts = accounts.filter(shop_id__in=shop_ids)
    if account_id:
        accounts = accounts.filter(id=account_id)
    account_ids = list(accounts.values_list("id", flat=True))

    txns = (
        PettyCashTransaction.objects.select_related("account", "recorded_by")
        .filter(account_id__in=account_ids)
        .order_by("date", "created_at")
    )

    # Opening balance = sum over accounts of the latest balance_after before date_from.
    opening = Decimal("0")
    if date_from is not None:
        for aid in account_ids:
            last = (
                PettyCashTransaction.objects.filter(account_id=aid, date__lt=date_from)
                .order_by("date", "created_at")
                .last()
            )
            if last is not None:
                opening += last.balance_after
        txns = txns.filter(date__gte=date_from)
    if date_to is not None:
        txns = txns.filter(date__lte=date_to)

    rows = list(txns)
    total_credit = sum(
        (t.amount for t in rows if t.txn_type == PettyCashTransaction.TxnType.CREDIT), Decimal("0")
    )
    total_debit = sum(
        (t.amount for t in rows if t.txn_type == PettyCashTransaction.TxnType.DEBIT), Decimal("0")
    )
    closing = opening + total_credit - total_debit
    return {
        "opening_balance": str(opening),
        "closing_balance": str(closing),
        "total_credit": str(total_credit),
        "total_debit": str(total_debit),
        "results": rows,
    }
