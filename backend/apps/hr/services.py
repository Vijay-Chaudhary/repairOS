"""
HR & Payroll business logic.

Salary computation follows the spec formulas exactly (§4).
"""

import calendar
import logging
from decimal import ROUND_HALF_UP, Decimal

from django.db import transaction
from django.utils import timezone

from .models import AttendanceRecord, Employee, LeaveRequest, SalarySlip

logger = logging.getLogger(__name__)

_TWO = Decimal("0.01")


# ──────────────────────────────────────────────────────────────────────────────
# Attendance
# ──────────────────────────────────────────────────────────────────────────────


def bulk_mark_attendance(records: list[dict]) -> tuple[int, int]:
    """
    Upsert attendance records.
    Returns (created_count, updated_count).
    Uses update_or_create so re-submission corrects existing records.
    """
    created_count = 0
    updated_count = 0
    for rec in records:
        _, created = AttendanceRecord.objects.update_or_create(
            employee_id=rec["employee_id"],
            date=rec["date"],
            defaults={
                "status": rec["status"],
                "check_in": rec.get("check_in"),
                "check_out": rec.get("check_out"),
                "overtime_hours": Decimal(str(rec.get("overtime_hours", 0))),
                "notes": rec.get("notes", ""),
            },
        )
        if created:
            created_count += 1
        else:
            updated_count += 1
    return created_count, updated_count


# ──────────────────────────────────────────────────────────────────────────────
# Leave requests
# ──────────────────────────────────────────────────────────────────────────────


def approve_or_reject_leave(leave: LeaveRequest, new_status: str, approver) -> LeaveRequest:
    from core.exceptions import BusinessRuleViolation

    if leave.status != LeaveRequest.LeaveStatus.PENDING:
        raise BusinessRuleViolation("Only pending leave requests can be approved or rejected.")

    leave.status = new_status
    leave.approved_by = approver
    leave.approved_at = timezone.now()
    leave.save(update_fields=["status", "approved_by", "approved_at", "updated_at"])

    if new_status == LeaveRequest.LeaveStatus.APPROVED:
        _mark_leave_attendance(leave)

    return leave


def _mark_leave_attendance(leave: LeaveRequest) -> None:
    """Create/update attendance records for each day of an approved leave."""
    current = leave.from_date
    while current <= leave.to_date:
        AttendanceRecord.objects.update_or_create(
            employee=leave.employee,
            date=current,
            defaults={"status": AttendanceRecord.AttendanceStatus.LEAVE},
        )
        import datetime
        current = current + datetime.timedelta(days=1)


# ──────────────────────────────────────────────────────────────────────────────
# Salary slip generation
# ──────────────────────────────────────────────────────────────────────────────


def generate_salary_slips(shop, month: int, year: int, employee_ids: list) -> list[SalarySlip]:
    from core.exceptions import BusinessRuleViolation

    if employee_ids:
        employees = Employee.objects.filter(
            pk__in=employee_ids, shop=shop, deleted_at__isnull=True
        )
        if employees.count() != len(employee_ids):
            raise BusinessRuleViolation("One or more employee IDs are invalid for this shop.")
    else:
        employees = Employee.objects.filter(shop=shop, deleted_at__isnull=True)

    # Guard: check for existing slips
    existing = SalarySlip.objects.filter(
        employee__in=employees, month=month, year=year
    )
    if existing.exists():
        raise BusinessRuleViolation(
            f"Salary slip already exists for employee(s) in {month}/{year}."
        )

    slips = []
    with transaction.atomic():
        for emp in employees:
            slip = _compute_and_create_slip(emp, month, year)
            slips.append(slip)
    return slips


def _compute_and_create_slip(employee: Employee, month: int, year: int) -> SalarySlip:
    """
    Compute proration from attendance records and persist the salary slip.

    Spec formulas (§4):
      basic_earned      = basic × paid_days / working_days
      hra_earned        = hra × paid_days / working_days
      allowances_earned = other_allowances × paid_days / working_days
      overtime_amount   = total_ot_hours × (basic / (working_days × 8))
      gross_earned      = basic_earned + hra_earned + allowances_earned + overtime_amount
      total_deductions  = pf + esic + advance + other
      net_salary        = gross_earned − total_deductions
    """
    attendance = AttendanceRecord.objects.filter(employee=employee, date__year=year, date__month=month)

    working_days = attendance.exclude(
        status__in=[AttendanceRecord.AttendanceStatus.WEEKEND, AttendanceRecord.AttendanceStatus.HOLIDAY]
    ).count()

    present_days = Decimal(str(
        attendance.filter(status=AttendanceRecord.AttendanceStatus.PRESENT).count()
    ))
    half_days = Decimal(str(
        attendance.filter(status=AttendanceRecord.AttendanceStatus.HALF_DAY).count()
    ))
    leave_days = Decimal(str(
        attendance.filter(status=AttendanceRecord.AttendanceStatus.LEAVE).count()
    ))
    absent_days = Decimal(str(
        attendance.filter(status=AttendanceRecord.AttendanceStatus.ABSENT).count()
    ))

    paid_days = present_days + (half_days * Decimal("0.5")) + leave_days

    # Sum overtime hours across all present days
    from django.db.models import Sum
    ot_result = attendance.filter(
        status=AttendanceRecord.AttendanceStatus.PRESENT
    ).aggregate(total=Sum("overtime_hours"))
    total_ot = Decimal(str(ot_result["total"] or 0))

    if working_days == 0:
        ratio = Decimal("0")
        hourly_rate = Decimal("0")
    else:
        ratio = paid_days / Decimal(str(working_days))
        hourly_rate = employee.basic_salary / (Decimal(str(working_days)) * 8)

    basic_earned = (employee.basic_salary * ratio).quantize(_TWO, rounding=ROUND_HALF_UP)
    hra_earned = (employee.hra * ratio).quantize(_TWO, rounding=ROUND_HALF_UP)
    allowances_earned = (employee.other_allowances * ratio).quantize(_TWO, rounding=ROUND_HALF_UP)
    overtime_amount = (total_ot * hourly_rate).quantize(_TWO, rounding=ROUND_HALF_UP)
    gross_earned = (basic_earned + hra_earned + allowances_earned + overtime_amount).quantize(_TWO)

    pf_deduction = employee.pf_employee
    esic_deduction = employee.esic_employee
    advance_deduction = Decimal("0")
    other_deductions = Decimal("0")
    total_deductions = (pf_deduction + esic_deduction + advance_deduction + other_deductions).quantize(_TWO)
    net_salary = (gross_earned - total_deductions).quantize(_TWO)

    return SalarySlip.objects.create(
        employee=employee,
        month=month,
        year=year,
        working_days=working_days,
        present_days=present_days,
        leave_days=leave_days,
        absent_days=absent_days,
        overtime_hours=total_ot,
        basic_earned=basic_earned,
        hra_earned=hra_earned,
        allowances_earned=allowances_earned,
        overtime_amount=overtime_amount,
        gross_earned=gross_earned,
        pf_deduction=pf_deduction,
        esic_deduction=esic_deduction,
        advance_deduction=advance_deduction,
        other_deductions=other_deductions,
        total_deductions=total_deductions,
        net_salary=net_salary,
        status=SalarySlip.SlipStatus.DRAFT,
    )


def update_slip_status(slip: SalarySlip, new_status: str) -> SalarySlip:
    from core.exceptions import BusinessRuleViolation

    valid_transitions = {
        SalarySlip.SlipStatus.DRAFT: {SalarySlip.SlipStatus.APPROVED},
        SalarySlip.SlipStatus.APPROVED: {SalarySlip.SlipStatus.PAID},
        SalarySlip.SlipStatus.PAID: set(),
    }

    if new_status not in valid_transitions.get(slip.status, set()):
        raise BusinessRuleViolation(
            f"Cannot transition salary slip from '{slip.status}' to '{new_status}'."
        )

    slip.status = new_status
    slip.save(update_fields=["status", "updated_at"])
    return slip
