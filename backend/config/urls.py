from django.conf import settings
from django.urls import include, path


urlpatterns = [
    path("api/v1/", include("master.urls")),
    path("api/v1/auth/", include("authentication.urls")),
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
    path("api/v1/reports/", include("reports.urls")),
    path("api/v1/health/", include("core.urls")),
]

if settings.DEBUG:
    import debug_toolbar

    urlpatterns = [path("__debug__/", include(debug_toolbar.urls))] + urlpatterns
