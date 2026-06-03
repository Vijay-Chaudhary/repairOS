from django.urls import include, path
from rest_framework.routers import DefaultRouter

from .views import (
    AdjustmentView,
    BarcodeView,
    BulkImportView,
    InventoryStockViewSet,
    InventoryTransactionViewSet,
    OpeningStockView,
    ProductVariantUpdateView,
    ProductViewSet,
    TransferView,
)

router = DefaultRouter(trailing_slash=True)
router.register("products", ProductViewSet, basename="products")
router.register("stock", InventoryStockViewSet, basename="inventory-stock")
router.register("transactions", InventoryTransactionViewSet, basename="inventory-transactions")

# Specific paths MUST come before router include; the router's <pk> converter
# would otherwise match "bulk-import", "barcode", etc. as a product pk.
urlpatterns = [
    path("products/barcode/<str:barcode>/", BarcodeView.as_view(), name="product-barcode"),
    path("products/bulk-import/", BulkImportView.as_view(), name="product-bulk-import"),
    path("products/variants/<uuid:pk>/", ProductVariantUpdateView.as_view(), name="variant-update"),
    path("stock/opening/", OpeningStockView.as_view(), name="opening-stock"),
    path("adjustment/", AdjustmentView.as_view(), name="stock-adjustment"),
    path("transfer/", TransferView.as_view(), name="stock-transfer"),
    path("", include(router.urls)),
]
