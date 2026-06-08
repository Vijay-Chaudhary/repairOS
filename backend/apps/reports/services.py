"""
Reports service layer — all query logic for the 28-report catalogue
plus the 8 dashboard widgets.

Every function is shop-scoped: callers pass a list of shop_ids that came
from the JWT so there is no cross-shop leakage within a tenant.
"""

import csv
import io
import logging
from datetime import date, timedelta
from decimal import Decimal

from django.db.models import Count, F, Q, Sum
from django.utils import timezone

logger = logging.getLogger(__name__)

_ZERO = Decimal("0.00")


# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────

def _d(val) -> str:
    """Decimal → 2-dp string."""
    return str(Decimal(str(val or 0)).quantize(Decimal("0.01")))


def _shop_filter(shop_ids: list) -> Q:
    if not shop_ids:
        return Q(pk__in=[])
    return Q(shop_id__in=shop_ids)


# ──────────────────────────────────────────────────────────────────────────────
# Dashboard (§4)
# ──────────────────────────────────────────────────────────────────────────────


def dashboard(shop_ids: list) -> dict:
    today = timezone.now().date()
    month_start = date(today.year, today.month, 1)
    week_start = today - timedelta(days=today.weekday())
    week_end = week_start + timedelta(days=6)
    if today.month == 12:
        next_month = date(today.year + 1, 1, 1)
    else:
        next_month = date(today.year, today.month + 1, 1)
    trend_start = today - timedelta(days=13)

    from repair.models import JobTicket
    from billing.models import RepairInvoice, Payment
    from crm.models import Customer, FollowUpTask
    from amc.models import AMCVisit, AMCContract
    from inventory.models import InventoryStock
    from finance.models import BudgetAllocation

    sq = _shop_filter(shop_ids)
    terminal = [JobTicket.Status.DELIVERED, JobTicket.Status.CLOSED, JobTicket.Status.CANCELLED]

    # 1. Open jobs (not in terminal states)
    open_jobs = (
        JobTicket.objects
        .filter(sq, deleted_at__isnull=True)
        .exclude(status__in=terminal)
        .count()
    )

    # 2. Jobs completed (delivered or closed) today
    jobs_completed_today = (
        JobTicket.objects
        .filter(sq, status__in=[JobTicket.Status.DELIVERED, JobTicket.Status.CLOSED],
                updated_at__date=today)
        .count()
    )

    # 3. Revenue today and this month
    payments_qs = Payment.objects.filter(invoice__shop_id__in=shop_ids) if shop_ids else Payment.objects.none()
    revenue_today = payments_qs.filter(paid_at__date=today).aggregate(t=Sum("amount"))["t"] or _ZERO
    revenue_month = payments_qs.filter(paid_at__date__gte=month_start).aggregate(t=Sum("amount"))["t"] or _ZERO

    # 4. Revenue trend — last 14 days
    trend_payments = (
        payments_qs
        .filter(paid_at__date__gte=trend_start)
        .values("paid_at__date")
        .annotate(revenue=Sum("amount"))
        .order_by("paid_at__date")
    )
    revenue_trend = [
        {"date": str(row["paid_at__date"]), "revenue": float(row["revenue"])}
        for row in trend_payments
    ]

    # 5. Outstanding dues (repair)
    outstanding_amount = (
        RepairInvoice.objects
        .filter(sq, amount_outstanding__gt=0, deleted_at__isnull=True)
        .aggregate(t=Sum("amount_outstanding"))["t"] or _ZERO
    )

    # 6. New customers this month
    new_customers_month = (
        Customer.objects
        .filter(sq, deleted_at__isnull=True, created_at__date__gte=month_start)
        .count()
    )

    # 7. CRM tasks due today (scoped via lead or customer shop)
    task_shop_q = (
        Q(lead__shop_id__in=shop_ids) | Q(customer__shop_id__in=shop_ids)
        if shop_ids else Q(pk__in=[])
    )
    tasks_due_today = (
        FollowUpTask.objects
        .filter(task_shop_q, deleted_at__isnull=True, due_date=today)
        .exclude(status="completed")
        .count()
    )

    # 8. AMC visits this week
    amc_visits_this_week = (
        AMCVisit.objects
        .filter(contract__shop_id__in=shop_ids, scheduled_date__range=(week_start, week_end))
        .count()
    )

    # 9. Low stock alerts
    low_stock_alerts = (
        InventoryStock.objects
        .filter(shop_id__in=shop_ids, quantity_in_stock__lt=F("reorder_level"))
        .count()
    )

    # 10. Contracts expiring this month
    contracts_expiring_this_month = (
        AMCContract.objects
        .filter(shop_id__in=shop_ids, end_date__gte=today, end_date__lt=next_month)
        .count()
    )

    # 11. Budget heads over limit
    over_budget_heads = (
        BudgetAllocation.objects
        .filter(head__shop_id__in=shop_ids, variance__gt=0)
        .count()
    )

    return {
        "open_jobs": open_jobs,
        "jobs_completed_today": jobs_completed_today,
        "revenue_today": float(revenue_today),
        "revenue_month": float(revenue_month),
        "outstanding_amount": float(outstanding_amount),
        "new_customers_month": new_customers_month,
        "tasks_due_today": tasks_due_today,
        "amc_visits_this_week": amc_visits_this_week,
        "low_stock_alerts": low_stock_alerts,
        "contracts_expiring_this_month": contracts_expiring_this_month,
        "over_budget_heads": over_budget_heads,
        "revenue_trend": revenue_trend,
    }


# ──────────────────────────────────────────────────────────────────────────────
# Report 1 — Revenue Summary  (Billing)
# ──────────────────────────────────────────────────────────────────────────────


def revenue_summary(shop_ids: list, date_from: date, date_to: date) -> dict:
    from billing.models import Payment

    payments = Payment.objects.filter(
        invoice__shop_id__in=shop_ids,
        paid_at__date__gte=date_from,
        paid_at__date__lte=date_to,
    ).select_related("invoice")

    total = sum(p.amount for p in payments)
    invoice_ids = set(p.invoice_id for p in payments)

    by_day: dict[str, Decimal] = {}
    for p in payments:
        key = str(p.paid_at.date())
        by_day[key] = by_day.get(key, _ZERO) + p.amount

    return {
        "total_revenue": _d(total),
        "invoice_count": len(invoice_ids),
        "by_day": {k: _d(v) for k, v in sorted(by_day.items())},
    }


# ──────────────────────────────────────────────────────────────────────────────
# Report 2 — Outstanding Dues (Repair)
# ──────────────────────────────────────────────────────────────────────────────


def outstanding_dues_repair(shop_ids: list, overdue_days: int = 0) -> dict:
    from billing.models import RepairInvoice

    qs = RepairInvoice.objects.filter(
        shop_id__in=shop_ids,
        amount_outstanding__gt=0,
        deleted_at__isnull=True,
    ).select_related("customer")

    if overdue_days:
        cutoff = timezone.now().date() - timedelta(days=overdue_days)
        qs = qs.filter(due_date__lte=cutoff)

    total = qs.aggregate(total=Sum("amount_outstanding"))["total"] or _ZERO
    rows = [
        {
            "invoice_number": inv.invoice_number,
            "customer": inv.customer.name,
            "grand_total": _d(inv.grand_total),
            "amount_outstanding": _d(inv.amount_outstanding),
            "due_date": str(inv.due_date) if inv.due_date else "",
        }
        for inv in qs
    ]
    return {"total_outstanding": _d(total), "invoices": rows}


# ──────────────────────────────────────────────────────────────────────────────
# Report 3 — Outstanding Dues (Wholesale / POS)
# ──────────────────────────────────────────────────────────────────────────────


def outstanding_dues_wholesale(shop_ids: list) -> dict:
    from pos.models import Sale

    qs = Sale.objects.filter(
        shop_id__in=shop_ids,
        amount_outstanding__gt=0,
    ).select_related("customer")

    total = qs.aggregate(total=Sum("amount_outstanding"))["total"] or _ZERO
    rows = [
        {
            "sale_number": s.sale_number,
            "customer": s.customer.name if s.customer else "",
            "grand_total": _d(s.grand_total),
            "amount_outstanding": _d(s.amount_outstanding),
        }
        for s in qs
    ]
    return {"total_outstanding": _d(total), "sales": rows}


# ──────────────────────────────────────────────────────────────────────────────
# Report 4 — Payment Collection Log
# ──────────────────────────────────────────────────────────────────────────────


def payment_collection_log(shop_ids: list, date_from: date, date_to: date,
                            method: str = "") -> dict:
    from billing.models import Payment

    qs = Payment.objects.filter(
        invoice__shop_id__in=shop_ids,
        paid_at__date__gte=date_from,
        paid_at__date__lte=date_to,
    ).select_related("invoice", "invoice__customer")
    if method:
        qs = qs.filter(method=method)

    rows = [
        {
            "date": str(p.paid_at.date()),
            "invoice_number": p.invoice.invoice_number,
            "customer": p.invoice.customer.name,
            "method": p.method,
            "amount": _d(p.amount),
            "reference_id": p.reference_id,
        }
        for p in qs
    ]
    total = sum(Decimal(r["amount"]) for r in rows)
    return {"total": _d(total), "payments": rows}


# ──────────────────────────────────────────────────────────────────────────────
# Report 5 — P&L Summary
# ──────────────────────────────────────────────────────────────────────────────


def pnl_summary(shop_ids: list, month: int, year: int) -> dict:
    from billing.models import Payment
    from finance.models import Expense

    start = date(year, month, 1)
    if month == 12:
        end = date(year + 1, 1, 1) - timedelta(days=1)
    else:
        end = date(year, month + 1, 1) - timedelta(days=1)

    revenue = (
        Payment.objects.filter(
            invoice__shop_id__in=shop_ids, paid_at__date__gte=start, paid_at__date__lte=end
        ).aggregate(total=Sum("amount"))["total"] or _ZERO
    )

    expenses = (
        Expense.objects.filter(
            shop_id__in=shop_ids, date__gte=start, date__lte=end
        ).aggregate(total=Sum("amount"))["total"] or _ZERO
    )

    return {
        "month": month, "year": year,
        "revenue": _d(revenue),
        "expenses": _d(expenses),
        "net_profit": _d(Decimal(str(revenue)) - Decimal(str(expenses))),
    }


# ──────────────────────────────────────────────────────────────────────────────
# Report 6 — Expense by Category
# ──────────────────────────────────────────────────────────────────────────────


def expense_by_category(shop_ids: list, date_from: date, date_to: date,
                         category: str = "") -> dict:
    from finance.models import Expense

    qs = Expense.objects.filter(
        shop_id__in=shop_ids, date__gte=date_from, date__lte=date_to
    )
    if category:
        qs = qs.filter(category=category)

    agg = qs.values("category").annotate(total=Sum("amount")).order_by("-total")
    return {"by_category": [{"category": r["category"], "total": _d(r["total"])} for r in agg]}


# ──────────────────────────────────────────────────────────────────────────────
# Report 7 — Budget vs Actual
# ──────────────────────────────────────────────────────────────────────────────


def budget_vs_actual(shop_ids: list, month: int, year: int) -> dict:
    from finance.models import BudgetAllocation

    allocs = (
        BudgetAllocation.objects
        .filter(head__shop_id__in=shop_ids, month=month, year=year)
        .select_related("head")
    )
    rows = [
        {
            "head": a.head.name,
            "category": a.head.category,
            "budgeted_amount": _d(a.budgeted_amount),
            "actual_amount": _d(a.actual_amount),
            "variance": _d(a.variance),
        }
        for a in allocs
    ]
    total_budget = sum(a.budgeted_amount for a in allocs)
    total_actual = sum(a.actual_amount for a in allocs)
    return {
        "month": month, "year": year,
        "heads": rows,
        "total_budgeted": _d(total_budget),
        "total_actual": _d(total_actual),
        "total_variance": _d(Decimal(str(total_actual)) - Decimal(str(total_budget))),
    }


# ──────────────────────────────────────────────────────────────────────────────
# Report 8 — Job Status Summary
# ──────────────────────────────────────────────────────────────────────────────


def job_status_summary(shop_ids: list, date_from: date, date_to: date,
                        tech_id=None) -> dict:
    from repair.models import JobTicket

    qs = JobTicket.objects.filter(
        shop_id__in=shop_ids,
        created_at__date__gte=date_from,
        created_at__date__lte=date_to,
    )
    if tech_id:
        qs = qs.filter(
            Q(created_by_id=tech_id) | Q(stages__assigned_technician_id=tech_id)
        ).distinct()

    by_status = dict(
        qs.values("status").annotate(count=Count("id")).values_list("status", "count")
    )
    return {"by_status": by_status, "total": sum(by_status.values())}


# ──────────────────────────────────────────────────────────────────────────────
# Report 9 — Job Turnaround Time
# ──────────────────────────────────────────────────────────────────────────────


def job_turnaround_time(shop_ids: list, date_from: date, date_to: date,
                         device_type: str = "") -> dict:
    from repair.models import JobTicket

    qs = JobTicket.objects.filter(
        shop_id__in=shop_ids,
        status=JobTicket.Status.CLOSED,
        created_at__date__gte=date_from,
        created_at__date__lte=date_to,
    )
    if device_type:
        qs = qs.filter(device_type=device_type)

    rows = []
    for job in qs.select_related("customer"):
        delta = (job.updated_at.date() - job.created_at.date()).days
        rows.append({
            "job_number": job.job_number,
            "device_type": job.device_type,
            "customer": job.customer.name,
            "days": delta,
        })
    avg = sum(r["days"] for r in rows) / len(rows) if rows else 0
    return {"jobs": rows, "average_days": round(avg, 1)}


# ──────────────────────────────────────────────────────────────────────────────
# Report 10 — Warranty Claims
# ──────────────────────────────────────────────────────────────────────────────


def warranty_claims(shop_ids: list, date_from: date, date_to: date) -> dict:
    from repair.models import JobTicket

    qs = JobTicket.objects.filter(
        shop_id__in=shop_ids,
        warranty_of_job__isnull=False,
        created_at__date__gte=date_from,
        created_at__date__lte=date_to,
    ).select_related("customer", "warranty_of_job")

    rows = [
        {
            "job_number": j.job_number,
            "original_job": j.warranty_of_job.job_number,
            "customer": j.customer.name,
            "device_type": j.device_type,
            "date": str(j.created_at.date()),
        }
        for j in qs
    ]
    return {"claims": rows, "total": len(rows)}


# ──────────────────────────────────────────────────────────────────────────────
# Report 11 — Fault Template Usage
# ──────────────────────────────────────────────────────────────────────────────


def fault_template_usage(shop_ids: list, date_from: date, date_to: date) -> dict:
    from repair.models import JobTicket

    qs = (
        JobTicket.objects
        .filter(
            shop_id__in=shop_ids,
            template__isnull=False,
            created_at__date__gte=date_from,
            created_at__date__lte=date_to,
        )
        .values("template__name")
        .annotate(count=Count("id"))
        .order_by("-count")
    )
    return {"by_template": [{"template": r["template__name"], "count": r["count"]} for r in qs]}


# ──────────────────────────────────────────────────────────────────────────────
# Report 12 — Technician Performance
# ──────────────────────────────────────────────────────────────────────────────


def technician_performance(shop_ids: list, month: int, year: int) -> dict:
    from repair.models import JobStage, JobTicket
    from commissions.models import TechnicianCommission

    start = date(year, month, 1)
    if month == 12:
        end = date(year + 1, 1, 1) - timedelta(days=1)
    else:
        end = date(year, month + 1, 1) - timedelta(days=1)

    stages = (
        JobStage.objects
        .filter(
            job__shop_id__in=shop_ids,
            job__created_at__date__gte=start,
            job__created_at__date__lte=end,
        )
        .values("assigned_technician_id", "assigned_technician__full_name")
        .annotate(jobs=Count("job_id", distinct=True))
    )

    rows = []
    for s in stages:
        commissions = (
            TechnicianCommission.objects
            .filter(
                technician_id=s["assigned_technician_id"],
                created_at__date__gte=start,
                created_at__date__lte=end,
            )
            .aggregate(total=Sum("commission_amount"))["total"] or _ZERO
        )
        rows.append({
            "technician_id": str(s["assigned_technician_id"]),
            "name": s["assigned_technician__full_name"],
            "jobs_handled": s["jobs"],
            "total_commission": _d(commissions),
        })

    return {"month": month, "year": year, "technicians": rows}


# ──────────────────────────────────────────────────────────────────────────────
# Report 13 — Commission Ledger
# ──────────────────────────────────────────────────────────────────────────────


def commission_ledger(technician_id, month: int, year: int) -> dict:
    from commissions.models import TechnicianCommission

    start = date(year, month, 1)
    if month == 12:
        end = date(year + 1, 1, 1) - timedelta(days=1)
    else:
        end = date(year, month + 1, 1) - timedelta(days=1)

    rows = TechnicianCommission.objects.filter(
        technician_id=technician_id,
        created_at__date__gte=start,
        created_at__date__lte=end,
    ).select_related("job")

    data = [
        {
            "job_number": r.job.job_number,
            "sc_amount": _d(r.sc_amount),
            "rate": _d(r.rate),
            "commission_amount": _d(r.commission_amount),
            "is_paid": r.is_paid,
        }
        for r in rows
    ]
    total = sum(Decimal(r["commission_amount"]) for r in data)
    return {
        "technician_id": str(technician_id),
        "month": month, "year": year,
        "commissions": data,
        "total_commission": _d(total),
    }


# ──────────────────────────────────────────────────────────────────────────────
# Report 14 — Lead Conversion
# ──────────────────────────────────────────────────────────────────────────────


def lead_conversion(shop_ids: list, date_from: date, date_to: date) -> dict:
    from crm.models import Customer, Lead

    leads = Lead.objects.filter(
        shop_id__in=shop_ids,
        created_at__date__gte=date_from,
        created_at__date__lte=date_to,
    )
    converted = leads.filter(status="won")
    return {
        "total_leads": leads.count(),
        "converted": converted.count(),
        "conversion_rate": round(converted.count() / leads.count() * 100, 1) if leads.count() else 0,
    }


# ──────────────────────────────────────────────────────────────────────────────
# Report 15 — Customer Acquisition
# ──────────────────────────────────────────────────────────────────────────────


def customer_acquisition(shop_ids: list, date_from: date, date_to: date) -> dict:
    from crm.models import Customer

    qs = Customer.objects.filter(
        shop_id__in=shop_ids,
        created_at__date__gte=date_from,
        created_at__date__lte=date_to,
        deleted_at__isnull=True,
    )
    by_type = dict(
        qs.values("customer_type").annotate(count=Count("id")).values_list("customer_type", "count")
    )
    return {"total": qs.count(), "by_type": by_type}


# ──────────────────────────────────────────────────────────────────────────────
# Report 16 — Customer Lifetime Value
# ──────────────────────────────────────────────────────────────────────────────


def customer_lifetime_value(shop_ids: list) -> dict:
    from crm.models import Customer

    customers = (
        Customer.objects
        .filter(shop_id__in=shop_ids, deleted_at__isnull=True, total_billed__gt=0)
        .order_by("-total_billed")
        .values("id", "name", "total_billed", "total_outstanding", "total_jobs")
    )
    rows = [
        {
            "customer_id": str(c["id"]),
            "name": c["name"],
            "total_billed": _d(c["total_billed"]),
            "total_outstanding": _d(c["total_outstanding"]),
            "total_jobs": c["total_jobs"],
        }
        for c in customers
    ]
    return {"customers": rows}


# ──────────────────────────────────────────────────────────────────────────────
# Report 17 — AMC Contract Summary
# ──────────────────────────────────────────────────────────────────────────────


def amc_contract_summary(shop_ids: list) -> dict:
    from amc.models import AMCContract

    qs = AMCContract.objects.filter(shop_id__in=shop_ids).values("status").annotate(count=Count("id"))
    by_status = {r["status"]: r["count"] for r in qs}
    return {"by_status": by_status, "total": sum(by_status.values())}


# ──────────────────────────────────────────────────────────────────────────────
# Report 18 — AMC Visit Compliance
# ──────────────────────────────────────────────────────────────────────────────


def amc_visit_compliance(shop_ids: list, date_from: date, date_to: date) -> dict:
    from amc.models import AMCVisit

    qs = AMCVisit.objects.filter(
        contract__shop_id__in=shop_ids,
        scheduled_date__gte=date_from,
        scheduled_date__lte=date_to,
    )
    total = qs.count()
    completed = qs.filter(status="completed").count()
    missed = qs.filter(status="missed").count()
    return {
        "total": total,
        "completed": completed,
        "missed": missed,
        "compliance_rate": round(completed / total * 100, 1) if total else 0,
    }


# ──────────────────────────────────────────────────────────────────────────────
# Report 19 — AMC Revenue
# ──────────────────────────────────────────────────────────────────────────────


def amc_revenue(shop_ids: list, date_from: date, date_to: date) -> dict:
    from amc.models import AMCContract

    qs = AMCContract.objects.filter(
        shop_id__in=shop_ids,
        start_date__lte=date_to,
        end_date__gte=date_from,
    )
    total = qs.aggregate(total=Sum("annual_charge"))["total"] or _ZERO
    return {"total_revenue": _d(total), "contract_count": qs.count()}


# ──────────────────────────────────────────────────────────────────────────────
# Report 20 — Inventory Valuation
# ──────────────────────────────────────────────────────────────────────────────


def inventory_valuation(shop_ids: list) -> dict:
    from inventory.models import InventoryStock

    stocks = InventoryStock.objects.filter(shop_id__in=shop_ids).select_related("variant__product")
    rows = []
    total_value = _ZERO
    for stock in stocks:
        value = stock.quantity_in_stock * stock.variant.cost_price
        total_value += value
        rows.append({
            "sku": stock.variant.sku,
            "product": stock.variant.product.name,
            "qty": str(stock.quantity_in_stock),
            "cost_price": _d(stock.variant.cost_price),
            "total_value": _d(value),
        })
    return {"items": rows, "total_value": _d(total_value)}


# ──────────────────────────────────────────────────────────────────────────────
# Report 21 — Stock Movement Ledger
# ──────────────────────────────────────────────────────────────────────────────


def stock_movement_ledger(shop_ids: list, date_from: date, date_to: date,
                           variant_id=None) -> dict:
    from inventory.models import InventoryTransaction

    qs = InventoryTransaction.objects.filter(
        shop_id__in=shop_ids,
        created_at__date__gte=date_from,
        created_at__date__lte=date_to,
    ).select_related("variant")
    if variant_id:
        qs = qs.filter(variant_id=variant_id)

    rows = [
        {
            "date": str(t.created_at.date()),
            "sku": t.variant.sku,
            "type": t.type,
            "quantity": str(t.quantity),
        }
        for t in qs
    ]
    return {"transactions": rows, "total": len(rows)}


# ──────────────────────────────────────────────────────────────────────────────
# Report 22 — Supplier Payable (Aged)
# ──────────────────────────────────────────────────────────────────────────────


def supplier_payable_aged(shop_ids: list, overdue_days: int = 0) -> dict:
    from procurement.models import PurchaseInvoice

    qs = PurchaseInvoice.objects.filter(
        shop_id__in=shop_ids,
        payment_status__in=["unpaid", "partially_paid"],
    ).select_related("supplier")
    if overdue_days:
        cutoff = timezone.now().date() - timedelta(days=overdue_days)
        qs = qs.filter(due_date__lte=cutoff)

    rows = [
        {
            "supplier": inv.supplier.name,
            "bill_number": inv.bill_number,
            "grand_total": _d(inv.grand_total),
            "outstanding": _d(inv.grand_total - inv.amount_paid),
            "due_date": str(inv.due_date) if inv.due_date else "",
        }
        for inv in qs
    ]
    total = sum(Decimal(r["outstanding"]) for r in rows)
    return {"total_outstanding": _d(total), "invoices": rows}


# ──────────────────────────────────────────────────────────────────────────────
# Report 23 — Purchase Summary
# ──────────────────────────────────────────────────────────────────────────────


def purchase_summary(shop_ids: list, date_from: date, date_to: date) -> dict:
    from procurement.models import PurchaseOrder

    qs = PurchaseOrder.objects.filter(
        shop_id__in=shop_ids,
        created_at__date__gte=date_from,
        created_at__date__lte=date_to,
    ).select_related("supplier")

    by_supplier: dict[str, Decimal] = {}
    for po in qs:
        by_supplier[po.supplier.name] = by_supplier.get(po.supplier.name, _ZERO) + (po.grand_total or _ZERO)

    total_pos = qs.count()
    return {"total_purchase_orders": total_pos, "by_supplier": {k: _d(v) for k, v in by_supplier.items()}}


# ──────────────────────────────────────────────────────────────────────────────
# Report 24 — HR Attendance Summary
# ──────────────────────────────────────────────────────────────────────────────


def hr_attendance_summary(shop_ids: list, month: int, year: int) -> dict:
    from hr.models import AttendanceRecord, Employee

    employees = Employee.objects.filter(shop_id__in=shop_ids, deleted_at__isnull=True)
    rows = []
    for emp in employees:
        recs = AttendanceRecord.objects.filter(
            employee=emp, date__year=year, date__month=month
        )
        present = recs.filter(status="present").count()
        absent = recs.filter(status="absent").count()
        leave = recs.filter(status="leave").count()
        rows.append({
            "employee_code": emp.employee_code,
            "name": emp.full_name,
            "present": present,
            "absent": absent,
            "leave": leave,
        })
    return {"month": month, "year": year, "employees": rows}


# ──────────────────────────────────────────────────────────────────────────────
# Report 25 — Salary Register
# ──────────────────────────────────────────────────────────────────────────────


def salary_register(shop_ids: list, month: int, year: int) -> dict:
    from hr.models import SalarySlip

    slips = (
        SalarySlip.objects
        .filter(employee__shop_id__in=shop_ids, month=month, year=year)
        .select_related("employee")
    )
    rows = [
        {
            "employee_code": s.employee.employee_code,
            "name": s.employee.full_name,
            "gross_earned": _d(s.gross_earned),
            "total_deductions": _d(s.total_deductions),
            "net_salary": _d(s.net_salary),
            "status": s.status,
        }
        for s in slips
    ]
    total_net = sum(Decimal(r["net_salary"]) for r in rows)
    return {"month": month, "year": year, "slips": rows, "total_net_salary": _d(total_net)}


# ──────────────────────────────────────────────────────────────────────────────
# Report 26 — Petty Cash Summary
# ──────────────────────────────────────────────────────────────────────────────


def petty_cash_summary(shop_ids: list, month: int, year: int) -> dict:
    from finance.models import PettyCashAccount, PettyCashTransaction

    accounts = PettyCashAccount.objects.filter(shop_id__in=shop_ids)
    rows = []
    for acc in accounts:
        txns = PettyCashTransaction.objects.filter(
            account=acc, date__year=year, date__month=month
        )
        credits = txns.filter(txn_type="credit").aggregate(t=Sum("amount"))["t"] or _ZERO
        debits = txns.filter(txn_type="debit").aggregate(t=Sum("amount"))["t"] or _ZERO
        rows.append({
            "account": acc.name,
            "current_balance": _d(acc.current_balance),
            "credits": _d(credits),
            "debits": _d(debits),
        })
    return {"month": month, "year": year, "accounts": rows}


# ──────────────────────────────────────────────────────────────────────────────
# Report 27 — GSTR-1 (Outward)  — also used by billing Tally export
# ──────────────────────────────────────────────────────────────────────────────


def gstr1_csv(shop_ids: list, month: int, year: int) -> str:
    from billing.models import RepairInvoice

    invoices = (
        RepairInvoice.objects
        .filter(
            shop_id__in=shop_ids,
            created_at__year=year,
            created_at__month=month,
        )
        .exclude(status="cancelled")
        .select_related("customer")
        .order_by("created_at")
    )

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "invoice_number", "date", "customer_name", "gstin",
        "taxable_value", "cgst", "sgst", "igst", "total",
    ])
    for inv in invoices:
        taxable = inv.subtotal - inv.discount_amount
        writer.writerow([
            inv.invoice_number,
            inv.created_at.strftime("%Y-%m-%d"),
            inv.customer.name,
            inv.customer.gstin or "",
            _d(taxable),
            _d(inv.cgst),
            _d(inv.sgst),
            _d(inv.igst),
            _d(inv.grand_total),
        ])
    return output.getvalue()


# ──────────────────────────────────────────────────────────────────────────────
# Report 28 — GSTR-2 Proxy (Inward)
# ──────────────────────────────────────────────────────────────────────────────


def gstr2_proxy_csv(shop_ids: list, month: int, year: int) -> str:
    from procurement.models import PurchaseInvoice

    invoices = (
        PurchaseInvoice.objects
        .filter(
            shop_id__in=shop_ids,
            bill_date__year=year,
            bill_date__month=month,
        )
        .select_related("supplier")
        .order_by("bill_date")
    )

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "bill_number", "bill_date", "supplier_name", "supplier_gstin",
        "taxable_value", "cgst", "sgst", "igst", "grand_total",
    ])
    for inv in invoices:
        writer.writerow([
            inv.bill_number,
            str(inv.bill_date),
            inv.supplier.name,
            inv.supplier.gstin or "",
            _d(inv.subtotal),
            _d(inv.cgst),
            _d(inv.sgst),
            _d(inv.igst),
            _d(inv.grand_total),
        ])
    return output.getvalue()
