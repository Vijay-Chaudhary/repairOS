from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import BarcodeView, SaleViewSet, SalesReturnViewSet

router = DefaultRouter(trailing_slash=True)
# Returns must be registered first: SaleViewSet's detail route (^sales/<pk>/$)
# would otherwise swallow the returns list (^sales/returns/$) and 400 on the
# non-UUID pk. Detail routes (sales/returns/<pk>/) are unaffected either way.
router.register("sales/returns", SalesReturnViewSet, basename="sales-returns")
router.register("sales", SaleViewSet, basename="sales")

urlpatterns = [
    path("", include(router.urls)),
    path("products/barcode/<str:barcode>/", BarcodeView.as_view(), name="barcode-lookup"),
]
