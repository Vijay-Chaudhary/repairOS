from django.urls import path

from . import views

urlpatterns = [
    path("employees/", views.EmployeeListCreateView.as_view(), name="employees"),
    path("employees/<uuid:employee_id>/", views.EmployeeDetailView.as_view(), name="employee-detail"),
    path("attendance/bulk/", views.BulkAttendanceView.as_view(), name="attendance-bulk"),
    path("leave-requests/", views.LeaveRequestListCreateView.as_view(), name="leave-requests"),
    path("leave-requests/<uuid:leave_id>/", views.LeaveRequestDetailView.as_view(), name="leave-request-detail"),
    path("salary-slips/", views.SalarySlipListView.as_view(), name="salary-slips"),
    path("salary-slips/generate/", views.GenerateSalarySlipsView.as_view(), name="salary-slips-generate"),
    path("salary-slips/<uuid:slip_id>/", views.SalarySlipDetailView.as_view(), name="salary-slip-detail"),
]
