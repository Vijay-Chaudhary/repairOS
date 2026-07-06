"""billing › GST tax-rate reference seeder (Indian market baseline)."""
import pytest

from core.seeding import SeedContext


@pytest.mark.django_db
def test_gst_slabs_seeded_and_idempotent():
    from billing.models import TaxRate
    from billing.seeds import GstTaxRateSeeder

    seeder = GstTaxRateSeeder()
    seeder.run(SeedContext())
    names = set(TaxRate.objects.values_list("name", flat=True))
    assert {"GST 0%", "GST 5%", "GST 12%", "GST 18%", "GST 28%"} <= names
    count = TaxRate.objects.count()

    seeder.run(SeedContext())  # upsert: no duplicates
    assert TaxRate.objects.count() == count
