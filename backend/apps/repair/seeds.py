"""Demo seed: job tickets in every lifecycle state + historical closed jobs."""
import logging
from datetime import date, timedelta
from decimal import Decimal

from django.utils import timezone

from core.seeding import SeedContext, Seeder, register

logger = logging.getLogger(__name__)

# (phone, device_type) natural keys of the extra closed jobs run() creates —
# order matters: index i maps to ctx["jobs"][f"closed_{i + 2}"].
EXTRA_JOB_LOOKUP = [
    ("+919100000010", "iPhone 13"), ("+919100000011", "Samsung Galaxy S23"),
    ("+919100000012", "Realme C55"), ("+919100000013", "iPhone 14 Pro"),
    ("+919100000014", "Redmi Note 12"), ("+919100000015", "Samsung A33"),
    ("+919100000016", "Oppo Reno 8"), ("+919100000017", "iPhone 12"),
    ("+919100000018", "Vivo V27"), ("+919100000019", "Realme GT Neo 3"),
    ("+919100000020", "Samsung Galaxy A54"), ("+919100000021", "iPhone 15"),
    ("+919100000022", "Redmi Note 11"), ("+919100000023", "OnePlus Nord 3"),
    ("+919100000024", "iPhone 14"), ("+919100000025", "Samsung S22"),
    ("+919100000026", "Tecno Phantom X2"), ("+919100000027", "iPhone 13 Mini"),
    ("+919100000028", "Realme 10 Pro"), ("+919100000029", "Samsung Galaxy F34"),
]


class RepairDemoSeeder(Seeder):
    name = "repair.demo"
    scope = "demo"
    depends_on = ("crm.demo", "inventory.demo", "commissions.demo_rules")

    def run(self, ctx: SeedContext) -> None:
        shop_del, shop_mum = ctx["shop_del"], ctx["shop_mum"]
        crm, users, variants = ctx["crm"], ctx["users"], ctx["variants"]
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
            rep_svc.request_spare_part(j2.shop, {
                "variant_id": str(v_sa54.id),
                "quantity": 1,
                "is_urgent": False,
            }, tech1, job=j2)

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
                logger.warning("Extra job skipped (%s): %s", device, exc)


        ctx["jobs"] = jobs

    def load(self, ctx: SeedContext) -> None:
        """Re-fetch using the same status/customer/device natural keys as run()."""
        from repair.models import JobTicket

        shop_del, crm = ctx["shop_del"], ctx["crm"]
        jobs = {
            "open": JobTicket.objects.filter(
                shop=shop_del, status="open", customer=crm["direct"]).first(),
            "in_progress": JobTicket.objects.filter(
                shop=shop_del, status="in_progress").first(),
            "ready_for_pickup": JobTicket.objects.filter(
                shop=shop_del, status="ready_for_pickup").first(),
            "closed": JobTicket.objects.filter(
                shop=shop_del, customer=crm["rahul"], device_type="iPhone").first(),
            "on_hold": JobTicket.objects.filter(shop=shop_del, status="on_hold").first(),
            "cancelled": JobTicket.objects.filter(shop=shop_del, status="cancelled").first(),
        }
        jobs["warranty"] = jobs["closed"].warranty_jobs.first() if jobs["closed"] else None
        for i, (phone, device) in enumerate(EXTRA_JOB_LOOKUP):
            customer = crm.get(phone)
            if not customer:
                continue
            job = JobTicket.objects.filter(
                shop=shop_del, customer=customer, device_type=device, status="closed"
            ).first()
            if job:
                jobs[f"closed_{i + 2}"] = job
        ctx["jobs"] = jobs


register(RepairDemoSeeder)
