"""
Management command: seed_demo

Creates a complete demo dataset exercising every module.
Idempotent — re-running updates/skips, never duplicates.

Safety guards:
  - Refuses when DEBUG is False
  - Refuses when DB host is not localhost/127.0.0.1/pgbouncer

Usage:
    python manage.py seed_demo
"""

import random
from datetime import date, timedelta, time
from decimal import Decimal

from django.conf import settings
from django.core.management import call_command
from django.core.management.base import BaseCommand, CommandError
from django.utils import timezone

DEMO_SLUG = "demo"
DEMO_TENANT_NAME = "Shree Electronics"
DEMO_PASSWORD = "Demo@1234!"
FIXED_SEED = 42


class Command(BaseCommand):
    help = "Seed demo data for all roles and modules (local dev only)."

    # ── public entry point ────────────────────────────────────────────────────

    def handle(self, *args, **options):
        self._guard()
        random.seed(FIXED_SEED)

        self.stdout.write(self.style.MIGRATE_HEADING("\n▶  RepairOS demo seed starting…\n"))

        alias = self._provision_tenant()

        from core.context import set_tenant_db_alias
        set_tenant_db_alias(alias)

        self.stdout.write("  Seeding commission rules (must precede job closures)…")
        self._seed_commission_rules()

        self.stdout.write("  Seeding shops…")
        shop_del, shop_mum = self._seed_shops()

        self.stdout.write("  Seeding users…")
        users = self._seed_users(shop_del, shop_mum)

        self.stdout.write("  Seeding CRM…")
        crm = self._seed_crm(users, shop_del, shop_mum)

        self.stdout.write("  Seeding inventory…")
        variants = self._seed_inventory(shop_del, users)

        self.stdout.write("  Seeding procurement…")
        self._seed_procurement(shop_del, variants, users)

        self.stdout.write("  Seeding repair jobs…")
        jobs = self._seed_repair(shop_del, shop_mum, crm, users, variants)

        self.stdout.write("  Seeding billing…")
        self._seed_billing(jobs, users)

        self.stdout.write("  Seeding POS…")
        self._seed_pos(shop_del, crm, users, variants)

        self.stdout.write("  Seeding AMC…")
        self._seed_amc(shop_del, crm, users)

        self.stdout.write("  Seeding commissions payout…")
        self._seed_commission_payout(jobs, users)

        self.stdout.write("  Seeding HR…")
        self._seed_hr(shop_del, users)

        self.stdout.write("  Seeding finance…")
        self._seed_finance(shop_del, shop_mum, users)

        self._print_summary(alias)

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
            master_cfg = settings.DATABASES["default"]
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

    # ── commission rules (created early — accrual fires on job close) ─────────

    def _seed_commission_rules(self):
        from commissions.models import CommissionRule

        CommissionRule.objects.get_or_create(
            effective_from=date(2026, 1, 1),
            applies_to_job_type=None,
            defaults={
                "rate": Decimal("10.00"),
                "lead_tech_share": Decimal("60.00"),
                "effective_to": None,
            },
        )
        CommissionRule.objects.get_or_create(
            effective_from=date(2026, 1, 1),
            applies_to_job_type="iPhone",
            defaults={
                "rate": Decimal("12.00"),
                "lead_tech_share": Decimal("60.00"),
                "effective_to": None,
            },
        )

    # ── shops ─────────────────────────────────────────────────────────────────

    def _seed_shops(self):
        from core.models import Shop

        shop_del, _ = Shop.objects.get_or_create(
            code="SDEL",
            defaults={
                "name": "Shree Electronics – Delhi",
                "address": "12, Nehru Place Market, South Delhi",
                "city": "New Delhi",
                "state": "Delhi",
                "state_code": "07",
                "phone": "+911140001001",
                "email": "delhi@shreeelectronics.in",
                "gstin": "07AABCS1234A1Z5",
                "is_active": True,
            },
        )
        shop_mum, _ = Shop.objects.get_or_create(
            code="SMUM",
            defaults={
                "name": "Shree Electronics – Mumbai",
                "address": "45, SV Road, Andheri West, Mumbai",
                "city": "Mumbai",
                "state": "Maharashtra",
                "state_code": "27",
                "phone": "+912240001001",
                "email": "mumbai@shreeelectronics.in",
                "gstin": "27AABCS1234A2Z5",
                "is_active": True,
            },
        )
        return shop_del, shop_mum

    # ── users ─────────────────────────────────────────────────────────────────

    def _seed_users(self, shop_del, shop_mum):
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

        return users

    # ── CRM ──────────────────────────────────────────────────────────────────

    def _seed_crm(self, users, shop_del, shop_mum):
        from crm.models import (
            Lead, Customer, CommunicationLog, FollowUpTask,
            CustomerSegment, CustomerSegmentMember,
        )
        from crm import services as crm_svc

        admin = users["admin"]
        today = date.today()

        # ── Direct customer (no lead) ──────────────────────────────────────
        cust_direct, _ = Customer.objects.get_or_create(
            phone="+919100000001",
            shop=shop_del,
            defaults={
                "name": "Sunil Tiwari",
                "email": "sunil@example.com",
                "customer_type": "individual",
                "city": "New Delhi",
                "credit_limit": Decimal("0"),
                "tags": ["walk_in"],
            },
        )

        # Business customer for inter-state GST (Mumbai customer, GSTIN starts with 27)
        cust_business, _ = Customer.objects.get_or_create(
            phone="+919100000002",
            shop=shop_mum,
            defaults={
                "name": "TechZone Distributors Pvt Ltd",
                "gstin": "27AABCT9876A1Z5",
                "customer_type": "business",
                "city": "Mumbai",
                "credit_limit": Decimal("50000"),
                "tags": ["wholesale"],
            },
        )

        # ── Leads pipeline ─────────────────────────────────────────────────
        def _get_or_make_lead(phone, name, status_target, **extra):
            lead, created = Lead.objects.get_or_create(
                phone=phone, shop=shop_del,
                defaults={"name": name, "source": "whatsapp", "device_type": extra.get("device_type", ""), **extra},
            )
            return lead

        lead_new = _get_or_make_lead("+919200000001", "Arun Joshi", "new", device_type="Samsung")

        lead_contacted = _get_or_make_lead("+919200000002", "Meena Pillai", "new", device_type="iPhone")
        if lead_contacted.status == "new":
            crm_svc.transition_lead(lead_contacted, "contacted", admin)

        lead_interested = _get_or_make_lead("+919200000003", "Deepak Nair", "new", device_type="OnePlus")
        if lead_interested.status == "new":
            crm_svc.transition_lead(lead_interested, "contacted", admin)
        if lead_interested.status == "contacted":
            crm_svc.transition_lead(lead_interested, "interested", admin)

        lead_quoted = _get_or_make_lead("+919200000004", "Anjali Rao", "new", device_type="Redmi")
        for step in [("new", "contacted"), ("contacted", "interested"), ("interested", "quoted")]:
            if lead_quoted.status == step[0]:
                crm_svc.transition_lead(lead_quoted, step[1], admin)

        # Converted lead → customer Rahul Sharma
        lead_conv = _get_or_make_lead("+919200000005", "Rahul Sharma", "new", device_type="iPhone", notes="Screen shattered")
        if lead_conv.status not in ("converted",):
            for step in [("new", "contacted"), ("contacted", "interested"), ("interested", "quoted")]:
                if lead_conv.status == step[0]:
                    crm_svc.transition_lead(lead_conv, step[1], admin)
        if lead_conv.status == "quoted":
            crm_svc.convert_lead(lead_conv, admin)
            lead_conv.refresh_from_db()

        cust_rahul = Customer.objects.filter(shop=shop_del, phone="+919200000005").first()
        if not cust_rahul:
            cust_rahul = Customer.objects.get_or_create(
                phone="+919200000005", shop=shop_del,
                defaults={"name": "Rahul Sharma", "customer_type": "individual", "credit_limit": Decimal("0"), "tags": []},
            )[0]

        # Lost lead (must reach 'quoted' before 'lost' is allowed per state machine)
        lead_lost = _get_or_make_lead("+919200000006", "Ravi Kapoor", "new", device_type="Vivo")
        for step in [("new", "contacted"), ("contacted", "interested"), ("interested", "quoted")]:
            if lead_lost.status == step[0]:
                crm_svc.transition_lead(lead_lost, step[1], admin)
        if lead_lost.status == "quoted":
            crm_svc.transition_lead(lead_lost, "lost", admin, reason="Price too high compared to local repair shop")

        # ── Communication logs ─────────────────────────────────────────────
        CommunicationLog.objects.get_or_create(
            lead=lead_contacted,
            summary="Called to inquire about iPhone screen repair cost and timeline",
            defaults={
                "type": "call", "direction": "inbound",
                "duration_minutes": 5,
                "logged_at": timezone.now() - timedelta(days=3),
                "logged_by": admin,
            },
        )
        CommunicationLog.objects.get_or_create(
            lead=lead_quoted,
            summary="Sent WhatsApp quote ₹4,500 for Redmi display replacement",
            defaults={
                "type": "whatsapp", "direction": "outbound",
                "logged_at": timezone.now() - timedelta(days=1),
                "logged_by": admin,
            },
        )
        if cust_rahul:
            CommunicationLog.objects.get_or_create(
                customer=cust_rahul,
                summary="Follow-up call — device ready for pickup",
                defaults={
                    "type": "call", "direction": "outbound",
                    "duration_minutes": 3,
                    "logged_at": timezone.now() - timedelta(days=2),
                    "logged_by": admin,
                },
            )

        # ── Follow-up tasks ────────────────────────────────────────────────
        FollowUpTask.objects.get_or_create(
            lead=lead_contacted,
            title="Call back Meena — iPhone screen quote follow-up",
            defaults={
                "due_date": today - timedelta(days=1),   # OVERDUE
                "status": "pending",
                "priority": "high",
                "assigned_to": admin,
            },
        )
        FollowUpTask.objects.get_or_create(
            lead=lead_quoted,
            title="Send revised quote to Anjali",
            defaults={
                "due_date": today,
                "status": "pending",
                "priority": "normal",
                "assigned_to": admin,
            },
        )
        if cust_rahul:
            FollowUpTask.objects.get_or_create(
                customer=cust_rahul,
                title="Check Rahul's job status and update",
                defaults={
                    "due_date": today + timedelta(days=2),
                    "status": "pending",
                    "priority": "normal",
                    "assigned_to": admin,
                },
            )

        # ── Segment (tenant-wide, no shop FK) ─────────────────────────────
        seg, _ = CustomerSegment.objects.get_or_create(
            name="VIP Customers",
            defaults={"description": "High-value repeat customers — priority service"},
        )
        CustomerSegmentMember.objects.get_or_create(segment=seg, customer=cust_direct)

        # ── Extra customers (richer demo volume) ───────────────────────────
        extra_cust_specs = [
            ("+919100000010", "Priya Mehta",       "individual", "Saket, New Delhi",           Decimal("0"),      []),
            ("+919100000011", "Ankit Sharma",      "individual", "Dwarka, New Delhi",          Decimal("0"),      ["repeat"]),
            ("+919100000012", "Neha Kapoor",       "individual", "Rohini, New Delhi",          Decimal("0"),      []),
            ("+919100000013", "Rajesh Gupta",      "individual", "Pitampura, New Delhi",       Decimal("0"),      ["vip"]),
            ("+919100000014", "Sonia Agarwal",     "individual", "Vasant Kunj, New Delhi",     Decimal("0"),      []),
            ("+919100000015", "Mohan Lal",         "individual", "Karol Bagh, New Delhi",      Decimal("0"),      ["repeat"]),
            ("+919100000016", "Ritu Patel",        "individual", "Janakpuri, New Delhi",       Decimal("0"),      []),
            ("+919100000017", "Vivek Singh",       "individual", "Noida, UP",                  Decimal("0"),      []),
            ("+919100000018", "Kavya Reddy",       "individual", "Gurgaon, Haryana",           Decimal("0"),      ["walk_in"]),
            ("+919100000019", "Sameer Khan",       "individual", "Faridabad, Haryana",         Decimal("0"),      []),
            ("+919100000020", "Geeta Malhotra",    "individual", "Laxmi Nagar, New Delhi",     Decimal("0"),      ["repeat"]),
            ("+919100000021", "Arjun Nair",        "individual", "South Delhi",                Decimal("0"),      []),
            ("+919100000022", "Divya Iyer",        "individual", "CR Park, Delhi",             Decimal("0"),      []),
            ("+919100000023", "Sachin Yadav",      "individual", "Okhla, New Delhi",           Decimal("0"),      []),
            ("+919100000024", "Meera Joshi",       "individual", "Greater Kailash, Delhi",     Decimal("0"),      ["vip"]),
            ("+919100000025", "Harish Pandey",     "individual", "Mayur Vihar, Delhi",         Decimal("0"),      []),
            ("+919100000026", "Sunita Bhatt",      "individual", "Rajouri Garden, Delhi",      Decimal("0"),      []),
            ("+919100000027", "Pankaj Kumar",      "individual", "Uttam Nagar, Delhi",         Decimal("0"),      ["repeat"]),
            ("+919100000028", "Alka Saxena",       "individual", "Paschim Vihar, Delhi",       Decimal("0"),      []),
            ("+919100000029", "Dev Kapoor",        "individual", "Punjabi Bagh, Delhi",        Decimal("0"),      []),
            ("+919100000030", "Shikha Mishra",     "individual", "Connaught Place, Delhi",     Decimal("0"),      ["vip"]),
            ("+919100000031", "MobileZone India",  "business",   "Nehru Place, Delhi",         Decimal("100000"), ["wholesale"]),
            ("+919100000032", "QuickFix Repairs",  "business",   "Lajpat Nagar, Delhi",        Decimal("50000"),  ["wholesale"]),
        ]
        extra_customers = {}
        for phone, name, ctype, city, credit, tags in extra_cust_specs:
            c, _ = Customer.objects.get_or_create(
                phone=phone, shop=shop_del,
                defaults={"name": name, "customer_type": ctype, "city": city,
                          "credit_limit": credit, "tags": tags},
            )
            extra_customers[phone] = c

        CustomerSegmentMember.objects.get_or_create(segment=seg, customer=extra_customers["+919100000013"])
        CustomerSegmentMember.objects.get_or_create(segment=seg, customer=extra_customers["+919100000024"])
        CustomerSegmentMember.objects.get_or_create(segment=seg, customer=extra_customers["+919100000030"])

        # ── Extra follow-up tasks ──────────────────────────────────────────
        extra_tasks = [
            (extra_customers["+919100000011"], None, "Call Ankit — iPhone screen quote follow-up",           today + timedelta(days=1),  "pending",     "high"),
            (extra_customers["+919100000013"], None, "Rajesh VIP — check repair progress",                   today,                      "pending",     "high"),
            (extra_customers["+919100000015"], None, "Mohan repeat customer — offer loyalty discount",       today + timedelta(days=2),  "pending",     "normal"),
            (extra_customers["+919100000020"], None, "Geeta — confirm payment received",                     today - timedelta(days=1),  "pending",     "normal"),
            (extra_customers["+919100000024"], None, "Meera VIP — device collection call",                   today,                      "in_progress", "high"),
            (extra_customers["+919100000027"], None, "Pankaj repeat — send service reminder",                today + timedelta(days=3),  "pending",     "normal"),
            (None, lead_new,                         "Call Arun — Samsung repair estimate follow-up",         today + timedelta(days=1),  "pending",     "normal"),
            (None, lead_interested,                  "Demo OnePlus repair timeline to Deepak",               today + timedelta(days=3),  "pending",     "normal"),
        ]
        for cust_obj, lead_obj, title, due, status, priority in extra_tasks:
            kw = {"due_date": due, "status": status, "priority": priority, "assigned_to": admin}
            if cust_obj:
                FollowUpTask.objects.get_or_create(customer=cust_obj, title=title, defaults=kw)
            elif lead_obj:
                FollowUpTask.objects.get_or_create(lead=lead_obj, title=title, defaults=kw)

        return {
            "rahul":    cust_rahul,
            "direct":   cust_direct,
            "business": cust_business,
            **extra_customers,
        }

    # ── inventory ─────────────────────────────────────────────────────────────

    def _seed_inventory(self, shop_del, users):
        from inventory.models import ProductCategory, Product, ProductVariant, InventoryStock
        from inventory import services as inv_svc

        admin = users["admin"]

        cat_spare, _ = ProductCategory.objects.get_or_create(name="Spare Parts")
        cat_acc, _ = ProductCategory.objects.get_or_create(name="Accessories & Consumables")

        def _product(sku, cat, name, brand, hsn, for_sale, for_repair):
            return Product.objects.get_or_create(
                sku=sku,
                defaults={
                    "category": cat, "name": name, "brand": brand,
                    "hsn_code": hsn, "default_tax_rate": Decimal("18"),
                    "is_for_sale": for_sale, "is_for_repair_use": for_repair,
                },
            )[0]

        p_ip14_screen = _product("SPN-IP14", cat_spare, "iPhone 14 Display Assembly", "Apple",    "85177090", False, True)
        p_sa54_batt   = _product("SPN-SA54", cat_spare, "Samsung A54 Battery",         "Samsung",  "85076000", False, True)
        p_usbc        = _product("ACC-USBC1",cat_acc,   "USB-C Cable 1m",              "Generic",  "85444290", True,  False)
        p_glass       = _product("ACC-TG01", cat_acc,   "Tempered Glass (Universal)",  "Generic",  "70099200", True,  False)
        p_charger     = _product("ACC-CA65", cat_acc,   "65W Charging Adapter",        "Generic",  "85044090", True,  False)

        def _variant(product, name, barcode, cost, sell, wholesale=None):
            return ProductVariant.objects.get_or_create(
                barcode=barcode,
                defaults={
                    "product": product, "variant_name": name,
                    "cost_price": Decimal(str(cost)),
                    "selling_price": Decimal(str(sell)),
                    "wholesale_price": Decimal(str(wholesale)) if wholesale else None,
                },
            )[0]

        v_ip14   = _variant(p_ip14_screen, "OEM Grade A",   "SPN-IP14-OEM", 3500,  4500)
        v_sa54   = _variant(p_sa54_batt,   "Original",      "SPN-SA54-ORI", 800,   1200)
        v_usbc   = _variant(p_usbc,        "Braided",       "ACC-USBC1-BR", 120,   299,  wholesale=220)
        v_glass  = _variant(p_glass,       "0.3mm",         "ACC-TG01-03",  50,    149,  wholesale=110)
        v_charge = _variant(p_charger,     "White / GaN",   "ACC-CA65-WH",  400,   899,  wholesale=650)

        from django.db import transaction as dbtxn

        def _open_stock(variant, qty, reorder):
            stock = InventoryStock.objects.filter(shop=shop_del, variant=variant).first()
            if stock is None or stock.quantity_in_stock == 0:
                with dbtxn.atomic():
                    inv_svc.opening_stock(shop_del, variant, Decimal(str(qty)), admin)
            InventoryStock.objects.filter(shop=shop_del, variant=variant).update(reorder_level=Decimal(str(reorder)))

        _open_stock(v_ip14,   10, 3)
        _open_stock(v_sa54,    2, 5)   # qty=2 < reorder_level=5 → low-stock alert
        _open_stock(v_usbc,   50, 10)
        _open_stock(v_glass,  40, 10)
        _open_stock(v_charge, 20,  5)

        # ── Extra products and variants ────────────────────────────────────
        cat_comp,  _ = ProductCategory.objects.get_or_create(name="Components & Ports")
        cat_cable, _ = ProductCategory.objects.get_or_create(name="Cables & Adapters")
        cat_prot,  _ = ProductCategory.objects.get_or_create(name="Protection & Cases")
        cat_power, _ = ProductCategory.objects.get_or_create(name="Power & Charging")
        cat_audio, _ = ProductCategory.objects.get_or_create(name="Audio & Accessories")

        extra_prod_specs = [
            ("SPN-IP13",      cat_spare, "iPhone 13 Display Assembly",      "Apple",   "85177090", False, True),
            ("SPN-IP15P",     cat_spare, "iPhone 15 Pro Display Assembly",   "Apple",   "85177090", False, True),
            ("SPN-SSS23",     cat_spare, "Samsung Galaxy S23 Battery",       "Samsung", "85076000", False, True),
            ("SPN-SSA33",     cat_spare, "Samsung Galaxy A33 Battery",       "Samsung", "85076000", False, True),
            ("SPN-RLC55",     cat_spare, "Realme C55 Battery",               "Realme",  "85076000", False, True),
            ("SPN-RDN12",     cat_spare, "Redmi Note 12 Battery",            "Xiaomi",  "85076000", False, True),
            ("SPN-IP12CP",    cat_comp,  "iPhone 12 Lightning Port",         "Apple",   "85177090", False, True),
            ("SPN-OPA57S",    cat_spare, "Oppo A57 Speaker Module",          "Oppo",    "85182100", False, True),
            ("ACC-USBC2",     cat_cable, "USB-C Cable 2m",                   "Generic", "85444290", True,  False),
            ("ACC-LIG1",      cat_cable, "Lightning Cable 1m",               "Generic", "85444290", True,  False),
            ("ACC-WC15",      cat_power, "15W Wireless Charging Pad",        "Generic", "85044090", True,  False),
            ("ACC-EP01",      cat_audio, "Wired Earphones 3.5mm",            "Generic", "85183000", True,  False),
            ("ACC-CASE-IP14", cat_prot,  "iPhone 14 Silicone Case",          "Apple",   "39269090", True,  False),
            ("ACC-CASE-SA54", cat_prot,  "Samsung A54 TPU Case",             "Samsung", "39269090", True,  False),
            ("ACC-PB10K",     cat_power, "Power Bank 10000mAh",              "Generic", "85076000", True,  False),
            ("ACC-SCRKIT",    cat_acc,   "Screen Cleaning Kit",              "Generic", "34021900", True,  False),
            ("ACC-MU1",       cat_cable, "Micro USB Cable 1m",               "Generic", "85444290", True,  False),
            ("ACC-TGIP14",    cat_prot,  "Tempered Glass iPhone 14",         "Generic", "70099200", True,  False),
            ("ACC-TGSA54",    cat_prot,  "Tempered Glass Samsung A54",       "Generic", "70099200", True,  False),
            ("ACC-CA20W",     cat_power, "20W PD Wall Charger",              "Generic", "85044090", True,  False),
        ]

        extra_variant_specs = [
            ("SPN-IP13",      "OEM Grade A",      "SPN-IP13-OEM",    2800, 3800,  None),
            ("SPN-IP15P",     "OEM Grade A",      "SPN-IP15P-OEM",   6500, 8500,  None),
            ("SPN-SSS23",     "Original",         "SPN-SSS23-ORI",   1200, 1800,  None),
            ("SPN-SSA33",     "Original",         "SPN-SSA33-ORI",   600,  950,   None),
            ("SPN-RLC55",     "Original",         "SPN-RLC55-ORI",   450,  750,   None),
            ("SPN-RDN12",     "Original",         "SPN-RDN12-ORI",   500,  799,   None),
            ("SPN-IP12CP",    "Original",         "SPN-IP12CP-ORI",  800,  1400,  None),
            ("SPN-OPA57S",    "Original",         "SPN-OPA57S-ORI",  350,  600,   None),
            ("ACC-USBC2",     "Nylon Braided",    "ACC-USBC2-NY",    150,  349,   260),
            ("ACC-LIG1",      "MFI Certified",    "ACC-LIG1-MFI",    180,  399,   290),
            ("ACC-WC15",      "Round Pad",        "ACC-WC15-RND",    450,  999,   750),
            ("ACC-EP01",      "In-ear Wired",     "ACC-EP01-IE",     120,  299,   220),
            ("ACC-CASE-IP14", "Midnight Black",   "ACC-CASE-IP14-BK",80,   249,   180),
            ("ACC-CASE-SA54", "Clear TPU",        "ACC-CASE-SA54-CL",60,   199,   140),
            ("ACC-PB10K",     "Black",            "ACC-PB10K-BK",    600,  1499,  1100),
            ("ACC-SCRKIT",    "Spray + Cloth",    "ACC-SCRKIT-SP",   40,   99,    None),
            ("ACC-MU1",       "Basic",            "ACC-MU1-BAS",     60,   149,   110),
            ("ACC-TGIP14",    "0.3mm Privacy",    "ACC-TGIP14-PV",   80,   249,   180),
            ("ACC-TGSA54",    "0.3mm Clear",      "ACC-TGSA54-CL",   70,   219,   160),
            ("ACC-CA20W",     "White",            "ACC-CA20W-WH",    280,  699,   500),
        ]

        prod_map = {sku: _product(sku, cat, nm, brand, hsn, fs, fr)
                    for sku, cat, nm, brand, hsn, fs, fr in extra_prod_specs}
        extra_variants = {}
        for sku, vname, barcode, cost, sell, wholesale in extra_variant_specs:
            extra_variants[sku] = _variant(prod_map[sku], vname, barcode, cost, sell, wholesale)

        extra_stock_specs = [
            ("SPN-IP13",      8,  3), ("SPN-IP15P",     5,  2),
            ("SPN-SSS23",     6,  3), ("SPN-SSA33",     10, 5),
            ("SPN-RLC55",     8,  4), ("SPN-RDN12",     4,  5),
            ("SPN-IP12CP",    6,  3), ("SPN-OPA57S",    4,  3),
            ("ACC-USBC2",     30, 10), ("ACC-LIG1",     25, 10),
            ("ACC-WC15",      15, 5),  ("ACC-EP01",     30, 10),
            ("ACC-CASE-IP14", 20, 8),  ("ACC-CASE-SA54",20, 8),
            ("ACC-PB10K",     12, 5),  ("ACC-SCRKIT",   40, 15),
            ("ACC-MU1",       50, 15), ("ACC-TGIP14",   25, 8),
            ("ACC-TGSA54",    20, 8),  ("ACC-CA20W",    15, 5),
        ]
        for sku, qty, reorder in extra_stock_specs:
            _open_stock(extra_variants[sku], qty, reorder)

        return {
            "iphone_screen":  v_ip14,
            "samsung_battery": v_sa54,
            "usbc":    v_usbc,
            "glass":   v_glass,
            "charger": v_charge,
            **extra_variants,
        }

    # ── procurement ───────────────────────────────────────────────────────────

    def _seed_procurement(self, shop_del, variants, users):
        from procurement.models import Supplier, PurchaseOrder
        from procurement import services as proc_svc

        admin = users["admin"]

        supplier, _ = Supplier.objects.get_or_create(
            phone="+911144001001",
            defaults={
                "name": "Rohan Mobile Distributors",
                "contact_person": "Rohan Aggarwal",
                "email": "rohan@rmobiles.in",
                "address": "Plot 14, Wazirpur Industrial Area, Delhi",
                "state": "Delhi",
                "state_code": "07",
                "gstin": "07AACPR1234B1Z5",
                "payment_terms_days": 30,
            },
        )

        # Idempotency: only create primary PO if it doesn't exist yet
        if not PurchaseOrder.objects.filter(shop=shop_del, supplier=supplier).exists():
            v_ip14 = variants["iphone_screen"]
            v_sa54 = variants["samsung_battery"]
            v_usbc = variants["usbc"]

            po = proc_svc.create_purchase_order(
                shop=shop_del,
                supplier=supplier,
                data={
                    "expected_delivery_date": date.today() + timedelta(days=7),
                    "notes": "Urgent — iPhone screens running low",
                    "items": [
                        {"variant_id": str(v_ip14.id), "quantity_ordered": "5", "unit_cost": "3200", "tax_rate": "18", "hsn_code": "85177090"},
                        {"variant_id": str(v_sa54.id), "quantity_ordered": "10","unit_cost": "750",  "tax_rate": "18", "hsn_code": "85076000"},
                        {"variant_id": str(v_usbc.id), "quantity_ordered": "20","unit_cost": "100",  "tax_rate": "18", "hsn_code": "85444290"},
                    ],
                },
                user=admin,
            )

            proc_svc.update_purchase_order(po, {"status": "sent"}, admin)

            grn = proc_svc.receive_grn(
                shop=shop_del,
                po=po,
                data={
                    "received_date": str(date.today()),
                    "challan_number": "CH-2026-0042",
                    "notes": "Samsung batteries — 2 units physically damaged",
                    "items": [
                        {"po_item_id": str(po.items.get(variant=v_ip14).id), "quantity_received": "5",  "quantity_accepted": "5",  "quantity_rejected": "0"},
                        {"po_item_id": str(po.items.get(variant=v_sa54).id), "quantity_received": "10", "quantity_accepted": "8",  "quantity_rejected": "2", "rejection_reason": "Dented casing — DOA"},
                        {"po_item_id": str(po.items.get(variant=v_usbc).id), "quantity_received": "20", "quantity_accepted": "20", "quantity_rejected": "0"},
                    ],
                },
                user=admin,
            )

            inv = proc_svc.create_purchase_invoice(
                shop=shop_del,
                supplier=supplier,
                data={
                    "grn_id": str(grn.id),
                    "bill_number": "RMD-INV-2026-0189",
                    "bill_date": str(date.today()),
                    "due_date": str(date.today() + timedelta(days=30)),
                    "subtotal": str(grn.subtotal),
                },
                user=admin,
            )

            proc_svc.record_purchase_payment(
                invoice=inv,
                data={"amount": "15000", "method": "neft", "reference_id": "NEFT20260601"},
                user=admin,
            )

        # ── Extra suppliers ────────────────────────────────────────────────
        supp2, _ = Supplier.objects.get_or_create(
            phone="+912244001001",
            defaults={
                "name": "TechParts Global",
                "contact_person": "Suresh Chandra",
                "email": "suresh@techpartsglobal.com",
                "address": "34, Dharavi Industrial Estate, Mumbai",
                "state": "Maharashtra",
                "state_code": "27",
                "gstin": "27AACPT9876B1Z5",
                "payment_terms_days": 45,
            },
        )
        supp3, _ = Supplier.objects.get_or_create(
            phone="+918044001001",
            defaults={
                "name": "Apple Authorized Spares",
                "contact_person": "Ramesh Kumar",
                "email": "ramesh@appleauth.in",
                "address": "15, Koramangala, Bangalore",
                "state": "Karnataka",
                "state_code": "29",
                "gstin": "29AACPA1234C1Z5",
                "payment_terms_days": 30,
            },
        )
        supp4, _ = Supplier.objects.get_or_create(
            phone="+911244001001",
            defaults={
                "name": "Xiaomi Service Distributors",
                "contact_person": "Deepak Jain",
                "email": "deepak@xiaomiparts.in",
                "address": "45, Sector 18, Noida, UP",
                "state": "Uttar Pradesh",
                "state_code": "09",
                "gstin": "09AACPX5678D1Z5",
                "payment_terms_days": 30,
            },
        )

        # PO from Apple supplier — SENT, awaiting delivery
        v_ip13  = variants.get("SPN-IP13")
        v_ip15p = variants.get("SPN-IP15P")
        if v_ip13 and v_ip15p and not PurchaseOrder.objects.filter(shop=shop_del, supplier=supp3).exists():
            po_apple = proc_svc.create_purchase_order(
                shop=shop_del, supplier=supp3,
                data={
                    "expected_delivery_date": date.today() + timedelta(days=5),
                    "notes": "Q2 stock replenishment — iPhone 13 and 15 Pro screens",
                    "items": [
                        {"variant_id": str(v_ip13.id),  "quantity_ordered": "10", "unit_cost": "2600", "tax_rate": "18", "hsn_code": "85177090"},
                        {"variant_id": str(v_ip15p.id), "quantity_ordered": "5",  "unit_cost": "6000", "tax_rate": "18", "hsn_code": "85177090"},
                    ],
                },
                user=admin,
            )
            proc_svc.update_purchase_order(po_apple, {"status": "sent"}, admin)

        # PO from Xiaomi supplier — DRAFT (not yet confirmed)
        v_rdn12 = variants.get("SPN-RDN12")
        v_rlc55 = variants.get("SPN-RLC55")
        if v_rdn12 and v_rlc55 and not PurchaseOrder.objects.filter(shop=shop_del, supplier=supp4).exists():
            proc_svc.create_purchase_order(
                shop=shop_del, supplier=supp4,
                data={
                    "expected_delivery_date": date.today() + timedelta(days=10),
                    "notes": "Restocking Redmi and Realme batteries",
                    "items": [
                        {"variant_id": str(v_rdn12.id), "quantity_ordered": "15", "unit_cost": "450", "tax_rate": "18", "hsn_code": "85076000"},
                        {"variant_id": str(v_rlc55.id), "quantity_ordered": "12", "unit_cost": "400", "tax_rate": "18", "hsn_code": "85076000"},
                    ],
                },
                user=admin,
            )

        # PO from TechParts — fully received and paid
        v_ep01  = variants.get("ACC-EP01")
        v_pb10k = variants.get("ACC-PB10K")
        v_wc15  = variants.get("ACC-WC15")
        if v_ep01 and v_pb10k and v_wc15 and not PurchaseOrder.objects.filter(shop=shop_del, supplier=supp2).exists():
            po_tech = proc_svc.create_purchase_order(
                shop=shop_del, supplier=supp2,
                data={
                    "expected_delivery_date": date.today() - timedelta(days=15),
                    "notes": "Accessories bulk order",
                    "items": [
                        {"variant_id": str(v_ep01.id),  "quantity_ordered": "30", "unit_cost": "100", "tax_rate": "18", "hsn_code": "85183000"},
                        {"variant_id": str(v_pb10k.id), "quantity_ordered": "10", "unit_cost": "550", "tax_rate": "18", "hsn_code": "85076000"},
                        {"variant_id": str(v_wc15.id),  "quantity_ordered": "15", "unit_cost": "400", "tax_rate": "18", "hsn_code": "85044090"},
                    ],
                },
                user=admin,
            )
            proc_svc.update_purchase_order(po_tech, {"status": "sent"}, admin)
            grn_tech = proc_svc.receive_grn(
                shop=shop_del, po=po_tech,
                data={
                    "received_date": str(date.today() - timedelta(days=10)),
                    "challan_number": "TG-CH-2026-0087",
                    "notes": "All items received in good condition",
                    "items": [
                        {"po_item_id": str(po_tech.items.get(variant=v_ep01).id),  "quantity_received": "30", "quantity_accepted": "30", "quantity_rejected": "0"},
                        {"po_item_id": str(po_tech.items.get(variant=v_pb10k).id), "quantity_received": "10", "quantity_accepted": "10", "quantity_rejected": "0"},
                        {"po_item_id": str(po_tech.items.get(variant=v_wc15).id),  "quantity_received": "15", "quantity_accepted": "15", "quantity_rejected": "0"},
                    ],
                },
                user=admin,
            )
            inv_tech = proc_svc.create_purchase_invoice(
                shop=shop_del, supplier=supp2,
                data={
                    "grn_id": str(grn_tech.id),
                    "bill_number": "TG-INV-2026-0456",
                    "bill_date": str(date.today() - timedelta(days=10)),
                    "due_date": str(date.today() + timedelta(days=35)),
                    "subtotal": str(grn_tech.subtotal),
                },
                user=admin,
            )
            proc_svc.record_purchase_payment(
                invoice=inv_tech,
                data={"amount": str(inv_tech.grand_total), "method": "neft", "reference_id": "NEFT20260520TG"},
                user=admin,
            )

    # ── repair jobs ───────────────────────────────────────────────────────────

    def _seed_repair(self, shop_del, shop_mum, crm, users, variants):
        from repair import services as rep_svc
        from repair.models import JobTicket

        admin   = users["admin"]
        tech1   = users["technician_1"]
        tech2   = users["technician_2"]

        cust_rahul  = crm["rahul"]
        cust_direct = crm["direct"]
        cust_biz    = crm["business"]

        v_ip14  = variants["iphone_screen"]
        v_sa54  = variants["samsung_battery"]

        today = date.today()

        def _make_job(shop, customer, device_type, problem, sc, priority="normal", created_by=None):
            return rep_svc.create_job(
                shop=shop, customer=customer,
                data={
                    "device_type": device_type,
                    "device_brand": device_type.split()[0],
                    "problem_description": problem,
                    "service_charge": Decimal(str(sc)),
                    "priority": priority,
                    "intake_date": timezone.now(),
                    "expected_delivery_date": today + timedelta(days=3),
                },
                user=created_by or admin,
            )

        jobs = {}

        # J1 — open (check-in submitted, awaiting tech)
        if not JobTicket.objects.filter(shop=shop_del, status="open",
                                        customer=cust_direct).exists():
            j1 = _make_job(shop_del, cust_direct, "Samsung Galaxy S22", "Cracked back glass, touch unresponsive", 1800)
            rep_svc.submit_checkin(j1, {
                "physical_condition": "damaged",
                "has_scratches": True, "has_cracks": True,
                "has_liquid_damage": False, "has_missing_parts": False,
                "accessory_received": ["charger"],
                "customer_description": "Dropped from 1.5m height",
                "technician_notes": "Back glass shattered, touch partially responsive",
            }, admin)
            rep_svc.transition_job(j1, "open", admin)
        else:
            j1 = JobTicket.objects.filter(shop=shop_del, status="open", customer=cust_direct).first()
        jobs["open"] = j1

        # J2 — in_progress (multi-stage, tech1=lead + tech2)
        if not JobTicket.objects.filter(shop=shop_del, status="in_progress").exists():
            j2 = _make_job(shop_del, cust_rahul, "Samsung Galaxy A54", "Battery drain — full replacement needed", 1200, created_by=tech1)
            rep_svc.submit_checkin(j2, {
                "physical_condition": "fair",
                "has_scratches": True, "has_cracks": False,
                "has_liquid_damage": False, "has_missing_parts": False,
                "accessory_received": [],
                "customer_description": "Battery drains within 3 hours",
                "technician_notes": "Battery health ~42% on diagnostic",
            }, tech1)
            rep_svc.transition_job(j2, "open", tech1)

            # Set 2-stage workflow: tech1 diagnoses, tech2 replaces battery
            stages = rep_svc.set_stages(j2, [
                {"stage_order": 1, "stage_type": "diagnosis",  "assigned_technician_id": str(tech1.id)},
                {"stage_order": 2, "stage_type": "parts_install", "assigned_technician_id": str(tech2.id)},
            ], admin)

            rep_svc.transition_job(j2, "in_progress", tech1)
            rep_svc.start_stage(stages[0], tech1)

            # Spare-part request by tech1
            rep_svc.request_spare_part(j2, {
                "variant_id": str(v_sa54.id),
                "quantity": 1,
                "is_urgent": False,
            }, tech1)

            spr = j2.spare_part_requests.first()
            if spr and spr.status == "requested":
                rep_svc.review_spare_part(spr, "approved", admin)
        else:
            j2 = JobTicket.objects.filter(shop=shop_del, status="in_progress").first()
        jobs["in_progress"] = j2

        # J3 — ready_for_pickup (estimate sent + approved → in_progress → ready_for_pickup)
        if not JobTicket.objects.filter(shop=shop_del, status="ready_for_pickup").exists():
            j3 = _make_job(shop_del, cust_direct, "iPhone 14", "Screen cracked — display dead", 4500, priority="urgent")
            rep_svc.submit_checkin(j3, {
                "physical_condition": "damaged",
                "has_scratches": True, "has_cracks": True,
                "has_liquid_damage": False, "has_missing_parts": False,
                "accessory_received": [],
                "customer_description": "Dropped. Screen completely black",
                "technician_notes": "Display assembly needs full replacement",
            }, tech1)
            rep_svc.transition_job(j3, "open", admin)
            est = rep_svc.create_estimate(j3, {
                "labor_charge": "4500",
                "parts_cost": "0",
                "notes": "Parts sourced — ready in 2 days",
                "valid_until": today + timedelta(days=3),
                "send_via": "whatsapp",
            }, admin)
            # respond_to_estimate works on SENT or DRAFT estimate
            rep_svc.respond_to_estimate(est, "approved", "whatsapp", admin)
            rep_svc.transition_job(j3, "in_progress", tech1)
            stages3 = rep_svc.set_stages(j3, [
                {"stage_order": 1, "stage_type": "parts_install", "assigned_technician_id": str(tech1.id)},
                {"stage_order": 2, "stage_type": "testing",       "assigned_technician_id": str(tech1.id)},
            ], tech1)
            rep_svc.start_stage(stages3[0], tech1)
            rep_svc.advance_stage(stages3[0], "complete", "Display replaced successfully", tech1)
            rep_svc.advance_stage(stages3[1], "complete", "All touch functions working", tech1)
            rep_svc.transition_job(j3, "ready_for_qc", tech1)
            rep_svc.transition_job(j3, "ready_for_pickup", admin)
        else:
            j3 = JobTicket.objects.filter(shop=shop_del, status="ready_for_pickup").first()
        jobs["ready_for_pickup"] = j3

        # J4 — closed (fully transitioned, triggers commission accrual)
        if not JobTicket.objects.filter(shop=shop_del, customer=cust_rahul, device_type="iPhone").exists():
            j4 = _make_job(shop_del, cust_rahul, "iPhone", "Home button not working after water damage", 2500, created_by=tech1)
            rep_svc.submit_checkin(j4, {
                "physical_condition": "fair",
                "has_scratches": False, "has_cracks": False,
                "has_liquid_damage": True, "has_missing_parts": False,
                "accessory_received": ["charger", "case"],
                "customer_description": "Fell in water — home button stopped working",
                "technician_notes": "Liquid damage indicators triggered — cleaned PCB",
            }, tech1)
            rep_svc.transition_job(j4, "open", tech1)

            stages4 = rep_svc.set_stages(j4, [
                {"stage_order": 1, "stage_type": "repair",  "assigned_technician_id": str(tech1.id)},
                {"stage_order": 2, "stage_type": "testing", "assigned_technician_id": str(tech2.id)},
            ], admin)
            rep_svc.transition_job(j4, "in_progress", tech1)
            rep_svc.start_stage(stages4[0], tech1)
            rep_svc.advance_stage(stages4[0], "complete", "PCB cleaned, home button flex replaced", tech1)
            rep_svc.advance_stage(stages4[1], "complete", "All buttons and sensors functional", tech2)
            rep_svc.transition_job(j4, "ready_for_qc", tech2)
            rep_svc.transition_job(j4, "ready_for_pickup", admin)
            rep_svc.transition_job(j4, "delivered", admin)
            rep_svc.transition_job(j4, "closed", admin)   # ← triggers commission accrual
        else:
            j4 = JobTicket.objects.filter(shop=shop_del, customer=cust_rahul, device_type="iPhone").first()
        jobs["closed"] = j4

        # J5 — on_hold (waiting for part)
        if not JobTicket.objects.filter(shop=shop_del, status="on_hold").exists():
            j5 = _make_job(shop_del, cust_direct, "Redmi Note 12", "Charging port damaged", 800)
            rep_svc.submit_checkin(j5, {
                "physical_condition": "good",
                "has_scratches": False, "has_cracks": False,
                "has_liquid_damage": False, "has_missing_parts": False,
                "accessory_received": [],
                "customer_description": "Phone not charging at all",
                "technician_notes": "Charging port corroded",
            }, tech2)
            rep_svc.transition_job(j5, "open", tech2)
            rep_svc.transition_job(j5, "in_progress", tech2)
            rep_svc.transition_job(j5, "on_hold", admin, reason="Waiting for Redmi Note 12 charging port — ordered from supplier")
        else:
            j5 = JobTicket.objects.filter(shop=shop_del, status="on_hold").first()
        jobs["on_hold"] = j5

        # J6 — cancelled
        if not JobTicket.objects.filter(shop=shop_del, status="cancelled").exists():
            j6 = _make_job(shop_del, cust_direct, "Oppo A57", "Speaker not working", 600)
            rep_svc.submit_checkin(j6, {
                "physical_condition": "good",
                "has_scratches": True, "has_cracks": False,
                "has_liquid_damage": False, "has_missing_parts": False,
                "accessory_received": [],
                "customer_description": "Speaker crackling then stopped",
                "technician_notes": "Speaker cone damaged",
            }, tech1)
            rep_svc.transition_job(j6, "open", tech1)
            rep_svc.transition_job(j6, "cancelled", admin)
        else:
            j6 = JobTicket.objects.filter(shop=shop_del, status="cancelled").first()
        jobs["cancelled"] = j6

        # J7 — warranty claim on J4 (only for the original closed job)
        j4_closed = jobs["closed"]
        if j4_closed and j4_closed.status == "closed" and not j4_closed.warranty_jobs.exists():
            try:
                warranty_job = rep_svc.create_warranty_claim(j4_closed, admin)
                jobs["warranty"] = warranty_job
            except Exception:
                jobs["warranty"] = None
        else:
            jobs["warranty"] = j4_closed.warranty_jobs.first() if j4_closed else None

        # ── Extra closed jobs (historical — spread over last 60 days) ──────
        def _make_and_close(shop, customer, device_type, problem, sc, tech, days_ago):
            if JobTicket.objects.filter(shop=shop, customer=customer, device_type=device_type).exists():
                return JobTicket.objects.filter(shop=shop, customer=customer, device_type=device_type).first()
            j = _make_job(shop, customer, device_type, problem, sc, created_by=tech)
            rep_svc.submit_checkin(j, {
                "physical_condition": "fair",
                "has_scratches": False, "has_cracks": False,
                "has_liquid_damage": False, "has_missing_parts": False,
                "accessory_received": [],
                "customer_description": problem,
                "technician_notes": "Inspected and repaired successfully",
            }, tech)
            rep_svc.transition_job(j, "open", tech)
            stgs = rep_svc.set_stages(j, [
                {"stage_order": 1, "stage_type": "repair", "assigned_technician_id": str(tech.id)},
            ], admin)
            rep_svc.transition_job(j, "in_progress", tech)
            rep_svc.start_stage(stgs[0], tech)
            rep_svc.advance_stage(stgs[0], "complete", "Repair completed", tech)
            rep_svc.transition_job(j, "ready_for_qc", tech)
            rep_svc.transition_job(j, "ready_for_pickup", admin)
            rep_svc.transition_job(j, "delivered", admin)
            rep_svc.transition_job(j, "closed", admin)
            return j

        extra_job_specs = [
            # (phone, device_type, problem, service_charge, tech, days_ago)
            ("+919100000010", "iPhone 13",              "Screen cracked after drop",               3800, tech1, 55),
            ("+919100000011", "Samsung Galaxy S23",     "Battery not charging",                    1500, tech1, 50),
            ("+919100000012", "Realme C55",             "Screen flickering",                       1200, tech2, 48),
            ("+919100000013", "iPhone 14 Pro",          "Face ID not working after drop",          2500, tech1, 45),
            ("+919100000014", "Redmi Note 12",          "Speaker completely no sound",             900,  tech2, 42),
            ("+919100000015", "Samsung A33",            "Back glass shattered",                    1100, tech1, 40),
            ("+919100000016", "Oppo Reno 8",            "Touch screen unresponsive",               1600, tech2, 38),
            ("+919100000017", "iPhone 12",              "Charging port loose",                     1400, tech1, 35),
            ("+919100000018", "Vivo V27",               "Front camera blurry",                     1800, tech2, 32),
            ("+919100000019", "Realme GT Neo 3",        "Battery swollen — urgent",                2200, tech1, 30),
            ("+919100000020", "Samsung Galaxy A54",     "Overheating during calls",                1300, tech2, 28),
            ("+919100000021", "iPhone 15",              "Power button stuck",                      1600, tech1, 25),
            ("+919100000022", "Redmi Note 11",          "Water damage — not powering on",          2800, tech2, 22),
            ("+919100000023", "OnePlus Nord 3",         "SIM card not detected",                   1100, tech1, 20),
            ("+919100000024", "iPhone 14",              "Display lines after drop",                4200, tech1, 18),
            ("+919100000025", "Samsung S22",            "Fingerprint sensor not working",          1400, tech2, 15),
            ("+919100000026", "Tecno Phantom X2",       "Battery drain — 20% per hour",            1200, tech1, 12),
            ("+919100000027", "iPhone 13 Mini",         "Microphone not working on calls",         1500, tech2, 10),
            ("+919100000028", "Realme 10 Pro",          "Vibration motor broken",                  900,  tech1,  8),
            ("+919100000029", "Samsung Galaxy F34",     "Screen burn-in on AMOLED panel",          1800, tech2,  5),
        ]

        extra_closed = []
        for i, (phone, device, problem, sc, tech, days_ago) in enumerate(extra_job_specs):
            cust = crm.get(phone)
            if not cust:
                continue
            try:
                j = _make_and_close(shop_del, cust, device, problem, sc, tech, days_ago)
                if j and j.status == "closed":
                    extra_closed.append(j)
                    jobs[f"closed_{i + 2}"] = j
            except Exception as exc:
                self.stdout.write(self.style.WARNING(f"  ⚠ Extra job skipped ({device}): {exc}"))

        return jobs

    # ── billing ───────────────────────────────────────────────────────────────

    def _seed_billing(self, jobs, users):
        from billing import services as bill_svc
        from billing.models import RepairInvoice

        admin = users["admin"]

        def _invoice_and_pay(job, method="cash", partial=False, ref=""):
            if RepairInvoice.objects.filter(job=job).exists():
                return
            try:
                inv = bill_svc.create_repair_invoice(job, {
                    "discount_amount": "0",
                    "due_date": str(date.today()),
                }, admin)
                if partial:
                    advance = min(Decimal("1000"), inv.grand_total - 1)
                    bill_svc.record_payment(inv, {
                        "method": "upi",
                        "amount": str(advance),
                        "reference_id": ref or "UPI20260601001",
                    }, admin)
                else:
                    bill_svc.record_payment(inv, {
                        "method": method,
                        "amount": str(inv.grand_total),
                        "paid_at": timezone.now().isoformat(),
                    }, admin)
            except Exception:
                pass

        j4 = jobs.get("closed")
        if j4:
            _invoice_and_pay(j4, method="cash")

        j3 = jobs.get("ready_for_pickup")
        if j3 and j3.status == "ready_for_pickup":
            _invoice_and_pay(j3, partial=True)

        # Extra closed jobs — rotate payment methods
        methods = ["cash", "upi", "card", "neft", "cash", "upi", "card"]
        extra_keys = sorted(k for k in jobs if k.startswith("closed_"))
        for i, key in enumerate(extra_keys):
            job = jobs[key]
            if job is None:
                continue
            if i % 7 == 3:
                _invoice_and_pay(job, partial=True, ref=f"UPI2026EX{i:03d}")
            else:
                _invoice_and_pay(job, method=methods[i % len(methods)])

    # ── POS ───────────────────────────────────────────────────────────────────

    def _seed_pos(self, shop_del, crm, users, variants):
        from pos.models import Sale
        from pos import services as pos_svc

        admin       = users["admin"]
        cust_direct = crm["direct"]
        cust_biz    = crm["business"]
        v_usbc      = variants["usbc"]
        v_glass     = variants["glass"]
        v_charge    = variants["charger"]

        def _item(v, qty, price, hsn="85444290"):
            return {
                "variant_id": str(v.id),
                "product_name_snapshot": v.product.name,
                "variant_name_snapshot": v.variant_name,
                "hsn_code": hsn,
                "quantity": str(qty),
                "unit_price": str(price),
                "tax_rate": "18",
            }

        # Sale 1 — counter sale, cash
        if not Sale.objects.filter(shop=shop_del, sale_type="counter").exists():
            sale1 = pos_svc.create_sale(shop_del, {
                "sale_type": "counter",
                "customer": cust_direct,
                "items": [
                    _item(v_usbc,  2, v_usbc.selling_price),
                    _item(v_glass, 1, v_glass.selling_price, hsn="70099200"),
                ],
                "payments": [{"method": "cash", "amount": str(
                    2 * v_usbc.selling_price + v_glass.selling_price
                )}],
            }, admin)

            # Return 1 USB-C cable from sale1
            if sale1.status == "completed":
                ret = pos_svc.create_return(sale1, {
                    "reason": "Customer bought wrong length",
                    "items": [{"sale_item_id": str(sale1.items.filter(variant_id=v_usbc.id).first().id), "quantity": "1"}],
                }, admin)
                pos_svc.approve_return(ret, admin)

        # Sale 2 — wholesale, NEFT, business customer
        if not Sale.objects.filter(shop=shop_del, sale_type="wholesale").exists():
            # Wholesale uses the Mumbai customer but sold from Delhi shop
            # (inter-state IGST since customer GSTIN starts with 27)
            pos_svc.create_sale(shop_del, {
                "sale_type": "wholesale",
                "customer": cust_biz,
                "items": [
                    _item(v_charge, 10, v_charge.wholesale_price or v_charge.selling_price, hsn="85044090"),
                    _item(v_usbc,   20, v_usbc.wholesale_price   or v_usbc.selling_price),
                ],
                "payments": [{"method": "neft", "amount": str(
                    10 * (v_charge.wholesale_price or v_charge.selling_price) +
                    20 * (v_usbc.wholesale_price   or v_usbc.selling_price)
                ), "reference_id": "NEFT20260601WS"}],
            }, admin)

        # Sale 3 — job-linked (accessories for J3)
        from pos.models import Sale as POS_Sale
        from repair.models import JobTicket
        j3 = JobTicket.objects.filter(shop=shop_del, status="ready_for_pickup").first()
        if j3 and not POS_Sale.objects.filter(job_id=j3.id).exists():
            pos_svc.create_sale(shop_del, {
                "sale_type": "job_linked",
                "customer": j3.customer,
                "job_id": str(j3.id),
                "items": [_item(v_glass, 1, v_glass.selling_price, hsn="70099200")],
                "payments": [{"method": "cash", "amount": str(v_glass.selling_price)}],
            }, admin)

        # ── Extra counter sales ────────────────────────────────────────────
        def _get(sku):
            return variants.get(sku)

        v_ep01      = _get("ACC-EP01")
        v_pb10k     = _get("ACC-PB10K")
        v_lign      = _get("ACC-LIG1")
        v_usbc2     = _get("ACC-USBC2")
        v_wc        = _get("ACC-WC15")
        v_case_ip14 = _get("ACC-CASE-IP14")
        v_case_sa54 = _get("ACC-CASE-SA54")
        v_tg_ip14   = _get("ACC-TGIP14")
        v_tg_sa54   = _get("ACC-TGSA54")
        v_ca20      = _get("ACC-CA20W")
        v_mu1       = _get("ACC-MU1")
        v_scrkit    = _get("ACC-SCRKIT")

        extra_counter_specs = [
            # (phone, [(variant, qty, price), ...], payment_method)
            ("+919100000010", [(v_lign, 1, 399), (v_tg_ip14, 1, 249)],                   "cash"),
            ("+919100000011", [(v_case_sa54, 1, 199), (v_tg_sa54, 1, 219), (v_usbc2, 1, 349)], "upi"),
            ("+919100000012", [(v_ep01, 1, 299)],                                          "cash"),
            ("+919100000013", [(v_pb10k, 1, 1499), (v_ca20, 1, 699)],                     "card"),
            ("+919100000014", [(v_mu1, 2, 149)],                                           "cash"),
            ("+919100000015", [(v_wc, 1, 999), (v_lign, 1, 399)],                         "upi"),
            ("+919100000016", [(v_scrkit, 2, 99)],                                         "cash"),
            ("+919100000017", [(v_case_ip14, 1, 249), (v_tg_ip14, 1, 249)],               "upi"),
            ("+919100000018", [(v_pb10k, 1, 1499)],                                        "card"),
            ("+919100000019", [(v_usbc2, 2, 349), (v_mu1, 1, 149)],                       "cash"),
            ("+919100000020", [(v_ep01, 1, 299), (v_ca20, 1, 699)],                       "upi"),
            ("+919100000021", [(v_glass, 2, 149), (v_usbc, 1, 299)],                      "cash"),
        ]
        for phone, items_spec, pay_method in extra_counter_specs:
            cust = crm.get(phone)
            if not cust:
                continue
            if Sale.objects.filter(shop=shop_del, customer=cust, sale_type="counter").exists():
                continue
            valid = [(v, qty, price) for v, qty, price in items_spec if v is not None]
            if not valid:
                continue
            total = sum(Decimal(str(qty)) * Decimal(str(price)) for _, qty, price in valid)
            try:
                pos_svc.create_sale(shop_del, {
                    "sale_type": "counter",
                    "customer": cust,
                    "items": [_item(v, qty, price) for v, qty, price in valid],
                    "payments": [{"method": pay_method, "amount": str(total)}],
                }, admin)
            except Exception as exc:
                self.stdout.write(self.style.WARNING(f"  ⚠ POS sale skipped ({phone}): {exc}"))

        # Extra wholesale order — MobileZone India
        cust_mz = crm.get("+919100000031")
        if cust_mz and v_ca20 and v_usbc2 and v_lign:
            if not Sale.objects.filter(shop=shop_del, customer=cust_mz, sale_type="wholesale").exists():
                ws_total = (
                    20 * (v_ca20.wholesale_price or v_ca20.selling_price) +
                    30 * (v_usbc2.wholesale_price or v_usbc2.selling_price) +
                    15 * (v_lign.wholesale_price or v_lign.selling_price)
                )
                try:
                    pos_svc.create_sale(shop_del, {
                        "sale_type": "wholesale",
                        "customer": cust_mz,
                        "items": [
                            _item(v_ca20,  20, v_ca20.wholesale_price  or v_ca20.selling_price,  hsn="85044090"),
                            _item(v_usbc2, 30, v_usbc2.wholesale_price or v_usbc2.selling_price),
                            _item(v_lign,  15, v_lign.wholesale_price  or v_lign.selling_price),
                        ],
                        "payments": [{"method": "neft", "amount": str(ws_total), "reference_id": "NEFT20260610WS2"}],
                    }, admin)
                except Exception as exc:
                    self.stdout.write(self.style.WARNING(f"  ⚠ Wholesale sale skipped: {exc}"))

    # ── AMC ───────────────────────────────────────────────────────────────────

    def _seed_amc(self, shop_del, crm, users):
        from amc.models import AMCContract, AMCVisit
        from amc import services as amc_svc

        admin = users["admin"]
        tech1 = users["technician_1"]
        cust  = crm["direct"]

        today = date.today()
        end   = today + timedelta(days=45)   # expiring soon → triggers renewal alert

        if not AMCContract.objects.filter(shop=shop_del, customer=cust).exists():
            contract = amc_svc.create_contract(shop_del, cust, {
                "title": "Annual AC & Electronics Maintenance",
                "description": "Quarterly preventive maintenance for all electronics",
                "start_date": today - timedelta(days=320),
                "end_date": end,
                "value": Decimal("12000"),
                "payment_terms": "upfront",
                "visits_per_year": 4,
                "auto_renew": True,
                "renewal_reminder_days": 30,
                "assigned_technician_id": str(tech1.id),
                "location_address": "12, Nehru Place Market, New Delhi",
            }, admin)

            first_visit = AMCVisit.objects.filter(contract=contract).order_by("visit_number").first()
            if first_visit and first_visit.status == "scheduled":
                amc_svc.complete_visit(first_visit, {
                    "work_done": "Full cleaning, cable tightening, software update, dust removal from all units",
                    "parts_replaced": "None",
                    "next_visit_date": str(today + timedelta(days=90)),
                }, tech1)

        # ── Extra AMC contracts ────────────────────────────────────────────
        extra_amc = [
            # (phone, title, days_back_start, duration_days, value, visits_per_year)
            ("+919100000013", "Quarterly Laptop & Phone Maintenance",  180, 365, Decimal("8000"),  4),
            ("+919100000020", "Annual Electronics Full-Service Plan",   90, 365, Decimal("15000"), 4),
            ("+919100000024", "VIP Premium Electronics Coverage",       30, 365, Decimal("24000"), 12),
            ("+919100000015", "Annual AC + Electronics Combo",         400, 365, Decimal("10000"), 4),
            ("+919100000030", "Home Appliances Annual Maintenance",     60, 180, Decimal("6000"),  2),
        ]
        for phone, title, days_back_start, duration_days, value, vpy in extra_amc:
            cust_extra = crm.get(phone)
            if not cust_extra or AMCContract.objects.filter(shop=shop_del, customer=cust_extra).exists():
                continue
            start_dt = today - timedelta(days=days_back_start)
            end_dt   = start_dt + timedelta(days=duration_days)
            try:
                c_extra = amc_svc.create_contract(shop_del, cust_extra, {
                    "title": title,
                    "description": "Comprehensive maintenance and service coverage",
                    "start_date": start_dt,
                    "end_date": end_dt,
                    "value": value,
                    "payment_terms": "upfront",
                    "visits_per_year": vpy,
                    "auto_renew": True,
                    "renewal_reminder_days": 30,
                    "assigned_technician_id": str(tech1.id),
                    "location_address": cust_extra.city or "Delhi",
                }, admin)
                # Complete past visits for contracts started long ago
                if days_back_start >= 90:
                    for visit in AMCVisit.objects.filter(contract=c_extra).order_by("visit_number")[:2]:
                        if visit.status == "scheduled" and visit.scheduled_date < today:
                            try:
                                amc_svc.complete_visit(visit, {
                                    "work_done": "Routine preventive maintenance completed",
                                    "parts_replaced": "None",
                                    "next_visit_date": str(today + timedelta(days=90)),
                                }, tech1)
                            except Exception:
                                pass
            except Exception as exc:
                self.stdout.write(self.style.WARNING(f"  ⚠ AMC contract skipped ({phone}): {exc}"))

    # ── commissions payout ────────────────────────────────────────────────────

    def _seed_commission_payout(self, jobs, users):
        from commissions.models import TechnicianCommission
        from commissions import services as comm_svc

        admin = users["admin"]
        tech1 = users["technician_1"]

        today = date.today()
        period_start = date(today.year, today.month, 1)
        period_end   = today

        # Only create payout if tech1 has unpaid commissions
        unpaid = TechnicianCommission.objects.filter(technician=tech1, is_paid=False)
        if unpaid.exists():
            from commissions.models import CommissionPayout
            if not CommissionPayout.objects.filter(technician=tech1, period_start=period_start).exists():
                comm_svc.create_payout(tech1, period_start, period_end, admin)

    # ── HR ────────────────────────────────────────────────────────────────────

    def _seed_hr(self, shop_del, users):
        from hr.models import Employee, LeaveRequest
        from hr import services as hr_svc

        admin = users["admin"]
        tech1 = users["technician_1"]
        tech2 = users["technician_2"]
        recp  = users["receptionist"]
        bill  = users["billing_staff"]

        today = date.today()
        month, year = today.month, today.year

        emp_specs = [
            (tech1, "EMP-001", "Lead Technician",   "Service",  Decimal("22000"), Decimal("8800"), Decimal("3000")),
            (tech2, "EMP-002", "Technician",         "Service",  Decimal("18000"), Decimal("7200"), Decimal("2000")),
            (recp,  "EMP-003", "Receptionist",       "Front Desk", Decimal("15000"), Decimal("6000"), Decimal("1500")),
            (bill,  "EMP-004", "Billing Executive",  "Finance",  Decimal("16000"), Decimal("6400"), Decimal("1500")),
        ]

        employees = {}
        for user, code, desig, dept, basic, hra, other in emp_specs:
            gross = basic + hra + other
            emp, created = Employee.objects.get_or_create(
                employee_code=code,
                defaults={
                    "shop": shop_del,
                    "user": user,
                    "full_name": user.full_name,
                    "designation": desig,
                    "department": dept,
                    "date_of_joining": date(2025, 6, 1),
                    "employment_type": "full_time",
                    "basic_salary": basic,
                    "hra": hra,
                    "other_allowances": other,
                    "gross_salary": gross,
                },
            )
            employees[code] = emp

        # 30 days attendance for current month
        month_start = date(year, month, 1)
        import calendar
        days_in_month = calendar.monthrange(year, month)[1]

        records = []
        for emp in employees.values():
            for d in range(1, min(days_in_month, today.day) + 1):
                att_date = date(year, month, d)
                wd = att_date.weekday()
                if wd == 6:   # Sunday off
                    status = "absent"
                    check_in = check_out = None
                elif wd == 5 and random.random() < 0.3:  # ~30% Saturdays off
                    status = "absent"
                    check_in = check_out = None
                else:
                    status = "present"
                    check_in = time(9, random.randint(0, 30))
                    check_out = time(18, random.randint(0, 30))
                records.append({
                    "employee_id": str(emp.id),
                    "date": att_date,
                    "status": status,
                    "check_in": check_in,
                    "check_out": check_out,
                })

        hr_svc.bulk_mark_attendance(records)

        # Leave request for tech2 (pending)
        emp_tech2 = employees.get("EMP-002")
        if emp_tech2:
            LeaveRequest.objects.get_or_create(
                employee=emp_tech2,
                from_date=today + timedelta(days=5),
                defaults={
                    "to_date": today + timedelta(days=6),
                    "leave_type": "casual",
                    "days": Decimal("2"),
                    "reason": "Family function",
                    "status": "pending",
                },
            )

        # Salary slips: last 3 months for all employees
        from hr.models import SalarySlip
        for months_back in range(1, 4):
            sm = month - months_back
            sy = year
            if sm <= 0:
                sm += 12
                sy -= 1
            for emp_obj in employees.values():
                if not SalarySlip.objects.filter(employee=emp_obj, month=sm, year=sy).exists():
                    try:
                        hr_svc.generate_salary_slips(shop_del, sm, sy, [str(emp_obj.id)])
                    except Exception:
                        pass

        # ── Extra leave requests ───────────────────────────────────────────
        extra_leaves = [
            ("EMP-001", today - timedelta(days=20), today - timedelta(days=19), "sick",   Decimal("2"), "High fever — doctor advised rest",         "approved"),
            ("EMP-002", today + timedelta(days=10), today + timedelta(days=14), "casual", Decimal("5"), "Vacation — family trip to Shimla",          "pending"),
            ("EMP-003", today - timedelta(days=10), today - timedelta(days=10), "casual", Decimal("1"), "Personal bank work",                        "approved"),
            ("EMP-004", today - timedelta(days=5),  today - timedelta(days=5),  "sick",   Decimal("1"), "Doctor appointment — routine checkup",      "approved"),
        ]
        for emp_code, from_dt, to_dt, ltype, days_count, reason, status in extra_leaves:
            emp = employees.get(emp_code)
            if emp:
                LeaveRequest.objects.get_or_create(
                    employee=emp,
                    from_date=from_dt,
                    defaults={
                        "to_date": to_dt,
                        "leave_type": ltype,
                        "days": days_count,
                        "reason": reason,
                        "status": status,
                    },
                )

    # ── finance ───────────────────────────────────────────────────────────────

    def _seed_finance(self, shop_del, shop_mum, users):
        from finance.models import PettyCashAccount, BudgetHead, BudgetAllocation, ShopAsset
        from finance import services as fin_svc

        admin = users["admin"]
        today = date.today()
        month, year = today.month, today.year

        # ── Petty cash accounts ────────────────────────────────────────────
        pc_del, _ = PettyCashAccount.objects.get_or_create(
            shop=shop_del,
            defaults={"name": "Delhi Petty Cash", "current_balance": Decimal("0"), "low_balance_threshold": Decimal("500")},
        )
        pc_mum, _ = PettyCashAccount.objects.get_or_create(
            shop=shop_mum,
            defaults={"name": "Mumbai Petty Cash", "current_balance": Decimal("0"), "low_balance_threshold": Decimal("500")},
        )

        # Opening credit
        from finance.models import PettyCashTransaction
        if not PettyCashTransaction.objects.filter(account=pc_del).exists():
            fin_svc.record_petty_cash_txn(pc_del, {"txn_type": "credit", "amount": "5000", "category": "Opening", "description": "Opening balance", "date": today - timedelta(days=30)}, admin)
            txns = [
                ("debit", "350",  "Chai & Refreshments",    "Monthly chai expense for staff"),
                ("debit", "820",  "Stationery",             "A4 paper, pens, stapler refill"),
                ("debit", "450",  "Courier",                "Parts courier from supplier"),
                ("debit", "200",  "Cleaning",               "Weekly cleaning supplies"),
                ("credit","3000", "Replenishment",          "Cash replenishment from accounts"),
            ]
            for txn_type, amount, category, desc in txns:
                fin_svc.record_petty_cash_txn(pc_del, {
                    "txn_type": txn_type, "amount": amount,
                    "category": category, "description": desc,
                    "date": today - timedelta(days=random.randint(1, 25)),
                }, admin)

        if not PettyCashTransaction.objects.filter(account=pc_mum).exists():
            fin_svc.record_petty_cash_txn(pc_mum, {"txn_type": "credit", "amount": "3000", "category": "Opening", "description": "Opening balance", "date": today - timedelta(days=30)}, admin)

        # ── Budget heads + allocations ─────────────────────────────────────
        bh_rm, _ = BudgetHead.objects.get_or_create(shop=shop_del, name="Repairs & Maintenance", defaults={"category": "operational"})
        bh_mkt, _ = BudgetHead.objects.get_or_create(shop=shop_del, name="Marketing",             defaults={"category": "marketing"})
        bh_off, _ = BudgetHead.objects.get_or_create(shop=shop_del, name="Office Supplies",       defaults={"category": "operational"})

        # Set budgeted amounts
        for bh, budgeted in [(bh_rm, Decimal("10000")), (bh_mkt, Decimal("8000")), (bh_off, Decimal("3000"))]:
            BudgetAllocation.objects.update_or_create(
                head=bh, month=month, year=year,
                defaults={"budgeted_amount": budgeted},
            )

        # ── Expenses ───────────────────────────────────────────────────────
        from finance.models import Expense
        if not Expense.objects.filter(shop=shop_del).exists():
            expenses = [
                (bh_rm,  "6500",  "Electrical repairs",  "Rewiring for new workstation"),
                (bh_mkt, "12000", "Social media ads",    "Instagram/Facebook campaign for June — OVER BUDGET"),  # ₹12k vs ₹8k budget
                (bh_off, "1200",  "Stationery & print",  "Invoice booklets, pens, register"),
            ]
            for bh, amount, category, desc in expenses:
                fin_svc.create_expense(shop_del, {
                    "budget_head_id": str(bh.id),
                    "amount": amount,
                    "category": category,
                    "description": desc,
                    "date": today - timedelta(days=random.randint(1, 15)),
                }, admin)

        # ── Extra budget heads ─────────────────────────────────────────────
        bh_util,  _ = BudgetHead.objects.get_or_create(shop=shop_del, name="Utilities",          defaults={"category": "operational"})
        bh_rent,  _ = BudgetHead.objects.get_or_create(shop=shop_del, name="Rent & Premises",    defaults={"category": "operational"})
        bh_train, _ = BudgetHead.objects.get_or_create(shop=shop_del, name="Staff Training",     defaults={"category": "operational"})
        bh_equip, _ = BudgetHead.objects.get_or_create(shop=shop_del, name="Equipment & Tools",  defaults={"category": "capex"})
        bh_it,    _ = BudgetHead.objects.get_or_create(shop=shop_del, name="IT & Software",      defaults={"category": "operational"})

        for bh, budgeted in [
            (bh_util,  Decimal("5000")), (bh_rent, Decimal("30000")),
            (bh_train, Decimal("4000")), (bh_equip, Decimal("15000")),
            (bh_it,    Decimal("3000")),
        ]:
            BudgetAllocation.objects.update_or_create(
                head=bh, month=month, year=year,
                defaults={"budgeted_amount": budgeted},
            )

        # ── Extra expenses ─────────────────────────────────────────────────
        from finance.models import Expense
        if Expense.objects.filter(shop=shop_del).count() < 15:
            extra_expenses = [
                (bh_util,  "4200",  "Electricity bill",      "June electricity bill for SDEL showroom",          today - timedelta(days=2)),
                (bh_rent,  "25000", "Shop rent",             "Monthly rent payment — Delhi showroom",             today - timedelta(days=5)),
                (bh_rm,    "3200",  "Generator service",     "Annual AMC for backup generator",                   today - timedelta(days=8)),
                (bh_mkt,   "5500",  "Flex banners",          "New service offering banners installed",            today - timedelta(days=12)),
                (bh_off,   "800",   "Printer cartridge",     "Canon ink cartridge for invoice printer",           today - timedelta(days=14)),
                (bh_equip, "12000", "Soldering station",     "Hakko FX-888D for micro-soldering repairs",         today - timedelta(days=18)),
                (bh_it,    "2400",  "Domain & hosting",      "Annual domain renewal and hosting plan",            today - timedelta(days=20)),
                (bh_util,  "1200",  "Water & housekeeping",  "Water bill + monthly cleaning contract",            today - timedelta(days=22)),
                (bh_train, "3500",  "Training workshop",     "Staff mobile repair diagnosis training",            today - timedelta(days=25)),
                (bh_mkt,   "2000",  "Print collateral",      "Visiting cards + promotional leaflets",             today - timedelta(days=28)),
                (bh_rm,    "1500",  "AC gas refill",         "Refrigerant refill for waiting area AC unit",       today - timedelta(days=30)),
                (bh_off,   "600",   "Office consumables",    "Stapler pins, rubber bands, folders",               today - timedelta(days=35)),
                (bh_equip, "2500",  "Oscilloscope probe",    "Replacement probe for test bench equipment",        today - timedelta(days=40)),
                (bh_it,    "599",   "Software subscription", "Monthly antivirus + remote monitoring subscription",today - timedelta(days=45)),
                (bh_mkt,   "1800",  "Google Ads",            "Search ads for mobile repair — Delhi targeting",    today - timedelta(days=48)),
            ]
            for bh, amount, category, desc, exp_date in extra_expenses:
                try:
                    fin_svc.create_expense(shop_del, {
                        "budget_head_id": str(bh.id),
                        "amount": amount,
                        "category": category,
                        "description": desc,
                        "date": exp_date,
                    }, admin)
                except Exception:
                    pass

        # ── Extra petty cash transactions ──────────────────────────────────
        from finance.models import PettyCashTransaction
        if PettyCashTransaction.objects.filter(account=pc_del).count() < 12:
            extra_pc = [
                ("debit",  "180",  "Food & Beverages",    "Lunch for technicians during overtime"),
                ("debit",  "420",  "Courier",             "Express courier — spare parts from supplier"),
                ("debit",  "250",  "Cleaning",            "Cleaning supplies — mop, phenyl, duster"),
                ("credit", "2000", "Replenishment",       "Cash replenishment from accounts"),
                ("debit",  "150",  "Printing",            "Customer receipt roll paper"),
                ("debit",  "320",  "Stationery",          "Register notebook and pens"),
                ("debit",  "500",  "Repairs & Maintenance","Workbench screw kit and cable ties"),
                ("debit",  "380",  "Courier",             "Return courier for rejected batteries"),
                ("credit", "1500", "Replenishment",       "Additional petty cash from accounts"),
                ("debit",  "200",  "Food & Beverages",    "Staff chai and snacks"),
            ]
            for txn_type, amount, category, desc in extra_pc:
                try:
                    fin_svc.record_petty_cash_txn(pc_del, {
                        "txn_type": txn_type, "amount": amount,
                        "category": category, "description": desc,
                        "date": today - timedelta(days=random.randint(1, 50)),
                    }, admin)
                except Exception:
                    pass

        # ── Assets ────────────────────────────────────────────────────────
        asset_specs = [
            ("Dell Inspiron Laptop (Service Desk)", "IT Equipment",       "SDEL-IT-001",
             date(2025, 3, 15), Decimal("55000"), None,              "good", "Front desk — service management PC"),
            ("Daikin 1.5T Split AC",                "Electrical Equipment","SDEL-EL-001",
             date(2024, 5, 10), Decimal("38000"), date(2029, 5, 10), "good", "Customer waiting area"),
            ("Hakko FX-888D Soldering Station",      "Workshop Tools",     "SDEL-WS-001",
             date(2026, 6, 1),  Decimal("12000"), None,              "good", "Service workbench — soldering & micro-repairs"),
            ("Canon PIXMA G3010 Printer",            "IT Equipment",       "SDEL-IT-002",
             date(2025, 8, 20), Decimal("8500"),  date(2028, 8, 20), "good", "Invoice and document printer"),
            ("Accessory Display Shelving Unit",      "Fixtures",           "SDEL-FX-001",
             date(2024, 11, 1), Decimal("15000"), None,              "good", "Front counter accessory display stand"),
            ("Security Camera System (4-cam)",       "Security",           "SDEL-SC-001",
             date(2025, 1, 15), Decimal("22000"), None,              "good", "CCTV covering shop front, counter, workshop"),
        ]
        for name, cat, code, pdate, cost, warranty, condition, loc in asset_specs:
            if not ShopAsset.objects.filter(asset_code=code).exists():
                ShopAsset.objects.create(
                    shop=shop_del, name=name, category=cat, asset_code=code,
                    purchase_date=pdate, purchase_cost=cost,
                    warranty_expiry=warranty, condition=condition,
                    location_description=loc, is_active=True,
                )

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
