from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import AMCContractViewSet, AMCVisitViewSet

router = DefaultRouter(trailing_slash=True)
router.register("contracts", AMCContractViewSet, basename="amc-contracts")
router.register("visits", AMCVisitViewSet, basename="amc-visits")

urlpatterns = [
    path("", include(router.urls)),
]
