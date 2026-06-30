from django.urls import path

from . import views

urlpatterns = [
    path("chart/", views.AccountListCreateView.as_view(), name="account-list-create"),
    path("chart/seed/", views.SeedChartView.as_view(), name="account-seed"),
    path("chart/<uuid:account_id>/", views.AccountDetailView.as_view(), name="account-detail"),
]
