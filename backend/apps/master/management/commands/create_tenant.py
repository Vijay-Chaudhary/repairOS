"""
Management command to provision a new tenant.

Usage (local dev):
    python manage.py create_tenant --slug joycomputer --name "Joy Computer" \
        --email admin@joy.com --phone "+919876543210" --admin-password secret123

The command delegates to master.services for the actual provisioning logic so that
the Celery task and the management command stay in sync automatically.
"""

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from master import services


class Command(BaseCommand):
    help = "Provision a new tenant database and seed initial data."

    def add_arguments(self, parser):
        parser.add_argument("--slug", required=True, help="Unique tenant slug (a-z, 0-9, _)")
        parser.add_argument("--name", required=True, help="Display name")
        parser.add_argument("--email", required=True, help="Owner email")
        parser.add_argument("--phone", required=True, help="Owner phone (+91XXXXXXXXXX)")
        parser.add_argument("--admin-password", default=None, help="Initial admin password (random if omitted)")
        parser.add_argument("--plan", default="starter", choices=["starter", "professional", "enterprise"])

    def handle(self, *args, **options):
        from master.models import SubscriptionPlan, Tenant, TenantDatabase

        slug = options["slug"].lower()
        name = options["name"]
        email = options["email"]
        phone = options["phone"]
        plan_slug = options["plan"]
        admin_password = options["admin_password"] or services._random_password()

        if Tenant.objects.using("default").filter(slug=slug).exists():
            raise CommandError(f"Tenant '{slug}' already exists.")

        try:
            plan = SubscriptionPlan.objects.using("default").get(name__iexact=plan_slug)
        except SubscriptionPlan.DoesNotExist:
            raise CommandError(f"Plan '{plan_slug}' not found. Create it via the platform admin first.")

        self.stdout.write(f"Provisioning tenant: {slug} ...")

        # Create master records
        with transaction.atomic(using="default"):
            tenant = Tenant.objects.using("default").create(
                name=name, slug=slug,
                status=Tenant.Status.PROVISIONING,
                plan=plan_slug,
                owner_email=email, owner_phone=phone,
            )

            db_password = services._random_password(32)
            master_cfg = settings.DATABASES["default"]
            tenant_host = getattr(settings, "TENANT_DB_HOST", None) or master_cfg["HOST"]
            tenant_db = TenantDatabase(
                tenant=tenant,
                db_name=tenant.db_name,
                db_host=tenant_host,
                db_port=int(master_cfg.get("PORT") or 5432),
                db_user=tenant.db_user,
            )
            tenant_db.encrypt_password(db_password)
            tenant_db.save(using="default")

        services._create_pg_resources(tenant_db.db_name, tenant_db.db_user, db_password)
        self.stdout.write(f"  ✓ PostgreSQL database '{tenant_db.db_name}' created.")

        from django.core.management import call_command
        from django.db import connections

        alias = f"tenant_{slug}"
        connections.databases[alias] = {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": tenant_db.db_name,
            "HOST": tenant_db.db_host,
            "PORT": str(tenant_db.db_port),
            "USER": tenant_db.db_user,
            "PASSWORD": db_password,
            "CONN_MAX_AGE": 0,
            "CONN_HEALTH_CHECKS": False,
            "OPTIONS": {},
            "TIME_ZONE": None,
            "ATOMIC_REQUESTS": False,
            "AUTOCOMMIT": True,
            "TEST": {},
        }
        call_command("migrate", database=alias, verbosity=1)
        self.stdout.write(f"  ✓ Migrations applied.")

        from core.context import clear_tenant_context, set_tenant_db_alias

        set_tenant_db_alias(alias)
        services._seed_roles_and_permissions()
        self.stdout.write("  ✓ System roles and permissions seeded.")

        from core.seeding import run_reference_tier
        run_reference_tier(log=self.stdout.write)
        self.stdout.write("  ✓ Reference data seeded (GST rates, chart of accounts).")

        services._create_admin_user(name=name, email=email, phone=phone, password=admin_password)
        self.stdout.write(f"  ✓ Tenant Admin created — email: {email}")

        clear_tenant_context()
        # Wrap the activation in an explicit atomic block so the status flip is
        # COMMITTED even though _create_pg_resources left the master connection's
        # autocommit desynced. Mirrors services._provision_tenant (the Celery
        # path); without this the tenant is stranded in PROVISIONING.
        with transaction.atomic(using="default"):
            tenant.status = Tenant.Status.ACTIVE
            tenant.save(using="default", update_fields=["status", "updated_at"])

        self.stdout.write(self.style.SUCCESS(
            f"\nTenant '{slug}' is ready.\n"
            f"  Admin email:    {email}\n"
            f"  Admin password: {admin_password}\n"
        ))
