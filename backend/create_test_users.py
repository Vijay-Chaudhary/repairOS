"""
One-shot script to create test users for every role in the demo tenant.
Run: python manage.py shell < create_test_users.py
"""

import django
from django.db import connections
from core.context import set_tenant_db_alias

# Register the tenant_demo DB connection from master DB records
from master.models import Tenant, TenantDatabase
tenant = Tenant.objects.using("default").get(slug="demo")
tenant_db = TenantDatabase.objects.using("default").get(tenant=tenant)
db_password = tenant_db.decrypt_password()

connections.databases["tenant_demo"] = {
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

set_tenant_db_alias("tenant_demo")

from authentication.models import Permission, Role, RolePermission, User, UserRole
from core.models import Shop

# ── Ensure the demo shop exists ────────────────────────────────────────────
shop, _ = Shop.objects.using("tenant_demo").get_or_create(
    code="DEMO",
    defaults={
        "name": "Demo Repair Shop",
        "address": "123 Main Street",
        "city": "Delhi",
        "state": "Delhi",
        "state_code": "07",
        "phone": "+919876543210",
        "gstin": "07AABCD1234E1Z5",
    },
)
print(f"Shop: {shop.name} ({shop.code})")

# ── Assign ALL permissions to Tenant Admin role ────────────────────────────
admin_role = Role.objects.using("tenant_demo").get(name="Tenant Admin")
all_perms = Permission.objects.using("tenant_demo").all()
for perm in all_perms:
    RolePermission.objects.using("tenant_demo").get_or_create(role=admin_role, permission=perm)

# ── Helper ─────────────────────────────────────────────────────────────────
def make_user(email, phone, full_name, password, role_name, perm_codenames):
    user, created = User.objects.using("tenant_demo").get_or_create(
        email=email,
        defaults={"phone": phone, "full_name": full_name},
    )
    if created:
        user.set_password(password)
        user.save(using="tenant_demo")

    role = Role.objects.using("tenant_demo").get(name=role_name)
    UserRole.objects.using("tenant_demo").get_or_create(user=user, role=role, shop=shop)

    # Ensure the role has the listed permissions
    for code in perm_codenames:
        perm, _ = Permission.objects.using("tenant_demo").get_or_create(
            codename=code, defaults={"label": code.replace(".", " ").title()}
        )
        RolePermission.objects.using("tenant_demo").get_or_create(role=role, permission=perm)

    status = "created" if created else "already exists"
    print(f"  [{role_name}] {email} / {password}  ({status})")
    return user


print("\nCreating test users...")

# 1. Tenant Admin — already created by create_tenant; ensure shop association
admin_user = User.objects.using("tenant_demo").get(email="admin@demo.com")
UserRole.objects.using("tenant_demo").get_or_create(user=admin_user, role=admin_role, shop=shop)
RolePermission.objects.using("tenant_demo").filter(role=admin_role).count()  # trigger queryset
print(f"  [Tenant Admin] admin@demo.com / Admin@123")

# 2. Shop Manager
manager_perms = [
    "crm.leads.view", "crm.leads.create", "crm.customers.view", "crm.customers.create",
    "crm.tasks.manage", "repair.jobs.view", "repair.jobs.create", "repair.jobs.edit",
    "repair.jobs.change_status", "repair.jobs.assign_tech",
    "repair.estimates.send", "repair.estimates.approve",
    "billing.repair_invoices.view", "billing.repair_invoices.create",
    "billing.payments.record", "billing.outstanding.view",
    "pos.counter_sale.create", "pos.discount.apply",
    "erp.inventory.view", "erp.expenses.view", "erp.budget.manage",
    "hr.employees.view", "hr.attendance.view",
    "reports.revenue.view", "reports.repair.view", "reports.crm.view",
    "settings.shop.edit", "settings.roles.manage",
    "settings.commission_rules.manage",
]
make_user("manager@demo.com", "+919876543211", "Shop Manager", "Manager@123",
          "Shop Manager", manager_perms)

# 3. Technician
tech_perms = [
    "repair.jobs.view", "repair.jobs.edit", "repair.jobs.change_status",
    "repair.estimates.send", "repair.warranty.view",
    "repair.spare_parts.request",
    "crm.customers.view",
    "erp.inventory.view",
]
make_user("tech@demo.com", "+919876543212", "Lead Technician", "Tech@1234",
          "Technician", tech_perms)

# 4. Receptionist
recept_perms = [
    "crm.leads.view", "crm.leads.create", "crm.customers.view", "crm.customers.create",
    "crm.communications.log", "crm.tasks.manage",
    "repair.jobs.view", "repair.jobs.create",
    "billing.repair_invoices.view", "billing.outstanding.view",
    "pos.counter_sale.create",
]
make_user("reception@demo.com", "+919876543213", "Front Desk", "Recept@123",
          "Receptionist", recept_perms)

# 5. Billing Staff
billing_perms = [
    "billing.repair_invoices.view", "billing.repair_invoices.create",
    "billing.sales_invoices.view", "billing.payments.record",
    "billing.outstanding.view", "billing.tally_export",
    "crm.customers.view",
    "reports.revenue.view", "reports.repair.view",
]
make_user("billing@demo.com", "+919876543214", "Billing Executive", "Billing@123",
          "Billing Staff", billing_perms)

# 6. HR Manager
hr_perms = [
    "hr.employees.view", "hr.employees.manage",
    "hr.attendance.view", "hr.attendance.mark",
    "hr.leaves.manage", "hr.salary.view", "hr.salary.generate",
    "hr.petty_cash.manage",
    "reports.hr.view",
    "settings.commission_rules.manage",
]
make_user("hr@demo.com", "+919876543215", "HR Manager", "HRmgr@123",
          "HR Manager", hr_perms)

# 7. Viewer (read-only)
viewer_perms = [
    "crm.leads.view", "crm.customers.view",
    "repair.jobs.view", "billing.repair_invoices.view",
    "billing.outstanding.view", "erp.inventory.view",
    "reports.revenue.view", "reports.repair.view",
]
make_user("viewer@demo.com", "+919876543216", "View Only User", "Viewer@123",
          "Viewer", viewer_perms)

# ── Platform Admin (lives in demo tenant DB, is_platform_admin=True) ───────
# Platform admin users authenticate via the tenant DB but carry is_platform_admin=True
# in their JWT which bypasses tenant RBAC and grants access to /platform/* endpoints.
print("\nCreating Platform Admin (demo tenant DB, is_platform_admin=True)...")
pa, created = User.objects.using("tenant_demo").get_or_create(
    email="platform@repaiross.app",
    defaults={
        "phone": "+910000000001",
        "full_name": "Platform Admin",
        "is_platform_admin": True,
    },
)
if created:
    pa.set_password("Platform@123")
    pa.save(using="tenant_demo")
status = "created" if created else "already exists"
print(f"  [Platform Admin] platform@repaiross.app / Platform@123  ({status})")

print("""
╔══════════════════════════════════════════════════════════════════╗
║                  RepairOS Test Credentials                       ║
║                  Tenant: demo   (X-Tenant-Slug: demo)           ║
╠══════════════════════════════════════════════════════════════════╣
║  Role            Email                    Password               ║
║  ─────────────── ──────────────────────── ───────────────────── ║
║  Tenant Admin    admin@demo.com           Admin@123              ║
║  Shop Manager    manager@demo.com         Manager@123            ║
║  Technician      tech@demo.com            Tech@1234              ║
║  Receptionist    reception@demo.com       Recept@123             ║
║  Billing Staff   billing@demo.com         Billing@123            ║
║  HR Manager      hr@demo.com              HRmgr@123              ║
║  Viewer          viewer@demo.com          Viewer@123             ║
╠══════════════════════════════════════════════════════════════════╣
║  Platform Admin  platform@repaiross.app   Platform@123           ║
║  (master DB — no tenant slug needed)                             ║
╠══════════════════════════════════════════════════════════════════╣
║  Login endpoint: POST /api/v1/auth/login/                        ║
║  Header needed:  X-Tenant-Slug: demo   (for tenant users)        ║
╚══════════════════════════════════════════════════════════════════╝
""")
