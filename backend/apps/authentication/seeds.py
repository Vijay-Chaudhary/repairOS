"""Demo seed: role users (admin normalisation, one user per role, platform admin)."""
from django.core.management.base import CommandError

from core.seeding import SeedContext, Seeder, register
from core.seeds import DEMO_PASSWORD

# email → ctx["users"] key (mirrors role_name.lower().replace(" ", "_") in run())
USER_EMAIL_KEYS = [
    ("manager@demo.com", "shop_manager"),
    ("reception@demo.com", "receptionist"),
    ("tech1@demo.com", "technician_1"),
    ("tech2@demo.com", "technician_2"),
    ("billing@demo.com", "billing_staff"),
    ("hr@demo.com", "hr_manager"),
    ("viewer@demo.com", "viewer"),
]


class UsersDemoSeeder(Seeder):
    name = "authentication.demo_users"
    scope = "demo"
    depends_on = ("core.demo_shops",)

    def run(self, ctx: SeedContext) -> None:
        shop_del, shop_mum = ctx["shop_del"], ctx["shop_mum"]
        from authentication.models import Role, User, UserRole

        # Admin already created by provisioning — locate by phone (most reliable field)
        admin = (
            User.objects.filter(phone="+919876543210").first()
            or User.objects.filter(email="admin@demo.com").first()
        )
        if admin is None:
            raise CommandError("Could not locate provisioned admin user in tenant DB.")

        # Normalise admin credentials to canonical demo values regardless of
        # what create_tenant used (email/password may differ on first run)
        changed = []
        if admin.email != "admin@demo.com":
            admin.email = "admin@demo.com"
            changed.append("email")
        if not admin.check_password(DEMO_PASSWORD):
            admin.set_password(DEMO_PASSWORD)
            changed.append("password")
        if changed:
            admin.save(update_fields=changed)

        specs = [
            ("manager@demo.com",   "+919000000001", "Amit Sharma",   "Shop Manager",  [shop_del, shop_mum], False),
            ("reception@demo.com", "+919000000002", "Priya Gupta",   "Receptionist",  [shop_del],           False),
            ("tech1@demo.com",     "+919000000003", "Rohit Kumar",   "Technician",    [shop_del],           False),
            ("tech2@demo.com",     "+919000000004", "Suresh Patil",  "Technician",    [shop_del],           False),
            ("billing@demo.com",   "+919000000005", "Neha Verma",    "Billing Staff", [shop_del],           False),
            ("hr@demo.com",        "+919000000006", "Kavita Singh",  "HR Manager",    None,                 True),
            ("viewer@demo.com",    "+919000000007", "Raj Mehta",     "Viewer",        [shop_del],           False),
        ]

        users = {"admin": admin}
        tech_idx = 0

        for email, phone, name, role_name, shops, is_tenant_wide in specs:
            user, created = User.objects.get_or_create(
                email=email,
                defaults={"phone": phone, "full_name": name, "is_active": True},
            )
            # Always reset to DEMO_PASSWORD on seed so repeated runs stay predictable
            user.set_password(DEMO_PASSWORD)
            user.failed_login_attempts = 0
            user.locked_until = None
            user.save(update_fields=["password", "failed_login_attempts", "locked_until"])

            role = Role.objects.get(name=role_name)

            if is_tenant_wide:
                UserRole.objects.get_or_create(user=user, role=role, shop=None)
            else:
                for shop in (shops or []):
                    UserRole.objects.get_or_create(user=user, role=role, shop=shop)

            key = role_name.lower().replace(" ", "_")
            if key == "technician":
                tech_idx += 1
                key = f"technician_{tech_idx}"
            users[key] = user

        # Seed platform admin user (stored in tenant DB, is_platform_admin=True)
        platform_admin, created = User.objects.get_or_create(
            email="platform@repaiross.app",
            defaults={"phone": "+919999999999", "full_name": "Platform Admin", "is_active": True,
                      "is_platform_admin": True},
        )
        platform_admin.is_platform_admin = True
        platform_admin.set_password(DEMO_PASSWORD)
        platform_admin.failed_login_attempts = 0
        platform_admin.locked_until = None
        platform_admin.save(update_fields=["is_platform_admin", "password", "failed_login_attempts", "locked_until"])

        # Ensure role-permission defaults are always up-to-date on every seed run
        from master.services import _seed_roles_and_permissions
        _seed_roles_and_permissions()


        ctx["users"] = users

    def load(self, ctx: SeedContext) -> None:
        from authentication.models import User

        users = {"admin": User.objects.get(email="admin@demo.com")}
        for email, key in USER_EMAIL_KEYS:
            users[key] = User.objects.get(email=email)
        ctx["users"] = users


register(UsersDemoSeeder)
