"""Demo seed: AMC contracts (one expiring soon → renewal alert) and visits."""
import logging
from datetime import date, timedelta
from decimal import Decimal

from core.seeding import SeedContext, Seeder, register

logger = logging.getLogger(__name__)


class AmcDemoSeeder(Seeder):
    name = "amc.demo"
    scope = "demo"
    depends_on = ("crm.demo",)

    def run(self, ctx: SeedContext) -> None:
        shop_del, crm, users = ctx["shop_del"], ctx["crm"], ctx["users"]
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
                logger.warning("AMC contract skipped (%s): %s", phone, exc)


register(AmcDemoSeeder)
