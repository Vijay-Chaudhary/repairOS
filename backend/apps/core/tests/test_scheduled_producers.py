import uuid
from decimal import Decimal

import pytest


@pytest.fixture
def shop(db):
    from core.models import Shop
    return Shop.objects.create(name="S", code="HTA", address="a", city="Delhi",
                               state="Delhi", state_code="07", phone="+919876543210")


def _mgr(codename, shop):
    from authentication.models import Permission, Role, RolePermission, User, UserRole
    u = User.objects.create_user(email=f"{uuid.uuid4().hex[:6]}@t.com",
                                 phone=f"+9190{uuid.uuid4().int % 100000000:08d}", full_name="M", password="p")
    role = Role.objects.create(name=f"R-{uuid.uuid4().hex[:4]}")
    perm, _ = Permission.objects.get_or_create(codename=codename, defaults={"label": codename})
    RolePermission.objects.create(role=role, permission=perm)
    UserRole.objects.create(user=u, role=role, shop=shop)
    return u


def _low_stock_row(shop):
    from inventory.models import InventoryStock, Product, ProductVariant
    product = Product.objects.create(name=f"P-{uuid.uuid4().hex[:6]}", sku=uuid.uuid4().hex[:10])
    variant = ProductVariant.objects.create(product=product, variant_name="Default")
    InventoryStock.objects.create(shop=shop, variant=variant,
                                  quantity_in_stock=Decimal("0"), reorder_level=Decimal("5"))


@pytest.mark.django_db
def test_low_stock_scan_notifies_managers_idempotently(shop):
    from core.tasks import _scan_low_stock_for_db
    from core.models import Notification
    _low_stock_row(shop)
    mgr = _mgr("erp.inventory.view", shop)

    _scan_low_stock_for_db()
    _scan_low_stock_for_db()  # second run must not duplicate
    assert Notification.objects.filter(recipient=mgr, type="low_stock").count() == 1


@pytest.mark.django_db
def test_amc_renewal_scan_notifies_and_dedups(shop):
    from datetime import date, timedelta
    from amc.models import AMCContract
    from core.tasks import _scan_amc_renewals_for_db
    from core.models import Notification
    from crm.models import Customer

    cust = Customer.objects.create(shop=shop, name="C", phone="+919811111111")
    creator = _mgr("amc.contracts.view", shop)  # also serves as created_by
    AMCContract.objects.create(
        shop=shop, customer=cust, contract_number=f"AMC-{uuid.uuid4().hex[:6]}",
        title="Annual Maintenance", value=Decimal("12000"),
        payment_terms=AMCContract.PaymentTerms.UPFRONT, created_by=creator,
        start_date=date.today() - timedelta(days=300),
        end_date=date.today() + timedelta(days=10),  # within default 30-day window
        status=AMCContract.Status.ACTIVE,
    )
    mgr = _mgr("amc.contracts.view", shop)

    _scan_amc_renewals_for_db()
    _scan_amc_renewals_for_db()
    assert Notification.objects.filter(recipient=mgr, type="amc_renewal_due").count() == 1
