from django.urls import path

from . import views

urlpatterns = [
    path("rules/", views.CommissionRulesView.as_view(), name="commission-rules"),
    path("technician/<uuid:technician_id>/", views.TechnicianLedgerView.as_view(), name="technician-ledger"),
    path("payouts/", views.CommissionPayoutView.as_view(), name="commission-payouts"),
    path("payouts/<uuid:payout_id>/", views.CommissionPayoutDetailView.as_view(), name="commission-payout-detail"),
]
