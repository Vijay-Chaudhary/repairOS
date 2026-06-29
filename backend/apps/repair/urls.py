from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    DeviceHistoryView,
    FaultTemplateViewSet,
    JobEstimateWorklistViewSet,
    JobTicketViewSet,
    RepairOverviewView,
    SparePartRequestViewSet,
    WarrantyWorklistView,
)

router = DefaultRouter(trailing_slash=True)
router.register("jobs", JobTicketViewSet, basename="jobs")
router.register("spare-parts", SparePartRequestViewSet, basename="spare-parts")
router.register("fault-templates", FaultTemplateViewSet, basename="fault-templates")
router.register("estimates", JobEstimateWorklistViewSet, basename="estimates")

urlpatterns = [
    path("overview/", RepairOverviewView.as_view(), name="repair-overview"),
    path("warranty/", WarrantyWorklistView.as_view(), name="repair-warranty"),
    path("device-history/", DeviceHistoryView.as_view(), name="repair-device-history"),
    path("", include(router.urls)),
]
