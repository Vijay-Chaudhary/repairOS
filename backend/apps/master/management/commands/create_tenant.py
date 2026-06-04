"""
Management command to provision a new tenant.

Usage (local dev):
    python manage.py create_tenant --slug joycomputer --name "Joy Computer" \
        --email admin@joy.com --phone "+919876543210" --admin-password secret123

The command:
  1. Creates Tenant + TenantDatabase records in the master DB.
  2. Creates the PostgreSQL database and user (using the master DB superuser connection).
  3. Runs all tenant-app migrations against the new DB.
  4. Seeds system roles + permissions.
  5. Creates the initial Tenant Admin user.
"""

import secrets
import string

from django.conf import settings
from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError
from django.db import connections, transaction


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
        from master.models import Tenant, TenantDatabase

        slug = options["slug"].lower()
        name = options["name"]
        email = options["email"]
        phone = options["phone"]
        plan = options["plan"]
        admin_password = options["admin_password"] or self._random_password()

        if Tenant.objects.using("default").filter(slug=slug).exists():
            raise CommandError(f"Tenant '{slug}' already exists.")

        self.stdout.write(f"Provisioning tenant: {slug} ...")

        # 1. Create master records
        with transaction.atomic(using="default"):
            tenant = Tenant.objects.using("default").create(
                name=name,
                slug=slug,
                status=Tenant.Status.PROVISIONING,
                plan=plan,
                owner_email=email,
                owner_phone=phone,
            )

            db_password = self._random_password(32)
            db_name = tenant.db_name
            db_user = tenant.db_user

            # Tenant connections route through PgBouncer, not postgres directly.
            # TENANT_DB_HOST (e.g. "pgbouncer") is set in settings; falls back to
            # the master DB host so the command still works without PgBouncer.
            master_cfg = settings.DATABASES["default"]
            tenant_host = getattr(settings, "TENANT_DB_HOST", None) or master_cfg["HOST"]
            tenant_db = TenantDatabase(
                tenant=tenant,
                db_name=db_name,
                db_host=tenant_host,
                db_port=int(master_cfg.get("PORT", 5432)),
                db_user=db_user,
            )
            tenant_db.encrypt_password(db_password)
            tenant_db.save(using="default")

        # 2. Create PG database and user via master connection
        self._create_pg_resources(slug, db_name, db_user, db_password)
        self.stdout.write(f"  ✓ PostgreSQL database '{db_name}' and user '{db_user}' created.")

        # 3. Run migrations on the new tenant DB
        alias = f"tenant_{slug}"
        connections.databases[alias] = {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": db_name,
            "HOST": tenant_db.db_host,
            "PORT": str(tenant_db.db_port),
            "USER": db_user,
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
        self.stdout.write(f"  ✓ Migrations applied to '{db_name}'.")

        # 4. Seed roles + permissions in tenant DB
        from core.context import set_tenant_db_alias
        set_tenant_db_alias(alias)
        self._seed_roles_and_permissions()
        self.stdout.write("  ✓ System roles and permissions seeded.")

        # 5. Create initial Tenant Admin
        self._create_admin_user(name=name, email=email, phone=phone, password=admin_password)
        self.stdout.write(f"  ✓ Tenant Admin created — email: {email}")

        # 6. Activate tenant
        tenant.status = Tenant.Status.ACTIVE
        tenant.save(using="default", update_fields=["status"])

        self.stdout.write(self.style.SUCCESS(
            f"\nTenant '{slug}' is ready.\n"
            f"  Admin email:    {email}\n"
            f"  Admin password: {admin_password}\n"
        ))

    def _create_pg_resources(self, slug: str, db_name: str, db_user: str, db_password: str):
        from django.db import connection

        with connection.cursor() as cursor:
            # autocommit required for CREATE DATABASE
            connection.connection.autocommit = True
            cursor.execute(f"SELECT 1 FROM pg_database WHERE datname = %s", [db_name])
            if not cursor.fetchone():
                cursor.execute(
                    f'CREATE DATABASE "{db_name}" ENCODING \'UTF8\' LC_COLLATE \'en_US.utf8\' LC_CTYPE \'en_US.utf8\' TEMPLATE template0'
                )

            cursor.execute("SELECT 1 FROM pg_roles WHERE rolname = %s", [db_user])
            if not cursor.fetchone():
                cursor.execute(f"CREATE USER \"{db_user}\" WITH PASSWORD %s", [db_password])

            cursor.execute(f'GRANT ALL PRIVILEGES ON DATABASE "{db_name}" TO "{db_user}"')
            cursor.execute(f'REVOKE ALL ON DATABASE "{db_name}" FROM PUBLIC')
            connection.connection.autocommit = False

    def _seed_roles_and_permissions(self):
        from authentication.models import Permission, Role

        system_roles = [
            ("Tenant Admin", True),
            ("Shop Manager", True),
            ("Receptionist", True),
            ("Technician", True),
            ("Billing Staff", True),
            ("HR Manager", True),
            ("Viewer", True),
        ]
        for role_name, is_system in system_roles:
            Role.objects.get_or_create(name=role_name, defaults={"is_system_role": is_system})

        permissions_catalogue = [
            # crm
            ("crm.leads.view", "crm"), ("crm.leads.create", "crm"), ("crm.leads.edit", "crm"),
            ("crm.leads.convert", "crm"), ("crm.customers.view", "crm"), ("crm.customers.create", "crm"),
            ("crm.customers.edit", "crm"), ("crm.customers.merge", "crm"),
            ("crm.communications.log", "crm"), ("crm.tasks.manage", "crm"), ("crm.segments.manage", "crm"),
            # repair
            ("repair.jobs.view", "repair"), ("repair.jobs.create", "repair"), ("repair.jobs.edit", "repair"),
            ("repair.jobs.change_status", "repair"), ("repair.jobs.assign_tech", "repair"),
            ("repair.estimates.send", "repair"), ("repair.estimates.approve", "repair"),
            ("repair.templates.manage", "repair"), ("repair.warranty.view", "repair"),
            ("repair.spare_parts.request", "repair"), ("repair.spare_parts.approve", "repair"),
            # pos
            ("pos.counter_sale.create", "pos"), ("pos.wholesale_sale.create", "pos"),
            ("pos.job_sale.create", "pos"), ("pos.discount.apply", "pos"),
            ("pos.returns.create", "pos"), ("pos.returns.approve", "pos"),
            # erp
            ("erp.inventory.view", "erp"), ("erp.inventory.adjust", "erp"),
            ("erp.suppliers.manage", "erp"), ("erp.purchase_orders.create", "erp"),
            ("erp.grn.receive", "erp"), ("erp.purchase_invoices.record", "erp"),
            ("erp.purchase_returns.create", "erp"), ("erp.expenses.view", "erp"),
            ("erp.expenses.create", "erp"), ("erp.budget.manage", "erp"), ("erp.assets.manage", "erp"),
            # amc
            ("amc.contracts.view", "amc"), ("amc.contracts.create", "amc"),
            ("amc.contracts.edit", "amc"), ("amc.visits.schedule", "amc"),
            ("amc.visits.complete", "amc"), ("amc.renewals.manage", "amc"),
            # hr
            ("hr.employees.view", "hr"), ("hr.employees.manage", "hr"),
            ("hr.attendance.view", "hr"), ("hr.attendance.mark", "hr"),
            ("hr.leaves.manage", "hr"), ("hr.salary.view", "hr"),
            ("hr.salary.generate", "hr"), ("hr.petty_cash.manage", "hr"),
            # billing
            ("billing.repair_invoices.view", "billing"), ("billing.repair_invoices.create", "billing"),
            ("billing.sales_invoices.view", "billing"), ("billing.payments.record", "billing"),
            ("billing.outstanding.view", "billing"), ("billing.tally_export", "billing"),
            # reports
            ("reports.revenue.view", "reports"), ("reports.hr.view", "reports"),
            ("reports.crm.view", "reports"), ("reports.repair.view", "reports"),
            ("reports.inventory.view", "reports"), ("reports.gst.view", "reports"),
            ("reports.pl.view", "reports"),
            # settings
            ("settings.shop.edit", "settings"), ("settings.roles.manage", "settings"),
            ("settings.users.manage", "settings"), ("settings.commission_rules.manage", "settings"),
            ("settings.notifications.manage", "settings"),
        ]
        for codename, module in permissions_catalogue:
            Permission.objects.get_or_create(
                codename=codename,
                defaults={"module": module, "label": codename.replace(".", " ").title()},
            )

    def _create_admin_user(self, name: str, email: str, phone: str, password: str):
        from authentication.models import Role, User, UserRole

        user = User.objects.create_user(
            email=email,
            phone=phone,
            full_name=name,
            password=password,
        )
        admin_role = Role.objects.get(name="Tenant Admin")
        UserRole.objects.create(user=user, role=admin_role, shop=None)

    @staticmethod
    def _random_password(length: int = 16) -> str:
        alphabet = string.ascii_letters + string.digits + "!@#$%^&*()"
        return "".join(secrets.choice(alphabet) for _ in range(length))
