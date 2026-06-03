from django.urls import path

from . import views

urlpatterns = [
    path("petty-cash/<uuid:shop_id>/", views.PettyCashAccountView.as_view(), name="petty-cash-account"),
    path("petty-cash/transactions/", views.PettyCashTransactionView.as_view(), name="petty-cash-txn"),
    path("budget/", views.BudgetHeadListView.as_view(), name="budget-heads"),
    path("budget/allocations/", views.BudgetAllocationView.as_view(), name="budget-allocations"),
    path("expenses/", views.ExpenseListCreateView.as_view(), name="expenses"),
    path("assets/", views.AssetListCreateView.as_view(), name="assets"),
    path("assets/<uuid:asset_id>/", views.AssetDetailView.as_view(), name="asset-detail"),
]
