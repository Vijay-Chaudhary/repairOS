"""
Platform Admin business logic.

All operations target the master ('default') database.
Provisioning is triggered asynchronously; API returns status=provisioning immediately.
"""

import hashlib
import hmac
import json
import logging
import secrets
import string

from django.conf import settings
from django.utils import timezone

from .models import AuditLogMaster, Tenant, TenantDatabase, TenantSubscription

logger = logging.getLogger(__name__)


# ──────────────────────────────────────────────────────────────────────────────
# Registration / provisioning
# ──────────────────────────────────────────────────────────────────────────────


class SmsNotConfiguredError(Exception):
    pass


class RegistrationNotFoundError(Exception):
    pass


class OtpInvalidError(Exception):
    pass


class EmailCodeInvalidError(Exception):
    pass


class OtpMaxAttemptsError(Exception):
    pass


def _send_registration_otp(phone: str, otp: str) -> bool:
    """Send phone OTP via SMS. Returns True on success (always True in DEBUG)."""
    if getattr(settings, "DEBUG", False):
        logger.info("[DEV] Registration OTP for %s: %s", phone, otp)
        return True
    # Production: wire MSG91 / SMS gateway here
    logger.warning("SMS gateway not configured — cannot send registration OTP to %s", phone)
    return False


def _send_registration_email_code(email: str, name: str, code: str) -> None:
    """Send email verification code. Logs in DEBUG; uses Django email backend in production."""
    from django.core.mail import send_mail
    if getattr(settings, "DEBUG", False):
        logger.info("[DEV] Registration email code for %s: %s", email, code)
        return
    try:
        send_mail(
            subject="Your RepairOS verification code",
            message=(
                f"Hi {name},\n\n"
                f"Your email verification code is: {code}\n\n"
                "This code expires in 10 minutes."
            ),
            from_email=getattr(settings, "DEFAULT_FROM_EMAIL", "noreply@repaiross.app"),
            recipient_list=[email],
            fail_silently=False,
        )
    except Exception as exc:
        logger.error("Failed to send registration email code to %s: %s", email, exc)


def initiate_registration(data: dict) -> dict:
    """
    Step 1 of 2-step registration: validate slug/plan, store pending data in Redis,
    and send phone OTP + email verification code.

    Returns {slug, phone_masked, expires_in} (plus dev_* codes when DEBUG=True).
    Does NOT create the Tenant — that happens in verify_registration().

    Raises ValueError on slug collision or missing plan.
    Raises SmsNotConfiguredError if SMS gateway is not available.
    """
    import random
    import uuid as _uuid
    from django.core import signing
    from django.core.cache import cache

    from .models import SubscriptionPlan, Tenant

    slug = data["slug"].lower().strip()

    if Tenant.objects.filter(slug=slug).exists():
        raise ValueError(f"Slug '{slug}' is already taken.")

    plan_id = data.get("plan_id")
    if plan_id:
        try:
            SubscriptionPlan.objects.get(id=plan_id)
        except SubscriptionPlan.DoesNotExist:
            raise ValueError("Plan not found.")
    else:
        default_plan = SubscriptionPlan.objects.order_by("price_monthly_inr").first()
        if not default_plan:
            raise ValueError("No subscription plans available.")
        data["plan_id"] = default_plan.id

    phone_otp = f"{random.randint(0, 999999):06d}"
    email_code = f"{random.randint(0, 999999):06d}"

    # JSON-serialize: convert UUID fields to str so signing.dumps can use json.dumps
    serializable = {k: str(v) if isinstance(v, _uuid.UUID) else v for k, v in data.items()}

    cache.set(f"reg_pending:{slug}", {
        "signed_data": signing.dumps(serializable),
        "phone_otp": phone_otp,
        "email_code": email_code,
        "otp_attempts": 0,
    }, timeout=600)

    sms_ok = _send_registration_otp(data["phone"], phone_otp)
    if not sms_ok:
        cache.delete(f"reg_pending:{slug}")
        raise SmsNotConfiguredError()

    _send_registration_email_code(data["email"], data.get("owner_name", ""), email_code)

    phone = data["phone"]
    phone_masked = phone[:3] + "****" + phone[-4:]

    result: dict = {"slug": slug, "phone_masked": phone_masked, "expires_in": 600}

    if getattr(settings, "DEBUG", False):
        result["dev_phone_otp"] = phone_otp
        result["dev_email_code"] = email_code

    return result


def verify_registration(slug: str, phone_otp: str, email_code: str) -> "Tenant":
    """
    Step 2 of 2-step registration: verify phone OTP + email code, then create the Tenant.

    Raises RegistrationNotFoundError if the pending entry is missing or expired.
    Raises OtpMaxAttemptsError after 5 failed attempts (returns 429 to the caller).
    Raises OtpInvalidError if phone_otp doesn't match.
    Raises EmailCodeInvalidError if email_code doesn't match.
    """
    from django.core import signing
    from django.core.cache import cache

    pending = cache.get(f"reg_pending:{slug}")
    if pending is None:
        raise RegistrationNotFoundError()

    if pending["otp_attempts"] >= 5:
        raise OtpMaxAttemptsError()

    if phone_otp != pending["phone_otp"]:
        pending["otp_attempts"] += 1
        # Keep the entry (don't delete) so the pre-check above fires on attempt 6+
        cache.set(f"reg_pending:{slug}", pending, timeout=600)
        raise OtpInvalidError()

    if email_code != pending["email_code"]:
        # Email failures also increment; phone is already verified so no lockout needed,
        # but we still protect against brute force on the email code.
        pending["otp_attempts"] += 1
        cache.set(f"reg_pending:{slug}", pending, timeout=600)
        raise EmailCodeInvalidError()

    try:
        form_data = signing.loads(pending["signed_data"])
    except signing.BadSignature:
        cache.delete(f"reg_pending:{slug}")
        raise RegistrationNotFoundError()

    cache.delete(f"reg_pending:{slug}")
    return register_tenant(form_data)


def register_tenant(data: dict) -> Tenant:
    """
    Create a Tenant record (status=provisioning) and a TenantSubscription,
    then kick off the async provisioning task.

    Raises ValueError on slug collision.
    """
    import datetime

    from django.core import signing
    from django.core.cache import cache

    from .models import SubscriptionPlan

    slug = data["slug"].lower().strip()

    if Tenant.objects.filter(slug=slug).exists():
        raise ValueError(f"Slug '{slug}' is already taken.")

    plan = SubscriptionPlan.objects.get(id=data["plan_id"])

    tenant = Tenant.objects.create(
        name=data["business_name"],
        slug=slug,
        status=Tenant.Status.PROVISIONING,
        plan=Tenant.Plan.STARTER,
        owner_email=data["email"],
        owner_phone=data["phone"],
    )

    today = timezone.now().date()
    TenantSubscription.objects.create(
        tenant=tenant,
        plan=plan,
        status=TenantSubscription.Status.TRIALING,
        current_period_start=today,
        current_period_end=today + datetime.timedelta(days=30),
    )

    AuditLogMaster.objects.create(
        event_type="tenant.created",
        tenant=tenant,
        payload={"slug": slug, "plan": plan.name, "owner_email": data["email"]},
    )

    # Store owner credentials for the provisioning task (signed, 1-hour TTL).
    init_payload = signing.dumps({
        "owner_name": data.get("owner_name", ""),
        "password": data["password"],
    })
    cache.set(f"tenant_init:{tenant.id}", init_payload, timeout=3600)

    from . import tasks
    tasks.provision_tenant.delay(str(tenant.id))

    logger.info("Tenant '%s' created, provisioning queued.", slug)
    return tenant


def suspend_tenant(tenant: Tenant, actor_email: str = "") -> Tenant:
    tenant.status = Tenant.Status.SUSPENDED
    tenant.save(update_fields=["status", "updated_at"])

    # Mark the DB record inactive so ?db_status=suspended filter (database__is_active=False)
    # returns correct results and get_db_status() reports "suspended".
    TenantDatabase.objects.using("default").filter(tenant=tenant).update(is_active=False)

    AuditLogMaster.objects.create(
        event_type="tenant.suspended",
        tenant=tenant,
        actor_email=actor_email,
        payload={"slug": tenant.slug},
    )
    return tenant


def reactivate_tenant(tenant: Tenant, actor_email: str = "") -> Tenant:
    tenant.status = Tenant.Status.ACTIVE
    tenant.save(update_fields=["status", "updated_at"])

    # Restore TenantDatabase.is_active so db_status filter is truthful again.
    TenantDatabase.objects.using("default").filter(tenant=tenant).update(is_active=True)

    AuditLogMaster.objects.create(
        event_type="tenant.reactivated",
        tenant=tenant,
        actor_email=actor_email,
        payload={"slug": tenant.slug},
    )
    return tenant


# ──────────────────────────────────────────────────────────────────────────────
# Provisioning helpers (shared between the Celery task and the mgmt command)
# ──────────────────────────────────────────────────────────────────────────────


def _random_password(length: int = 16) -> str:
    alphabet = string.ascii_letters + string.digits + "!@#$%^&*()"
    return "".join(secrets.choice(alphabet) for _ in range(length))


def _create_pg_resources(db_name: str, db_user: str, db_password: str) -> None:
    """
    Create the PostgreSQL database and user for a new tenant.

    Requires CREATEDB + CREATEROLE privileges on the master connection.
    Safe to call again on a retry — each step is guarded by an existence check.
    """
    import psycopg2
    from django.db import connection

    with connection.cursor() as cursor:
        connection.connection.autocommit = True
        cursor.execute("SELECT 1 FROM pg_database WHERE datname = %s", [db_name])
        if not cursor.fetchone():
            cursor.execute(
                f'CREATE DATABASE "{db_name}" ENCODING \'UTF8\' '
                f"LC_COLLATE 'en_US.utf8' LC_CTYPE 'en_US.utf8' TEMPLATE template0"
            )
        cursor.execute("SET password_encryption = 'md5'")
        cursor.execute("SELECT 1 FROM pg_roles WHERE rolname = %s", [db_user])
        if not cursor.fetchone():
            cursor.execute(f'CREATE USER "{db_user}" WITH PASSWORD %s', [db_password])
        else:
            # Prior failed run — reset password so PgBouncer auth matches the record.
            cursor.execute(f'ALTER USER "{db_user}" WITH PASSWORD %s', [db_password])
        cursor.execute(f'GRANT ALL PRIVILEGES ON DATABASE "{db_name}" TO "{db_user}"')
        cursor.execute(f'REVOKE ALL ON DATABASE "{db_name}" FROM PUBLIC')
        connection.connection.autocommit = False

    # PostgreSQL 15+ revokes CREATE on the public schema from PUBLIC by default.
    master_cfg = settings.DATABASES["default"]
    with psycopg2.connect(
        dbname=db_name,
        user=master_cfg["USER"],
        password=master_cfg["PASSWORD"],
        host=master_cfg["HOST"],
        port=int(master_cfg.get("PORT", 5432)),
    ) as schema_conn:
        schema_conn.autocommit = True
        with schema_conn.cursor() as sc:
            sc.execute(f'GRANT ALL ON SCHEMA public TO "{db_user}"')


def _seed_roles_and_permissions() -> None:
    """Seed system roles, the full permission catalogue, and grant defaults per spec §4–5."""
    from authentication.models import Permission, Role, RolePermission

    system_roles = [
        ("Tenant Admin", True), ("Shop Manager", True),
        ("Receptionist", True), ("Technician", True),
        ("Billing Staff", True), ("HR Manager", True), ("Viewer", True),
    ]
    for role_name, is_system in system_roles:
        Role.objects.get_or_create(name=role_name, defaults={"is_system_role": is_system})

    permissions_catalogue = [
        # crm
        ("crm.leads.view", "crm"), ("crm.leads.create", "crm"), ("crm.leads.edit", "crm"),
        ("crm.leads.delete", "crm"), ("crm.leads.convert", "crm"),
        ("crm.customers.view", "crm"), ("crm.customers.create", "crm"),
        ("crm.customers.edit", "crm"), ("crm.customers.merge", "crm"),
        ("crm.communications.log", "crm"), ("crm.tasks.manage", "crm"),
        ("crm.segments.manage", "crm"),
        # repair
        ("repair.jobs.view", "repair"), ("repair.jobs.create", "repair"),
        ("repair.jobs.edit", "repair"), ("repair.jobs.change_status", "repair"),
        ("repair.jobs.assign_tech", "repair"), ("repair.estimates.send", "repair"),
        ("repair.estimates.approve", "repair"), ("repair.templates.manage", "repair"),
        ("repair.warranty.view", "repair"), ("repair.spare_parts.request", "repair"),
        ("repair.spare_parts.approve", "repair"),
        # pos
        ("pos.counter_sale.create", "pos"), ("pos.wholesale_sale.create", "pos"),
        ("pos.job_sale.create", "pos"), ("pos.discount.apply", "pos"),
        ("pos.returns.create", "pos"), ("pos.returns.approve", "pos"),
        # erp
        ("erp.inventory.view", "erp"), ("erp.inventory.adjust", "erp"),
        ("erp.suppliers.manage", "erp"), ("erp.purchase_orders.create", "erp"),
        ("erp.grn.receive", "erp"), ("erp.purchase_invoices.record", "erp"),
        ("erp.purchase_returns.create", "erp"), ("erp.expenses.view", "erp"),
        ("erp.expenses.create", "erp"), ("erp.budget.manage", "erp"),
        ("erp.assets.manage", "erp"),
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
        # reports — spec §5: revenue/hr/crm/repair/inventory/gst/pl + amc for AMC reports
        ("reports.revenue.view", "reports"), ("reports.hr.view", "reports"),
        ("reports.crm.view", "reports"), ("reports.repair.view", "reports"),
        ("reports.inventory.view", "reports"), ("reports.gst.view", "reports"),
        ("reports.pl.view", "reports"), ("reports.amc.view", "reports"),
        # settings
        ("settings.shop.edit", "settings"), ("settings.roles.manage", "settings"),
        ("settings.users.manage", "settings"),
        ("settings.commission_rules.manage", "settings"),
        ("settings.notifications.manage", "settings"),
        # crm — Phase-0 nav blueprint additions
        ("crm.deals.view", "crm"), ("crm.deals.create", "crm"), ("crm.deals.edit", "crm"),
        ("crm.deals.change_stage", "crm"), ("crm.deals.close", "crm"),
        ("crm.contacts.view", "crm"), ("crm.contacts.create", "crm"), ("crm.contacts.edit", "crm"),
        # repair — Phase-0 additions
        ("repair.estimates.view", "repair"),
        # erp — Phase-0 additions
        ("erp.products.view", "erp"), ("erp.products.manage", "erp"),
        ("erp.purchase_returns.view", "erp"),
        # billing — Phase-0 additions
        ("billing.credit_notes.view", "billing"), ("billing.credit_notes.create", "billing"),
        ("billing.credit_notes.approve", "billing"),
        ("billing.refunds.view", "billing"), ("billing.refunds.create", "billing"),
        ("billing.refunds.approve", "billing"),
        # accounts — Phase-0 new module (expenses stay under erp.expenses.*)
        ("accounts.income.view", "accounts"), ("accounts.income.record", "accounts"),
        ("accounts.cashbook.view", "accounts"),
        ("accounts.bank.view", "accounts"), ("accounts.bank.manage", "accounts"),
        ("accounts.ledger.view", "accounts"), ("accounts.ledger.export", "accounts"),
        ("accounts.journal.view", "accounts"), ("accounts.journal.create", "accounts"),
        ("accounts.journal.post", "accounts"),
        ("accounts.chart.manage", "accounts"),
        ("accounts.reports.view", "accounts"), ("accounts.reports.export", "accounts"),
        # tasks — Phase-0 new global module
        ("tasks.tasks.view", "tasks"), ("tasks.tasks.manage", "tasks"),
        # hr — Phase-0 additions
        ("hr.departments.manage", "hr"),
        # settings — Phase-0 additions
        ("settings.taxes.manage", "settings"), ("settings.branches.manage", "settings"),
        ("settings.integrations.manage", "settings"), ("settings.backup.manage", "settings"),
        ("settings.audit.view", "settings"),
    ]
    for codename, module in permissions_catalogue:
        Permission.objects.get_or_create(
            codename=codename,
            defaults={"module": module, "label": codename.replace(".", " ").title()},
        )

    # ── Default permissions per spec §4 system roles ──────────────────────────
    # Tenant Admin gets all permissions; others get a scoped subset.
    DEFAULT_ROLE_PERMISSIONS: dict[str, list[str]] = {
        "Tenant Admin": [],  # handled separately below (all perms)
        "Shop Manager": [
            # CRM — full access
            "crm.leads.view", "crm.leads.create", "crm.leads.edit", "crm.leads.convert",
            "crm.customers.view", "crm.customers.create", "crm.customers.edit",
            "crm.customers.merge", "crm.communications.log", "crm.tasks.manage",
            "crm.segments.manage",
            # Repair — full access
            "repair.jobs.view", "repair.jobs.create", "repair.jobs.edit",
            "repair.jobs.change_status", "repair.jobs.assign_tech",
            "repair.estimates.send", "repair.estimates.approve", "repair.templates.manage",
            "repair.warranty.view", "repair.spare_parts.request", "repair.spare_parts.approve",
            # POS — full access
            "pos.counter_sale.create", "pos.wholesale_sale.create", "pos.job_sale.create",
            "pos.discount.apply", "pos.returns.create", "pos.returns.approve",
            # ERP — full access
            "erp.inventory.view", "erp.inventory.adjust", "erp.suppliers.manage",
            "erp.purchase_orders.create", "erp.grn.receive", "erp.purchase_invoices.record",
            "erp.purchase_returns.create", "erp.expenses.view", "erp.expenses.create",
            "erp.budget.manage", "erp.assets.manage",
            # AMC — full access
            "amc.contracts.view", "amc.contracts.create", "amc.contracts.edit",
            "amc.visits.schedule", "amc.visits.complete", "amc.renewals.manage",
            # HR — view + attendance (no salary generate, no petty cash)
            "hr.employees.view", "hr.attendance.view", "hr.attendance.mark",
            "hr.leaves.manage", "hr.salary.view",
            # Billing — full access
            "billing.repair_invoices.view", "billing.repair_invoices.create",
            "billing.sales_invoices.view", "billing.payments.record",
            "billing.outstanding.view", "billing.tally_export",
            # Reports — all
            "reports.revenue.view", "reports.hr.view", "reports.crm.view",
            "reports.repair.view", "reports.inventory.view", "reports.gst.view",
            "reports.pl.view", "reports.amc.view",
        ],
        "Receptionist": [
            # CRM — create/edit leads & customers, log comms
            "crm.leads.view", "crm.leads.create", "crm.leads.edit", "crm.leads.convert",
            "crm.customers.view", "crm.customers.create", "crm.customers.edit",
            "crm.communications.log", "crm.tasks.manage",
            # Repair — create & manage jobs; no approve
            "repair.jobs.view", "repair.jobs.create", "repair.jobs.edit",
            "repair.jobs.change_status", "repair.warranty.view",
            "repair.spare_parts.request",
            # POS — counter sales only (no billing write)
            "pos.counter_sale.create", "pos.returns.create",
            # AMC — view + schedule visits
            "amc.contracts.view", "amc.visits.schedule", "amc.visits.complete",
        ],
        "Technician": [
            # Repair — own jobs/stages, spare parts
            "repair.jobs.view", "repair.jobs.edit", "repair.jobs.change_status",
            "repair.warranty.view", "repair.spare_parts.request",
            # ERP — inventory view to check stock
            "erp.inventory.view",
        ],
        "Billing Staff": [
            # Billing — full access
            "billing.repair_invoices.view", "billing.repair_invoices.create",
            "billing.sales_invoices.view", "billing.payments.record",
            "billing.outstanding.view", "billing.tally_export",
            # POS — all sale types + returns
            "pos.counter_sale.create", "pos.wholesale_sale.create", "pos.job_sale.create",
            "pos.returns.create", "pos.returns.approve",
            # Repair — view jobs to raise invoices
            "repair.jobs.view",
            # Reports — financial
            "reports.revenue.view", "reports.gst.view", "reports.pl.view",
        ],
        "HR Manager": [
            # HR — full access
            "hr.employees.view", "hr.employees.manage", "hr.attendance.view",
            "hr.attendance.mark", "hr.leaves.manage", "hr.salary.view",
            "hr.salary.generate", "hr.petty_cash.manage",
            # Reports — HR only
            "reports.hr.view",
        ],
        "Viewer": [
            # Read-only across key modules
            "crm.leads.view", "crm.customers.view",
            "repair.jobs.view", "repair.warranty.view",
            "erp.inventory.view",
            "amc.contracts.view",
            "billing.repair_invoices.view", "billing.outstanding.view",
            "reports.repair.view", "reports.crm.view", "reports.inventory.view",
        ],
    }

    # Grant Tenant Admin all permissions
    admin_role = Role.objects.get(name="Tenant Admin")
    all_permissions = Permission.objects.all()
    existing_admin = set(
        RolePermission.objects.filter(role=admin_role).values_list("permission_id", flat=True)
    )
    RolePermission.objects.bulk_create(
        [RolePermission(role=admin_role, permission=p) for p in all_permissions if p.id not in existing_admin],
        ignore_conflicts=True,
    )

    # Grant each other role its spec-defined defaults
    perm_map = {p.codename: p for p in all_permissions}
    for role_name, codenames in DEFAULT_ROLE_PERMISSIONS.items():
        if role_name == "Tenant Admin" or not codenames:
            continue
        role = Role.objects.get(name=role_name)
        existing_role = set(
            RolePermission.objects.filter(role=role).values_list("permission_id", flat=True)
        )
        new_rps = [
            RolePermission(role=role, permission=perm_map[c])
            for c in codenames
            if c in perm_map and perm_map[c].id not in existing_role
        ]
        if new_rps:
            RolePermission.objects.bulk_create(new_rps, ignore_conflicts=True)


def _create_admin_user(name: str, email: str, phone: str, password: str) -> None:
    """Create the initial Tenant Admin user and assign the Tenant Admin role."""
    from authentication.models import Role, User, UserRole

    user = User.objects.create_user(email=email, phone=phone, full_name=name, password=password)
    admin_role = Role.objects.get(name="Tenant Admin")
    UserRole.objects.create(user=user, role=admin_role, shop=None)


def _create_default_shop(tenant_name: str, tenant_slug: str, phone: str, email: str) -> None:
    """Create a default shop so new tenants can use CRM/Repair immediately."""
    import re as _re
    from core.models import Shop

    # Derive a short unique code from the slug (e.g. "vijay_test" → "VT")
    words = [w for w in tenant_slug.split("_") if w]
    code = "".join(w[0].upper() for w in words)[:4] or tenant_slug[:4].upper()

    Shop.objects.create(
        name=tenant_name,
        code=code,
        address="TBD",       # owner updates via Settings → Shop
        city="TBD",
        state="Karnataka",
        state_code="29",
        phone=phone,
        email=email or None,
        is_active=True,
    )


def do_provision_tenant(tenant_id: str) -> None:
    """
    Full provisioning sequence for a new tenant.  Idempotent — safe to retry.

    Steps:
      1. Create TenantDatabase record (skipped if already exists from a prior attempt).
      2. Create PG database + user.
      3. Run Django migrations against the new DB.
      4. Seed system roles + permission catalogue.
      5. Create Tenant Admin user (credentials retrieved from signed Redis entry).
      6. Set tenant.status = ACTIVE.
    """
    from django.core import signing
    from django.core.cache import cache
    from django.core.management import call_command
    from django.db import connections

    from .models import Tenant, TenantDatabase

    tenant = Tenant.objects.using("default").get(id=tenant_id)

    if tenant.status == Tenant.Status.ACTIVE:
        return  # already provisioned — idempotent no-op

    # Step 1: ensure TenantDatabase record exists
    try:
        tenant_db = TenantDatabase.objects.using("default").get(tenant=tenant)
        db_password = tenant_db.decrypt_password()
    except TenantDatabase.DoesNotExist:
        db_password = _random_password(32)
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

    # Step 2: create PG database and user
    _create_pg_resources(tenant_db.db_name, tenant_db.db_user, db_password)

    # Step 3: register alias and run migrations
    alias = f"tenant_{tenant.slug}"
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
    call_command("migrate", database=alias, verbosity=0)

    # Steps 4 + 5: seed inside the tenant DB context
    from core.context import clear_tenant_context, set_tenant_db_alias

    set_tenant_db_alias(alias)
    try:
        _seed_roles_and_permissions()

        init_raw = cache.get(f"tenant_init:{tenant_id}")
        if init_raw:
            try:
                init_data = signing.loads(init_raw)
                owner_name = init_data.get("owner_name") or tenant.name
                password = init_data["password"]
            except signing.BadSignature:
                logger.warning(
                    "Bad signature on tenant_init cache for %s; using random password.", tenant.slug
                )
                owner_name = tenant.name
                password = _random_password()
            cache.delete(f"tenant_init:{tenant_id}")
        else:
            logger.warning("No tenant_init cache entry for %s; using random password.", tenant.slug)
            owner_name = tenant.name
            password = _random_password()

        _create_admin_user(
            name=owner_name,
            email=tenant.owner_email,
            phone=tenant.owner_phone,
            password=password,
        )
        _create_default_shop(
            tenant_name=tenant.name,
            tenant_slug=tenant.slug,
            phone=tenant.owner_phone,
            email=tenant.owner_email,
        )
    finally:
        clear_tenant_context()

    # Step 6: activate — explicit atomic block ensures the status update and
    # audit log are committed immediately; without this Celery worker connections
    # can leave an idle-in-transaction session that blocks subsequent queries.
    from django.db import transaction as db_transaction
    with db_transaction.atomic(using="default"):
        tenant.status = Tenant.Status.ACTIVE
        tenant.save(using="default", update_fields=["status", "updated_at"])
        AuditLogMaster.objects.create(
            event_type="tenant.provisioned",
            tenant=tenant,
            payload={"slug": tenant.slug},
        )
    logger.info("Tenant '%s' provisioned successfully.", tenant.slug)


def mark_provisioning_failed(tenant_id: str) -> None:
    """Mark a tenant as provisioning_failed after all Celery retries are exhausted."""
    from .models import Tenant

    try:
        tenant = Tenant.objects.using("default").get(id=tenant_id)
        tenant.status = Tenant.Status.PROVISIONING_FAILED
        tenant.save(using="default", update_fields=["status", "updated_at"])
        AuditLogMaster.objects.create(
            event_type="tenant.provisioning_failed",
            tenant=tenant,
            payload={"slug": tenant.slug},
        )
    except Tenant.DoesNotExist:
        logger.error("mark_provisioning_failed: tenant %s not found.", tenant_id)


# ──────────────────────────────────────────────────────────────────────────────
# Razorpay subscription webhook
# ──────────────────────────────────────────────────────────────────────────────

_RAZORPAY_EVENT_TO_STATUS = {
    "subscription.activated": TenantSubscription.Status.ACTIVE,
    "subscription.charged": TenantSubscription.Status.ACTIVE,
    "subscription.halted": TenantSubscription.Status.PAST_DUE,
    "subscription.cancelled": TenantSubscription.Status.CANCELLED,
    "subscription.paused": TenantSubscription.Status.PAUSED,
    "subscription.resumed": TenantSubscription.Status.ACTIVE,
    "subscription.pending": TenantSubscription.Status.PAST_DUE,
}


def verify_razorpay_signature(payload: bytes, signature: str) -> bool:
    secret = getattr(settings, "RAZORPAY_WEBHOOK_SECRET", "")
    expected = hmac.new(secret.encode(), payload, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


def handle_razorpay_subscription_webhook(payload: bytes, signature: str) -> dict:
    if not verify_razorpay_signature(payload, signature):
        raise ValueError("Invalid Razorpay signature.")

    data = json.loads(payload)
    event = data.get("event", "")
    new_status = _RAZORPAY_EVENT_TO_STATUS.get(event)
    if new_status is None:
        return {"ignored": True, "event": event}

    entity = data["payload"]["subscription"]["entity"]
    razorpay_id = entity["id"]

    try:
        sub = TenantSubscription.objects.get(razorpay_subscription_id=razorpay_id)
    except TenantSubscription.DoesNotExist:
        logger.warning("Subscription %s not found for event %s", razorpay_id, event)
        return {"ignored": True, "reason": "subscription_not_found"}

    sub.status = new_status
    sub.save(update_fields=["status", "updated_at"])

    AuditLogMaster.objects.create(
        event_type=f"subscription.{event.split('.')[1]}",
        tenant=sub.tenant,
        payload={"razorpay_id": razorpay_id, "new_status": new_status},
    )

    logger.info("Subscription %s → %s (event: %s)", razorpay_id, new_status, event)
    return {"updated": True, "status": new_status}
