from django.urls import path

from .settings_views import (
    NotificationTemplateDetailView,
    NotificationTemplateListView,
    TenantSettingsView,
    WhatsAppConnectView,
    WhatsAppConnectionView,
    WhatsAppDisconnectView,
)

urlpatterns = [
    # Tenant branding
    path("tenants/me/", TenantSettingsView.as_view(), name="settings-tenant-me"),

    # WhatsApp
    path("whatsapp/connection/",  WhatsAppConnectionView.as_view(), name="settings-whatsapp-connection"),
    path("whatsapp/connect/",     WhatsAppConnectView.as_view(),    name="settings-whatsapp-connect"),
    path("whatsapp/disconnect/",  WhatsAppDisconnectView.as_view(), name="settings-whatsapp-disconnect"),

    # Notification templates
    path("notifications/templates/",             NotificationTemplateListView.as_view(),   name="settings-notif-list"),
    path("notifications/templates/<str:template_id>/", NotificationTemplateDetailView.as_view(), name="settings-notif-detail"),
]
