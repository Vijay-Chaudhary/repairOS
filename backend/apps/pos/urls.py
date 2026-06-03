from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import BarcodeView, SaleViewSet, SalesReturnViewSet

router = DefaultRouter(trailing_slash=True)
router.register("sales", SaleViewSet, basename="sales")
router.register("sales/returns", SalesReturnViewSet, basename="sales-returns")

urlpatterns = [
    path("", include(router.urls)),
    path("products/barcode/<str:barcode>/", BarcodeView.as_view(), name="barcode-lookup"),
]
