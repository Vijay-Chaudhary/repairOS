from .context import get_tenant_db_alias

MASTER_APP_LABELS = frozenset({"master"})
MASTER_ALIAS = "default"


class TenantDatabaseRouter:
    """
    Routes ORM queries to the correct database:

    - `master` app models → 'default' (master DB) always.
    - All other models → the current tenant DB alias from context.
      Falls back to 'default' when no tenant context is set (management commands,
      health checks) — this is safe because management commands either set the
      context explicitly or only touch master-app models.
    """

    def db_for_read(self, model, **hints):
        if model._meta.app_label in MASTER_APP_LABELS:
            return MASTER_ALIAS
        return get_tenant_db_alias() or MASTER_ALIAS

    def db_for_write(self, model, **hints):
        if model._meta.app_label in MASTER_APP_LABELS:
            return MASTER_ALIAS
        return get_tenant_db_alias() or MASTER_ALIAS

    def allow_relation(self, obj1, obj2, **hints):
        db1 = MASTER_ALIAS if obj1._meta.app_label in MASTER_APP_LABELS else "tenant"
        db2 = MASTER_ALIAS if obj2._meta.app_label in MASTER_APP_LABELS else "tenant"
        if db1 == db2:
            return True
        return None  # let Django decide (will block cross-DB joins)

    def allow_migrate(self, db, app_label, model_name=None, **hints):
        if db == MASTER_ALIAS:
            # Only master app migrations go to the master DB
            return app_label in MASTER_APP_LABELS
        # Every other alias is a tenant DB — migrate all non-master apps
        return app_label not in MASTER_APP_LABELS
