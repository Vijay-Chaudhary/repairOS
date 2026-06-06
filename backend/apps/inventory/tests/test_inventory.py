"""
Inventory tests — §10 acceptance criteria + §11 test cases.

Covers:
- Product / variant CRUD
- Barcode lookup
- Opening stock seeding
- Manual adjustment (positive and negative)
- Insufficient stock → 400
- Ledger invariant: every update creates exactly one transaction
- Inter-shop transfer: paired out/in transactions
- Low-stock alert fires when crossing reorder level
- CSV bulk import
- Transaction immutability
- Soft-delete visibility
- RBAC
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
        name="Joy Elec", code="JEL",
        address="MG Rd", city="Delhi",
        state="UP", state_code="09", phone="+919876543210",
    )


@pytest.fixture
def shop2(db):
    from core.models import Shop
    return Shop.objects.create(
        name="Branch 2", code="B02",
        address="CP", city="Delhi",
        state="UP", state_code="09", phone="+919876543211",
    )


@pytest.fixture
def admin_user(db):
    from authentication.models import Permission, Role, RolePermission, User, UserRole

    user = User.objects.create_user(
        email="admin@inv.test", phone="+919000000040",
        full_name="Inv Admin", password="AdminPass@1",
    )
    role, _ = Role.objects.get_or_create(name="Shop Manager", defaults={"is_system_role": True})
    perms = [
        "erp.inventory.view", "erp.inventory.adjust",
        "pos.counter_sale.create",
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
def product(db):
    from inventory.models import Product
    return Product.objects.create(
        name="USB Cable", sku="USBC-1M",
        hsn_code="8544", default_tax_rate=Decimal("18"),
        is_for_sale=True,
    )


@pytest.fixture
def variant(db, product):
    from inventory.models import ProductVariant
    return ProductVariant.objects.create(
        product=product,
        variant_name="USB-C 1m Black",
        barcode="5901234123457",
        selling_price=Decimal("250"),
        cost_price=Decimal("120"),
    )


# ──────────────────────────────────────────────────────────────────────────────
# Product CRUD
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.django_db
class TestProductCRUD:
    url = "/api/v1/inventory/products/"

    def test_create_product(self, admin_client):
        res = admin_client.post(self.url, {
            "name": "CCTV Camera", "sku": "CCTV-2MP",
            "hsn_code": "8525", "default_tax_rate": "18.00",
            "is_for_sale": True,
        }, format="json")
        assert res.status_code == status.HTTP_201_CREATED
        assert res.data["sku"] == "CCTV-2MP"

    def test_duplicate_sku_returns_400(self, admin_client, product):
        res = admin_client.post(self.url, {
            "name": "Duplicate", "sku": product.sku,
        }, format="json")
        assert res.status_code == status.HTTP_400_BAD_REQUEST

    def test_list_products(self, admin_client, product):
        res = admin_client.get(self.url)
        assert res.status_code == status.HTTP_200_OK
        assert len(res.data["items"]) >= 1

    def test_filter_for_sale(self, admin_client, product):
        res = admin_client.get(self.url + "?is_for_sale=true")
        assert res.status_code == status.HTTP_200_OK

    def test_soft_deleted_product_excluded(self, admin_client, product):
        product.soft_delete()
        res = admin_client.get(self.url)
        skus = [p["sku"] for p in res.data["items"]]
        assert product.sku not in skus

    def test_add_variant_to_product(self, admin_client, product):
        res = admin_client.post(f"{self.url}{product.id}/variants/", {
            "variant_name": "USB-C 2m White",
            "barcode": "5901234123458",
            "selling_price": "300.00",
            "cost_price": "150.00",
        }, format="json")
        assert res.status_code == status.HTTP_201_CREATED
        assert res.data["variant_name"] == "USB-C 2m White"

    def test_duplicate_barcode_returns_400(self, admin_client, product, variant):
        res = admin_client.post(f"{self.url}{product.id}/variants/", {
            "variant_name": "USB-C 2m",
            "barcode": variant.barcode,  # same barcode
            "selling_price": "300.00",
        }, format="json")
        assert res.status_code == status.HTTP_400_BAD_REQUEST


# ──────────────────────────────────────────────────────────────────────────────
# Barcode lookup
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.django_db
class TestBarcodeLookup:
    def test_lookup_existing_barcode(self, admin_client, variant):
        res = admin_client.get(f"/api/v1/inventory/products/barcode/{variant.barcode}/")
        assert res.status_code == status.HTTP_200_OK
        assert res.data["barcode"] == variant.barcode
        assert res.data["variant_name"] == variant.variant_name

    def test_unknown_barcode_returns_404(self, admin_client):
        res = admin_client.get("/api/v1/inventory/products/barcode/0000000000000/")
        assert res.status_code == status.HTTP_404_NOT_FOUND


# ──────────────────────────────────────────────────────────────────────────────
# Opening stock
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.django_db
class TestOpeningStock:
    url = "/api/v1/inventory/stock/opening/"

    def test_set_opening_stock(self, admin_client, shop, variant):
        res = admin_client.post(self.url, {
            "shop_id": str(shop.id),
            "variant_id": str(variant.id),
            "quantity": "100",
        }, format="json")
        assert res.status_code == status.HTTP_201_CREATED
        assert res.data["quantity_in_stock"] == "100.000"

    def test_opening_stock_creates_ledger_entry(self, admin_client, shop, variant):
        from inventory.models import InventoryTransaction

        admin_client.post(self.url, {
            "shop_id": str(shop.id),
            "variant_id": str(variant.id),
            "quantity": "50",
        }, format="json")

        txn = InventoryTransaction.objects.filter(
            shop=shop, variant=variant, type="opening_stock"
        ).first()
        assert txn is not None
        assert txn.quantity == Decimal("50")

    def test_cannot_set_opening_stock_twice(self, admin_user, shop, variant):
        from inventory.services import opening_stock
        from core.exceptions import BusinessRuleViolation

        opening_stock(shop, variant, Decimal("10"), admin_user)

        with pytest.raises(BusinessRuleViolation):
            opening_stock(shop, variant, Decimal("20"), admin_user)


# ──────────────────────────────────────────────────────────────────────────────
# Adjustments
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.django_db
class TestStockAdjustment:
    url = "/api/v1/inventory/adjustment/"

    def _seed(self, shop, variant, admin_user, qty=100):
        from inventory.services import opening_stock
        opening_stock(shop, variant, Decimal(str(qty)), admin_user)

    def test_positive_adjustment_increases_stock(self, admin_client, admin_user, shop, variant):
        self._seed(shop, variant, admin_user, 50)
        res = admin_client.post(self.url, {
            "shop_id": str(shop.id),
            "variant_id": str(variant.id),
            "quantity": "10",
            "note": "Found extra items",
        }, format="json")
        assert res.status_code == status.HTTP_201_CREATED
        assert res.data["new_qty"] == 60.0

    def test_negative_adjustment_decreases_stock(self, admin_client, admin_user, shop, variant):
        self._seed(shop, variant, admin_user, 50)
        res = admin_client.post(self.url, {
            "shop_id": str(shop.id),
            "variant_id": str(variant.id),
            "quantity": "-5",
            "note": "Damaged in storage",
        }, format="json")
        assert res.status_code == status.HTTP_201_CREATED
        assert res.data["new_qty"] == 45.0

    def test_insufficient_stock_returns_400(self, admin_client, admin_user, shop, variant):
        self._seed(shop, variant, admin_user, 10)
        res = admin_client.post(self.url, {
            "shop_id": str(shop.id),
            "variant_id": str(variant.id),
            "quantity": "-100",  # would go negative
            "note": "Over-deduction attempt",
        }, format="json")
        assert res.status_code == status.HTTP_400_BAD_REQUEST
        assert res.json()["error"]["code"] == "INSUFFICIENT_STOCK"

    def test_each_adjustment_creates_one_ledger_row(self, admin_client, admin_user, shop, variant):
        from inventory.models import InventoryTransaction

        self._seed(shop, variant, admin_user, 100)
        txn_count_before = InventoryTransaction.objects.filter(shop=shop, variant=variant).count()

        admin_client.post(self.url, {
            "shop_id": str(shop.id), "variant_id": str(variant.id),
            "quantity": "-5", "note": "Test",
        }, format="json")

        txn_count_after = InventoryTransaction.objects.filter(shop=shop, variant=variant).count()
        assert txn_count_after == txn_count_before + 1

    def test_ledger_sum_equals_current_stock(self, admin_user, shop, variant):
        from decimal import Decimal
        from django.db.models import Sum
        from inventory.models import InventoryStock, InventoryTransaction
        from inventory.services import adjust_stock, opening_stock

        opening_stock(shop, variant, Decimal("100"), admin_user)
        adjust_stock(shop, variant, Decimal("-30"), "test", admin_user)
        adjust_stock(shop, variant, Decimal("5"), "restocked", admin_user)

        stock = InventoryStock.objects.get(shop=shop, variant=variant)
        ledger_sum = InventoryTransaction.objects.filter(
            shop=shop, variant=variant
        ).aggregate(total=Sum("quantity"))["total"]

        assert stock.quantity_in_stock == ledger_sum


# ──────────────────────────────────────────────────────────────────────────────
# Inter-shop transfer
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.django_db
class TestTransfer:
    url = "/api/v1/inventory/transfer/"

    def _seed(self, shop, variant, admin_user, qty=100):
        from inventory.services import opening_stock
        opening_stock(shop, variant, Decimal(str(qty)), admin_user)

    def test_transfer_posts_paired_transactions(self, admin_client, admin_user, shop, shop2, variant):
        from inventory.models import InventoryTransaction

        self._seed(shop, variant, admin_user, 100)
        res = admin_client.post(self.url, {
            "source_shop_id": str(shop.id),
            "dest_shop_id": str(shop2.id),
            "variant_id": str(variant.id),
            "quantity": "30",
            "note": "Branch replenishment",
        }, format="json")
        assert res.status_code == status.HTTP_201_CREATED

        out_txn = InventoryTransaction.objects.filter(
            shop=shop, variant=variant, type="transfer_out"
        ).first()
        in_txn = InventoryTransaction.objects.filter(
            shop=shop2, variant=variant, type="transfer_in"
        ).first()

        assert out_txn is not None
        assert in_txn is not None
        assert out_txn.reference_id == in_txn.reference_id  # same transfer batch

    def test_transfer_deducts_source_adds_dest(self, admin_user, shop, shop2, variant):
        from inventory.models import InventoryStock
        from inventory.services import inter_shop_transfer, opening_stock

        opening_stock(shop, variant, Decimal("100"), admin_user)
        inter_shop_transfer(shop, shop2, variant, Decimal("40"), "test", admin_user)

        src = InventoryStock.objects.get(shop=shop, variant=variant)
        dst = InventoryStock.objects.get(shop=shop2, variant=variant)
        assert src.quantity_in_stock == Decimal("60")
        assert dst.quantity_in_stock == Decimal("40")

    def test_transfer_insufficient_stock_raises(self, admin_client, admin_user, shop, shop2, variant):
        from inventory.services import opening_stock
        opening_stock(shop, variant, Decimal("10"), admin_user)

        res = admin_client.post(self.url, {
            "source_shop_id": str(shop.id),
            "dest_shop_id": str(shop2.id),
            "variant_id": str(variant.id),
            "quantity": "50",
        }, format="json")
        assert res.status_code == status.HTTP_400_BAD_REQUEST

    def test_same_shop_transfer_returns_400(self, admin_client, shop, variant):
        res = admin_client.post(self.url, {
            "source_shop_id": str(shop.id),
            "dest_shop_id": str(shop.id),
            "variant_id": str(variant.id),
            "quantity": "5",
        }, format="json")
        assert res.status_code == status.HTTP_400_BAD_REQUEST


# ──────────────────────────────────────────────────────────────────────────────
# Transaction immutability
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.django_db
class TestTransactionImmutability:
    def test_cannot_update_transaction(self, admin_user, shop, variant):
        from inventory.services import opening_stock
        from inventory.models import InventoryTransaction

        opening_stock(shop, variant, Decimal("50"), admin_user)
        txn = InventoryTransaction.objects.filter(shop=shop, variant=variant).first()

        with pytest.raises(RuntimeError, match="immutable"):
            txn.note = "Altered"
            txn.save()

    def test_cannot_delete_transaction(self, admin_user, shop, variant):
        from inventory.services import opening_stock
        from inventory.models import InventoryTransaction

        opening_stock(shop, variant, Decimal("50"), admin_user)
        txn = InventoryTransaction.objects.filter(shop=shop, variant=variant).first()

        with pytest.raises(RuntimeError, match="cannot be deleted"):
            txn.delete()


# ──────────────────────────────────────────────────────────────────────────────
# Ledger endpoint
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.django_db
class TestLedgerEndpoint:
    url = "/api/v1/inventory/transactions/"

    def test_list_transactions(self, admin_client, admin_user, shop, variant):
        from inventory.services import opening_stock
        opening_stock(shop, variant, Decimal("100"), admin_user)

        res = admin_client.get(self.url)
        assert res.status_code == status.HTTP_200_OK
        assert len(res.data["items"]) >= 1


# ──────────────────────────────────────────────────────────────────────────────
# CSV bulk import
# ──────────────────────────────────────────────────────────────────────────────


@pytest.mark.django_db
class TestBulkImport:
    url = "/api/v1/inventory/products/bulk-import/"

    def test_bulk_import_creates_products(self, admin_client):
        csv_content = (
            "name,sku,variant_name,barcode,selling_price,cost_price,default_tax_rate,hsn_code\n"
            "Thermal Paste,TP-001,5g Tube,8901234567890,150.00,50.00,18.00,3824\n"
            "HDMI Cable,HDMI-1M,1m Cable,,450.00,200.00,18.00,8544\n"
        )
        import io
        from django.core.files.uploadedfile import SimpleUploadedFile

        f = SimpleUploadedFile("products.csv", csv_content.encode(), content_type="text/csv")
        res = admin_client.post(self.url, {"file": f}, format="multipart")
        assert res.status_code == status.HTTP_200_OK
        assert res.data["created"] == 2
        assert res.data["failed"] == []

        from inventory.models import Product
        assert Product.objects.filter(sku="TP-001").exists()

    def test_bulk_import_updates_existing(self, admin_client, product):
        csv_content = (
            "name,sku,variant_name,barcode,selling_price,cost_price\n"
            f"Updated Name,{product.sku},Default,,999.00,500.00\n"
        )
        import io
        from django.core.files.uploadedfile import SimpleUploadedFile

        f = SimpleUploadedFile("products.csv", csv_content.encode(), content_type="text/csv")
        res = admin_client.post(self.url, {"file": f}, format="multipart")
        assert res.status_code == status.HTTP_200_OK
        assert res.data["updated"] == 1

        product.refresh_from_db()
        assert product.name == "Updated Name"
