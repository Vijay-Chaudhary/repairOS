"""
HR & Payroll API views.
"""

import logging

from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from authentication.permissions import require_permission

from . import services
from .models import Employee, LeaveRequest, SalarySlip
from .serializers import (
    BulkAttendanceSerializer,
    CreateEmployeeSerializer,
    CreateLeaveRequestSerializer,
    EmployeeSerializer,
    GenerateSlipsSerializer,
    LeaveRequestSerializer,
    SalarySlipSerializer,
    UpdateLeaveStatusSerializer,
    UpdateSlipStatusSerializer,
)

logger = logging.getLogger(__name__)


class EmployeeListCreateView(APIView):

    def get_permissions(self):
        if self.request.method == "POST":
            return [IsAuthenticated(), require_permission("hr.employees.manage")()]
        return [IsAuthenticated(), require_permission("hr.employees.view")()]

    def get(self, request: Request) -> Response:
        employees = Employee.objects.filter(deleted_at__isnull=True).select_related("shop")
        return Response(EmployeeSerializer(employees, many=True).data)

    def post(self, request: Request) -> Response:
        serializer = CreateEmployeeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        from core.models import Shop
        try:
            shop = Shop.objects.get(id=data["shop_id"])
        except Shop.DoesNotExist:
            return Response({"detail": "Shop not found."}, status=status.HTTP_404_NOT_FOUND)

        # Unique employee_code check
        if Employee.objects.filter(employee_code=data["employee_code"]).exists():
            return Response(
                {"detail": "Employee with this code already exists."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        emp = Employee(
            shop=shop,
            employee_code=data["employee_code"],
            full_name=data["full_name"],
            designation=data["designation"],
            department=data.get("department") or None,
            date_of_joining=data["date_of_joining"],
            employment_type=data["employment_type"],
            basic_salary=data["basic_salary"],
            hra=data["hra"],
            other_allowances=data["other_allowances"],
            gross_salary=data["gross_salary"],
            pf_employee=data["pf_employee"],
            pf_employer=data["pf_employer"],
            esic_employee=data["esic_employee"],
            esic_employer=data["esic_employer"],
            bank_ifsc=data.get("bank_ifsc", ""),
        )
        if data.get("bank_account_number"):
            emp.set_bank_account(data["bank_account_number"])
        if data.get("pan_number"):
            emp.set_pan(data["pan_number"])
        if data.get("aadhar_number"):
            emp.set_aadhar(data["aadhar_number"])
        emp.save()

        return Response(EmployeeSerializer(emp).data, status=status.HTTP_201_CREATED)


class EmployeeDetailView(APIView):
    permission_classes = [IsAuthenticated, require_permission("hr.employees.view")]

    def get(self, request: Request, employee_id) -> Response:
        try:
            emp = Employee.objects.get(id=employee_id, deleted_at__isnull=True)
        except Employee.DoesNotExist:
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        return Response(EmployeeSerializer(emp).data)


class BulkAttendanceView(APIView):
    permission_classes = [IsAuthenticated, require_permission("hr.attendance.mark")]

    def post(self, request: Request) -> Response:
        serializer = BulkAttendanceSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        records = serializer.validated_data["records"]
        created = services.bulk_mark_attendance(records)
        return Response({"created": created, "total": len(records)}, status=status.HTTP_201_CREATED)


class LeaveRequestListCreateView(APIView):
    permission_classes = [IsAuthenticated, require_permission("hr.leaves.manage")]

    def post(self, request: Request) -> Response:
        serializer = CreateLeaveRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        try:
            employee = Employee.objects.get(id=data["employee_id"], deleted_at__isnull=True)
        except Employee.DoesNotExist:
            return Response({"detail": "Employee not found."}, status=status.HTTP_404_NOT_FOUND)

        leave = LeaveRequest.objects.create(
            employee=employee,
            leave_type=data["leave_type"],
            from_date=data["from_date"],
            to_date=data["to_date"],
            days=data["days"],
            reason=data.get("reason", ""),
        )
        return Response(LeaveRequestSerializer(leave).data, status=status.HTTP_201_CREATED)


class LeaveRequestDetailView(APIView):
    permission_classes = [IsAuthenticated, require_permission("hr.leaves.manage")]

    def patch(self, request: Request, leave_id) -> Response:
        serializer = UpdateLeaveStatusSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            leave = LeaveRequest.objects.get(id=leave_id)
        except LeaveRequest.DoesNotExist:
            return Response({"detail": "Leave request not found."}, status=status.HTTP_404_NOT_FOUND)

        leave = services.approve_or_reject_leave(
            leave, serializer.validated_data["status"], request.user
        )
        return Response(LeaveRequestSerializer(leave).data)


class GenerateSalarySlipsView(APIView):
    permission_classes = [IsAuthenticated, require_permission("hr.salary.generate")]

    def post(self, request: Request) -> Response:
        serializer = GenerateSlipsSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        from core.models import Shop
        try:
            shop = Shop.objects.get(id=data["shop_id"])
        except Shop.DoesNotExist:
            return Response({"detail": "Shop not found."}, status=status.HTTP_404_NOT_FOUND)

        slips = services.generate_salary_slips(
            shop=shop,
            month=data["month"],
            year=data["year"],
            employee_ids=data["employee_ids"],
        )
        return Response(SalarySlipSerializer(slips, many=True).data, status=status.HTTP_201_CREATED)


class SalarySlipDetailView(APIView):

    def get_permissions(self):
        if self.request.method == "PATCH":
            return [IsAuthenticated(), require_permission("hr.salary.generate")()]
        return [IsAuthenticated(), require_permission("hr.salary.view")()]

    def patch(self, request: Request, slip_id) -> Response:
        serializer = UpdateSlipStatusSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        try:
            slip = SalarySlip.objects.get(id=slip_id)
        except SalarySlip.DoesNotExist:
            return Response({"detail": "Salary slip not found."}, status=status.HTTP_404_NOT_FOUND)

        slip = services.update_slip_status(slip, serializer.validated_data["status"])
        return Response(SalarySlipSerializer(slip).data)
