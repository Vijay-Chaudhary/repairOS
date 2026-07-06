"""
Drift doctor: report unapplied migrations for every active tenant database.

Usage:
    python manage.py check_tenant_migrations [--fail-on-drift]

Read-only — never applies anything. --fail-on-drift exits non-zero when any
tenant is behind, so it can gate deploys.
"""

from django.core.management.base import BaseCommand
from django.db import connections
from django.db.migrations.executor import MigrationExecutor

from master.services import ensure_tenant_alias


class Command(BaseCommand):
    help = "Report unapplied migrations per active tenant DB (read-only)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--fail-on-drift", action="store_true",
            help="Exit non-zero if any tenant has unapplied migrations.",
        )

    def handle(self, *args, **options):
        from master.models import Tenant, TenantDatabase

        tenant_dbs = list(
            TenantDatabase.objects.using("default")
            .select_related("tenant")
            .filter(tenant__status=Tenant.Status.ACTIVE, is_active=True)
        )
        if not tenant_dbs:
            self.stdout.write("No active tenants found.")
            return

        drifted = 0
        for td in tenant_dbs:
            slug = td.tenant.slug
            try:
                alias = ensure_tenant_alias(td)
                executor = MigrationExecutor(connections[alias])
                plan = executor.migration_plan(executor.loader.graph.leaf_nodes())
                pending = [f"{m.app_label}.{m.name}" for m, _ in plan]
            except Exception as exc:  # unreachable DB is drift too — surface it
                drifted += 1
                self.stderr.write(f"  ✗ {slug}: unreachable ({exc})")
                continue
            if pending:
                drifted += 1
                self.stdout.write(
                    f"  ✗ {slug}: behind by {len(pending)} — {', '.join(pending[:5])}"
                    + (" …" if len(pending) > 5 else "")
                )
            else:
                self.stdout.write(f"  ✓ {slug}: up to date")

        self.stdout.write(f"\n{drifted}/{len(tenant_dbs)} tenant(s) drifted.")
        if drifted and options["fail_on_drift"]:
            raise SystemExit(1)
