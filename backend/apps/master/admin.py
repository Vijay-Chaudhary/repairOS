from django.contrib import admin

from .models import Tenant, TenantDatabase


@admin.register(Tenant)
class TenantAdmin(admin.ModelAdmin):
    list_display = ("name", "slug", "status", "plan", "owner_email", "created_at")
    list_filter = ("status", "plan")
    search_fields = ("name", "slug", "owner_email")
    readonly_fields = ("id", "created_at", "updated_at")


@admin.register(TenantDatabase)
class TenantDatabaseAdmin(admin.ModelAdmin):
    list_display = ("db_name", "db_host", "db_port", "is_active", "created_at")
    list_filter = ("is_active",)
    readonly_fields = ("id", "created_at", "db_password_encrypted")
