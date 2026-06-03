from django.urls import path

from . import views

urlpatterns = [
    path("repair-invoices/", views.RepairInvoiceView.as_view(), name="repair-invoices"),
    path("payments/", views.PaymentView.as_view(), name="payments"),
    path("webhooks/razorpay/", views.RazorpayWebhookView.as_view(), name="razorpay-webhook"),
    path("tally-export/", views.TallyExportView.as_view(), name="tally-export"),
]
