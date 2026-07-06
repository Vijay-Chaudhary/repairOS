"""
Management command: seed_demo

Thin runner over the core.seeding registry: provisions the demo tenant, then
executes every registered seeder (reference tier first, then demo, in
dependency order) with SeedRun resume tracking.

Safety guards:
  - Refuses when DEBUG is False
  - Refuses when DB host is not localhost/127.0.0.1/pgbouncer

Usage:
    python manage.py seed_demo [--force] [--only NAME] [--reset] [--if-empty]
"""

import random
from datetime import date
from decimal import Decimal

from django.conf import settings
from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError

from core.seeding import SeedContext, autodiscover, ordered, run_seeders
from core.seeds import DEMO_PASSWORD

DEMO_SLUG = "demo"
DEMO_TENANT_NAME = "Shree Electronics"
FIXED_SEED = 42


class Command(BaseCommand):
    help = "Seed demo data for all roles and modules (local dev only)."

    def add_arguments(self, parser):
        parser.add_argument("--force", action="store_true",
                            help="Re-run all seeders (upsert-safe).")
        parser.add_argument("--only", default=None, metavar="NAME",
                            help="Run a single seeder by name.")
        parser.add_argument("--reset", action="store_true",
                            help="Drop + reprovision the demo tenant DB, then seed fresh.")
        parser.add_argument("--if-empty", action="store_true", dest="if_empty",
                            help="Exit immediately when every seeder is recorded (entrypoint fast path).")

    # ── public entry point ────────────────────────────────────────────────────

    def handle(self, *args, **options):
        self._guard()
        random.seed(FIXED_SEED)

        if options["reset"]:
            self._reset_demo_tenant()

        alias = self._provision_tenant()

        from core.context import clear_tenant_context, set_tenant_db_alias
        set_tenant_db_alias(alias)
        try:
            autodiscover()
            seeders = ordered()          # reference tier first, then demo (deps)
            if options["only"]:
                seeders = [s for s in seeders if s.name == options["only"]]
                if not seeders:
                    raise CommandError(f"Unknown seeder: {options['only']}")

            from core.models import SeedRun
            if options["if_empty"]:
                done = set(SeedRun.objects.values_list("seeder_name", flat=True))
                if {s.name for s in seeders} <= done:
                    self.stdout.write("Demo tenant already seeded — nothing to do.")
                    return

            from core.models import Shop
            ctx = SeedContext(shops=list(Shop.objects.all()))
            result = run_seeders(
                seeders, ctx, force=options["force"], log=self.stdout.write
            )
            self._print_summary(alias)
            if result.failed:
                raise SystemExit(f"{len(result.failed)} seeder(s) failed: {result.failed}")
        finally:
            clear_tenant_context()

    # ── guard ─────────────────────────────────────────────────────────────────

    def _guard(self):
        if not settings.DEBUG:
            raise CommandError("seed_demo refuses to run when DEBUG=False.")

        db_host = settings.DATABASES["default"].get("HOST", "localhost")
        allowed = {"localhost", "127.0.0.1", "pgbouncer", "postgres", "db"}
        if db_host not in allowed:
            raise CommandError(
                f"seed_demo refuses to run against host '{db_host}'. "
                "Only local DB hosts are permitted."
            )

    # ── tenant provisioning ───────────────────────────────────────────────────

    def _provision_tenant(self) -> str:
        from master.models import Tenant, TenantDatabase
        from django.db import connections

        alias = f"tenant_{DEMO_SLUG}"

        try:
            tenant = Tenant.objects.using("default").get(slug=DEMO_SLUG)
            td = TenantDatabase.objects.using("default").get(tenant=tenant)
            db_password = td.decrypt_password()
            connections.databases[alias] = {
                "ENGINE": "django.db.backends.postgresql",
                "NAME": td.db_name,
                "HOST": td.db_host,
                "PORT": str(td.db_port),
                "USER": td.db_user,
                "PASSWORD": db_password,
                "CONN_MAX_AGE": 0,
                "CONN_HEALTH_CHECKS": False,
                "OPTIONS": {},
                "TIME_ZONE": None,
                "ATOMIC_REQUESTS": False,
                "AUTOCOMMIT": True,
                "TEST": {},
            }
            self.stdout.write(f"  ✓ Demo tenant '{DEMO_SLUG}' already provisioned — reusing.")
        except Tenant.DoesNotExist:
            self.stdout.write("  Provisioning demo tenant (this takes ~5 s)…")
            call_command(
                "create_tenant",
                slug=DEMO_SLUG,
                name=DEMO_TENANT_NAME,
                email="admin@demo.com",
                phone="+919876543210",
                admin_password=DEMO_PASSWORD,
                verbosity=0,
            )
            self.stdout.write(f"  ✓ Demo tenant '{DEMO_SLUG}' provisioned.")

        # Ensure a subscription plan exists and the demo tenant is linked to it
        self._seed_subscription(alias)

        return alias

    def _seed_subscription(self, alias):
        from master.models import SubscriptionPlan, Tenant, TenantSubscription

        plan, _ = SubscriptionPlan.objects.using("default").get_or_create(
            name="Professional",
            defaults={
                "max_shops": 10,
                "max_users": 50,
                "price_monthly_inr": Decimal("2999.00"),
                "features": {
                    "crm": True, "repair": True, "pos": True, "erp": True,
                    "amc": True, "billing": True, "hr": True, "reports": True,
                },
            },
        )
        tenant = Tenant.objects.using("default").get(slug=DEMO_SLUG)
        today = date.today()
        TenantSubscription.objects.using("default").update_or_create(
            tenant=tenant,
            defaults={
                "plan": plan,
                "status": TenantSubscription.Status.ACTIVE,
                "current_period_start": today.replace(day=1),
                "current_period_end": today.replace(month=today.month % 12 + 1, day=1) if today.month < 12
                    else today.replace(year=today.year + 1, month=1, day=1),
            },
        )

    # ── reset ─────────────────────────────────────────────────────────────────

    def _reset_demo_tenant(self):
        """DEBUG-only (guarded): drop the demo tenant DB + master rows so
        _provision_tenant recreates everything from scratch."""
        from django.db import connections

        from master import services
        from master.models import Tenant

        tenant = Tenant.objects.using("default").filter(slug=DEMO_SLUG).first()
        if tenant is None:
            return
        alias = f"tenant_{DEMO_SLUG}"
        if alias in connections.databases:
            connections[alias].close()
            del connections.databases[alias]
        tenant_db = tenant.database  # TenantDatabase reverse one-to-one
        services._drop_pg_resources(tenant_db.db_name, tenant_db.db_user)
        tenant_db.delete(using="default")
        tenant.delete(using="default")
        self.stdout.write(f"  ✓ Demo tenant '{DEMO_SLUG}' dropped.")

    # ── summary ───────────────────────────────────────────────────────────────

    def _print_summary(self, alias):
        SEP = "━" * 58
        logins = [
            ("Tenant Admin",   "admin@demo.com"),
            ("Shop Manager",   "manager@demo.com"),
            ("Receptionist",   "reception@demo.com"),
            ("Technician 1",   "tech1@demo.com"),
            ("Technician 2",   "tech2@demo.com"),
            ("Billing Staff",  "billing@demo.com"),
            ("HR Manager",     "hr@demo.com"),
            ("Viewer",         "viewer@demo.com"),
        ]
        self.stdout.write("\n" + self.style.SUCCESS(SEP))
        self.stdout.write(self.style.SUCCESS(" RepairOS DEMO TENANT"))
        self.stdout.write(self.style.SUCCESS(SEP))
        self.stdout.write(f"  Slug : {DEMO_SLUG}")
        self.stdout.write(f"  API  : http://localhost:8000  (X-Tenant-Slug: {DEMO_SLUG})")
        self.stdout.write(f"  App  : http://localhost:3000\n")
        self.stdout.write(f"  All passwords : {DEMO_PASSWORD}\n")
        self.stdout.write(f"  {'Role':<18} {'Email'}")
        self.stdout.write(f"  {'-'*18} {'-'*32}")
        for role, email in logins:
            self.stdout.write(f"  {role:<18} {email}")
        self.stdout.write(self.style.SUCCESS(SEP + "\n"))
