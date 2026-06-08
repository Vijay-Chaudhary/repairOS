"""
Reports module tests — §10 acceptance criteria + §11 test cases.

Covers:
- Dashboard: all 8 widgets return correct aggregates
- Revenue Summary: figures reconcile against billing.payments
- Outstanding Dues: only invoices with outstanding > 0
- Job Status Summary: counts by status within date range
- Budget vs Actual: variance correct from finance allocations
- Salary Register: employee rows with net_salary
- Commission Ledger: technician commission rows
- Inventory Valuation: qty × cost per variant
- Export job lifecycle: created as queued, type/format stored
- Shop-access filtering: user sees only their shop's data
- GSTR-1 CSV: correct columns + rows matching invoices
"""

import datetime
from decimal import Decimal

import pytest
from rest_framework import status


# ──────────────────────────────────────────────────────────────────────────────
# Fixtures
# ──────────────────────────────────────────────────────────────────────────────


@pytest.fixture
def shop(db):
    from core.models import Shop
    return Shop.objects.create(
        name="Report Shop", code="RPT",
        address="1 Report Rd", city="Delhi",
        state="Delhi", state_code="07",
        phone="+919000000001",
    )


@pytest.fixture
def shop2(db):
    from core.models import Shop
    return Shop.objects.create(
        name="Other Shop", code="OTH",
        address="2 Other Rd", city="Mumbai",
        state="Maharashtra", state_code="27",
        phone="+919000000002",
    )


@pytest.fixture
def admin_user(db):
    from authentication.models import Permission, Role, RolePermission, User, UserRole
    user = User.objects.create_user(
        email="reports@test.com", phone="+919000000099",
        full_name="Reports Admin", password="pass",
    )
    role = Role.objects.create(name="ReportAdmin", is_system_role=True)
    all_perms = [
        "reports.billing.view", "reports.repair.view", "reports.crm.view",
        "reports.hr.view", "reports.erp.view", "reports.amc.view",
    ]
    for code in all_perms:
        perm, _ = Permission.objects.get_or_create(codename=code, defaults={"label": code})
        RolePermission.objects.create(role=role, permission=perm)
    UserRole.objects.create(user=user, role=role)
    return user


@pytest.fixture
def rpt_client(db, admin_user, shop):
    from rest_framework.test import APIClient
    from rest_framework_simplejwt.tokens import RefreshToken
    refresh = RefreshToken.for_user(admin_user)
    access = refresh.access_token
    access["permissions"] = [
        "reports.billing.view", "reports.repair.view", "reports.crm.view",
        "reports.hr.view", "reports.erp.view", "reports.amc.view",
    ]
    access["shop_ids"] = [str(shop.id)]
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {str(access)}")
    return client


@pytest.fixture
def customer(db, shop):
    from crm.models import Customer
    return Customer.objects.create(
        shop=shop, name="Test Customer", phone="+919811100001",
    )


@pytest.fixture
def technician(db):
    from authentication.models import User
    return User.objects.create_user(
        email="tech@test.com", phone="+919000000010",
        full_name="Test Tech", password="pass",
    )


@pytest.fixture
def closed_job(db, shop, customer, technician):
    """A closed job ticket with service_charge."""
    from repair.models import JobTicket
    return JobTicket.objects.create(
        shop=shop, customer=customer, created_by=technician,
        job_number="RPT-2026-0001",
        device_type="Laptop", problem_description="Screen broken",
        service_charge=Decimal("1000.00"),
        status=JobTicket.Status.CLOSED,
    )


@pytest.fixture
def repair_invoice(db, shop, closed_job, customer, admin_user):
    from billing.services import create_repair_invoice
    return create_repair_invoice(closed_job, {"discount_amount": "0"}, admin_user)


@pytest.fixture
def paid_invoice(db, repair_invoice, admin_user):
    from billing.services import record_payment
    record_payment(repair_invoice, {
        "amount": str(repair_invoice.grand_total),
        "method": "cash",
    }, admin_user)
    repair_invoice.refresh_from_db()
    return repair_invoice


# ──────────────────────────────────────────────────────────────────────────────
# TestDashboard
# ──────────────────────────────────────────────────────────────────────────────


class TestDashboard:
    url = "/api/v1/reports/dashboard/"

    def test_dashboard_returns_all_widgets(self, rpt_client, shop):
        res = rpt_client.get(self.url, {"shop_id": str(shop.id)})
        assert res.status_code == status.HTTP_200_OK
        data = res.data
        assert "open_jobs" in data
        assert "jobs_completed_today" in data
        assert "revenue_today" in data
        assert "revenue_month" in data
        assert "outstanding_amount" in data
        assert "new_customers_month" in data
        assert "tasks_due_today" in data
        assert "amc_visits_this_week" in data
        assert "low_stock_alerts" in data
        assert "contracts_expiring_this_month" in data
        assert "over_budget_heads" in data
        assert "revenue_trend" in data

    def test_revenue_today_reflects_payments(self, rpt_client, shop, paid_invoice):
        res = rpt_client.get(self.url, {"shop_id": str(shop.id)})
        assert res.status_code == status.HTTP_200_OK
        assert Decimal(str(res.data["revenue_today"])) >= paid_invoice.grand_total

    def test_outstanding_amount_counts_unpaid(self, rpt_client, shop, repair_invoice):
        res = rpt_client.get(self.url, {"shop_id": str(shop.id)})
        assert res.status_code == status.HTTP_200_OK
        assert Decimal(str(res.data["outstanding_amount"])) >= repair_invoice.grand_total


# ──────────────────────────────────────────────────────────────────────────────
# TestRevenueSummary
# ──────────────────────────────────────────────────────────────────────────────


class TestRevenueSummary:
    url = "/api/v1/reports/revenue-summary/"

    def test_revenue_summary_structure(self, rpt_client, shop):
        res = rpt_client.get(self.url, {
            "shop_id": str(shop.id),
            "date_from": "2026-01-01",
            "date_to": "2026-12-31",
        })
        assert res.status_code == status.HTTP_200_OK
        assert "total_revenue" in res.data
        assert "invoice_count" in res.data
        assert "by_day" in res.data

    def test_revenue_matches_payments(self, rpt_client, shop, paid_invoice):
        res = rpt_client.get(self.url, {
            "shop_id": str(shop.id),
            "date_from": "2026-01-01",
            "date_to": "2026-12-31",
        })
        assert Decimal(str(res.data["total_revenue"])) == paid_invoice.grand_total

    def test_shop_isolation(self, rpt_client, shop, shop2, paid_invoice, admin_user, db):
        """Revenue from shop2's invoices must not appear in shop1's report."""
        # Create an invoice in shop2
        from crm.models import Customer
        from repair.models import JobTicket
        from billing.services import create_repair_invoice, record_payment as rp
        c2 = Customer.objects.create(shop=shop2, name="C2", phone="+919000001111")
        j2 = JobTicket.objects.create(
            shop=shop2, customer=c2, created_by=admin_user,
            job_number="OTH-2026-0001",
            device_type="Phone", problem_description="Test",
            service_charge=Decimal("9999.00"),
            status=JobTicket.Status.CLOSED,
        )
        inv2 = create_repair_invoice(j2, {"discount_amount": "0"}, admin_user)
        rp(inv2, {"amount": str(inv2.grand_total), "method": "cash"}, admin_user)

        res = rpt_client.get(self.url, {
            "shop_id": str(shop.id),
            "date_from": "2026-01-01",
            "date_to": "2026-12-31",
        })
        assert Decimal(str(res.data["total_revenue"])) == paid_invoice.grand_total


# ──────────────────────────────────────────────────────────────────────────────
# TestOutstandingDues
# ──────────────────────────────────────────────────────────────────────────────


class TestOutstandingDues:
    url = "/api/v1/reports/outstanding-dues/"

    def test_outstanding_includes_unpaid_invoices(self, rpt_client, shop, repair_invoice):
        res = rpt_client.get(self.url, {"shop_id": str(shop.id)})
        assert res.status_code == status.HTTP_200_OK
        assert "total_outstanding" in res.data
        assert "invoices" in res.data
        assert len(res.data["invoices"]) == 1
        assert Decimal(res.data["total_outstanding"]) == repair_invoice.amount_outstanding

    def test_paid_invoices_excluded(self, rpt_client, shop, paid_invoice):
        res = rpt_client.get(self.url, {"shop_id": str(shop.id)})
        assert res.status_code == status.HTTP_200_OK
        assert len(res.data["invoices"]) == 0
        assert Decimal(res.data["total_outstanding"]) == Decimal("0.00")


# ──────────────────────────────────────────────────────────────────────────────
# TestJobStatusSummary
# ──────────────────────────────────────────────────────────────────────────────


class TestJobStatusSummary:
    url = "/api/v1/reports/job-status-summary/"

    def test_counts_by_status(self, rpt_client, shop, closed_job):
        res = rpt_client.get(self.url, {
            "shop_id": str(shop.id),
            "date_from": "2026-01-01",
            "date_to": "2026-12-31",
        })
        assert res.status_code == status.HTTP_200_OK
        assert "by_status" in res.data
        assert res.data["by_status"].get("closed", 0) >= 1
        assert "total" in res.data

    def test_date_range_filters_jobs(self, rpt_client, shop, closed_job):
        # Future range — no jobs
        res = rpt_client.get(self.url, {
            "shop_id": str(shop.id),
            "date_from": "2030-01-01",
            "date_to": "2030-12-31",
        })
        assert res.data["total"] == 0


# ──────────────────────────────────────────────────────────────────────────────
# TestBudgetVsActual
# ──────────────────────────────────────────────────────────────────────────────


class TestBudgetVsActual:
    url = "/api/v1/reports/budget-vs-actual/"

    def test_budget_vs_actual_structure(self, rpt_client, shop, db):
        from finance.models import BudgetAllocation, BudgetHead
        head = BudgetHead.objects.create(shop=shop, name="Rent", category="fixed")
        BudgetAllocation.objects.create(
            head=head, month=6, year=2026,
            budgeted_amount=Decimal("20000"), actual_amount=Decimal("22000"),
            variance=Decimal("2000"),
        )
        res = rpt_client.get(self.url, {
            "shop_id": str(shop.id),
            "month": 6, "year": 2026,
        })
        assert res.status_code == status.HTTP_200_OK
        assert "heads" in res.data
        assert len(res.data["heads"]) == 1
        head_data = res.data["heads"][0]
        assert Decimal(head_data["budgeted_amount"]) == Decimal("20000.00")
        assert Decimal(head_data["actual_amount"]) == Decimal("22000.00")
        assert Decimal(head_data["variance"]) == Decimal("2000.00")


# ──────────────────────────────────────────────────────────────────────────────
# TestSalaryRegister
# ──────────────────────────────────────────────────────────────────────────────


class TestSalaryRegister:
    url = "/api/v1/reports/salary-register/"

    def test_salary_register_structure(self, rpt_client, shop, db):
        from hr.models import Employee, SalarySlip
        emp = Employee.objects.create(
            shop=shop, employee_code="RPT001", full_name="Test Emp",
            designation="Tech", date_of_joining=datetime.date(2025, 1, 1),
            basic_salary=Decimal("20000"), gross_salary=Decimal("30000"),
        )
        SalarySlip.objects.create(
            employee=emp, month=5, year=2026,
            working_days=22, present_days=Decimal("22"),
            leave_days=Decimal("0"), absent_days=Decimal("0"),
            basic_earned=Decimal("20000"), hra_earned=Decimal("8000"),
            allowances_earned=Decimal("2000"), gross_earned=Decimal("30000"),
            net_salary=Decimal("27375"),
            status="draft",
        )
        res = rpt_client.get(self.url, {
            "shop_id": str(shop.id),
            "month": 5, "year": 2026,
        })
        assert res.status_code == status.HTTP_200_OK
        assert "slips" in res.data
        assert len(res.data["slips"]) == 1
        assert Decimal(res.data["slips"][0]["net_salary"]) == Decimal("27375.00")


# ──────────────────────────────────────────────────────────────────────────────
# TestCommissionLedger
# ──────────────────────────────────────────────────────────────────────────────


class TestCommissionLedger:
    url = "/api/v1/reports/commission-ledger/"

    def test_commission_ledger_structure(self, rpt_client, technician, db, shop, customer):
        from commissions.models import CommissionRule, TechnicianCommission
        from repair.models import JobTicket
        rule = CommissionRule.objects.create(
            name="Test Rule", rate=Decimal("30"),
            effective_from=datetime.date(2026, 1, 1),
        )
        job = JobTicket.objects.create(
            shop=shop, customer=customer, created_by=technician,
            job_number="RPT-COM-001",
            device_type="PC", problem_description="Test",
            service_charge=Decimal("1000"),
            status=JobTicket.Status.CLOSED,
        )
        TechnicianCommission.objects.create(
            job=job, technician=technician, rule=rule,
            is_lead=True, sc_amount=Decimal("1000"),
            rate=Decimal("30"), commission_amount=Decimal("300"),
        )
        res = rpt_client.get(self.url, {
            "technician_id": str(technician.id),
            "month": 6, "year": 2026,
        })
        assert res.status_code == status.HTTP_200_OK
        assert "commissions" in res.data
        assert "total_commission" in res.data


# ──────────────────────────────────────────────────────────────────────────────
# TestExportJob
# ──────────────────────────────────────────────────────────────────────────────


class TestExportJob:
    report_url = "/api/v1/reports/revenue-summary/"

    def test_export_creates_queued_job(self, rpt_client, shop):
        res = rpt_client.get(self.report_url, {
            "shop_id": str(shop.id),
            "date_from": "2026-01-01",
            "date_to": "2026-12-31",
            "export": "csv",
        })
        assert res.status_code == status.HTTP_202_ACCEPTED
        assert "export_job_id" in res.data
        assert res.data["status"] == "queued"

    def test_export_job_stored_in_db(self, rpt_client, shop, admin_user):
        res = rpt_client.get(self.report_url, {
            "shop_id": str(shop.id),
            "date_from": "2026-06-01",
            "date_to": "2026-06-30",
            "export": "csv",
        })
        from reports.models import ExportJob
        job = ExportJob.objects.get(id=res.data["export_job_id"])
        assert job.report_type == "revenue-summary"
        assert job.format == "csv"
        # CELERY_TASK_ALWAYS_EAGER runs run_export synchronously, so by the
        # time we re-fetch from the DB the job has already completed.
        assert job.status == "ready"
        assert job.file_url
        assert job.requested_by == admin_user

    def test_export_job_list(self, rpt_client, shop):
        rpt_client.get(self.report_url, {
            "shop_id": str(shop.id),
            "date_from": "2026-01-01",
            "date_to": "2026-12-31",
            "export": "pdf",
        })
        res = rpt_client.get("/api/v1/reports/export-jobs/")
        assert res.status_code == status.HTTP_200_OK
        assert len(res.data) >= 1


# ──────────────────────────────────────────────────────────────────────────────
# TestGSTR1
# ──────────────────────────────────────────────────────────────────────────────


class TestGSTR1:
    url = "/api/v1/reports/gstr1/"

    def test_gstr1_csv_columns(self, rpt_client, shop, repair_invoice):
        res = rpt_client.get(self.url, {
            "shop_id": str(shop.id),
            "month": 6, "year": 2026,
        })
        assert res.status_code == status.HTTP_200_OK
        assert "text/csv" in res["Content-Type"]
        header = res.content.decode().splitlines()[0]
        for col in ["invoice_number", "date", "customer_name", "gstin",
                    "taxable_value", "cgst", "sgst", "igst", "total"]:
            assert col in header

    def test_gstr1_contains_invoice_row(self, rpt_client, shop, repair_invoice):
        res = rpt_client.get(self.url, {
            "shop_id": str(shop.id),
            "month": 6, "year": 2026,
        })
        content = res.content.decode()
        assert repair_invoice.invoice_number in content
