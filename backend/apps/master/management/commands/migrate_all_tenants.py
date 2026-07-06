"""
Applies pending migrations to every active tenant database in parallel.

Usage:
    python manage.py migrate_all_tenants [--workers 10]

Runs during deployment after master DB migrations. Tolerates partial failure:
logs per-tenant errors and exits non-zero if >5% fail (matches CI pipeline gate).
"""

import logging
from concurrent.futures import ThreadPoolExecutor, as_completed

from django.core.management import call_command
from django.core.management.base import BaseCommand
from django.db import connections

logger = logging.getLogger(__name__)


class Command(BaseCommand):
    help = "Apply migrations to all active tenant databases in parallel."

    def add_arguments(self, parser):
        parser.add_argument("--workers", type=int, default=10, help="Parallel worker count (default 10)")

    def handle(self, *args, **options):
        from master.models import Tenant, TenantDatabase

        tenants = list(
            TenantDatabase.objects.using("default")
            .select_related("tenant")
            .filter(tenant__status=Tenant.Status.ACTIVE, is_active=True)
        )

        if not tenants:
            self.stdout.write("No active tenants found.")
            return

        self.stdout.write(f"Migrating {len(tenants)} tenant(s) with {options['workers']} workers...")

        results = {"ok": [], "failed": []}

        with ThreadPoolExecutor(max_workers=options["workers"]) as executor:
            futures = {executor.submit(self._migrate_one, t): t for t in tenants}
            for future in as_completed(futures):
                tenant_db = futures[future]
                slug = tenant_db.tenant.slug
                try:
                    future.result()
                    results["ok"].append(slug)
                    self.stdout.write(f"  ✓ {slug}")
                except Exception as exc:
                    results["failed"].append(slug)
                    logger.error("Migration failed for tenant %s: %s", slug, exc)
                    self.stderr.write(f"  ✗ {slug}: {exc}")

        total = len(tenants)
        fail_count = len(results["failed"])
        self.stdout.write(f"\nDone — {total - fail_count}/{total} succeeded.")

        if fail_count / total > 0.05:
            raise SystemExit(f">{fail_count}/{total} migrations failed — CI gate triggered.")

    def _migrate_one(self, tenant_db) -> None:
        from core.context import clear_tenant_context, set_tenant_db_alias
        from master.services import ensure_tenant_alias

        alias = ensure_tenant_alias(tenant_db)
        # Data migrations may query through the router; pin the context so any
        # unpinned query lands on this tenant DB instead of master.
        set_tenant_db_alias(alias)
        try:
            call_command("migrate", database=alias, verbosity=0)
        finally:
            clear_tenant_context()
