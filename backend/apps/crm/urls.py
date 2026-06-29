from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    CampaignViewSet,
    CommunicationLogViewSet,
    ContactViewSet,
    CrmOverviewView,
    CustomerSegmentViewSet,
    CustomerViewSet,
    FollowUpTaskViewSet,
    LeadQuoteViewSet,
    LeadViewSet,
)

router = DefaultRouter(trailing_slash=True)
router.register("leads", LeadViewSet, basename="leads")
router.register("quotes", LeadQuoteViewSet, basename="quotes")
router.register("customers", CustomerViewSet, basename="customers")
router.register("communications", CommunicationLogViewSet, basename="communications")
router.register("tasks", FollowUpTaskViewSet, basename="tasks")
router.register("segments", CustomerSegmentViewSet, basename="segments")
router.register("campaigns", CampaignViewSet, basename="campaigns")
router.register("contacts", ContactViewSet, basename="contacts")

urlpatterns = [
    path("overview/", CrmOverviewView.as_view(), name="crm-overview"),
    path("", include(router.urls)),
]
