"""
Pattern 5 — FK field naming: DRF emits bare FK name, FE expects `_id`/`_name` suffix.

Each test class GETs a list or detail endpoint and asserts that the response
shape contains the `_id`/`_name` aliased fields (not the raw DRF FK keys like
`employee`, `shop`, `assigned_technician`).

Modules covered: Repair (02), AMC (04), HR (09), Finance (10).
CRM aliases were fixed earlier and the contract is verified by the existing
CRM test suite.
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
def shop(db):
    from core.models import Shop
    return Shop.objects.create(
        name="FK Shape Shop", code="FKS",
        address="1 Test Rd", city="Delhi",
        state="Delhi", state_code="07",
        phone="+919901000001",
    )


@pytest.fixture
def system_user(db):
    from authentication.models import User
    return User.objects.create_user(
        email="sys@fkshape.test",
        phone="+919901000099",
        full_name="System",
        password="pass",
    )


def _wide_client(permission_codenames):
    """Return an APIClient with a tenant-wide user holding the given permissions."""
    from authentication.models import Permission, Role, RolePermission, User, UserRole
    from authentication.tokens import _build_token_claims
    from rest_framework_simplejwt.tokens import RefreshToken

    tag = "_".join(c.replace(".", "_") for c in permission_codenames[:2])
    email = f"wide_{tag[:30]}@fk.test"
    phone_suffix = abs(hash(email)) % 900000000 + 100000000
    phone = f"+91{phone_suffix}"

    user = User.objects.create_user(
        email=email, phone=phone, full_name="Wide User", password="pass",
    )
    role, _ = Role.objects.get_or_create(name=f"WideRole_{tag[:20]}")
    for codename in permission_codenames:
        perm, _ = Permission.objects.get_or_create(
            codename=codename,
            defaults={"module": codename.split(".")[0], "label": codename},
        )
        RolePermission.objects.get_or_create(role=role, permission=perm)
    UserRole.objects.create(user=user, role=role, shop=None)

    client = APIClient()
    refresh = RefreshToken.for_user(user)
    access = refresh.access_token
    for k, v in _build_token_claims(user, "test").items():
        access[k] = v
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {str(access)}")
    return client


# ──────────────────────────────────────────────────────────────────────────────
# Module 02 — Repair: JobTicketListSerializer
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.django_db
class TestRepairListShape:
    """
    JobTicketListSerializer must emit `customer_id`, `customer_phone`,
    `assigned_technician_name`, and `shop_id` — not a bare `customer` FK key.
    """

    URL = "/api/v1/repair/jobs/"

    def test_list_item_has_customer_id_and_phone(self, db, shop, system_user):
        from crm.models import Customer
        from repair.models import JobTicket

        customer = Customer.objects.create(
            shop=shop, name="Ravi Kumar", phone="+919901100001",
        )
        JobTicket.objects.create(
            shop=shop,
            customer=customer,
            job_number="JOB-FK-001",
            device_type="Laptop",
            problem_description="Won't boot",
            created_by=system_user,
        )

        # assign_tech bypasses the "own-jobs only" queryset guard in get_queryset
        client = _wide_client(["repair.jobs.view", "repair.jobs.assign_tech"])
        res = client.get(self.URL)

        assert res.status_code == status.HTTP_200_OK
        items = res.data["items"]
        assert len(items) >= 1
        item = items[0]

        assert "customer_id" in item, "customer_id must be in list response"
        assert item["customer_id"] is not None
        assert "customer_phone" in item, "customer_phone must be in list response"
        assert item["customer_phone"] == "+919901100001"
        assert "shop_id" in item, "shop_id must be in list response"
        assert "assigned_technician_name" in item, "assigned_technician_name must be in list response"
        # bare FK key must NOT appear
        assert "customer" not in item, "bare 'customer' FK key must not appear in list response"

    def test_list_item_assigned_technician_name_is_none_when_unassigned(self, db, shop, system_user):
        from crm.models import Customer
        from repair.models import JobTicket

        customer = Customer.objects.create(
            shop=shop, name="Priya Singh", phone="+919901100002",
        )
        JobTicket.objects.create(
            shop=shop,
            customer=customer,
            job_number="JOB-FK-002",
            device_type="Phone",
            problem_description="Screen cracked",
            created_by=system_user,
        )

        client = _wide_client(["repair.jobs.view", "repair.jobs.assign_tech"])
        res = client.get(self.URL)

        assert res.status_code == status.HTTP_200_OK
        item = next(i for i in res.data["items"] if i["job_number"] == "JOB-FK-002")
        # No technician assigned yet — field must be present but falsy
        assert "assigned_technician_name" in item
        assert not item["assigned_technician_name"]


# ──────────────────────────────────────────────────────────────────────────────
# Module 04 — AMC: AMCContractSerializer + AMCVisitSerializer
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.django_db
class TestAMCFieldNames:
    """
    AMCContractSerializer must emit `assigned_technician_id` and
    `assigned_technician_name` (not the bare `assigned_technician` FK).

    AMCVisitSerializer must emit `technician_id`, `technician_name`,
    and `contract_id` (not the bare `technician` or `contract` FK key).
    """

    def _make_contract(self, shop, customer, technician, system_user):
        from amc.models import AMCContract
        return AMCContract.objects.create(
            shop=shop,
            customer=customer,
            contract_number="AMC-FK-001",
            title="AC Maintenance",
            start_date=datetime.date(2026, 1, 1),
            end_date=datetime.date(2026, 12, 31),
            value=Decimal("12000"),
            payment_terms=AMCContract.PaymentTerms.UPFRONT,
            visits_per_year=4,
            visit_interval_days=91,
            assigned_technician=technician,
            created_by=system_user,
        )

    def _make_visit(self, contract, technician):
        from amc.models import AMCVisit
        return AMCVisit.objects.create(
            contract=contract,
            visit_number=1,
            scheduled_date=datetime.date(2026, 3, 1),
            technician=technician,
        )

    def _make_customer(self, shop):
        from crm.models import Customer
        return Customer.objects.create(
            shop=shop, name="AMC Client", phone="+919901200001",
        )

    def _make_technician(self):
        from authentication.models import User
        return User.objects.create_user(
            email="tech@amc.fk.test", phone="+919901200099",
            full_name="Ramesh Technician", password="pass",
        )

    def test_contract_detail_has_assigned_technician_id_and_name(
        self, db, shop, system_user
    ):
        customer = self._make_customer(shop)
        technician = self._make_technician()
        contract = self._make_contract(shop, customer, technician, system_user)

        client = _wide_client(["amc.contracts.view"])
        res = client.get(f"/api/v1/amc/contracts/{contract.id}/")

        assert res.status_code == status.HTTP_200_OK
        data = res.data

        assert "assigned_technician_id" in data, "assigned_technician_id must be in contract response"
        assert str(data["assigned_technician_id"]) == str(technician.id)
        assert "assigned_technician_name" in data, "assigned_technician_name must be in contract response"
        assert data["assigned_technician_name"] == "Ramesh Technician"
        assert "assigned_technician" not in data, (
            "bare 'assigned_technician' FK key must not appear in contract response"
        )

    def test_visit_list_has_technician_id_name_and_contract_id(
        self, db, shop, system_user
    ):
        customer = self._make_customer(shop)
        technician = self._make_technician()
        contract = self._make_contract(shop, customer, technician, system_user)
        self._make_visit(contract, technician)

        client = _wide_client(["amc.visits.schedule"])
        res = client.get(f"/api/v1/amc/contracts/{contract.id}/visits/")

        assert res.status_code == status.HTTP_200_OK
        data = res.data
        # Support plain list, {items, meta}, or DRF default {count, results}
        if isinstance(data, list):
            items = data
        elif "items" in data:
            items = data["items"]
        else:
            items = data.get("results", [])
        assert len(items) >= 1
        visit = items[0]

        assert "technician_id" in visit, "technician_id must be in visit response"
        assert str(visit["technician_id"]) == str(technician.id)
        assert "technician_name" in visit, "technician_name must be in visit response"
        assert visit["technician_name"] == "Ramesh Technician"
        assert "contract_id" in visit, "contract_id must be in visit response"
        assert str(visit["contract_id"]) == str(contract.id)
        assert "technician" not in visit, (
            "bare 'technician' FK key must not appear in visit response"
        )


# ──────────────────────────────────────────────────────────────────────────────
# Module 09 — HR: EmployeeSerializer, LeaveRequestSerializer, SalarySlipSerializer
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.django_db
class TestHRFieldNames:
    """
    EmployeeSerializer  — must have `shop_id`, `user_id`, `is_active`,
                           `bank_account_masked`, `pan_masked`, `aadhar_masked`.
    LeaveRequestSerializer — must have `employee_id`, `employee_name`.
    SalarySlipSerializer   — must have `employee_id`, `employee_name`, `employee_code`.
    """

    def _make_employee(self, shop, user=None):
        from hr.models import Employee
        emp = Employee.objects.create(
            shop=shop,
            user=user,
            employee_code="EMP-FK-01",
            full_name="Suresh Kumar",
            designation="Technician",
            date_of_joining=datetime.date(2025, 1, 1),
            employment_type=Employee.EmploymentType.FULL_TIME,
            basic_salary=Decimal("30000"),
        )
        return emp

    def _make_leave(self, employee):
        from hr.models import LeaveRequest
        return LeaveRequest.objects.create(
            employee=employee,
            leave_type=LeaveRequest.LeaveType.CASUAL,
            from_date=datetime.date(2026, 6, 10),
            to_date=datetime.date(2026, 6, 11),
            days=Decimal("2"),
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

    def test_employee_detail_has_shop_id_user_id_and_masked_fields(
        self, db, shop, system_user
    ):
        emp = self._make_employee(shop, user=system_user)
        client = _wide_client(["hr.employees.view"])
        res = client.get(f"/api/v1/hr/employees/{emp.id}/")

        assert res.status_code == status.HTTP_200_OK
        data = res.data

        assert "shop_id" in data, "shop_id must be in employee response"
        assert str(data["shop_id"]) == str(shop.id)
        assert "user_id" in data, "user_id must be in employee response"
        assert str(data["user_id"]) == str(system_user.id)
        assert "is_active" in data, "is_active must be in employee response"
        assert data["is_active"] is True
        assert "bank_account_masked" in data, "bank_account_masked must be in employee response"
        assert "pan_masked" in data, "pan_masked must be in employee response"
        assert "aadhar_masked" in data, "aadhar_masked must be in employee response"
        # bare FK keys must not appear
        assert "shop" not in data, "bare 'shop' FK key must not appear"
        assert "user" not in data, "bare 'user' FK key must not appear"

    def test_leave_list_has_employee_id_and_name(self, db, shop):
        emp = self._make_employee(shop)
        self._make_leave(emp)

        client = _wide_client(["hr.leaves.manage"])
        res = client.get("/api/v1/hr/leave-requests/")

        assert res.status_code == status.HTTP_200_OK
        items = res.data["items"]
        assert len(items) >= 1
        item = items[0]

        assert "employee_id" in item, "employee_id must be in leave response"
        assert str(item["employee_id"]) == str(emp.id)
        assert "employee_name" in item, "employee_name must be in leave response"
        assert item["employee_name"] == "Suresh Kumar"
        assert "employee" not in item, "bare 'employee' FK key must not appear in leave response"

    def test_salary_slip_list_has_employee_id_name_and_code(self, db, shop):
        emp = self._make_employee(shop)
        self._make_slip(emp)

        client = _wide_client(["hr.salary.view"])
        res = client.get("/api/v1/hr/salary-slips/")

        assert res.status_code == status.HTTP_200_OK
        items = res.data["items"]
        assert len(items) >= 1
        item = items[0]

        assert "employee_id" in item, "employee_id must be in salary slip response"
        assert str(item["employee_id"]) == str(emp.id)
        assert "employee_name" in item, "employee_name must be in salary slip response"
        assert item["employee_name"] == "Suresh Kumar"
        assert "employee_code" in item, "employee_code must be in salary slip response"
        assert item["employee_code"] == "EMP-FK-01"
        assert "employee" not in item, "bare 'employee' FK key must not appear in slip response"


# ──────────────────────────────────────────────────────────────────────────────
# Module 10 — Finance: BudgetAllocationSerializer, ExpenseSerializer, ShopAssetSerializer
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.django_db
class TestFinanceFieldNames:
    """
    BudgetAllocationSerializer — must have `head_id`, `head_name`, `category`.
    ExpenseSerializer          — must have `shop_id`, `budget_head_id`,
                                  `budget_head_name`, `recorded_by_name`.
    ShopAssetSerializer        — must have `shop_id`.
    """

    def _make_budget_head(self, shop):
        from finance.models import BudgetHead
        return BudgetHead.objects.create(
            shop=shop,
            name="Office Supplies",
            category=BudgetHead.Category.VARIABLE,
        )

    def _make_allocation(self, head):
        from finance.models import BudgetAllocation
        return BudgetAllocation.objects.create(
            head=head, month=6, year=2026,
            budgeted_amount=Decimal("5000"),
        )

    def _make_expense(self, shop, head, recorded_by):
        from finance.models import Expense
        return Expense.objects.create(
            shop=shop,
            budget_head=head,
            category="Stationery",
            amount=Decimal("500"),
            date=datetime.date(2026, 6, 10),
            recorded_by=recorded_by,
        )

    def _make_asset(self, shop):
        from finance.models import ShopAsset
        return ShopAsset.objects.create(
            shop=shop,
            name="UPS 1KVA",
            category="Electronics",
            asset_code="ASSET-FK-01",
            purchase_date=datetime.date(2025, 1, 1),
            purchase_cost=Decimal("15000"),
        )

    def test_budget_allocation_list_has_head_id_name_and_category(
        self, db, shop
    ):
        head = self._make_budget_head(shop)
        self._make_allocation(head)

        client = _wide_client(["erp.budget.manage"])
        res = client.get("/api/v1/finance/budget/allocations/")

        assert res.status_code == status.HTTP_200_OK
        items = res.data["items"]
        assert len(items) >= 1
        item = items[0]

        assert "head_id" in item, "head_id must be in budget allocation response"
        assert str(item["head_id"]) == str(head.id)
        assert "head_name" in item, "head_name must be in budget allocation response"
        assert item["head_name"] == "Office Supplies"
        assert "category" in item, "category must be in budget allocation response"
        assert item["category"] == "variable"
        assert "head" not in item, "bare 'head' FK key must not appear in allocation response"

    def test_expense_list_has_shop_id_head_id_name_and_recorded_by(
        self, db, shop, system_user
    ):
        head = self._make_budget_head(shop)
        self._make_expense(shop, head, system_user)

        client = _wide_client(["erp.expenses.view"])
        res = client.get("/api/v1/finance/expenses/")

        assert res.status_code == status.HTTP_200_OK
        items = res.data["items"]
        assert len(items) >= 1
        item = items[0]

        assert "shop_id" in item, "shop_id must be in expense response"
        assert str(item["shop_id"]) == str(shop.id)
        assert "budget_head_id" in item, "budget_head_id must be in expense response"
        assert str(item["budget_head_id"]) == str(head.id)
        assert "budget_head_name" in item, "budget_head_name must be in expense response"
        assert item["budget_head_name"] == "Office Supplies"
        assert "recorded_by_name" in item, "recorded_by_name must be in expense response"
        assert item["recorded_by_name"] == "System"
        assert "shop" not in item, "bare 'shop' FK key must not appear in expense response"
        assert "budget_head" not in item, "bare 'budget_head' FK key must not appear in expense response"

    def test_asset_list_has_shop_id(self, db, shop):
        self._make_asset(shop)

        client = _wide_client(["erp.assets.manage"])
        res = client.get("/api/v1/finance/assets/")

        assert res.status_code == status.HTTP_200_OK
        items = res.data["items"]
        assert len(items) >= 1
        item = items[0]

        assert "shop_id" in item, "shop_id must be in asset response"
        assert str(item["shop_id"]) == str(shop.id)
        assert "shop" not in item, "bare 'shop' FK key must not appear in asset response"
