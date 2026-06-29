from django.urls import path

from . import views

urlpatterns = [
    path("outstanding/", views.OutstandingView.as_view(), name="outstanding"),
    path("repair-invoices/", views.RepairInvoiceView.as_view(), name="repair-invoices"),
    path("repair-invoices/<uuid:invoice_id>/", views.RepairInvoiceDetailView.as_view(), name="repair-invoice-detail"),
    path("repair-invoices/<uuid:invoice_id>/pdf/", views.RepairInvoicePdfView.as_view(), name="repair-invoice-pdf"),
    path("repair-invoices/<uuid:invoice_id>/send-whatsapp/", views.RepairInvoiceSendWhatsappView.as_view(), name="repair-invoice-send-whatsapp"),
    # payments/razorpay/create-link/ must be declared before payments/ to avoid ambiguity
    path("payments/razorpay/create-link/", views.RazorpayCreateLinkView.as_view(), name="razorpay-create-link"),
    path("payments/", views.PaymentView.as_view(), name="payments"),
    path("webhooks/razorpay/", views.RazorpayWebhookView.as_view(), name="razorpay-webhook"),
    path("tally-export/", views.TallyExportView.as_view(), name="tally-export"),
    path("tax-rates/", views.TaxRateView.as_view(), name="tax-rates"),
    path("tax-rates/<uuid:tax_rate_id>/", views.TaxRateDetailView.as_view(), name="tax-rate-detail"),
]
