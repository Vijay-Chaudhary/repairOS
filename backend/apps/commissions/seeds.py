"""Demo seed: commission rules (must precede job closures) and month payout."""
from datetime import date
from decimal import Decimal

from core.seeding import SeedContext, Seeder, register


class CommissionRulesDemoSeeder(Seeder):
    name = "commissions.demo_rules"
    scope = "demo"

    def run(self, ctx: SeedContext) -> None:
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


class CommissionPayoutDemoSeeder(Seeder):
    name = "commissions.demo_payout"
    scope = "demo"
    depends_on = ("billing.demo",)

    def run(self, ctx: SeedContext) -> None:
        users = ctx["users"]
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


register(CommissionRulesDemoSeeder)
register(CommissionPayoutDemoSeeder)
