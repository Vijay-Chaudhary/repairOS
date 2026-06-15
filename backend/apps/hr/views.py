"""
HR & Payroll API views.
"""

import logging
from datetime import timedelta

from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from authentication.permissions import require_permission
from core.pagination import RepairOSCursorPagination, RepairOSPageNumberPagination

from . import services
from .models import AttendanceRecord, Employee, LeaveRequest, SalarySlip
from .serializers import (
    AttendanceRecordOutputSerializer,
    CreateEmployeeSerializer,
    CreateLeaveRequestSerializer,
    DateRangeBulkAttendanceSerializer,
    EmployeeSerializer,
    GenerateSlipsSerializer,
    LeaveRequestSerializer,
    SalarySlipSerializer,
    UpdateEmployeeSerializer,
    UpdateLeaveStatusSerializer,
    UpdateSlipStatusSerializer,
)

logger = logging.getLogger(__name__)


def _shop_ids_for_request(token) -> tuple[list, bool]:
    """Returns (shop_ids, is_wide). is_wide=True means no shop filter should apply."""
    if not token:
        return [], False
    if token.get("is_tenant_wide") or token.get("is_platform_admin"):
        return [], True
    return token.get("shop_ids", []), False


class EmployeeListCreateView(APIView):

    def get_permissions(self):
        if self.request.method == "POST":
            return [IsAuthenticated(), require_permission("hr.employees.manage")()]
        return [IsAuthenticated(), require_permission("hr.employees.view")()]

    def get(self, request: Request) -> Response:
        token = getattr(request, "auth", None)
        shop_ids, is_wide = _shop_ids_for_request(token)

        qs = Employee.objects.filter(deleted_at__isnull=True).select_related("shop").order_by("full_name")
        if not is_wide:
            qs = qs.filter(shop_id__in=shop_ids)

        if search := request.query_params.get("search"):
            from django.db.models import Q as DQ
            qs = qs.filter(DQ(full_name__icontains=search) | DQ(employee_code__icontains=search))

        paginator = RepairOSPageNumberPagination()
        page = paginator.paginate_queryset(qs, request)
        data = EmployeeSerializer(page, many=True).data
        return paginator.get_paginated_response(data)

    def post(self, request: Request) -> Response:
        serializer = CreateEmployeeSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        from core.models import Shop
        try:
            shop = Shop.objects.get(id=data["shop_id"])
        except Shop.DoesNotExist:
            return Response({"detail": "Shop not found."}, status=status.HTTP_404_NOT_FOUND)

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

    def get_permissions(self):
        if self.request.method == "PATCH":
            return [IsAuthenticated(), require_permission("hr.employees.manage")()]
        return [IsAuthenticated(), require_permission("hr.employees.view")()]

    def _get_employee(self, request: Request, employee_id):
        qs = Employee.objects.filter(deleted_at__isnull=True)
        token = getattr(request, "auth", None)
        shop_ids, is_wide = _shop_ids_for_request(token)
        if not is_wide:
            qs = qs.filter(shop_id__in=shop_ids)
        try:
            return qs.get(id=employee_id)
        except Employee.DoesNotExist:
            return None

    def get(self, request: Request, employee_id) -> Response:
        emp = self._get_employee(request, employee_id)
        if not emp:
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)
        return Response(EmployeeSerializer(emp).data)

    def patch(self, request: Request, employee_id) -> Response:
        emp = self._get_employee(request, employee_id)
        if not emp:
            return Response({"detail": "Not found."}, status=status.HTTP_404_NOT_FOUND)

        ser = UpdateEmployeeSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data

        updatable = [
            "full_name", "designation", "department", "date_of_leaving",
            "employment_type", "basic_salary", "hra", "other_allowances",
        ]
        for field in updatable:
            if field in data:
                setattr(emp, field, data[field])

        if "is_active" in data:
            from django.utils import timezone
            emp.deleted_at = None if data["is_active"] else timezone.now()

        # Recalculate gross_salary whenever any salary component changes
        if any(f in data for f in ("basic_salary", "hra", "other_allowances")):
            emp.gross_salary = emp.basic_salary + emp.hra + emp.other_allowances

        emp.save()
        return Response(EmployeeSerializer(emp).data)


class AttendanceListView(APIView):
    permission_classes = [IsAuthenticated, require_permission("hr.attendance.mark")]

    def get(self, request: Request) -> Response:
        token = getattr(request, "auth", None)
        shop_ids, is_wide = _shop_ids_for_request(token)

        qs = AttendanceRecord.objects.select_related("employee").order_by("date", "employee__full_name")
        if not is_wide:
            qs = qs.filter(employee__shop_id__in=shop_ids)

        if month := request.query_params.get("month"):
            qs = qs.filter(date__month=month)
        if year := request.query_params.get("year"):
            qs = qs.filter(date__year=year)
        if emp_id := request.query_params.get("employee_id"):
            qs = qs.filter(employee_id=emp_id)

        return Response({"items": AttendanceRecordOutputSerializer(qs, many=True).data})


class BulkAttendanceView(APIView):
    permission_classes = [IsAuthenticated, require_permission("hr.attendance.mark")]

    def post(self, request: Request) -> Response:
        serializer = DateRangeBulkAttendanceSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data

        records = []
        current = data["date_from"]
        while current <= data["date_to"]:
            for emp_id in data["employee_ids"]:
                records.append({
                    "employee_id": emp_id,
                    "date": current,
                    "status": data["status"],
                    "notes": data.get("notes", ""),
                })
            current += timedelta(days=1)

        created, updated = services.bulk_mark_attendance(records)
        return Response({"created": created, "updated": updated}, status=status.HTTP_201_CREATED)


class LeaveRequestListCreateView(APIView):
    permission_classes = [IsAuthenticated, require_permission("hr.leaves.manage")]

    def get(self, request: Request) -> Response:
        token = getattr(request, "auth", None)
        shop_ids, is_wide = _shop_ids_for_request(token)

        qs = LeaveRequest.objects.select_related("employee").order_by("-from_date")
        if not is_wide:
            qs = qs.filter(employee__shop_id__in=shop_ids)

        if s := request.query_params.get("status"):
            qs = qs.filter(status=s)
        if emp_id := request.query_params.get("employee_id"):
            qs = qs.filter(employee_id=emp_id)

        paginator = RepairOSPageNumberPagination()
        page = paginator.paginate_queryset(qs, request)
        data = LeaveRequestSerializer(page, many=True).data
        return paginator.get_paginated_response(data)

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

        token = getattr(request, "auth", None)
        shop_ids, is_wide = _shop_ids_for_request(token)
        qs = LeaveRequest.objects.select_related("employee")
        if not is_wide:
            qs = qs.filter(employee__shop_id__in=shop_ids)
        try:
            leave = qs.get(id=leave_id)
        except LeaveRequest.DoesNotExist:
            return Response({"detail": "Leave request not found."}, status=status.HTTP_404_NOT_FOUND)

        leave = services.approve_or_reject_leave(
            leave, serializer.validated_data["status"], request.user
        )
        return Response(LeaveRequestSerializer(leave).data)


class SalarySlipListView(APIView):

    def get_permissions(self):
        return [IsAuthenticated(), require_permission("hr.salary.view")()]

    def get(self, request: Request) -> Response:
        token = getattr(request, "auth", None)
        shop_ids, is_wide = _shop_ids_for_request(token)

        qs = SalarySlip.objects.select_related("employee").order_by("-year", "-month", "employee__full_name")
        if not is_wide:
            qs = qs.filter(employee__shop_id__in=shop_ids)

        if month := request.query_params.get("month"):
            qs = qs.filter(month=month)
        if year := request.query_params.get("year"):
            qs = qs.filter(year=year)
        if emp_id := request.query_params.get("employee_id"):
            qs = qs.filter(employee_id=emp_id)
        if s := request.query_params.get("status"):
            qs = qs.filter(status=s)

        paginator = RepairOSPageNumberPagination()
        page = paginator.paginate_queryset(qs, request)
        data = SalarySlipSerializer(page, many=True).data
        return paginator.get_paginated_response(data)


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
        return Response({"slips": SalarySlipSerializer(slips, many=True).data}, status=status.HTTP_201_CREATED)


class SalarySlipDetailView(APIView):

    def get_permissions(self):
        if self.request.method == "PATCH":
            return [IsAuthenticated(), require_permission("hr.salary.generate")()]
        return [IsAuthenticated(), require_permission("hr.salary.view")()]

    def _get_slip(self, request: Request, slip_id):
        token = getattr(request, "auth", None)
        shop_ids, is_wide = _shop_ids_for_request(token)
        qs = SalarySlip.objects.select_related("employee")
        if not is_wide:
            qs = qs.filter(employee__shop_id__in=shop_ids)
        try:
            return qs.get(id=slip_id)
        except SalarySlip.DoesNotExist:
            return None

    def get(self, request: Request, slip_id) -> Response:
        slip = self._get_slip(request, slip_id)
        if not slip:
            return Response({"detail": "Salary slip not found."}, status=status.HTTP_404_NOT_FOUND)
        return Response(SalarySlipSerializer(slip).data)

    def patch(self, request: Request, slip_id) -> Response:
        serializer = UpdateSlipStatusSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        slip = self._get_slip(request, slip_id)
        if not slip:
            return Response({"detail": "Salary slip not found."}, status=status.HTTP_404_NOT_FOUND)

        slip = services.update_slip_status(slip, serializer.validated_data["status"])
        return Response(SalarySlipSerializer(slip).data)


class SalarySlipPdfView(APIView):
    permission_classes = [IsAuthenticated, require_permission("hr.salary.view")]

    def get(self, request: Request, slip_id) -> Response:
        token = getattr(request, "auth", None)
        shop_ids, is_wide = _shop_ids_for_request(token)
        qs = SalarySlip.objects.select_related("employee")
        if not is_wide:
            qs = qs.filter(employee__shop_id__in=shop_ids)
        try:
            slip = qs.get(id=slip_id)
        except SalarySlip.DoesNotExist:
            return Response({"detail": "Salary slip not found."}, status=status.HTTP_404_NOT_FOUND)
        return Response({"pdf_url": slip.pdf_url or ""})
