import pytest
from decimal import Decimal


@pytest.mark.django_db
def test_deal_defaults():
    from core.models import Shop
    from crm.models import Deal
    shop = Shop.objects.create(name="S", code="HTA", address="a", city="Delhi",
                               state="Delhi", state_code="07", phone="+919876543210")
    d = Deal.objects.create(shop=shop, title="Acme upgrade", expected_revenue=Decimal("50000"), probability=40)
    assert d.stage == Deal.Stage.QUALIFICATION
    assert d.customer_id is None        # customer optional
    assert d.closed_at is None
    assert str(d)
