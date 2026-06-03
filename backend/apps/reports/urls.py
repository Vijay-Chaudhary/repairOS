from django.urls import path

from . import views

urlpatterns = [
    path("dashboard/", views.DashboardView.as_view(), name="dashboard"),
    path("export-jobs/", views.ExportJobListView.as_view(), name="export-jobs"),
    path("gstr1/", views.GSTR1View.as_view(), name="gstr1"),
    path("gstr2-proxy/", views.GSTR2View.as_view(), name="gstr2-proxy"),
    # Dynamic report dispatcher. When ?export=csv|pdf is present, creates an ExportJob (202).
    path("<str:report_type>/", views.ReportView.as_view(), name="report"),
]
