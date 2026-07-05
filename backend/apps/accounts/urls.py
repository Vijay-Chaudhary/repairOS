from django.urls import path

from . import views

urlpatterns = [
    path("chart/", views.AccountListCreateView.as_view(), name="account-list-create"),
    path("chart/seed/", views.SeedChartView.as_view(), name="account-seed"),
    path("chart/<uuid:account_id>/", views.AccountDetailView.as_view(), name="account-detail"),
    path("journal/", views.JournalListCreateView.as_view(), name="journal-list-create"),
    path("journal/<uuid:entry_id>/", views.JournalDetailView.as_view(), name="journal-detail"),
    path("journal/<uuid:entry_id>/post/", views.PostJournalView.as_view(), name="journal-post"),
    path("ledger/<uuid:account_id>/", views.LedgerView.as_view(), name="ledger"),
    path("trial-balance/", views.TrialBalanceView.as_view(), name="trial-balance"),
    path("reports/pnl/", views.ProfitLossView.as_view(), name="report-pnl"),
    path("reports/balance-sheet/", views.BalanceSheetView.as_view(), name="report-balance-sheet"),
]
