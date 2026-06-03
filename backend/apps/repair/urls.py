from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import FaultTemplateViewSet, JobTicketViewSet, SparePartRequestViewSet

router = DefaultRouter(trailing_slash=True)
router.register("jobs", JobTicketViewSet, basename="jobs")
router.register("spare-parts", SparePartRequestViewSet, basename="spare-parts")
router.register("fault-templates", FaultTemplateViewSet, basename="fault-templates")

urlpatterns = [
    path("", include(router.urls)),
]
