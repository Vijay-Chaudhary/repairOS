"""
Backfill default role permissions for all active tenant DBs.

Run after the _seed_roles_and_permissions() update to populate
existing tenants provisioned without per-role permission defaults.

Usage:
    docker compose exec backend python manage.py backfill_role_permissions
    docker compose exec backend python manage.py backfill_role_permissions --slug demo
"""

from django.core.management.base import BaseCommand


class Command(BaseCommand):
    help = "Idempotent: seed spec-aligned role permissions into every active tenant DB."

    def add_arguments(self, parser):
        parser.add_argument("--slug", help="Limit backfill to a single tenant slug.")

    def handle(self, *args, **options):
        from django.db import connections

        from core.context import set_tenant_db_alias
        from master.models import TenantDatabase
        from master.services import _seed_roles_and_permissions

        slug_filter = options.get("slug")
        qs = TenantDatabase.objects.using("default").filter(is_active=True)
        if slug_filter:
            qs = qs.filter(tenant__slug=slug_filter)

        tenant_dbs = list(qs.select_related("tenant"))
        if not tenant_dbs:
            self.stdout.write(self.style.WARNING("No matching active tenant DBs found."))
            return

        for tdb in tenant_dbs:
            slug = tdb.tenant.slug
            alias = f"tenant_{slug}"
            self.stdout.write(f"  Backfilling {slug} ({alias}) …")
            try:
                if alias not in connections.databases:
                    connections.databases[alias] = {
                        "ENGINE": "django.db.backends.postgresql",
                        "NAME": tdb.db_name,
                        "HOST": tdb.db_host,
                        "PORT": str(tdb.db_port),
                        "USER": tdb.db_user,
                        "PASSWORD": tdb.decrypt_password(),
                        "CONN_MAX_AGE": 0,
                        "CONN_HEALTH_CHECKS": False,
                        "OPTIONS": {},
                        "TIME_ZONE": None,
                        "ATOMIC_REQUESTS": False,
                        "AUTOCOMMIT": True,
                        "TEST": {},
                    }

                set_tenant_db_alias(alias)
                _seed_roles_and_permissions()
                set_tenant_db_alias(None)
                self.stdout.write(self.style.SUCCESS(f"    ✓ {slug}"))
            except Exception as exc:
                set_tenant_db_alias(None)
                self.stdout.write(self.style.ERROR(f"    ✗ {slug}: {exc}"))

        self.stdout.write(self.style.SUCCESS("Backfill complete."))
