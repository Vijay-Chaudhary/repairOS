"""
Pattern 4 — Shop isolation on detail/mutation views.

Verifies that a user scoped to Shop A receives 404 (or 403 for URL-param
resources) when accessing or mutating records belonging to Shop B.

Modules covered: POS, AMC, HR, Finance.
CRM isolation is already covered in crm/tests/test_leads.py.
"""

import datetime
from decimal import Decimal

import pytest
from rest_framework import status
from rest_framework.test import APIClient


# ──────────────────────────────────────────────────────────────────────────────
# Shared helpers
# ──────────────────────────────────────────────────────────────────────────────


@pytest.fixture
def shop_a(db):
    from core.models import Shop
    return Shop.objects.create(
        name="Shop Alpha", code="PA4A",
        address="1 Alpha Rd", city="Delhi",
        state="Delhi", state_code="07",
        phone="+919900100001",
    )


@pytest.fixture
def shop_b(db):
    from core.models import Shop
    return Shop.objects.create(
        name="Shop Beta", code="PA4B",
        address="2 Beta Rd", city="Mumbai",
        state="Maharashtra", state_code="27",
        phone="+919900100002",
    )


@pytest.fixture
def system_user(db):
    """Minimal User required as FK on model objects (e.g. Sale.created_by)."""
    from authentication.models import User
    return User.objects.create_user(
        email="sys@isolation.test",
        phone="+919900100099",
        full_name="System",
        password="pass",
    )


def _make_scoped_client(shop, email, phone, permission_codenames):
    """Return an APIClient authenticated as a shop-specific (non-tenant-wide) user."""
    from authentication.models import Permission, Role, RolePermission, User, UserRole
    from authentication.tokens import _build_token_claims
    from rest_framework_simplejwt.tokens import RefreshToken

    user = User.objects.create_user(
        email=email, phone=phone, full_name="Scoped User", password="Pass@123",
    )
    role_name = f"Role_{email[:40]}"
    role, _ = Role.objects.get_or_create(name=role_name)
    for codename in permission_codenames:
        perm, _ = Permission.objects.get_or_create(
            codename=codename,
            defaults={"module": codename.split(".")[0], "label": codename},
        )
        RolePermission.objects.get_or_create(role=role, permission=perm)
    UserRole.objects.create(user=user, role=role, shop=shop)

    client = APIClient()
    refresh = RefreshToken.for_user(user)
    access = refresh.access_token
    for k, v in _build_token_claims(user, "test").items():
        access[k] = v
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {str(access)}")
    return client


# ──────────────────────────────────────────────────────────────────────────────
# POS — SalesReturnViewSet
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.django_db
class TestPOSSalesReturnIsolation:
    """
    SalesReturnViewSet.get_queryset filters by sale__shop_id__in=shop_ids.
    A user scoped to Shop A must get 404 for a return that belongs to Shop B.
    """

    PERMS = ["pos.returns.approve"]

    def _make_return(self, shop, system_user):
        from pos.models import Sale, SalesReturn
        sale = Sale.objects.create(
            shop=shop,
            sale_type=Sale.SaleType.COUNTER,
            sale_number=f"SL-{shop.code}-001",
            grand_total=Decimal("1000.00"),
            status=Sale.Status.COMPLETED,
            created_by=system_user,
        )
        return SalesReturn.objects.create(
            sale=sale,
            return_number=f"RET-{shop.code}-001",
            reason="Defective",
            total_refund_amount=Decimal("500.00"),
            refund_method=SalesReturn.RefundMethod.CASH,
        )

    def test_shop_a_user_gets_404_on_shop_b_return_review(self, db, shop_a, shop_b, system_user):
        return_b = self._make_return(shop_b, system_user)
        client_a = _make_scoped_client(shop_a, "pos_a@iso.test", "+919900200001", self.PERMS)

        res = client_a.patch(
            f"/api/v1/pos/sales/returns/{return_b.id}/",
            {"action": "approve"},
            format="json",
        )
        assert res.status_code == status.HTTP_404_NOT_FOUND, (
            f"Shop A user should not access Shop B return — got {res.status_code}"
        )

    def test_shop_a_user_can_review_own_shop_return(self, db, shop_a, system_user):
        """Positive check: same-shop return is accessible."""
        return_a = self._make_return(shop_a, system_user)
        client_a = _make_scoped_client(shop_a, "pos_a2@iso.test", "+919900200002", self.PERMS)

        res = client_a.patch(
            f"/api/v1/pos/sales/returns/{return_a.id}/",
            {"action": "approve"},
            format="json",
        )
        assert res.status_code != status.HTTP_404_NOT_FOUND, (
            "Shop A user should be able to access own-shop return"
        )


# ──────────────────────────────────────────────────────────────────────────────
# AMC — AMCVisitViewSet
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.django_db
class TestAMCVisitIsolation:
    """
    AMCVisitViewSet.get_queryset filters by contract__shop_id__in=shop_ids.
    A user scoped to Shop A must get 404 for complete/reschedule on Shop B visits.
    """

    PERMS = ["amc.visits.complete"]

    def _make_visit(self, shop, system_user):
        from crm.models import Customer
        from amc.models import AMCContract, AMCVisit

        customer = Customer.objects.create(
            shop=shop,
            name=f"AMC Client {shop.code}",
            phone=f"+919900{shop.state_code}0001",
        )
        contract = AMCContract.objects.create(
            shop=shop,
            customer=customer,
            contract_number=f"AMC-{shop.code}-001",
            title=f"AC Maintenance {shop.code}",
            start_date=datetime.date(2026, 1, 1),
            end_date=datetime.date(2026, 12, 31),
            value=Decimal("12000.00"),
            payment_terms=AMCContract.PaymentTerms.UPFRONT,
            visits_per_year=4,
            visit_interval_days=91,
            created_by=system_user,
        )
        return AMCVisit.objects.create(
            contract=contract,
            visit_number=1,
            scheduled_date=datetime.date(2026, 3, 1),
        )

    def test_shop_a_user_gets_404_on_shop_b_visit_complete(self, db, shop_a, shop_b, system_user):
        visit_b = self._make_visit(shop_b, system_user)
        client_a = _make_scoped_client(shop_a, "amc_a@iso.test", "+919900300001", self.PERMS)

        res = client_a.post(
            f"/api/v1/amc/visits/{visit_b.id}/complete/",
            {"work_done": "Cleaned filters"},
            format="json",
        )
        assert res.status_code == status.HTTP_404_NOT_FOUND, (
            f"Shop A user should not complete Shop B visit — got {res.status_code}"
        )

    def test_shop_a_user_gets_404_on_shop_b_visit_reschedule(self, db, shop_a, shop_b, system_user):
        visit_b = self._make_visit(shop_b, system_user)
        client_a = _make_scoped_client(
            shop_a, "amc_a2@iso.test", "+919900300002",
            ["amc.visits.schedule"],  # reschedule requires amc.visits.schedule
        )

        res = client_a.post(
            f"/api/v1/amc/visits/{visit_b.id}/reschedule/",
            {"new_date": "2026-04-01", "reason": "Technician sick"},
            format="json",
        )
        assert res.status_code == status.HTTP_404_NOT_FOUND, (
            f"Shop A user should not reschedule Shop B visit — got {res.status_code}"
        )

    def test_shop_a_user_can_complete_own_shop_visit(self, db, shop_a, system_user):
        """Positive check: same-shop visit is accessible."""
        visit_a = self._make_visit(shop_a, system_user)
        client_a = _make_scoped_client(shop_a, "amc_a3@iso.test", "+919900300003", self.PERMS)

        res = client_a.post(
            f"/api/v1/amc/visits/{visit_a.id}/complete/",
            {"work_done": "All good"},
            format="json",
        )
        assert res.status_code != status.HTTP_404_NOT_FOUND, (
            "Shop A user should be able to complete own-shop visit"
        )


# ──────────────────────────────────────────────────────────────────────────────
# HR — EmployeeDetailView, LeaveRequestDetailView, SalarySlipDetailView
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.django_db
class TestHRDetailIsolation:
    """
    HR detail views use _shop_ids_for_request + filter(shop_id__in) /
    filter(employee__shop_id__in).  Shop A user must get 404 on every
    Shop B detail/mutation endpoint.
    """

    HR_PERMS = [
        "hr.employees.view", "hr.employees.manage",
        "hr.leaves.manage",
        "hr.salary.view", "hr.salary.generate",
    ]

    def _make_employee(self, shop, code_suffix):
        from hr.models import Employee
        return Employee.objects.create(
            shop=shop,
            employee_code=f"EMP-{code_suffix}",
            full_name=f"Employee {code_suffix}",
            designation="Technician",
            date_of_joining=datetime.date(2025, 1, 1),
            employment_type=Employee.EmploymentType.FULL_TIME,
            basic_salary=Decimal("30000"),
        )

    def _make_leave(self, employee):
        from hr.models import LeaveRequest
        return LeaveRequest.objects.create(
            employee=employee,
            leave_type=LeaveRequest.LeaveType.CASUAL,
            from_date=datetime.date(2026, 6, 10),
            to_date=datetime.date(2026, 6, 11),
            days=Decimal("2"),
            reason="Personal",
        )

    def _make_slip(self, employee):
        from hr.models import SalarySlip
        return SalarySlip.objects.create(
            employee=employee,
            month=5,
            year=2026,
            working_days=22,
            present_days=Decimal("20"),
            gross_earned=Decimal("28000"),
            net_salary=Decimal("25000"),
        )

    # ── Employee GET ──────────────────────────────────────────────────────────

    def test_shop_a_user_gets_404_on_shop_b_employee_get(self, db, shop_a, shop_b):
        emp_b = self._make_employee(shop_b, "B01")
        client_a = _make_scoped_client(
            shop_a, "hr_a@iso.test", "+919900400001", self.HR_PERMS,
        )
        res = client_a.get(f"/api/v1/hr/employees/{emp_b.id}/")
        assert res.status_code == status.HTTP_404_NOT_FOUND, (
            f"Shop A user should not GET Shop B employee — got {res.status_code}"
        )

    # ── Employee PATCH ────────────────────────────────────────────────────────

    def test_shop_a_user_gets_404_on_shop_b_employee_patch(self, db, shop_a, shop_b):
        emp_b = self._make_employee(shop_b, "B02")
        client_a = _make_scoped_client(
            shop_a, "hr_a2@iso.test", "+919900400002", self.HR_PERMS,
        )
        res = client_a.patch(
            f"/api/v1/hr/employees/{emp_b.id}/",
            {"designation": "Senior Technician"},
            format="json",
        )
        assert res.status_code == status.HTTP_404_NOT_FOUND, (
            f"Shop A user should not PATCH Shop B employee — got {res.status_code}"
        )

    # ── Leave PATCH ───────────────────────────────────────────────────────────

    def test_shop_a_user_gets_404_on_shop_b_leave_patch(self, db, shop_a, shop_b):
        emp_b = self._make_employee(shop_b, "B03")
        leave_b = self._make_leave(emp_b)
        client_a = _make_scoped_client(
            shop_a, "hr_a3@iso.test", "+919900400003", self.HR_PERMS,
        )
        res = client_a.patch(
            f"/api/v1/hr/leave-requests/{leave_b.id}/",
            {"status": "approved"},
            format="json",
        )
        assert res.status_code == status.HTTP_404_NOT_FOUND, (
            f"Shop A user should not PATCH Shop B leave — got {res.status_code}"
        )

    # ── Salary slip GET ───────────────────────────────────────────────────────

    def test_shop_a_user_gets_404_on_shop_b_slip_get(self, db, shop_a, shop_b):
        emp_b = self._make_employee(shop_b, "B04")
        slip_b = self._make_slip(emp_b)
        client_a = _make_scoped_client(
            shop_a, "hr_a4@iso.test", "+919900400004", self.HR_PERMS,
        )
        res = client_a.get(f"/api/v1/hr/salary-slips/{slip_b.id}/")
        assert res.status_code == status.HTTP_404_NOT_FOUND, (
            f"Shop A user should not GET Shop B salary slip — got {res.status_code}"
        )

    # ── Salary slip PATCH ─────────────────────────────────────────────────────

    def test_shop_a_user_gets_404_on_shop_b_slip_patch(self, db, shop_a, shop_b):
        emp_b = self._make_employee(shop_b, "B05")
        slip_b = self._make_slip(emp_b)
        client_a = _make_scoped_client(
            shop_a, "hr_a5@iso.test", "+919900400005", self.HR_PERMS,
        )
        res = client_a.patch(
            f"/api/v1/hr/salary-slips/{slip_b.id}/",
            {"status": "approved"},
            format="json",
        )
        assert res.status_code == status.HTTP_404_NOT_FOUND, (
            f"Shop A user should not PATCH Shop B salary slip — got {res.status_code}"
        )

    # ── Positive: own-shop access works ──────────────────────────────────────

    def test_shop_a_user_can_access_own_employee(self, db, shop_a):
        emp_a = self._make_employee(shop_a, "A01")
        client_a = _make_scoped_client(
            shop_a, "hr_a6@iso.test", "+919900400006", self.HR_PERMS,
        )
        res = client_a.get(f"/api/v1/hr/employees/{emp_a.id}/")
        assert res.status_code == status.HTTP_200_OK, (
            "Shop A user should be able to GET own-shop employee"
        )


# ──────────────────────────────────────────────────────────────────────────────
# Finance — AssetDetailView, PettyCashAccountView
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.django_db
class TestFinanceDetailIsolation:
    """
    AssetDetailView filters by shop_id__in; PettyCashAccountView checks the
    URL shop_id against the caller's shop_ids.  Both must block cross-shop access.
    """

    FIN_PERMS = ["erp.assets.manage", "hr.petty_cash.manage"]

    def _make_asset(self, shop, code_suffix):
        from finance.models import ShopAsset
        return ShopAsset.objects.create(
            shop=shop,
            name=f"UPS {code_suffix}",
            category="Electronics",
            asset_code=f"ASSET-{code_suffix}",
            purchase_date=datetime.date(2025, 6, 1),
            purchase_cost=Decimal("15000.00"),
        )

    def _make_petty_cash(self, shop):
        from finance.models import PettyCashAccount
        return PettyCashAccount.objects.create(
            shop=shop,
            current_balance=Decimal("5000.00"),
        )

    # ── Asset PATCH ───────────────────────────────────────────────────────────

    def test_shop_a_user_gets_404_on_shop_b_asset_patch(self, db, shop_a, shop_b):
        asset_b = self._make_asset(shop_b, "B01")
        client_a = _make_scoped_client(
            shop_a, "fin_a@iso.test", "+919900500001", self.FIN_PERMS,
        )
        res = client_a.patch(
            f"/api/v1/finance/assets/{asset_b.id}/",
            {"condition": "fair"},
            format="json",
        )
        assert res.status_code == status.HTTP_404_NOT_FOUND, (
            f"Shop A user should not PATCH Shop B asset — got {res.status_code}"
        )

    # ── Petty cash GET cross-shop ─────────────────────────────────────────────

    def test_shop_a_user_gets_404_on_shop_b_petty_cash(self, db, shop_a, shop_b):
        self._make_petty_cash(shop_b)
        client_a = _make_scoped_client(
            shop_a, "fin_a2@iso.test", "+919900500002", self.FIN_PERMS,
        )
        res = client_a.get(f"/api/v1/finance/petty-cash/{shop_b.id}/")
        assert res.status_code == status.HTTP_404_NOT_FOUND, (
            f"Shop A user should not access Shop B petty cash — got {res.status_code}"
        )

    # ── Positive: own-shop access works ──────────────────────────────────────

    def test_shop_a_user_can_patch_own_asset(self, db, shop_a):
        asset_a = self._make_asset(shop_a, "A01")
        client_a = _make_scoped_client(
            shop_a, "fin_a3@iso.test", "+919900500003", self.FIN_PERMS,
        )
        res = client_a.patch(
            f"/api/v1/finance/assets/{asset_a.id}/",
            {"condition": "fair"},
            format="json",
        )
        assert res.status_code == status.HTTP_200_OK, (
            "Shop A user should be able to PATCH own-shop asset"
        )

    def test_shop_a_user_can_access_own_petty_cash(self, db, shop_a):
        self._make_petty_cash(shop_a)
        client_a = _make_scoped_client(
            shop_a, "fin_a4@iso.test", "+919900500004", self.FIN_PERMS,
        )
        res = client_a.get(f"/api/v1/finance/petty-cash/{shop_a.id}/")
        assert res.status_code == status.HTTP_200_OK, (
            "Shop A user should be able to access own-shop petty cash"
        )
