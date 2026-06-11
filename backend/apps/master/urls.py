from django.urls import path

from . import views

urlpatterns = [
    path("register/", views.RegisterView.as_view(), name="register"),
    path("register/status/", views.RegistrationStatusView.as_view(), name="register-status"),
    path("platform/tenants/", views.TenantListView.as_view(), name="platform-tenants"),
    path("platform/tenants/<uuid:tenant_id>/", views.TenantDetailView.as_view(), name="platform-tenant-detail"),
    path("platform/tenants/<uuid:tenant_id>/suspend/", views.TenantSuspendView.as_view(), name="platform-tenant-suspend"),
    path("platform/plans/", views.SubscriptionPlanListCreateView.as_view(), name="platform-plans"),
    path("platform/plans/<uuid:plan_id>/", views.SubscriptionPlanDetailView.as_view(), name="platform-plan-detail"),
    path("webhooks/razorpay-subscription/", views.RazorpaySubscriptionWebhookView.as_view(), name="razorpay-subscription-webhook"),
]
