"""
Finance business logic.

Petty cash: atomic balance update + immutable ledger row.
Expenses: update budget allocation actual + recompute variance.
Assets: condition lifecycle (disposed → is_active=False).
"""

import logging
from decimal import Decimal

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
    amount = Decimal(str(data["amount"])).quantize(_TWO)

    with transaction.atomic():
        account_locked = PettyCashAccount.objects.select_for_update().get(pk=account.pk)

        if data["txn_type"] == PettyCashTransaction.TxnType.CREDIT:
            new_balance = account_locked.current_balance + amount
        else:
            new_balance = account_locked.current_balance - amount

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
        # Notification stub — wire WhatsApp when notification module is built.

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
        # Notification stub — wire WhatsApp when notification module is built.


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
