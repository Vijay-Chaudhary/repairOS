from django.conf import settings
from django.urls import include, path


urlpatterns = [
    path("api/v1/", include("master.urls")),
    path("api/v1/auth/", include("authentication.urls")),
    # Settings — users, roles, permissions
    path("api/v1/", include("authentication.settings_urls")),
    # Settings — tenant branding, WhatsApp, notification templates
    path("api/v1/", include("core.settings_urls")),
    # Shops (list + detail)
    path("api/v1/shops/", include("core.shop_urls")),
    path("api/v1/crm/", include("crm.urls")),
    path("api/v1/repair/", include("repair.urls")),
    path("api/v1/pos/", include("pos.urls")),
    path("api/v1/amc/", include("amc.urls")),
    path("api/v1/inventory/", include("inventory.urls")),
    path("api/v1/procurement/", include("procurement.urls")),
    path("api/v1/billing/", include("billing.urls")),
    path("api/v1/commissions/", include("commissions.urls")),
    path("api/v1/hr/", include("hr.urls")),
    path("api/v1/finance/", include("finance.urls")),
    path("api/v1/accounts/", include("accounts.urls")),
    path("api/v1/reports/", include("reports.urls")),
    path("api/v1/notifications/", include("core.notification_urls")),
    path("api/v1/search/", include("core.search_urls")),
    path("api/v1/health/", include("core.urls")),
]

if settings.DEBUG and "debug_toolbar" in settings.INSTALLED_APPS:
    import debug_toolbar

    urlpatterns = [path("__debug__/", include(debug_toolbar.urls))] + urlpatterns
