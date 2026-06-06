"""
POS tests — §10 acceptance criteria + §11 test cases.

Covers:
- Counter sale: happy path, tax calculation, stock deduct stub
- Wholesale sale: credit limit enforcement, GSTIN inter-state
- Job-linked sale: requires job_id
- Payment recording and status transitions (draft→partially_paid→completed)
- Razorpay idempotency (no double-count)
- Return flow: create→approve (credit note issued, sale→returned)
- Return rejection
- RBAC: billing.sales_invoices.view required for GET
"""

import pytest
from decimal import Decimal
from rest_framework import status


# ──────────────────────────────────────────────────────────────────────────────
# Shared fixtures
# ──────────────────────────────────────────────────────────────────────────────


@pytest.fixture
def shop(db):
    from core.models import Shop
    return Shop.objects.create(
        name="Joy Computer", code="JOY",
        address="MG Rd", city="Delhi",
        state="UP", state_code="09", phone="+919876543210",
    )


@pytest.fixture
def customer(db, shop):
    from crm.models import Customer
    return Customer.objects.create(
        shop=shop, name="Ravi Kumar", phone="+919811100001",
        customer_type="individual", credit_limit=Decimal("10000"),
    )


@pytest.fixture
def wholesale_customer(db, shop):
    from crm.models import Customer
    return Customer.objects.create(
        shop=shop, name="B2B Corp", phone="+919811100002",
        customer_type="business",
        gstin="09AAAAA0000A1Z5",  # state_code = 09 (same as shop)
        credit_limit=Decimal("50000"),
    )


@pytest.fixture
def admin_user(db):
    from authentication.models import Permission, Role, RolePermission, User, UserRole

    user = User.objects.create_user(
        email="admin@pos.test",
        phone="+919000000020",
        full_name="POS Admin",
        password="AdminPass@1",
    )
    role, _ = Role.objects.get_or_create(name="Billing Staff", defaults={"is_system_role": True})
    perms = [
        "pos.counter_sale.create", "pos.wholesale_sale.create",
        "pos.job_sale.create", "pos.discount.apply",
        "pos.returns.create", "pos.returns.approve",
        "billing.sales_invoices.view", "billing.payments.record",
    ]
    for codename in perms:
        module = codename.split(".")[0]
        perm, _ = Permission.objects.get_or_create(
            codename=codename, defaults={"module": module, "label": codename}
        )
        RolePermission.objects.get_or_create(role=role, permission=perm)
    UserRole.objects.create(user=user, role=role, shop=None)
    return user


@pytest.fixture
def admin_client(api_client, admin_user):
    from authentication.tokens import _build_token_claims
    from rest_framework_simplejwt.tokens import RefreshToken

    refresh = RefreshToken.for_user(admin_user)
    access = refresh.access_token
    for k, v in _build_token_claims(admin_user, "test").items():
        access[k] = v
    api_client.credentials(HTTP_AUTHORIZATION=f"Bearer {str(access)}")
    return api_client


def _item(name="USB Cable", qty=2, price="250.00", tax_rate="18.00", disc=0):
    return {
        "product_name_snapshot": name,
        "quantity": str(qty),
        "unit_price": str(price),
        "discount_per_unit": str(disc),
        "tax_rate": str(tax_rate),
    }


def _payment(amount, method="upi", reference_id="REF001"):
    return {"amount": str(amount), "method": method, "reference_id": reference_id}


# ──────────────────────────────────────────────────────────────────────────────
# Counter sale
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.django_db
class TestCounterSale:
    url = "/api/v1/pos/sales/"

    def test_counter_sale_guest_no_customer(self, admin_client, shop):
        res = admin_client.post(self.url, {
            "shop_id": str(shop.id),
            "sale_type": "counter",
            "items": [_item()],
            "payments": [_payment(590)],  # 2*250 = 500, 18% = 90, total = 590
        }, format="json")
        assert res.status_code == status.HTTP_201_CREATED
        data = res.data
        assert data["status"] == "completed"
        assert "sale_number" in data
        assert data["sale_number"].startswith("JOY-SALE-")

    def test_counter_sale_sale_number_format(self, admin_client, shop):
        import datetime
        res = admin_client.post(self.url, {
            "shop_id": str(shop.id),
            "sale_type": "counter",
            "items": [_item()],
            "payments": [_payment(590)],
        }, format="json")
        year = datetime.date.today().year
        month = datetime.date.today().month
        assert f"JOY-SALE-{year}-{month:02d}-" in res.data["sale_number"]

    def test_grand_total_calculation(self, admin_client, shop):
        # 2 * 250 = 500 subtotal, 18% tax = 90, total = 590
        res = admin_client.post(self.url, {
            "shop_id": str(shop.id),
            "sale_type": "counter",
            "items": [_item(qty=2, price="250.00", tax_rate="18.00")],
            "payments": [_payment(590)],
        }, format="json")
        assert res.status_code == status.HTTP_201_CREATED
        assert res.data["grand_total"] == "590.00"

    def test_flat_discount_reduces_total(self, admin_client, shop):
        # subtotal = 500, discount = 50, taxable = 450, tax 18% = 81, total = 531
        res = admin_client.post(self.url, {
            "shop_id": str(shop.id),
            "sale_type": "counter",
            "items": [_item(qty=2, price="250.00", tax_rate="18.00")],
            "discount_type": "flat",
            "discount_value": "50.00",
            "payments": [_payment(531)],
        }, format="json")
        assert res.status_code == status.HTTP_201_CREATED
        assert res.data["grand_total"] == "531.00"

    def test_partially_paid_status(self, admin_client, shop):
        res = admin_client.post(self.url, {
            "shop_id": str(shop.id),
            "sale_type": "counter",
            "items": [_item()],
            "payments": [_payment(200)],  # less than 590
        }, format="json")
        assert res.status_code == status.HTTP_201_CREATED
        assert res.data["status"] == "partially_paid"

    def test_no_payment_leaves_draft(self, admin_client, shop):
        res = admin_client.post(self.url, {
            "shop_id": str(shop.id),
            "sale_type": "counter",
            "items": [_item()],
        }, format="json")
        assert res.status_code == status.HTTP_201_CREATED
        assert res.data["status"] == "draft"

    def test_no_items_returns_400(self, admin_client, shop):
        res = admin_client.post(self.url, {
            "shop_id": str(shop.id),
            "sale_type": "counter",
            "items": [],
        }, format="json")
        assert res.status_code == status.HTTP_400_BAD_REQUEST

    def test_requires_auth(self, api_client, shop):
        res = api_client.post(self.url, {}, format="json")
        assert res.status_code == status.HTTP_401_UNAUTHORIZED


# ──────────────────────────────────────────────────────────────────────────────
# Intra / inter-state GST
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.django_db
class TestGSTSplit:
    url = "/api/v1/pos/sales/"

    def test_intra_state_cgst_sgst(self, admin_client, shop, wholesale_customer):
        # wholesale_customer has gstin with state_code=09 (same as shop)
        res = admin_client.post(self.url, {
            "shop_id": str(shop.id),
            "sale_type": "wholesale",
            "customer_id": str(wholesale_customer.id),
            "items": [_item(qty=1, price="1000.00", tax_rate="18.00")],
            "payments": [_payment(1180)],
        }, format="json")
        assert res.status_code == status.HTTP_201_CREATED

        from pos.models import Sale
        sale = Sale.objects.get(pk=res.data["id"])
        assert sale.cgst > 0
        assert sale.sgst > 0
        assert sale.igst == Decimal("0")

    def test_inter_state_igst(self, admin_client, shop):
        from crm.models import Customer
        # Customer from different state (Maharashtra = 27)
        interstate_customer = Customer.objects.create(
            shop=shop, name="Mumbai Corp", phone="+919811100099",
            customer_type="business",
            gstin="27AAAAA0000A1Z5",  # state_code = 27 ≠ shop 09
            credit_limit=Decimal("100000"),
        )
        res = admin_client.post(self.url, {
            "shop_id": str(shop.id),
            "sale_type": "wholesale",
            "customer_id": str(interstate_customer.id),
            "items": [_item(qty=1, price="1000.00", tax_rate="18.00")],
            "payments": [_payment(1180)],
        }, format="json")
        assert res.status_code == status.HTTP_201_CREATED

        from pos.models import Sale
        sale = Sale.objects.get(pk=res.data["id"])
        assert sale.igst > 0
        assert sale.cgst == Decimal("0")
        assert sale.sgst == Decimal("0")


# ──────────────────────────────────────────────────────────────────────────────
# Wholesale credit limit
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.django_db
class TestCreditLimit:
    url = "/api/v1/pos/sales/"

    def test_wholesale_within_credit_limit(self, admin_client, shop, wholesale_customer):
        # No payment upfront — draft status. Credit limit check happens at sale creation.
        res = admin_client.post(self.url, {
            "shop_id": str(shop.id),
            "sale_type": "wholesale",
            "customer_id": str(wholesale_customer.id),
            "items": [_item(qty=1, price="5000.00", tax_rate="0.00")],
        }, format="json")
        assert res.status_code == status.HTTP_201_CREATED

    def test_wholesale_exceeds_credit_limit_returns_422(self, admin_client, shop):
        from crm.models import Customer
        limited_customer = Customer.objects.create(
            shop=shop, name="Low Credit", phone="+919811100003",
            customer_type="business", gstin="09AAAAB0000B1Z5",
            credit_limit=Decimal("100"),
        )
        res = admin_client.post(self.url, {
            "shop_id": str(shop.id),
            "sale_type": "wholesale",
            "customer_id": str(limited_customer.id),
            "items": [_item(qty=1, price="500.00", tax_rate="0.00")],
        }, format="json")
        assert res.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY

    def test_wholesale_requires_customer(self, admin_client, shop):
        res = admin_client.post(self.url, {
            "shop_id": str(shop.id),
            "sale_type": "wholesale",
            "items": [_item()],
        }, format="json")
        assert res.status_code == status.HTTP_400_BAD_REQUEST


# ──────────────────────────────────────────────────────────────────────────────
# Payment recording
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.django_db
class TestPayments:
    url = "/api/v1/pos/sales/"

    def _create_draft_sale(self, admin_client, shop):
        res = admin_client.post(self.url, {
            "shop_id": str(shop.id),
            "sale_type": "counter",
            "items": [_item()],
        }, format="json")
        return res.data["id"]

    def test_add_payment_completes_sale(self, admin_client, shop):
        sale_id = self._create_draft_sale(admin_client, shop)
        res = admin_client.post(
            f"{self.url}{sale_id}/payment/",
            _payment(590),  # full amount
            format="json",
        )
        assert res.status_code == status.HTTP_200_OK
        assert res.data["status"] == "completed"

    def test_partial_payment_leaves_partially_paid(self, admin_client, shop):
        sale_id = self._create_draft_sale(admin_client, shop)
        res = admin_client.post(
            f"{self.url}{sale_id}/payment/",
            _payment(300),
            format="json",
        )
        assert res.status_code == status.HTTP_200_OK
        assert res.data["status"] == "partially_paid"

    def test_razorpay_idempotency_no_double_count(self, admin_client, shop, admin_user):
        from pos.services import create_sale

        sale = create_sale(
            shop,
            {
                "sale_type": "counter",
                "items": [{"product_name_snapshot": "Cable", "quantity": "1",
                            "unit_price": "500", "tax_rate": "0"}],
                "payments": [],
            },
            admin_user,
        )
        pay_data = {"amount": "500", "method": "upi", "razorpay_payment_id": "pay_test_001"}

        # First payment
        res1 = admin_client.post(f"{self.url}{sale.id}/payment/", pay_data, format="json")
        assert res1.status_code == status.HTTP_200_OK

        # Duplicate Razorpay payment id — should be silently ignored
        res2 = admin_client.post(f"{self.url}{sale.id}/payment/", pay_data, format="json")
        assert res2.status_code == status.HTTP_200_OK  # no error, idempotent

        # Payment count should still be 1
        sale.refresh_from_db()
        assert sale.payments.count() == 1


# ──────────────────────────────────────────────────────────────────────────────
# Returns and credit notes
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.django_db
class TestReturns:
    url = "/api/v1/pos/sales/"
    returns_url = "/api/v1/pos/sales/returns/"

    def _make_completed_sale(self, admin_client, shop):
        res = admin_client.post(self.url, {
            "shop_id": str(shop.id),
            "sale_type": "counter",
            "items": [_item()],
            "payments": [_payment(590)],
        }, format="json")
        return res.data["id"]

    def test_create_return(self, admin_client, shop):
        sale_id = self._make_completed_sale(admin_client, shop)
        res = admin_client.post(
            f"{self.url}{sale_id}/return/",
            {"reason": "Customer dissatisfied", "total_refund_amount": "590.00", "refund_method": "cash"},
            format="json",
        )
        assert res.status_code == status.HTTP_201_CREATED
        assert res.data["status"] == "pending"
        assert res.data["return_number"].startswith("JOY-RET-")

    def test_approve_return_issues_credit_note(self, admin_client, shop, admin_user):
        from pos.services import create_sale, create_return

        sale = create_sale(
            shop,
            {
                "sale_type": "counter",
                "items": [{"product_name_snapshot": "USB Cable", "quantity": "1",
                            "unit_price": "500", "tax_rate": "0"}],
                "payments": [{"amount": "500", "method": "cash"}],
            },
            admin_user,
        )
        ret = create_return(
            sale,
            {"reason": "Defective item", "total_refund_amount": "500.00", "refund_method": "cash"},
            admin_user,
        )

        res = admin_client.patch(
            f"{self.returns_url}{ret.id}/",
            {"action": "approve"},
            format="json",
        )
        assert res.status_code == status.HTTP_200_OK
        assert res.data["status"] == "approved"
        assert res.data["credit_note_number"].startswith("JOY-CN-")

        sale.refresh_from_db()
        assert sale.status == "returned"

    def test_reject_return(self, admin_client, shop, admin_user):
        from pos.services import create_sale, create_return

        sale = create_sale(
            shop,
            {
                "sale_type": "counter",
                "items": [{"product_name_snapshot": "USB Cable", "quantity": "1",
                            "unit_price": "500", "tax_rate": "0"}],
                "payments": [{"amount": "500", "method": "cash"}],
            },
            admin_user,
        )
        ret = create_return(
            sale,
            {"reason": "Defective item", "total_refund_amount": "500.00", "refund_method": "cash"},
            admin_user,
        )

        res = admin_client.patch(
            f"{self.returns_url}{ret.id}/",
            {"action": "reject"},
            format="json",
        )
        assert res.status_code == status.HTTP_200_OK
        assert res.data["status"] == "rejected"

    def test_cannot_return_cancelled_sale(self, admin_client, shop, admin_user):
        from pos.models import Sale
        from pos.services import create_sale

        sale = create_sale(
            shop,
            {
                "sale_type": "counter",
                "items": [{"product_name_snapshot": "Cable", "quantity": "1",
                            "unit_price": "100", "tax_rate": "0"}],
                "payments": [],
            },
            admin_user,
        )
        sale.status = Sale.Status.CANCELLED
        sale.save()

        res = admin_client.post(
            f"{self.url}{sale.id}/return/",
            {"reason": "Return request", "total_refund_amount": "100", "refund_method": "cash"},
            format="json",
        )
        assert res.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY


# ──────────────────────────────────────────────────────────────────────────────
# Job-linked sale
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.django_db
class TestJobLinkedSale:
    url = "/api/v1/pos/sales/"

    def test_job_linked_requires_job_id(self, admin_client, shop, customer):
        res = admin_client.post(self.url, {
            "shop_id": str(shop.id),
            "sale_type": "job_linked",
            "customer_id": str(customer.id),
            "items": [_item()],
        }, format="json")
        assert res.status_code == status.HTTP_400_BAD_REQUEST

    def test_job_linked_sale_created(self, admin_client, shop, customer):
        import uuid
        fake_job_id = uuid.uuid4()
        res = admin_client.post(self.url, {
            "shop_id": str(shop.id),
            "sale_type": "job_linked",
            "customer_id": str(customer.id),
            "job_id": str(fake_job_id),
            "items": [_item()],
        }, format="json")
        assert res.status_code == status.HTTP_201_CREATED


# ──────────────────────────────────────────────────────────────────────────────
# Soft-delete & retrieval
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.django_db
class TestSaleRetrieval:
    url = "/api/v1/pos/sales/"

    def test_get_sale_detail(self, admin_client, shop, admin_user):
        from pos.services import create_sale

        sale = create_sale(
            shop,
            {
                "sale_type": "counter",
                "items": [{"product_name_snapshot": "Phone", "quantity": "1",
                            "unit_price": "8000", "tax_rate": "18.00"}],
                "payments": [{"amount": "9440", "method": "card"}],
            },
            admin_user,
        )
        res = admin_client.get(f"{self.url}{sale.id}/")
        assert res.status_code == status.HTTP_200_OK
        assert res.data["sale_number"] == sale.sale_number
        assert len(res.data["items"]) == 1

    def test_soft_deleted_sale_excluded_from_list(self, admin_client, shop, admin_user):
        from pos.services import create_sale

        sale = create_sale(
            shop,
            {
                "sale_type": "counter",
                "items": [{"product_name_snapshot": "X", "quantity": "1",
                            "unit_price": "100", "tax_rate": "0"}],
            },
            admin_user,
        )
        sale.soft_delete()
        res = admin_client.get(self.url)
        ids = [s["id"] for s in res.data["items"]]
        assert str(sale.id) not in ids
