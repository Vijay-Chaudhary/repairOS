"""Demo seed: employees, attendance, leave requests, salary slips."""
import random
from datetime import date, time, timedelta
from decimal import Decimal

from core.seeding import SeedContext, Seeder, register


class HrDemoSeeder(Seeder):
    name = "hr.demo"
    scope = "demo"
    depends_on = ("authentication.demo_users",)

    def run(self, ctx: SeedContext) -> None:
        shop_del, users = ctx["shop_del"], ctx["users"]
        from hr.models import Employee, LeaveRequest
        from hr import services as hr_svc

        admin = users["admin"]
        tech1 = users["technician_1"]
        tech2 = users["technician_2"]
        recp  = users["receptionist"]
        bill  = users["billing_staff"]

        today = date.today()
        month, year = today.month, today.year

        emp_specs = [
            (tech1, "EMP-001", "Lead Technician",   "Service",  Decimal("22000"), Decimal("8800"), Decimal("3000")),
            (tech2, "EMP-002", "Technician",         "Service",  Decimal("18000"), Decimal("7200"), Decimal("2000")),
            (recp,  "EMP-003", "Receptionist",       "Front Desk", Decimal("15000"), Decimal("6000"), Decimal("1500")),
            (bill,  "EMP-004", "Billing Executive",  "Finance",  Decimal("16000"), Decimal("6400"), Decimal("1500")),
        ]

        employees = {}
        for user, code, desig, dept, basic, hra, other in emp_specs:
            gross = basic + hra + other
            emp, created = Employee.objects.get_or_create(
                employee_code=code,
                defaults={
                    "shop": shop_del,
                    "user": user,
                    "full_name": user.full_name,
                    "designation": desig,
                    "department": dept,
                    "date_of_joining": date(2025, 6, 1),
                    "employment_type": "full_time",
                    "basic_salary": basic,
                    "hra": hra,
                    "other_allowances": other,
                    "gross_salary": gross,
                },
            )
            employees[code] = emp

        # 30 days attendance for current month
        month_start = date(year, month, 1)
        import calendar
        days_in_month = calendar.monthrange(year, month)[1]

        records = []
        for emp in employees.values():
            for d in range(1, min(days_in_month, today.day) + 1):
                att_date = date(year, month, d)
                wd = att_date.weekday()
                if wd == 6:   # Sunday off
                    status = "absent"
                    check_in = check_out = None
                elif wd == 5 and random.random() < 0.3:  # ~30% Saturdays off
                    status = "absent"
                    check_in = check_out = None
                else:
                    status = "present"
                    check_in = time(9, random.randint(0, 30))
                    check_out = time(18, random.randint(0, 30))
                records.append({
                    "employee_id": str(emp.id),
                    "date": att_date,
                    "status": status,
                    "check_in": check_in,
                    "check_out": check_out,
                })

        hr_svc.bulk_mark_attendance(records)

        # Leave request for tech2 (pending)
        emp_tech2 = employees.get("EMP-002")
        if emp_tech2:
            LeaveRequest.objects.get_or_create(
                employee=emp_tech2,
                from_date=today + timedelta(days=5),
                defaults={
                    "to_date": today + timedelta(days=6),
                    "leave_type": "casual",
                    "days": Decimal("2"),
                    "reason": "Family function",
                    "status": "pending",
                },
            )

        # Salary slips: last 3 months for all employees
        from hr.models import SalarySlip
        for months_back in range(1, 4):
            sm = month - months_back
            sy = year
            if sm <= 0:
                sm += 12
                sy -= 1
            for emp_obj in employees.values():
                if not SalarySlip.objects.filter(employee=emp_obj, month=sm, year=sy).exists():
                    try:
                        hr_svc.generate_salary_slips(shop_del, sm, sy, [str(emp_obj.id)])
                    except Exception:
                        pass

        # ── Extra leave requests ───────────────────────────────────────────
        extra_leaves = [
            ("EMP-001", today - timedelta(days=20), today - timedelta(days=19), "sick",   Decimal("2"), "High fever — doctor advised rest",         "approved"),
            ("EMP-002", today + timedelta(days=10), today + timedelta(days=14), "casual", Decimal("5"), "Vacation — family trip to Shimla",          "pending"),
            ("EMP-003", today - timedelta(days=10), today - timedelta(days=10), "casual", Decimal("1"), "Personal bank work",                        "approved"),
            ("EMP-004", today - timedelta(days=5),  today - timedelta(days=5),  "sick",   Decimal("1"), "Doctor appointment — routine checkup",      "approved"),
        ]
        for emp_code, from_dt, to_dt, ltype, days_count, reason, status in extra_leaves:
            emp = employees.get(emp_code)
            if emp:
                LeaveRequest.objects.get_or_create(
                    employee=emp,
                    from_date=from_dt,
                    defaults={
                        "to_date": to_dt,
                        "leave_type": ltype,
                        "days": days_count,
                        "reason": reason,
                        "status": status,
                    },
                )


register(HrDemoSeeder)
