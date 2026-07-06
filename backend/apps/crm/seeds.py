"""Demo seed: CRM customers/leads/segments (Indian names, +91 phones)."""
from datetime import date, timedelta
from decimal import Decimal

from django.utils import timezone

from core.seeding import SeedContext, Seeder, register

# Phone literals of the extra customers created in run() (ctx["crm"] keys).
EXTRA_CUSTOMER_PHONES = [f"+9191000000{n:02d}" for n in range(10, 33)]


class CrmDemoSeeder(Seeder):
    name = "crm.demo"
    scope = "demo"
    depends_on = ("authentication.demo_users",)

    def run(self, ctx: SeedContext) -> None:
        users, shop_del, shop_mum = ctx["users"], ctx["shop_del"], ctx["shop_mum"]
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


        ctx["crm"] = {
            "rahul":    cust_rahul,
            "direct":   cust_direct,
            "business": cust_business,
            **extra_customers,
        }

    def load(self, ctx: SeedContext) -> None:
        """Re-fetch by the same phone-number natural keys run() creates with."""
        from crm.models import Customer

        crm = {
            "rahul": Customer.objects.filter(phone="+919200000005").first(),
            "direct": Customer.objects.filter(phone="+919100000001").first(),
            "business": Customer.objects.filter(phone="+919100000002").first(),
        }
        for customer in Customer.objects.filter(phone__in=EXTRA_CUSTOMER_PHONES):
            crm[customer.phone] = customer
        ctx["crm"] = crm


register(CrmDemoSeeder)
