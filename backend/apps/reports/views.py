"""
Reports API views.

Pattern: single ReportView dispatches to a service function by report_type slug.
ExportView creates an ExportJob (queued) and returns 202 — Celery task runs it async.
"""

import logging
from datetime import date

from django.http import HttpResponse
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from authentication.permissions import require_permission

from . import services
from .models import ExportJob

logger = logging.getLogger(__name__)


def _shop_ids_from_request(request: Request) -> list:
    """
    Resolve the shop_ids the user may access.

    If ?shop_id= is passed and the user has tenant-wide access (or that shop
    is in their JWT shop_ids), use it. Otherwise use all JWT shop_ids.
    """
    token = getattr(request, "auth", None)
    if token is None:
        return []

    if token.get("is_tenant_wide") or token.get("is_platform_admin"):
        shop_id = request.query_params.get("shop_id")
        if shop_id:
            return [shop_id]
        # Tenant-wide with no filter: return empty so callers can decide
        # what makes sense (most reports require a shop_id).
        return []

    jwt_shops = token.get("shop_ids", [])
    shop_id = request.query_params.get("shop_id")
    if shop_id and str(shop_id) in [str(s) for s in jwt_shops]:
        return [str(shop_id)]
    return [str(s) for s in jwt_shops]


def _parse_date(value: str, default: date = None) -> date:
    if not value:
        return default
    return date.fromisoformat(value)


class DashboardView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request: Request) -> Response:
        shop_ids = _shop_ids_from_request(request)
        return Response(services.dashboard(shop_ids))


# ── Report map ─────────────────────────────────────────────────────────────────
# Maps slug → (permission_suffix, callable)

def _revenue_summary(shop_ids, qp):
    return services.revenue_summary(
        shop_ids,
        _parse_date(qp.get("date_from"), date(2020, 1, 1)),
        _parse_date(qp.get("date_to"), date.today()),
    )


def _outstanding_dues(shop_ids, qp):
    return services.outstanding_dues_repair(
        shop_ids,
        int(qp.get("overdue_days", 0)),
    )


def _job_status_summary(shop_ids, qp):
    return services.job_status_summary(
        shop_ids,
        _parse_date(qp.get("date_from"), date(2020, 1, 1)),
        _parse_date(qp.get("date_to"), date.today()),
        qp.get("technician_id"),
    )


def _job_turnaround(shop_ids, qp):
    return services.job_turnaround_time(
        shop_ids,
        _parse_date(qp.get("date_from"), date(2020, 1, 1)),
        _parse_date(qp.get("date_to"), date.today()),
        qp.get("device_type", ""),
    )


def _warranty_claims(shop_ids, qp):
    return services.warranty_claims(
        shop_ids,
        _parse_date(qp.get("date_from"), date(2020, 1, 1)),
        _parse_date(qp.get("date_to"), date.today()),
    )


def _fault_template_usage(shop_ids, qp):
    return services.fault_template_usage(
        shop_ids,
        _parse_date(qp.get("date_from"), date(2020, 1, 1)),
        _parse_date(qp.get("date_to"), date.today()),
    )


def _technician_performance(shop_ids, qp):
    return services.technician_performance(
        shop_ids, int(qp.get("month", date.today().month)),
        int(qp.get("year", date.today().year)),
    )


def _commission_ledger(shop_ids, qp):
    return services.commission_ledger(
        qp.get("technician_id"),
        int(qp.get("month", date.today().month)),
        int(qp.get("year", date.today().year)),
    )


def _lead_conversion(shop_ids, qp):
    return services.lead_conversion(
        shop_ids,
        _parse_date(qp.get("date_from"), date(2020, 1, 1)),
        _parse_date(qp.get("date_to"), date.today()),
    )


def _customer_acquisition(shop_ids, qp):
    return services.customer_acquisition(
        shop_ids,
        _parse_date(qp.get("date_from"), date(2020, 1, 1)),
        _parse_date(qp.get("date_to"), date.today()),
    )


def _clv(shop_ids, qp):
    return services.customer_lifetime_value(shop_ids)


def _amc_contract_summary(shop_ids, qp):
    return services.amc_contract_summary(shop_ids)


def _amc_visit_compliance(shop_ids, qp):
    return services.amc_visit_compliance(
        shop_ids,
        _parse_date(qp.get("date_from"), date(2020, 1, 1)),
        _parse_date(qp.get("date_to"), date.today()),
    )


def _amc_revenue(shop_ids, qp):
    return services.amc_revenue(
        shop_ids,
        _parse_date(qp.get("date_from"), date(2020, 1, 1)),
        _parse_date(qp.get("date_to"), date.today()),
    )


def _inventory_valuation(shop_ids, qp):
    return services.inventory_valuation(shop_ids)


def _stock_movement(shop_ids, qp):
    return services.stock_movement_ledger(
        shop_ids,
        _parse_date(qp.get("date_from"), date(2020, 1, 1)),
        _parse_date(qp.get("date_to"), date.today()),
        qp.get("variant_id"),
    )


def _supplier_payable(shop_ids, qp):
    return services.supplier_payable_aged(shop_ids, int(qp.get("overdue_days", 0)))


def _purchase_summary(shop_ids, qp):
    return services.purchase_summary(
        shop_ids,
        _parse_date(qp.get("date_from"), date(2020, 1, 1)),
        _parse_date(qp.get("date_to"), date.today()),
    )


def _hr_attendance_summary(shop_ids, qp):
    return services.hr_attendance_summary(
        shop_ids,
        int(qp.get("month", date.today().month)),
        int(qp.get("year", date.today().year)),
    )


def _salary_register(shop_ids, qp):
    return services.salary_register(
        shop_ids,
        int(qp.get("month", date.today().month)),
        int(qp.get("year", date.today().year)),
    )


def _petty_cash_summary(shop_ids, qp):
    return services.petty_cash_summary(
        shop_ids,
        int(qp.get("month", date.today().month)),
        int(qp.get("year", date.today().year)),
    )


def _budget_vs_actual(shop_ids, qp):
    return services.budget_vs_actual(
        shop_ids,
        int(qp.get("month", date.today().month)),
        int(qp.get("year", date.today().year)),
    )


def _payment_collection_log(shop_ids, qp):
    return services.payment_collection_log(
        shop_ids,
        _parse_date(qp.get("date_from"), date(2020, 1, 1)),
        _parse_date(qp.get("date_to"), date.today()),
        qp.get("method", ""),
    )


def _pnl_summary(shop_ids, qp):
    return services.pnl_summary(
        shop_ids,
        int(qp.get("month", date.today().month)),
        int(qp.get("year", date.today().year)),
    )


def _outstanding_wholesale(shop_ids, qp):
    return services.outstanding_dues_wholesale(shop_ids)


REPORT_REGISTRY: dict[str, tuple[str, callable]] = {
    "revenue-summary":          ("billing", _revenue_summary),
    "outstanding-dues":         ("billing", _outstanding_dues),
    "outstanding-dues-wholesale": ("erp",   _outstanding_wholesale),
    "payment-collection-log":   ("billing", _payment_collection_log),
    "pnl-summary":              ("billing", _pnl_summary),
    "expense-by-category":      ("erp",     lambda s, q: services.expense_by_category(
                                                s, _parse_date(q.get("date_from"), date(2020,1,1)),
                                                _parse_date(q.get("date_to"), date.today()),
                                                q.get("category", ""))),
    "budget-vs-actual":         ("erp",     _budget_vs_actual),
    "job-status-summary":       ("repair",  _job_status_summary),
    "job-turnaround-time":      ("repair",  _job_turnaround),
    "warranty-claims":          ("repair",  _warranty_claims),
    "fault-template-usage":     ("repair",  _fault_template_usage),
    "technician-performance":   ("repair",  _technician_performance),
    "commission-ledger":        ("hr",      _commission_ledger),
    "lead-conversion":          ("crm",     _lead_conversion),
    "customer-acquisition":     ("crm",     _customer_acquisition),
    "customer-lifetime-value":  ("crm",     _clv),
    "amc-contract-summary":     ("amc",     _amc_contract_summary),
    "amc-visit-compliance":     ("amc",     _amc_visit_compliance),
    "amc-revenue":              ("amc",     _amc_revenue),
    "inventory-valuation":      ("erp",     _inventory_valuation),
    "stock-movement-ledger":    ("erp",     _stock_movement),
    "supplier-payable-aged":    ("erp",     _supplier_payable),
    "purchase-summary":         ("erp",     _purchase_summary),
    "hr-attendance-summary":    ("hr",      _hr_attendance_summary),
    "salary-register":          ("hr",      _salary_register),
    "petty-cash-summary":       ("hr",      _petty_cash_summary),
}

# CSV reports served as downloads rather than JSON
CSV_REPORTS = {"gstr1", "gstr2-proxy"}


class ReportView(APIView):
    """
    Dispatch to report service by slug.

    GET ?export=csv|pdf  → create ExportJob (202); Celery runs it async.
    GET (no export param) → return JSON data immediately.
    """

    def get(self, request: Request, report_type: str) -> Response:
        entry = REPORT_REGISTRY.get(report_type)
        if not entry:
            return Response({"detail": f"Unknown report '{report_type}'."}, status=status.HTTP_404_NOT_FOUND)

        module, fn = entry
        perm = f"reports.{module}.view"
        token = getattr(request, "auth", None)
        perms = token.get("permissions", []) if token else []
        if perm not in perms:
            return Response({"detail": "Permission denied."}, status=status.HTTP_403_FORBIDDEN)

        # Export path — create an async job
        fmt = request.query_params.get("export", "")
        if fmt in ("csv", "pdf"):
            job = ExportJob.objects.create(
                report_type=report_type,
                filters=dict(request.query_params),
                format=fmt,
                status=ExportJob.Status.QUEUED,
                requested_by=request.user if request.user.is_authenticated else None,
            )
            # tasks.run_export.delay(str(job.id))  — wire when Celery is configured
            return Response(
                {"export_job_id": str(job.id), "status": job.status},
                status=status.HTTP_202_ACCEPTED,
            )

        shop_ids = _shop_ids_from_request(request)
        data = fn(shop_ids, request.query_params)
        return Response(data)


class ExportJobListView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request: Request) -> Response:
        jobs = ExportJob.objects.filter(
            requested_by=request.user
        ).order_by("-created_at").values(
            "id", "report_type", "format", "status", "file_url", "created_at"
        )
        return Response(list(jobs))


class GSTR1View(APIView):
    permission_classes = [IsAuthenticated, require_permission("reports.billing.view")]

    def get(self, request: Request) -> Response:
        shop_ids = _shop_ids_from_request(request)
        month = int(request.query_params.get("month", date.today().month))
        year = int(request.query_params.get("year", date.today().year))
        csv_data = services.gstr1_csv(shop_ids, month, year)
        response = HttpResponse(csv_data, content_type="text/csv; charset=utf-8")
        response["Content-Disposition"] = f'attachment; filename="gstr1-{year}-{month:02d}.csv"'
        return response


class GSTR2View(APIView):
    permission_classes = [IsAuthenticated, require_permission("reports.erp.view")]

    def get(self, request: Request) -> Response:
        shop_ids = _shop_ids_from_request(request)
        month = int(request.query_params.get("month", date.today().month))
        year = int(request.query_params.get("year", date.today().year))
        csv_data = services.gstr2_proxy_csv(shop_ids, month, year)
        response = HttpResponse(csv_data, content_type="text/csv; charset=utf-8")
        response["Content-Disposition"] = f'attachment; filename="gstr2-proxy-{year}-{month:02d}.csv"'
        return response
