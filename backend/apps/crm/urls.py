from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    CommunicationLogViewSet,
    CustomerSegmentViewSet,
    CustomerViewSet,
    FollowUpTaskViewSet,
    LeadViewSet,
)

router = DefaultRouter(trailing_slash=True)
router.register("leads", LeadViewSet, basename="leads")
router.register("customers", CustomerViewSet, basename="customers")
router.register("communications", CommunicationLogViewSet, basename="communications")
router.register("tasks", FollowUpTaskViewSet, basename="tasks")
router.register("segments", CustomerSegmentViewSet, basename="segments")

urlpatterns = [
    path("", include(router.urls)),
]
