import pytest


@pytest.mark.django_db
def test_contact_belongs_to_customer():
    from core.models import Shop
    from crm.models import Customer, Contact
    shop = Shop.objects.create(name="S", code="HTA", address="a", city="Delhi",
                               state="Delhi", state_code="07", phone="+919876543210")
    cust = Customer.objects.create(shop=shop, name="Acme", phone="+919811111111")
    c = Contact.objects.create(shop=shop, customer=cust, name="Asha", designation="Owner",
                               email="a@acme.com", phone="+919822222222")
    assert c.is_primary is False
    assert cust.contacts.count() == 1
    assert str(c)
