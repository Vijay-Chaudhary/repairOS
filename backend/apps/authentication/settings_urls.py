from django.urls import path

from .settings_views import (
    ForceLogoutView,
    PermissionListView,
    RoleDetailView,
    RoleListCreateView,
    UserDetailView,
    UserListCreateView,
)

urlpatterns = [
    # Users
    path("users/",                     UserListCreateView.as_view(), name="settings-users-list"),
    path("users/<uuid:user_id>/",      UserDetailView.as_view(),     name="settings-users-detail"),
    path("users/<uuid:user_id>/force-logout/", ForceLogoutView.as_view(), name="settings-users-force-logout"),

    # Roles
    path("roles/",                     RoleListCreateView.as_view(), name="settings-roles-list"),
    path("roles/<uuid:role_id>/",      RoleDetailView.as_view(),     name="settings-roles-detail"),

    # Permissions
    path("permissions/",               PermissionListView.as_view(), name="settings-permissions-list"),
]
