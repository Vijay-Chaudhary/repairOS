from django.urls import path

from .audit_views import AuditLogFacetsView, AuditLogListView

urlpatterns = [
    path("", AuditLogListView.as_view(), name="audit-list"),
    path("facets/", AuditLogFacetsView.as_view(), name="audit-facets"),
]
