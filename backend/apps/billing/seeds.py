"""Reference seed: Indian GST slab tax rates (heals tenants missing any slab)."""
from core.seeding import SeedContext, Seeder, register

GST_SLABS = [("GST 0%", "0"), ("GST 5%", "5"), ("GST 12%", "12"),
             ("GST 18%", "18"), ("GST 28%", "28")]


class GstTaxRateSeeder(Seeder):
    name = "billing.gst_tax_rates"
    scope = "reference"

    def run(self, ctx: SeedContext) -> None:
        from billing.models import TaxRate

        for slab_name, rate in GST_SLABS:
            TaxRate.objects.get_or_create(
                name=slab_name, defaults={"rate": rate, "tax_type": "gst"}
            )


register(GstTaxRateSeeder)


class BillingDemoSeeder(Seeder):
    name = "billing.demo"
    scope = "demo"
    depends_on = ("repair.demo",)

    def run(self, ctx: SeedContext) -> None:
        from datetime import date
        from decimal import Decimal

        from django.utils import timezone

        jobs, users = ctx["jobs"], ctx["users"]
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


register(BillingDemoSeeder)
