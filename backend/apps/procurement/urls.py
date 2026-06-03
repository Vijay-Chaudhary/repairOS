from django.urls import path

from .views import (
    GRNView,
    PurchaseInvoiceView,
    PurchaseOrderDetailView,
    PurchaseOrderView,
    PurchasePaymentView,
    PurchaseReturnDispatchView,
    PurchaseReturnView,
    SupplierDetailView,
    SupplierLedgerView,
    SupplierView,
)

urlpatterns = [
    path("suppliers/", SupplierView.as_view(), name="supplier-list"),
    path("suppliers/<uuid:pk>/", SupplierDetailView.as_view(), name="supplier-detail"),
    path("suppliers/<uuid:pk>/ledger/", SupplierLedgerView.as_view(), name="supplier-ledger"),
    path("purchase-orders/", PurchaseOrderView.as_view(), name="purchase-order-list"),
    path("purchase-orders/<uuid:pk>/", PurchaseOrderDetailView.as_view(), name="purchase-order-detail"),
    path("grn/", GRNView.as_view(), name="grn-create"),
    path("purchase-invoices/", PurchaseInvoiceView.as_view(), name="purchase-invoice-create"),
    path("purchase-payments/", PurchasePaymentView.as_view(), name="purchase-payment-create"),
    path("purchase-returns/", PurchaseReturnView.as_view(), name="purchase-return-create"),
    path("purchase-returns/<uuid:pk>/dispatch/", PurchaseReturnDispatchView.as_view(), name="purchase-return-dispatch"),
]
