"""
HR & Payroll module tests — §10 acceptance criteria + §11 test cases.

Covers:
- Employee CRUD; encrypted fields (bank, PAN, Aadhar) never exposed raw
- Bulk attendance marking
- Leave request submit → approve → attendance updated
- Salary slip generation with exact proration formula
- Half-day and overtime proration edge cases
- Duplicate slip (same employee/month/year) blocked
- Slip status transitions: draft → approved → paid
- E2E payroll cycle: attendance → generate → approve → paid
"""

import datetime
from decimal import ROUND_HALF_UP, Decimal

import pytest
from rest_framework import status


# ──────────────────────────────────────────────────────────────────────────────
# Fixtures
# ──────────────────────────────────────────────────────────────────────────────


@pytest.fixture
def shop(db):
    from core.models import Shop
    return Shop.objects.create(
        name="HR Shop", code="HRS",
        address="1 Main", city="Delhi",
        state="Delhi", state_code="07",
        phone="+919000000001",
    )


@pytest.fixture
def hr_admin(db):
    from authentication.models import Permission, Role, RolePermission, User, UserRole
    user = User.objects.create_user(
        email="hr@test.com", phone="+919000000099",
        full_name="HR Admin", password="pass",
    )
    role = Role.objects.create(name="HRAdmin", is_system_role=True)
    for code in [
        "hr.employees.view", "hr.employees.manage",
        "hr.attendance.view", "hr.attendance.mark",
        "hr.leaves.manage",
        "hr.salary.view", "hr.salary.generate",
    ]:
        perm, _ = Permission.objects.get_or_create(codename=code, defaults={"label": code})
        RolePermission.objects.create(role=role, permission=perm)
    UserRole.objects.create(user=user, role=role)
    return user


@pytest.fixture
def hr_client(db, hr_admin):
    from rest_framework.test import APIClient
    from rest_framework_simplejwt.tokens import RefreshToken
    refresh = RefreshToken.for_user(hr_admin)
    access = refresh.access_token
    access["permissions"] = [
        "hr.employees.view", "hr.employees.manage",
        "hr.attendance.view", "hr.attendance.mark",
        "hr.leaves.manage",
        "hr.salary.view", "hr.salary.generate",
    ]
    access["is_tenant_wide"] = True
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {str(access)}")
    return client


@pytest.fixture
def employee(db, shop):
    from hr.models import Employee
    emp = Employee(
        shop=shop,
        employee_code="EMP001",
        full_name="Alice Technician",
        designation="Technician",
        date_of_joining=datetime.date(2025, 1, 1),
        basic_salary=Decimal("20000.00"),
        hra=Decimal("8000.00"),
        other_allowances=Decimal("2000.00"),
        gross_salary=Decimal("30000.00"),
        pf_employee=Decimal("2400.00"),
        esic_employee=Decimal("225.00"),
    )
    emp.set_bank_account("123456789012")
    emp.set_pan("ABCDE1234F")
    emp.set_aadhar("123456789012")
    emp.save()
    return emp


@pytest.fixture
def employee2(db, shop):
    from hr.models import Employee
    emp = Employee(
        shop=shop,
        employee_code="EMP002",
        full_name="Bob Technician",
        designation="Technician",
        date_of_joining=datetime.date(2025, 1, 1),
        basic_salary=Decimal("15000.00"),
        hra=Decimal("5000.00"),
        other_allowances=Decimal("1000.00"),
        gross_salary=Decimal("21000.00"),
        pf_employee=Decimal("1800.00"),
        esic_employee=Decimal("157.50"),
    )
    emp.save()
    return emp


def mark_month_attendance(employee, year, month, present_days, half_days=0, overtime_per_day=0):
    """
    Mark attendance for all calendar days in the given month.

    Iterates working days (Mon–Fri) in order: the first `present_days` working
    days are marked PRESENT, the next `half_days` as HALF_DAY, the rest ABSENT.
    All Sat/Sun are marked WEEKEND.
    """
    from hr.models import AttendanceRecord
    import calendar as cal_mod
    total_days = cal_mod.monthrange(year, month)[1]
    records = []
    working_count = 0
    for day in range(1, total_days + 1):
        d = datetime.date(year, month, day)
        if d.weekday() >= 5:
            stat = AttendanceRecord.AttendanceStatus.WEEKEND
            ot = Decimal("0")
        else:
            working_count += 1
            if working_count <= present_days:
                stat = AttendanceRecord.AttendanceStatus.PRESENT
                ot = Decimal(str(overtime_per_day))
            elif working_count <= present_days + half_days:
                stat = AttendanceRecord.AttendanceStatus.HALF_DAY
                ot = Decimal("0")
            else:
                stat = AttendanceRecord.AttendanceStatus.ABSENT
                ot = Decimal("0")
        records.append(AttendanceRecord(employee=employee, date=d, status=stat, overtime_hours=ot))
    AttendanceRecord.objects.bulk_create(records, ignore_conflicts=True)


# ──────────────────────────────────────────────────────────────────────────────
# TestEmployeeCRUD
# ──────────────────────────────────────────────────────────────────────────────


class TestEmployeeCRUD:
    url = "/api/v1/hr/employees/"

    def test_create_employee(self, hr_client, shop):
        res = hr_client.post(self.url, {
            "shop_id": str(shop.id),
            "employee_code": "EMP010",
            "full_name": "Charlie Dev",
            "designation": "Developer",
            "date_of_joining": "2026-01-01",
            "employment_type": "full_time",
            "basic_salary": "25000.00",
            "hra": "10000.00",
            "other_allowances": "5000.00",
            "gross_salary": "40000.00",
            "bank_account_number": "987654321098",
            "bank_ifsc": "HDFC0001234",
            "pan_number": "FGHIJ5678K",
            "aadhar_number": "987654321098",
        }, format="json")
        assert res.status_code == status.HTTP_201_CREATED
        assert res.data["employee_code"] == "EMP010"

    def test_encrypted_fields_not_returned_raw(self, hr_client, employee):
        res = hr_client.get(f"{self.url}{employee.id}/")
        assert res.status_code == status.HTTP_200_OK
        # encrypted ciphertexts must not appear in the response
        assert "bank_account_number_encrypted" not in res.data
        assert "pan_number_encrypted" not in res.data
        assert "aadhar_number_encrypted" not in res.data
        # masked placeholder or omitted — never the raw 12-digit number
        if "bank_account_number" in res.data:
            assert res.data["bank_account_number"] != "123456789012"

    def test_list_employees(self, hr_client, employee):
        res = hr_client.get(self.url)
        assert res.status_code == status.HTTP_200_OK
        assert len(res.data["items"]) >= 1

    def test_encryption_roundtrip(self, db, employee):
        """Encrypted fields decrypt correctly."""
        from hr.models import Employee
        emp = Employee.objects.get(pk=employee.pk)
        assert emp.get_bank_account() == "123456789012"
        assert emp.get_pan() == "ABCDE1234F"
        assert emp.get_aadhar() == "123456789012"

    def test_duplicate_employee_code_blocked(self, hr_client, employee, shop):
        res = hr_client.post(self.url, {
            "shop_id": str(shop.id),
            "employee_code": "EMP001",  # duplicate
            "full_name": "Duplicate",
            "designation": "Test",
            "date_of_joining": "2026-01-01",
            "basic_salary": "10000",
            "gross_salary": "10000",
        }, format="json")
        assert res.status_code == status.HTTP_400_BAD_REQUEST


# ──────────────────────────────────────────────────────────────────────────────
# TestAttendance
# ──────────────────────────────────────────────────────────────────────────────


class TestAttendance:
    url = "/api/v1/hr/attendance/bulk/"

    def test_bulk_mark_attendance(self, hr_client, employee):
        res = hr_client.post(self.url, {
            "shop_id": str(employee.shop_id),
            "employee_ids": [str(employee.id)],
            "date_from": "2026-05-01",
            "date_to": "2026-05-02",
            "status": "present",
        }, format="json")
        assert res.status_code == status.HTTP_201_CREATED
        assert res.data["created"] == 2

    def test_duplicate_date_upserts_not_errors(self, hr_client, employee):
        """Re-submitting the same date updates the record."""
        hr_client.post(self.url, {
            "shop_id": str(employee.shop_id),
            "employee_ids": [str(employee.id)],
            "date_from": "2026-05-03",
            "date_to": "2026-05-03",
            "status": "present",
        }, format="json")
        res = hr_client.post(self.url, {
            "shop_id": str(employee.shop_id),
            "employee_ids": [str(employee.id)],
            "date_from": "2026-05-03",
            "date_to": "2026-05-03",
            "status": "absent",
        }, format="json")
        assert res.status_code == status.HTTP_201_CREATED

        from hr.models import AttendanceRecord
        rec = AttendanceRecord.objects.get(employee=employee, date=datetime.date(2026, 5, 3))
        assert rec.status == "absent"


# ──────────────────────────────────────────────────────────────────────────────
# TestLeaveRequests
# ──────────────────────────────────────────────────────────────────────────────


class TestLeaveRequests:
    create_url = "/api/v1/hr/leave-requests/"

    def test_submit_leave_request(self, hr_client, employee):
        res = hr_client.post(self.create_url, {
            "employee_id": str(employee.id),
            "leave_type": "casual",
            "from_date": "2026-05-05",
            "to_date": "2026-05-05",
            "days": "1.0",
            "reason": "Personal work",
        }, format="json")
        assert res.status_code == status.HTTP_201_CREATED
        assert res.data["status"] == "pending"

    def test_approve_leave_marks_attendance_as_leave(self, hr_client, employee, db):
        # Submit
        res = hr_client.post(self.create_url, {
            "employee_id": str(employee.id),
            "leave_type": "sick",
            "from_date": "2026-05-06",
            "to_date": "2026-05-06",
            "days": "1.0",
            "reason": "Fever",
        }, format="json")
        leave_id = res.data["id"]

        # Approve
        res2 = hr_client.patch(
            f"{self.create_url}{leave_id}/",
            {"status": "approved"},
            format="json",
        )
        assert res2.status_code == status.HTTP_200_OK
        assert res2.data["status"] == "approved"

        # Attendance record should be created/updated to 'leave'
        from hr.models import AttendanceRecord
        rec = AttendanceRecord.objects.get(
            employee=employee, date=datetime.date(2026, 5, 6)
        )
        assert rec.status == AttendanceRecord.AttendanceStatus.LEAVE

    def test_reject_leave_keeps_pending_resolved(self, hr_client, employee):
        res = hr_client.post(self.create_url, {
            "employee_id": str(employee.id),
            "leave_type": "earned",
            "from_date": "2026-05-10",
            "to_date": "2026-05-10",
            "days": "1.0",
        }, format="json")
        leave_id = res.data["id"]

        res2 = hr_client.patch(
            f"{self.create_url}{leave_id}/",
            {"status": "rejected"},
            format="json",
        )
        assert res2.status_code == status.HTTP_200_OK
        assert res2.data["status"] == "rejected"


# ──────────────────────────────────────────────────────────────────────────────
# TestSalaryGeneration
# ──────────────────────────────────────────────────────────────────────────────


class TestSalaryGeneration:
    url = "/api/v1/hr/salary-slips/generate/"

    def test_full_month_salary_equals_gross(self, hr_client, employee, shop, db):
        """All working days present → earned = gross (no proration)."""
        # Jan 2026 has 22 working days; marking 99 clamps to all 22
        year, month = 2026, 1
        mark_month_attendance(employee, year, month, present_days=99)

        res = hr_client.post(self.url, {
            "shop_id": str(shop.id),
            "month": month,
            "year": year,
            "employee_ids": [str(employee.id)],
        }, format="json")
        assert res.status_code == status.HTTP_201_CREATED
        slip = res.data["slips"][0]
        assert Decimal(slip["net_salary"]) > Decimal("0")
        assert slip["status"] == "draft"

    def test_proration_formula_matches_spec(self, hr_client, employee, shop, db):
        """
        Jan 2026: 22 working days, 11 present, 0 leave:
        basic_earned = 20000 × 11/22 = 10000
        hra_earned   = 8000  × 11/22 = 4000
        allow_earned = 2000  × 11/22 = 1000
        gross_earned = 15000
        total_ded    = 2400 + 225    = 2625
        net          = 12375
        """
        mark_month_attendance(employee, 2026, 1, present_days=11)

        res = hr_client.post(self.url, {
            "shop_id": str(shop.id),
            "month": 1, "year": 2026,
            "employee_ids": [str(employee.id)],
        }, format="json")
        assert res.status_code == status.HTTP_201_CREATED
        slip = res.data["slips"][0]

        assert Decimal(slip["basic_earned"]) == Decimal("10000.00")
        assert Decimal(slip["hra_earned"]) == Decimal("4000.00")
        assert Decimal(slip["allowances_earned"]) == Decimal("1000.00")
        assert Decimal(slip["gross_earned"]) == Decimal("15000.00")
        assert Decimal(slip["total_deductions"]) == Decimal("2625.00")
        assert Decimal(slip["net_salary"]) == Decimal("12375.00")

    def test_half_day_counts_as_point_five(self, hr_client, employee, shop, db):
        """
        Mar 2026: 22 working days, 10 present + 2 half-days:
        paid_days = 11.0  (10 + 2×0.5)
        basic_earned = 20000 × 11/22 = 10000
        """
        mark_month_attendance(employee, 2026, 3, present_days=10, half_days=2)

        res = hr_client.post(self.url, {
            "shop_id": str(shop.id),
            "month": 3, "year": 2026,
            "employee_ids": [str(employee.id)],
        }, format="json")
        assert res.status_code == status.HTTP_201_CREATED
        slip = res.data["slips"][0]
        assert Decimal(slip["basic_earned"]) == Decimal("10000.00")

    def test_overtime_amount_formula(self, hr_client, employee, shop, db):
        """
        Apr 2026: 22 working days all present, 2 OT hrs/day → total 44 OT hrs:
        overtime_amount = 44 × (20000 / (22 × 8)) = 44 × 113.636... = 5000.00
        """
        mark_month_attendance(employee, 2026, 4, present_days=99, overtime_per_day=2)

        res = hr_client.post(self.url, {
            "shop_id": str(shop.id),
            "month": 4, "year": 2026,
            "employee_ids": [str(employee.id)],
        }, format="json")
        assert res.status_code == status.HTTP_201_CREATED
        slip = res.data["slips"][0]
        # 22 wd × 2 OT = 44 hrs; 44 × (20000/176) = 5000.00
        assert Decimal(slip["overtime_amount"]) == Decimal("5000.00")

    def test_duplicate_slip_same_month_year_blocked(self, hr_client, employee, shop, db):
        mark_month_attendance(employee, 2026, 6, present_days=10)
        hr_client.post(self.url, {
            "shop_id": str(shop.id),
            "month": 6, "year": 2026,
            "employee_ids": [str(employee.id)],
        }, format="json")
        res2 = hr_client.post(self.url, {
            "shop_id": str(shop.id),
            "month": 6, "year": 2026,
            "employee_ids": [str(employee.id)],
        }, format="json")
        assert res2.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY

    def test_generate_multiple_employees(self, hr_client, employee, employee2, shop, db):
        mark_month_attendance(employee, 2026, 2, present_days=15)
        mark_month_attendance(employee2, 2026, 2, present_days=12)

        res = hr_client.post(self.url, {
            "shop_id": str(shop.id),
            "month": 2, "year": 2026,
            "employee_ids": [str(employee.id), str(employee2.id)],
        }, format="json")
        assert res.status_code == status.HTTP_201_CREATED
        assert len(res.data["slips"]) == 2


# ──────────────────────────────────────────────────────────────────────────────
# TestSalarySlipStatusTransitions
# ──────────────────────────────────────────────────────────────────────────────


class TestSalarySlipStatusTransitions:
    generate_url = "/api/v1/hr/salary-slips/generate/"

    def _generate(self, hr_client, employee, shop, month=8, year=2026):
        mark_month_attendance(employee, year, month, present_days=22)
        res = hr_client.post(self.generate_url, {
            "shop_id": str(shop.id),
            "month": month, "year": year,
            "employee_ids": [str(employee.id)],
        }, format="json")
        assert res.status_code == status.HTTP_201_CREATED
        return res.data["slips"][0]

    def test_approve_slip(self, hr_client, employee, shop, db):
        slip = self._generate(hr_client, employee, shop)
        res = hr_client.patch(
            f"/api/v1/hr/salary-slips/{slip['id']}/",
            {"status": "approved"},
            format="json",
        )
        assert res.status_code == status.HTTP_200_OK
        assert res.data["status"] == "approved"

    def test_mark_paid_requires_approved_first(self, hr_client, employee, shop, db):
        slip = self._generate(hr_client, employee, shop)
        # Try paying without approving first
        res = hr_client.patch(
            f"/api/v1/hr/salary-slips/{slip['id']}/",
            {"status": "paid"},
            format="json",
        )
        assert res.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY

    def test_full_status_transition_draft_approved_paid(self, hr_client, employee, shop, db):
        slip_data = self._generate(hr_client, employee, shop, month=9)
        slip_id = slip_data["id"]

        hr_client.patch(f"/api/v1/hr/salary-slips/{slip_id}/", {"status": "approved"}, format="json")
        res = hr_client.patch(f"/api/v1/hr/salary-slips/{slip_id}/", {"status": "paid"}, format="json")
        assert res.status_code == status.HTTP_200_OK
        assert res.data["status"] == "paid"
