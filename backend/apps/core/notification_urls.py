from django.urls import path

from . import notification_views as views

urlpatterns = [
    path("", views.NotificationListView.as_view(), name="notifications"),
    path("unread-count/", views.UnreadCountView.as_view(), name="notifications-unread-count"),
    path("read-all/", views.MarkAllReadView.as_view(), name="notifications-read-all"),
    path("<uuid:notification_id>/read/", views.MarkReadView.as_view(), name="notification-read"),
]
