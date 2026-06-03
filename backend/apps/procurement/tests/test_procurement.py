"""
Procurement tests — §10 acceptance criteria + §11 test cases.

Covers:
- Supplier CRUD; bank account encryption at rest
- Purchase order creation and status transitions
- GRN receipt: accepted qty posts purchase_in to inventory, PO status update
- Partial receipt → partially_received; full receipt → received
- GRN rejected qty requires rejection_reason; not stocked
- Purchase invoice GST: intra-state (CGST+SGST) and inter-state (IGST)
- Purchase payment: amount_paid tracking and payment_status transitions
- Over-payment blocked
- Purchase return creation
- Dispatch of return: stock decremented + debit note generated
- Supplier ledger
- RBAC / permissions
- E2E: supplier → PO → GRN → invoice → payment → return + debit note
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
        name="Main Shop", code="MSH",
        address="123 MG Rd", city="Mumbai",
        state="Maharashtra", state_code="27", phone="+919876500001",
    )


@pytest.fixture
def shop_other_state(db):
    from core.models import Shop
    return Shop.objects.create(
        name="Delhi Branch", code="DEL",
        address="CP", city="Delhi",
        state="Delhi", state_code="07", phone="+919876500002",
    )


@pytest.fixture
def admin_user(db):
    from authentication.models import Permission, Role, RolePermission, User, UserRole

    user = User.objects.create_user(
        email="admin@proc.test", phone="+919000000050",
        full_name="Proc Admin", password="AdminPass@1",
    )
    role, _ = Role.objects.get_or_create(name="Procurement Manager", defaults={"is_system_role": True})
    perms = [
        "erp.suppliers.manage",
        "erp.purchase_orders.create",
        "erp.grn.receive",
        "erp.purchase_invoices.record",
        "erp.purchase_returns.create",
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


@pytest.fixture
def supplier(db):
    from procurement.models import Supplier
    s = Supplier(
        name="Alpha Electronics",
        phone="+912212345678",
        state="Maharashtra", state_code="27",
        gstin="27AABCU9603R1ZX",
        payment_terms_days=30,
    )
    s.save()
    return s


@pytest.fixture
def supplier_other_state(db):
    from procurement.models import Supplier
    return Supplier.objects.create(
        name="Delhi Distributor",
        phone="+911112345678",
        state="Delhi", state_code="07",
    )


@pytest.fixture
def product_variant(db):
    from inventory.models import Product, ProductVariant
    product = Product.objects.create(
        name="USB Hub", sku="USBHUB-4P",
        hsn_code="8473", default_tax_rate=18,
    )
    return ProductVariant.objects.create(
        product=product, variant_name="4-Port Black",
        selling_price=Decimal("500"), cost_price=Decimal("250"),
    )


@pytest.fixture
def product_variant2(db):
    from inventory.models import Product, ProductVariant
    product = Product.objects.create(
        name="HDMI Cable", sku="HDMI-2M",
        hsn_code="8544", default_tax_rate=18,
    )
    return ProductVariant.objects.create(
        product=product, variant_name="2m Black",
        selling_price=Decimal("200"), cost_price=Decimal("100"),
    )


@pytest.fixture
def draft_po(db, shop, supplier, product_variant, admin_user):
    from procurement.services import create_purchase_order
    return create_purchase_order(
        shop=shop, supplier=supplier,
        data={
            "items": [
                {"variant_id": str(product_variant.id), "quantity_ordered": "10", "unit_cost": "250", "tax_rate": "18"},
            ],
            "notes": "Test PO",
        },
        user=admin_user,
    )


@pytest.fixture
def sent_po(db, draft_po, admin_user):
    from procurement.services import update_purchase_order
    from procurement.models import PurchaseOrder
    return update_purchase_order(draft_po, {"status": PurchaseOrder.Status.SENT}, admin_user)


@pytest.fixture
def grn(db, shop, sent_po, admin_user):
    from procurement.services import receive_grn
    po_item = sent_po.items.first()
    return receive_grn(
        shop=shop, po=sent_po,
        data={
            "received_date": "2026-06-03",
            "challan_number": "CH-001",
            "items": [
                {
                    "po_item_id": str(po_item.id),
                    "quantity_received": "10",
                    "quantity_accepted": "10",
                    "quantity_rejected": "0",
                },
            ],
        },
        user=admin_user,
    )


@pytest.fixture
def purchase_invoice(db, shop, supplier, grn, admin_user):
    from procurement.services import create_purchase_invoice
    return create_purchase_invoice(
        shop=shop, supplier=supplier,
        data={
            "shop_id": str(shop.id),
            "supplier_id": str(supplier.id),
            "grn_id": str(grn.id),
            "bill_number": "SUP-INV-001",
            "bill_date": "2026-06-03",
            "subtotal": "2500.00",
            "tax_rate": "18",
            "due_date": "2026-07-03",
        },
        user=admin_user,
    )


# ──────────────────────────────────────────────────────────────────────────────
# Supplier CRUD
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.django_db
class TestSupplierCRUD:
    url = "/api/v1/procurement/suppliers/"

    def test_create_supplier(self, admin_client, db):
        res = admin_client.post(self.url, {
            "name": "Test Supplier",
            "phone": "+911234567890",
            "state": "UP",
            "state_code": "09",
            "bank_account_number": "123456789012",
            "bank_ifsc": "SBIN0001234",
        })
        assert res.status_code == status.HTTP_201_CREATED
        assert res.data["name"] == "Test Supplier"
        assert "bank_account_number" not in res.data  # write-only

    def test_bank_account_encrypted_at_rest(self, db, admin_user):
        from procurement.services import create_supplier
        supplier = create_supplier(
            {"name": "Enc Test", "phone": "+910000000001", "bank_account_number": "987654321098"},
            admin_user,
        )
        assert supplier.bank_account_number_encrypted != "987654321098"
        assert supplier.get_bank_account() == "987654321098"

    def test_list_suppliers(self, admin_client, supplier):
        res = admin_client.get(self.url)
        assert res.status_code == status.HTTP_200_OK
        assert len(res.data) >= 1

    def test_supplier_detail(self, admin_client, supplier):
        res = admin_client.get(f"{self.url}{supplier.id}/")
        assert res.status_code == status.HTTP_200_OK
        assert res.data["name"] == "Alpha Electronics"

    def test_update_supplier(self, admin_client, supplier):
        res = admin_client.patch(f"{self.url}{supplier.id}/", {"payment_terms_days": 45})
        assert res.status_code == status.HTTP_200_OK
        assert res.data["payment_terms_days"] == 45

    def test_unauthenticated_blocked(self, api_client):
        res = api_client.get(self.url)
        assert res.status_code == status.HTTP_401_UNAUTHORIZED


# ──────────────────────────────────────────────────────────────────────────────
# Supplier Ledger
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.django_db
class TestSupplierLedger:
    def test_empty_ledger(self, admin_client, supplier):
        res = admin_client.get(f"/api/v1/procurement/suppliers/{supplier.id}/ledger/")
        assert res.status_code == status.HTTP_200_OK
        assert res.data["total_invoiced"] == "0.00"
        assert res.data["outstanding"] == "0.00"

    def test_ledger_after_invoice(self, admin_client, supplier, purchase_invoice):
        res = admin_client.get(f"/api/v1/procurement/suppliers/{supplier.id}/ledger/")
        assert res.status_code == status.HTTP_200_OK
        assert Decimal(res.data["total_invoiced"]) > 0
        assert len(res.data["invoices"]) == 1


# ──────────────────────────────────────────────────────────────────────────────
# Purchase Order
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.django_db
class TestPurchaseOrder:
    url = "/api/v1/procurement/purchase-orders/"

    def test_create_po(self, admin_client, shop, supplier, product_variant):
        res = admin_client.post(self.url, {
            "shop_id": str(shop.id),
            "supplier_id": str(supplier.id),
            "items": [
                {
                    "variant_id": str(product_variant.id),
                    "quantity_ordered": "5",
                    "unit_cost": "250.00",
                    "tax_rate": "18",
                },
            ],
        }, format="json")
        assert res.status_code == status.HTTP_201_CREATED
        assert res.data["status"] == "draft"
        assert res.data["po_number"].startswith("MSH-PO-")
        assert len(res.data["items"]) == 1

    def test_po_number_sequential(self, admin_client, shop, supplier, product_variant):
        payload = {
            "shop_id": str(shop.id),
            "supplier_id": str(supplier.id),
            "items": [{"variant_id": str(product_variant.id), "quantity_ordered": "1", "unit_cost": "100"}],
        }
        r1 = admin_client.post(self.url, payload, format="json")
        r2 = admin_client.post(self.url, payload, format="json")
        assert r1.status_code == r2.status_code == status.HTTP_201_CREATED
        assert r1.data["po_number"] != r2.data["po_number"]

    def test_send_po(self, admin_client, draft_po):
        res = admin_client.patch(f"{self.url}{draft_po.id}/", {"status": "sent"}, format="json")
        assert res.status_code == status.HTTP_200_OK
        assert res.data["status"] == "sent"

    def test_invalid_status_transition_blocked(self, admin_client, draft_po):
        res = admin_client.patch(
            f"{self.url}{draft_po.id}/", {"status": "received"}, format="json"
        )
        assert res.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY

    def test_create_po_requires_at_least_one_item(self, admin_client, shop, supplier):
        res = admin_client.post(self.url, {
            "shop_id": str(shop.id),
            "supplier_id": str(supplier.id),
            "items": [],
        }, format="json")
        assert res.status_code == status.HTTP_400_BAD_REQUEST


# ──────────────────────────────────────────────────────────────────────────────
# GRN
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.django_db
class TestGRN:
    url = "/api/v1/procurement/grn/"

    def test_full_receipt_sets_po_received(self, admin_client, shop, sent_po, product_variant):
        po_item = sent_po.items.first()
        res = admin_client.post(self.url, {
            "po_id": str(sent_po.id),
            "received_date": "2026-06-03",
            "items": [
                {
                    "po_item_id": str(po_item.id),
                    "quantity_received": "10",
                    "quantity_accepted": "10",
                    "quantity_rejected": "0",
                },
            ],
        }, format="json")
        assert res.status_code == status.HTTP_201_CREATED
        assert res.data["grn_number"].startswith("MSH-GRN-")

        sent_po.refresh_from_db()
        assert sent_po.status == "received"

    def test_accepted_qty_increments_stock(self, admin_client, shop, sent_po, product_variant):
        from inventory.models import InventoryStock
        po_item = sent_po.items.first()
        admin_client.post(self.url, {
            "po_id": str(sent_po.id),
            "received_date": "2026-06-03",
            "items": [{
                "po_item_id": str(po_item.id),
                "quantity_received": "10",
                "quantity_accepted": "10",
                "quantity_rejected": "0",
            }],
        }, format="json")

        stock = InventoryStock.objects.get(shop=shop, variant=product_variant)
        assert stock.quantity_in_stock == Decimal("10")

    def test_rejected_qty_not_stocked(self, admin_client, shop, sent_po, product_variant):
        from inventory.models import InventoryStock
        po_item = sent_po.items.first()
        res = admin_client.post(self.url, {
            "po_id": str(sent_po.id),
            "received_date": "2026-06-03",
            "items": [{
                "po_item_id": str(po_item.id),
                "quantity_received": "10",
                "quantity_accepted": "8",
                "quantity_rejected": "2",
                "rejection_reason": "2 units damaged",
            }],
        }, format="json")
        assert res.status_code == status.HTTP_201_CREATED

        stock = InventoryStock.objects.get(shop=shop, variant=product_variant)
        assert stock.quantity_in_stock == Decimal("8")  # only accepted

    def test_partial_receipt_sets_po_partially_received(
        self, admin_client, shop, sent_po, product_variant, product_variant2, admin_user
    ):
        from procurement.models import PurchaseOrderItem
        # Add a second item to the PO
        PurchaseOrderItem.objects.create(
            po=sent_po, variant=product_variant2,
            quantity_ordered=Decimal("5"), unit_cost=Decimal("100"),
            tax_rate=Decimal("18"), line_total=Decimal("590"),
        )

        po_item = sent_po.items.filter(variant=product_variant).first()
        res = admin_client.post(self.url, {
            "po_id": str(sent_po.id),
            "received_date": "2026-06-03",
            "items": [{
                "po_item_id": str(po_item.id),
                "quantity_received": "10",
                "quantity_accepted": "10",
                "quantity_rejected": "0",
            }],
        }, format="json")
        assert res.status_code == status.HTTP_201_CREATED

        sent_po.refresh_from_db()
        assert sent_po.status == "partially_received"

    def test_rejection_reason_required_when_rejected(self, admin_client, sent_po):
        po_item = sent_po.items.first()
        res = admin_client.post(self.url, {
            "po_id": str(sent_po.id),
            "received_date": "2026-06-03",
            "items": [{
                "po_item_id": str(po_item.id),
                "quantity_received": "5",
                "quantity_accepted": "3",
                "quantity_rejected": "2",
                "rejection_reason": "",
            }],
        }, format="json")
        assert res.status_code == status.HTTP_400_BAD_REQUEST

    def test_accepted_plus_rejected_must_equal_received(self, admin_client, sent_po):
        po_item = sent_po.items.first()
        res = admin_client.post(self.url, {
            "po_id": str(sent_po.id),
            "received_date": "2026-06-03",
            "items": [{
                "po_item_id": str(po_item.id),
                "quantity_received": "10",
                "quantity_accepted": "6",
                "quantity_rejected": "2",
            }],
        }, format="json")
        assert res.status_code == status.HTTP_400_BAD_REQUEST

    def test_grn_against_draft_po_blocked(self, admin_client, draft_po):
        po_item = draft_po.items.first()
        res = admin_client.post(self.url, {
            "po_id": str(draft_po.id),
            "received_date": "2026-06-03",
            "items": [{
                "po_item_id": str(po_item.id),
                "quantity_received": "5",
                "quantity_accepted": "5",
                "quantity_rejected": "0",
            }],
        }, format="json")
        assert res.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY

    def test_ledger_row_created_for_accepted_qty(self, admin_client, shop, sent_po, product_variant):
        from inventory.models import InventoryTransaction
        po_item = sent_po.items.first()
        admin_client.post(self.url, {
            "po_id": str(sent_po.id),
            "received_date": "2026-06-03",
            "items": [{
                "po_item_id": str(po_item.id),
                "quantity_received": "10",
                "quantity_accepted": "10",
                "quantity_rejected": "0",
            }],
        }, format="json")
        assert InventoryTransaction.objects.filter(
            shop=shop, variant=product_variant, type="purchase_in"
        ).count() == 1


# ──────────────────────────────────────────────────────────────────────────────
# Purchase Invoice
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.django_db
class TestPurchaseInvoice:
    url = "/api/v1/procurement/purchase-invoices/"

    def test_create_invoice_intrastate(self, admin_client, shop, supplier):
        # shop.state_code == "27", supplier.state_code == "27" → CGST+SGST
        res = admin_client.post(self.url, {
            "shop_id": str(shop.id),
            "supplier_id": str(supplier.id),
            "bill_number": "INV-001",
            "bill_date": "2026-06-03",
            "subtotal": "1000.00",
            "tax_rate": "18",
        }, format="json")
        assert res.status_code == status.HTTP_201_CREATED
        assert Decimal(res.data["cgst"]) > 0
        assert Decimal(res.data["sgst"]) > 0
        assert Decimal(res.data["igst"]) == Decimal("0")
        assert Decimal(res.data["grand_total"]) == Decimal("1180.00")

    def test_create_invoice_interstate(self, admin_client, shop, supplier_other_state):
        # shop.state_code == "27", supplier.state_code == "07" → IGST
        res = admin_client.post(self.url, {
            "shop_id": str(shop.id),
            "supplier_id": str(supplier_other_state.id),
            "bill_number": "INV-002",
            "bill_date": "2026-06-03",
            "subtotal": "1000.00",
            "tax_rate": "18",
        }, format="json")
        assert res.status_code == status.HTTP_201_CREATED
        assert Decimal(res.data["cgst"]) == Decimal("0")
        assert Decimal(res.data["igst"]) > 0
        assert Decimal(res.data["grand_total"]) == Decimal("1180.00")

    def test_invoice_payment_status_unpaid_on_creation(self, admin_client, shop, supplier):
        res = admin_client.post(self.url, {
            "shop_id": str(shop.id),
            "supplier_id": str(supplier.id),
            "bill_number": "INV-003",
            "bill_date": "2026-06-03",
            "subtotal": "500.00",
            "tax_rate": "18",
        }, format="json")
        assert res.status_code == status.HTTP_201_CREATED
        assert res.data["payment_status"] == "unpaid"


# ──────────────────────────────────────────────────────────────────────────────
# Purchase Payment
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.django_db
class TestPurchasePayment:
    url = "/api/v1/procurement/purchase-payments/"

    def test_partial_payment(self, admin_client, purchase_invoice):
        grand_total = purchase_invoice.grand_total
        pay_amount = grand_total / 2

        res = admin_client.post(self.url, {
            "purchase_invoice_id": str(purchase_invoice.id),
            "amount": str(pay_amount.quantize(Decimal("0.01"))),
            "method": "neft",
        }, format="json")
        assert res.status_code == status.HTTP_201_CREATED

        purchase_invoice.refresh_from_db()
        assert purchase_invoice.payment_status == "partially_paid"
        assert purchase_invoice.amount_paid == pay_amount.quantize(Decimal("0.01"))

    def test_full_payment_marks_paid(self, admin_client, purchase_invoice):
        res = admin_client.post(self.url, {
            "purchase_invoice_id": str(purchase_invoice.id),
            "amount": str(purchase_invoice.grand_total),
            "method": "neft",
        }, format="json")
        assert res.status_code == status.HTTP_201_CREATED

        purchase_invoice.refresh_from_db()
        assert purchase_invoice.payment_status == "paid"

    def test_overpayment_blocked(self, admin_client, purchase_invoice):
        overpay = purchase_invoice.grand_total + Decimal("100")
        res = admin_client.post(self.url, {
            "purchase_invoice_id": str(purchase_invoice.id),
            "amount": str(overpay),
            "method": "cash",
        }, format="json")
        assert res.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY


# ──────────────────────────────────────────────────────────────────────────────
# Purchase Return + Debit Note
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.django_db
class TestPurchaseReturn:
    create_url = "/api/v1/procurement/purchase-returns/"

    def test_create_return(self, admin_client, purchase_invoice, product_variant):
        res = admin_client.post(self.create_url, {
            "purchase_invoice_id": str(purchase_invoice.id),
            "reason": "Items damaged in transit",
            "items": [
                {
                    "variant_id": str(product_variant.id),
                    "quantity": "2",
                    "unit_cost": "250.00",
                },
            ],
        }, format="json")
        assert res.status_code == status.HTTP_201_CREATED
        assert res.data["status"] == "pending"
        assert res.data["return_number"].startswith("MSH-PR-")
        assert Decimal(res.data["total_amount"]) == Decimal("500.00")

    def test_dispatch_return_decrements_stock(
        self, admin_client, shop, purchase_invoice, product_variant, grn, admin_user
    ):
        from inventory.models import InventoryStock
        # Stock after GRN = 10
        stock = InventoryStock.objects.get(shop=shop, variant=product_variant)
        assert stock.quantity_in_stock == Decimal("10")

        # Create return
        ret_res = admin_client.post(self.create_url, {
            "purchase_invoice_id": str(purchase_invoice.id),
            "reason": "Damaged",
            "items": [{"variant_id": str(product_variant.id), "quantity": "3", "unit_cost": "250.00"}],
        }, format="json")
        assert ret_res.status_code == status.HTTP_201_CREATED
        ret_id = ret_res.data["id"]

        # Dispatch
        dispatch_res = admin_client.patch(
            f"{self.create_url}{ret_id}/dispatch/", {}, format="json"
        )
        assert dispatch_res.status_code == status.HTTP_200_OK
        assert dispatch_res.data["status"] == "dispatched"
        assert dispatch_res.data["debit_note_number"] is not None
        assert "DN-" in dispatch_res.data["debit_note_number"]

        stock.refresh_from_db()
        assert stock.quantity_in_stock == Decimal("7")  # 10 - 3

    def test_dispatch_creates_return_out_ledger_row(
        self, admin_client, shop, purchase_invoice, product_variant
    ):
        from inventory.models import InventoryTransaction

        ret_res = admin_client.post(self.create_url, {
            "purchase_invoice_id": str(purchase_invoice.id),
            "reason": "Wrong item",
            "items": [{"variant_id": str(product_variant.id), "quantity": "1", "unit_cost": "250.00"}],
        }, format="json")
        ret_id = ret_res.data["id"]
        admin_client.patch(f"{self.create_url}{ret_id}/dispatch/", {}, format="json")

        assert InventoryTransaction.objects.filter(
            shop=shop, variant=product_variant, type="return_out"
        ).count() == 1

    def test_double_dispatch_blocked(self, admin_client, purchase_invoice, product_variant):
        ret_res = admin_client.post(self.create_url, {
            "purchase_invoice_id": str(purchase_invoice.id),
            "reason": "Excess order",
            "items": [{"variant_id": str(product_variant.id), "quantity": "1", "unit_cost": "250.00"}],
        }, format="json")
        ret_id = ret_res.data["id"]

        admin_client.patch(f"{self.create_url}{ret_id}/dispatch/", {}, format="json")
        res2 = admin_client.patch(f"{self.create_url}{ret_id}/dispatch/", {}, format="json")
        assert res2.status_code == status.HTTP_422_UNPROCESSABLE_ENTITY


# ──────────────────────────────────────────────────────────────────────────────
# E2E
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.django_db
class TestE2E:
    def test_full_procurement_flow(
        self, admin_client, shop, supplier, product_variant
    ):
        from inventory.models import InventoryStock

        # 1. Create supplier
        assert supplier.name == "Alpha Electronics"

        # 2. Create PO
        po_res = admin_client.post("/api/v1/procurement/purchase-orders/", {
            "shop_id": str(shop.id),
            "supplier_id": str(supplier.id),
            "items": [{"variant_id": str(product_variant.id), "quantity_ordered": "20", "unit_cost": "250"}],
        }, format="json")
        assert po_res.status_code == 201
        po_id = po_res.data["id"]

        # 3. Send PO
        send_res = admin_client.patch(f"/api/v1/procurement/purchase-orders/{po_id}/", {"status": "sent"}, format="json")
        assert send_res.data["status"] == "sent"
        po_item_id = po_res.data["items"][0]["id"]

        # 4. Receive GRN (20 ordered, 18 accepted, 2 rejected with reason)
        grn_res = admin_client.post("/api/v1/procurement/grn/", {
            "po_id": po_id,
            "received_date": "2026-06-03",
            "challan_number": "CH-E2E-001",
            "items": [{
                "po_item_id": po_item_id,
                "quantity_received": "20",
                "quantity_accepted": "18",
                "quantity_rejected": "2",
                "rejection_reason": "Packaging damage",
            }],
        }, format="json")
        assert grn_res.status_code == 201
        grn_id = grn_res.data["id"]

        # PO should be received (18 < 20 → partially_received)
        from procurement.models import PurchaseOrder
        po = PurchaseOrder.objects.get(id=po_id)
        assert po.status == "partially_received"

        # Stock = 18 (only accepted)
        stock = InventoryStock.objects.get(shop=shop, variant=product_variant)
        assert stock.quantity_in_stock == Decimal("18")

        # 5. Record purchase invoice
        inv_res = admin_client.post("/api/v1/procurement/purchase-invoices/", {
            "shop_id": str(shop.id),
            "supplier_id": str(supplier.id),
            "grn_id": grn_id,
            "bill_number": "ALPHA-INV-9001",
            "bill_date": "2026-06-03",
            "subtotal": "4500.00",
            "tax_rate": "18",
            "due_date": "2026-07-03",
        }, format="json")
        assert inv_res.status_code == 201
        inv_id = inv_res.data["id"]
        grand_total = Decimal(inv_res.data["grand_total"])
        assert grand_total == Decimal("5310.00")  # 4500 + 18%

        # 6. Record payment (partial)
        pay1_res = admin_client.post("/api/v1/procurement/purchase-payments/", {
            "purchase_invoice_id": inv_id,
            "amount": "2000.00",
            "method": "neft",
            "reference_id": "TXN001",
        }, format="json")
        assert pay1_res.status_code == 201

        from procurement.models import PurchaseInvoice
        invoice = PurchaseInvoice.objects.get(id=inv_id)
        assert invoice.payment_status == "partially_paid"

        # 7. Record remaining payment
        outstanding = invoice.grand_total - invoice.amount_paid
        admin_client.post("/api/v1/procurement/purchase-payments/", {
            "purchase_invoice_id": inv_id,
            "amount": str(outstanding),
            "method": "neft",
        }, format="json")
        invoice.refresh_from_db()
        assert invoice.payment_status == "paid"

        # 8. Create purchase return (3 units)
        ret_res = admin_client.post("/api/v1/procurement/purchase-returns/", {
            "purchase_invoice_id": inv_id,
            "reason": "3 units found defective after inspection",
            "items": [{"variant_id": str(product_variant.id), "quantity": "3", "unit_cost": "250.00"}],
        }, format="json")
        assert ret_res.status_code == 201
        ret_id = ret_res.data["id"]

        # 9. Dispatch return → stock decrements, debit note generated
        dispatch_res = admin_client.patch(
            f"/api/v1/procurement/purchase-returns/{ret_id}/dispatch/", {}, format="json"
        )
        assert dispatch_res.status_code == 200
        assert dispatch_res.data["status"] == "dispatched"
        dn_number = dispatch_res.data["debit_note_number"]
        assert dn_number and "DN-" in dn_number

        stock.refresh_from_db()
        assert stock.quantity_in_stock == Decimal("15")  # 18 - 3

        # 10. Supplier ledger shows the invoice
        ledger_res = admin_client.get(f"/api/v1/procurement/suppliers/{supplier.id}/ledger/")
        assert ledger_res.status_code == 200
        assert len(ledger_res.data["invoices"]) == 1
        assert Decimal(ledger_res.data["total_invoiced"]) == grand_total
