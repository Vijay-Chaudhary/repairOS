from django.urls import path

from . import auth_views, views

urlpatterns = [
    path("platform/auth/login/", auth_views.PlatformAdminLoginView.as_view(), name="platform-admin-login"),
    path("register/", views.RegisterView.as_view(), name="register"),
    path("register/verify/", views.RegisterVerifyView.as_view(), name="register-verify"),
    path("register/status/", views.RegistrationStatusView.as_view(), name="register-status"),
    path("platform/tenants/", views.TenantListView.as_view(), name="platform-tenants"),
    path("platform/tenants/<uuid:tenant_id>/", views.TenantDetailView.as_view(), name="platform-tenant-detail"),
    path("platform/tenants/<uuid:tenant_id>/suspend/", views.TenantSuspendView.as_view(), name="platform-tenant-suspend"),
    path("platform/tenants/<uuid:tenant_id>/reactivate/", views.TenantReactivateView.as_view(), name="platform-tenant-reactivate"),
    path("platform/plans/", views.SubscriptionPlanListCreateView.as_view(), name="platform-plans"),
    path("platform/plans/<uuid:plan_id>/", views.SubscriptionPlanDetailView.as_view(), name="platform-plan-detail"),
    path("webhooks/razorpay-subscription/", views.RazorpaySubscriptionWebhookView.as_view(), name="razorpay-subscription-webhook"),
]
