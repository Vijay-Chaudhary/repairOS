from decimal import Decimal

from rest_framework import serializers

from .models import AttendanceRecord, Employee, LeaveRequest, SalarySlip


class EmployeeSerializer(serializers.ModelSerializer):
    """
    Safe output serializer — never exposes encrypted fields or their ciphertexts.
    Encrypted fields are masked as 'XXXX' to confirm they exist without leaking values.
    """
    shop_id = serializers.UUIDField(read_only=True)
    user_id = serializers.UUIDField(read_only=True, allow_null=True)
    is_active = serializers.SerializerMethodField()
    bank_account_masked = serializers.SerializerMethodField()
    pan_masked = serializers.SerializerMethodField()
    aadhar_masked = serializers.SerializerMethodField()

    class Meta:
        model = Employee
        fields = [
            "id", "shop_id", "user_id", "employee_code", "full_name", "designation", "department",
            "date_of_joining", "date_of_leaving", "employment_type",
            "basic_salary", "hra", "other_allowances", "gross_salary",
            "pf_employee", "pf_employer", "esic_employee", "esic_employer",
            "bank_ifsc", "is_active",
            "bank_account_masked", "pan_masked", "aadhar_masked",
        ]

    def get_is_active(self, obj) -> bool:
        return obj.deleted_at is None

    def get_bank_account_masked(self, obj) -> str:
        return "****" if obj.bank_account_number_encrypted else ""

    def get_pan_masked(self, obj) -> str:
        return "****" if obj.pan_number_encrypted else ""

    def get_aadhar_masked(self, obj) -> str:
        return "****" if obj.aadhar_number_encrypted else ""


class CreateEmployeeSerializer(serializers.Serializer):
    shop_id = serializers.UUIDField()
    employee_code = serializers.CharField(max_length=30)
    full_name = serializers.CharField(max_length=200)
    designation = serializers.CharField(max_length=100)
    department = serializers.CharField(max_length=100, required=False, default="", allow_blank=True)
    date_of_joining = serializers.DateField()
    employment_type = serializers.ChoiceField(
        choices=Employee.EmploymentType.choices, default=Employee.EmploymentType.FULL_TIME
    )
    basic_salary = serializers.DecimalField(max_digits=10, decimal_places=2, default=0)
    hra = serializers.DecimalField(max_digits=10, decimal_places=2, default=0)
    other_allowances = serializers.DecimalField(max_digits=10, decimal_places=2, default=0)
    gross_salary = serializers.DecimalField(max_digits=10, decimal_places=2, default=0)
    pf_employee = serializers.DecimalField(max_digits=10, decimal_places=2, default=0)
    pf_employer = serializers.DecimalField(max_digits=10, decimal_places=2, default=0)
    esic_employee = serializers.DecimalField(max_digits=10, decimal_places=2, default=0)
    esic_employer = serializers.DecimalField(max_digits=10, decimal_places=2, default=0)
    bank_account_number = serializers.CharField(max_length=30, required=False, default="", allow_blank=True)
    bank_ifsc = serializers.CharField(max_length=11, required=False, default="", allow_blank=True)
    pan_number = serializers.CharField(max_length=10, required=False, default="", allow_blank=True)
    aadhar_number = serializers.CharField(max_length=12, required=False, default="", allow_blank=True)


class AttendanceRecordSerializer(serializers.Serializer):
    employee_id = serializers.UUIDField()
    date = serializers.DateField()
    status = serializers.ChoiceField(choices=AttendanceRecord.AttendanceStatus.choices)
    check_in = serializers.TimeField(required=False, allow_null=True)
    check_out = serializers.TimeField(required=False, allow_null=True)
    overtime_hours = serializers.DecimalField(
        max_digits=4, decimal_places=2, default=0, min_value=Decimal("0")
    )
    notes = serializers.CharField(required=False, default="", allow_blank=True)


class BulkAttendanceSerializer(serializers.Serializer):
    records = AttendanceRecordSerializer(many=True, min_length=1)


class DateRangeBulkAttendanceSerializer(serializers.Serializer):
    """Accepts a date range + employee list and expands to per-day records server-side."""
    shop_id = serializers.UUIDField()
    employee_ids = serializers.ListField(child=serializers.UUIDField(), min_length=1)
    date_from = serializers.DateField()
    date_to = serializers.DateField()
    status = serializers.ChoiceField(choices=AttendanceRecord.AttendanceStatus.choices)
    notes = serializers.CharField(required=False, default="", allow_blank=True)

    def validate(self, data):
        if data["date_to"] < data["date_from"]:
            raise serializers.ValidationError("date_to must be >= date_from.")
        delta = (data["date_to"] - data["date_from"]).days + 1
        if delta > 31:
            raise serializers.ValidationError("Date range cannot exceed 31 days.")
        return data


class AttendanceRecordOutputSerializer(serializers.ModelSerializer):
    employee_id = serializers.UUIDField(read_only=True)
    employee_name = serializers.CharField(source="employee.full_name", read_only=True)

    class Meta:
        model = AttendanceRecord
        fields = [
            "id", "employee_id", "employee_name", "date", "status",
            "check_in", "check_out", "overtime_hours", "notes",
        ]


class LeaveRequestSerializer(serializers.ModelSerializer):
    employee_id = serializers.UUIDField(read_only=True)
    employee_name = serializers.CharField(source="employee.full_name", read_only=True)

    class Meta:
        model = LeaveRequest
        fields = [
            "id", "employee_id", "employee_name", "leave_type", "from_date", "to_date",
            "days", "reason", "status", "approved_by", "approved_at",
        ]


class CreateLeaveRequestSerializer(serializers.Serializer):
    employee_id = serializers.UUIDField()
    leave_type = serializers.ChoiceField(choices=LeaveRequest.LeaveType.choices)
    from_date = serializers.DateField()
    to_date = serializers.DateField()
    days = serializers.DecimalField(max_digits=4, decimal_places=1, min_value=Decimal("0.5"))
    reason = serializers.CharField(required=False, default="", allow_blank=True)

    def validate(self, data):
        if data["to_date"] < data["from_date"]:
            raise serializers.ValidationError("to_date must be >= from_date.")
        return data


class UpdateLeaveStatusSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=[
        LeaveRequest.LeaveStatus.APPROVED,
        LeaveRequest.LeaveStatus.REJECTED,
    ])


class SalarySlipSerializer(serializers.ModelSerializer):
    employee_id = serializers.UUIDField(read_only=True)
    employee_name = serializers.CharField(source="employee.full_name", read_only=True)
    employee_code = serializers.CharField(source="employee.employee_code", read_only=True)

    class Meta:
        model = SalarySlip
        fields = [
            "id", "employee_id", "employee_name", "employee_code", "month", "year", "working_days",
            "present_days", "leave_days", "absent_days", "overtime_hours",
            "basic_earned", "hra_earned", "allowances_earned", "overtime_amount",
            "gross_earned", "pf_deduction", "esic_deduction",
            "advance_deduction", "other_deductions", "total_deductions",
            "net_salary", "status", "pdf_url",
        ]


class GenerateSlipsSerializer(serializers.Serializer):
    shop_id = serializers.UUIDField()
    month = serializers.IntegerField(min_value=1, max_value=12)
    year = serializers.IntegerField(min_value=2020, max_value=2100)
    employee_ids = serializers.ListField(child=serializers.UUIDField(), required=False, default=list)


class UpdateEmployeeSerializer(serializers.Serializer):
    full_name = serializers.CharField(max_length=200, required=False)
    designation = serializers.CharField(max_length=100, required=False)
    department = serializers.CharField(max_length=100, required=False, allow_blank=True, allow_null=True)
    date_of_leaving = serializers.DateField(required=False, allow_null=True)
    employment_type = serializers.ChoiceField(
        choices=Employee.EmploymentType.choices, required=False
    )
    basic_salary = serializers.DecimalField(max_digits=10, decimal_places=2, required=False)
    hra = serializers.DecimalField(max_digits=10, decimal_places=2, required=False)
    other_allowances = serializers.DecimalField(max_digits=10, decimal_places=2, required=False)
    is_active = serializers.BooleanField(required=False)


class UpdateSlipStatusSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=[
        SalarySlip.SlipStatus.APPROVED,
        SalarySlip.SlipStatus.PAID,
    ])
