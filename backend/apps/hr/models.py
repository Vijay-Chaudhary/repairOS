"""
HR & Payroll models — tenant DB.

Sensitive fields (bank_account_number, pan_number, aadhar_number) are
stored encrypted using Fernet (AES-128-CBC). Never return raw encrypted
bytes to the client — use the get_*/set_* helpers.
"""

import uuid

from cryptography.fernet import Fernet
from django.conf import settings
from django.db import models
from django.utils import timezone

from core.models import BaseModel, SoftDeleteModel


def _fernet() -> Fernet:
    key = settings.TENANT_CRED_ENCRYPTION_KEY
    if not key:
        raise RuntimeError("TENANT_CRED_ENCRYPTION_KEY is not set.")
    return Fernet(key.encode() if isinstance(key, str) else key)


def _encrypt(plaintext: str) -> str:
    if not plaintext:
        return ""
    return _fernet().encrypt(plaintext.encode()).decode()


def _decrypt(ciphertext: str) -> str:
    if not ciphertext:
        return ""
    return _fernet().decrypt(ciphertext.encode()).decode()


class Employee(SoftDeleteModel):
    class EmploymentType(models.TextChoices):
        FULL_TIME = "full_time", "Full Time"
        PART_TIME = "part_time", "Part Time"
        CONTRACT = "contract", "Contract"
        INTERN = "intern", "Intern"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    shop = models.ForeignKey("core.Shop", on_delete=models.PROTECT, related_name="employees")
    user = models.OneToOneField(
        settings.AUTH_USER_MODEL,
        null=True, blank=True,
        on_delete=models.SET_NULL,
        related_name="employee_profile",
    )
    employee_code = models.CharField(max_length=30, unique=True)
    full_name = models.CharField(max_length=200)
    designation = models.CharField(max_length=100)
    department = models.CharField(max_length=100, null=True, blank=True)
    date_of_joining = models.DateField()
    date_of_leaving = models.DateField(null=True, blank=True)
    employment_type = models.CharField(
        max_length=20, choices=EmploymentType.choices, default=EmploymentType.FULL_TIME
    )

    # Salary components
    basic_salary = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    hra = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    other_allowances = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    gross_salary = models.DecimalField(max_digits=10, decimal_places=2, default=0)

    # Statutory deductions
    pf_employee = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    pf_employer = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    esic_employee = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    esic_employer = models.DecimalField(max_digits=10, decimal_places=2, default=0)

    # Encrypted statutory fields — never expose raw ciphertext
    bank_account_number_encrypted = models.TextField(blank=True, default="")
    bank_ifsc = models.CharField(max_length=11, blank=True, default="")
    pan_number_encrypted = models.TextField(blank=True, default="")
    aadhar_number_encrypted = models.TextField(blank=True, default="")

    def set_bank_account(self, plaintext: str) -> None:
        self.bank_account_number_encrypted = _encrypt(plaintext)

    def get_bank_account(self) -> str:
        return _decrypt(self.bank_account_number_encrypted)

    def set_pan(self, plaintext: str) -> None:
        self.pan_number_encrypted = _encrypt(plaintext)

    def get_pan(self) -> str:
        return _decrypt(self.pan_number_encrypted)

    def set_aadhar(self, plaintext: str) -> None:
        self.aadhar_number_encrypted = _encrypt(plaintext)

    def get_aadhar(self) -> str:
        return _decrypt(self.aadhar_number_encrypted)

    class Meta:
        app_label = "hr"
        db_table = "employees"
        indexes = [
            models.Index(fields=["shop"]),
            models.Index(fields=["employee_code"]),
        ]

    def __str__(self) -> str:
        return f"{self.employee_code} — {self.full_name}"


class AttendanceRecord(BaseModel):
    class AttendanceStatus(models.TextChoices):
        PRESENT = "present", "Present"
        ABSENT = "absent", "Absent"
        HALF_DAY = "half_day", "Half Day"
        LEAVE = "leave", "Leave"
        HOLIDAY = "holiday", "Holiday"
        WEEKEND = "weekend", "Weekend"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name="attendance")
    date = models.DateField(db_index=True)
    status = models.CharField(max_length=20, choices=AttendanceStatus.choices)
    check_in = models.TimeField(null=True, blank=True)
    check_out = models.TimeField(null=True, blank=True)
    overtime_hours = models.DecimalField(max_digits=4, decimal_places=2, default=0)
    notes = models.TextField(blank=True, default="")

    class Meta:
        app_label = "hr"
        db_table = "attendance_records"
        unique_together = [("employee", "date")]
        indexes = [models.Index(fields=["employee", "date"])]

    def __str__(self) -> str:
        return f"{self.employee.employee_code} {self.date}: {self.status}"


class LeaveRequest(BaseModel):
    class LeaveType(models.TextChoices):
        CASUAL = "casual", "Casual"
        SICK = "sick", "Sick"
        EARNED = "earned", "Earned"
        UNPAID = "unpaid", "Unpaid"
        MATERNITY = "maternity", "Maternity"
        PATERNITY = "paternity", "Paternity"

    class LeaveStatus(models.TextChoices):
        PENDING = "pending", "Pending"
        APPROVED = "approved", "Approved"
        REJECTED = "rejected", "Rejected"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    employee = models.ForeignKey(Employee, on_delete=models.CASCADE, related_name="leave_requests")
    leave_type = models.CharField(max_length=20, choices=LeaveType.choices)
    from_date = models.DateField()
    to_date = models.DateField()
    days = models.DecimalField(max_digits=4, decimal_places=1)
    reason = models.TextField(blank=True, default="")
    status = models.CharField(
        max_length=20, choices=LeaveStatus.choices, default=LeaveStatus.PENDING
    )
    approved_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True, blank=True,
        on_delete=models.SET_NULL,
        related_name="approved_leaves",
    )
    approved_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        app_label = "hr"
        db_table = "leave_requests"
        indexes = [models.Index(fields=["employee", "status"])]

    def __str__(self) -> str:
        return f"{self.employee.employee_code} leave {self.from_date}–{self.to_date}"


class SalarySlip(BaseModel):
    class SlipStatus(models.TextChoices):
        DRAFT = "draft", "Draft"
        APPROVED = "approved", "Approved"
        PAID = "paid", "Paid"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    employee = models.ForeignKey(Employee, on_delete=models.PROTECT, related_name="salary_slips")
    month = models.IntegerField()
    year = models.IntegerField()

    working_days = models.IntegerField(default=0)
    present_days = models.DecimalField(max_digits=5, decimal_places=1, default=0)
    leave_days = models.DecimalField(max_digits=5, decimal_places=1, default=0)
    absent_days = models.DecimalField(max_digits=5, decimal_places=1, default=0)
    overtime_hours = models.DecimalField(max_digits=6, decimal_places=2, default=0)

    basic_earned = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    hra_earned = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    allowances_earned = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    overtime_amount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    gross_earned = models.DecimalField(max_digits=10, decimal_places=2, default=0)

    pf_deduction = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    esic_deduction = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    advance_deduction = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    other_deductions = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    total_deductions = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    net_salary = models.DecimalField(max_digits=10, decimal_places=2, default=0)

    status = models.CharField(
        max_length=20, choices=SlipStatus.choices, default=SlipStatus.DRAFT
    )
    pdf_url = models.CharField(max_length=500, blank=True, default="")

    class Meta:
        app_label = "hr"
        db_table = "salary_slips"
        unique_together = [("employee", "month", "year")]
        indexes = [models.Index(fields=["employee", "year", "month"])]

    def __str__(self) -> str:
        return f"Slip {self.employee.employee_code} {self.month}/{self.year}"
