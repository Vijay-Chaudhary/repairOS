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
