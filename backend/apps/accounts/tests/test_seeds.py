"""accounts › Chart-of-Accounts reference seeder."""
import pytest

from core.seeding import SeedContext


@pytest.fixture
def shop(db):
    from core.models import Shop
    return Shop.objects.create(
        name="Ref Shop", code="REF", address="MG Road", city="Delhi",
        state="Delhi", state_code="07", phone="+919876543299",
    )


@pytest.mark.django_db
def test_chart_seeded_per_shop_and_idempotent(shop):
    from accounts.models import Account, AccountMapping
    from accounts.seeds import ChartOfAccountsSeeder

    seeder = ChartOfAccountsSeeder()
    seeder.run(SeedContext(shops=[shop]))
    assert Account.objects.filter(shop=shop).count() == 17
    assert AccountMapping.objects.filter(shop=shop).count() == 9

    seeder.run(SeedContext(shops=[shop]))  # existing seed helpers are no-op safe
    assert Account.objects.filter(shop=shop).count() == 17


@pytest.mark.django_db
def test_chart_seeder_no_shops_is_noop(db):
    from accounts.seeds import ChartOfAccountsSeeder
    ChartOfAccountsSeeder().run(SeedContext())  # must not raise
