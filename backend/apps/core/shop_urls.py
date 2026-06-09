from django.urls import path

from .views import ShopListView
from .settings_views import ShopDetailView

urlpatterns = [
    path("",                   ShopListView.as_view(),   name="shop-list"),
    path("<uuid:shop_id>/",    ShopDetailView.as_view(), name="shop-detail"),
]
