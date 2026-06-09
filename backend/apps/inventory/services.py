"""
Inventory business logic.

The core invariant: every stock change = one atomic DB transaction that writes
both the stock row update AND the InventoryTransaction ledger entry.
Stock never goes negative (service + DB CHECK enforce this).
"""

import csv
import io
import logging
import uuid
from decimal import Decimal
from typing import Optional
from uuid import UUID

from django.db import transaction
from django.db.models import F

from authentication.models import AuditLog

from .models import (
    InventoryStock,
    InventoryTransaction,
    Product,
    ProductVariant,
)

logger = logging.getLogger(__name__)


# ──────────────────────────────────────────────────────────────────────────────
# Core stock update (all callers go through this)
# ──────────────────────────────────────────────────────────────────────────────


def update_stock(
    *,
    shop,
    variant: ProductVariant,
    quantity_delta: Decimal,
    txn_type: str,
    reference_type: str,
    reference_id: Optional[UUID] = None,
    note: str = "",
    user,
) -> tuple[InventoryStock, Decimal]:
    """
    Atomically update stock and write the immutable ledger entry.

    Uses SELECT FOR UPDATE on the InventoryStock row to prevent concurrent
    overselling (PostgreSQL honours the lock; SQLite ignores it harmlessly in tests).

    Returns (stock_record, new_quantity).
    Raises core.exceptions.InsufficientStock if the result would be negative.
    """
    from core.context import get_tenant_db_alias
    from core.exceptions import InsufficientStock

    _db = get_tenant_db_alias() or "default"
    with transaction.atomic(using=_db):
        # Ensure the row exists before locking it
        InventoryStock.objects.get_or_create(
            shop=shop, variant=variant,
            defaults={"quantity_in_stock": Decimal("0")},
        )
        # Lock and read
        stock = InventoryStock.objects.select_for_update().get(shop=shop, variant=variant)

        new_qty = stock.quantity_in_stock + quantity_delta
        if new_qty < 0:
            raise InsufficientStock()

        stock.quantity_in_stock = new_qty
        stock.save(update_fields=["quantity_in_stock"])

        InventoryTransaction.objects.create(
            shop=shop,
            variant=variant,
            type=txn_type,
            quantity=quantity_delta,
            reference_type=reference_type,
            reference_id=reference_id,
            note=note,
            created_by=user,
        )

        # Low-stock alert
        if new_qty < stock.reorder_level and quantity_delta < 0:
            _emit_low_stock_alert(shop, variant, new_qty, stock.reorder_level)

    return stock, new_qty


# ──────────────────────────────────────────────────────────────────────────────
# Named operations
# ──────────────────────────────────────────────────────────────────────────────


def opening_stock(shop, variant: ProductVariant, qty: Decimal, user) -> InventoryStock:
    """Seed initial stock. Raises if stock already exists and is non-zero."""
    from core.exceptions import BusinessRuleViolation

    existing = InventoryStock.objects.filter(shop=shop, variant=variant).first()
    if existing and existing.quantity_in_stock != 0:
        raise BusinessRuleViolation(
            "Opening stock can only be set when current stock is zero."
        )

    stock, _ = update_stock(
        shop=shop, variant=variant, quantity_delta=qty,
        txn_type=InventoryTransaction.TxnType.OPENING_STOCK,
        reference_type=InventoryTransaction.RefType.OPENING,
        note="Opening stock", user=user,
    )
    return stock


def adjust_stock(
    shop, variant: ProductVariant, quantity_delta: Decimal, note: str, user
) -> tuple[InventoryStock, Decimal]:
    stock, new_qty = update_stock(
        shop=shop, variant=variant, quantity_delta=quantity_delta,
        txn_type=InventoryTransaction.TxnType.ADJUSTMENT,
        reference_type=InventoryTransaction.RefType.ADJUSTMENT,
        note=note, user=user,
    )
    return stock, new_qty


def inter_shop_transfer(
    source_shop, dest_shop, variant: ProductVariant,
    qty: Decimal, note: str, user
) -> tuple[InventoryStock, InventoryStock, UUID]:
    """
    Post paired transfer_out (source) + transfer_in (dest) in one DB transaction.

    OQ-06 (receiving shop confirms receipt before transfer_in posts) is not yet
    implemented; both legs post immediately.

    Returns (src_stock, dst_stock, transfer_ref) so the caller can look up both
    ledger entries by reference_id.
    """
    transfer_ref = uuid.uuid4()

    with transaction.atomic():
        src_stock, _ = update_stock(
            shop=source_shop, variant=variant, quantity_delta=-qty,
            txn_type=InventoryTransaction.TxnType.TRANSFER_OUT,
            reference_type=InventoryTransaction.RefType.TRANSFER,
            reference_id=transfer_ref,
            note=f"Transfer to {dest_shop.code}: {note}", user=user,
        )
        dst_stock, _ = update_stock(
            shop=dest_shop, variant=variant, quantity_delta=qty,
            txn_type=InventoryTransaction.TxnType.TRANSFER_IN,
            reference_type=InventoryTransaction.RefType.TRANSFER,
            reference_id=transfer_ref,
            note=f"Transfer from {source_shop.code}: {note}", user=user,
        )

    return src_stock, dst_stock, transfer_ref


def record_sale_out(shop, variant: ProductVariant, qty: Decimal, sale_id: UUID, user) -> None:
    """Called by POS when a sale is completed."""
    update_stock(
        shop=shop, variant=variant, quantity_delta=-qty,
        txn_type=InventoryTransaction.TxnType.SALE_OUT,
        reference_type=InventoryTransaction.RefType.SALE,
        reference_id=sale_id, user=user,
    )


def record_repair_out(shop, variant: ProductVariant, qty: Decimal, job_id: UUID, user) -> None:
    """Called by Repair when a job is delivered/closed."""
    update_stock(
        shop=shop, variant=variant, quantity_delta=-qty,
        txn_type=InventoryTransaction.TxnType.REPAIR_OUT,
        reference_type=InventoryTransaction.RefType.JOB,
        reference_id=job_id, user=user,
    )


def record_return_in(shop, variant: ProductVariant, qty: Decimal, return_id: UUID, user) -> None:
    """Called when a customer return is approved and stock is restocked."""
    update_stock(
        shop=shop, variant=variant, quantity_delta=qty,
        txn_type=InventoryTransaction.TxnType.RETURN_IN,
        reference_type=InventoryTransaction.RefType.RETURN,
        reference_id=return_id, user=user,
    )


def record_purchase_in(shop, variant: ProductVariant, qty: Decimal, grn_id: UUID, user) -> None:
    """Called by Procurement when a GRN is received."""
    update_stock(
        shop=shop, variant=variant, quantity_delta=qty,
        txn_type=InventoryTransaction.TxnType.PURCHASE_IN,
        reference_type=InventoryTransaction.RefType.GRN,
        reference_id=grn_id, user=user,
    )


# ──────────────────────────────────────────────────────────────────────────────
# CSV bulk import
# ──────────────────────────────────────────────────────────────────────────────

BULK_IMPORT_HEADERS = [
    "name", "sku", "variant_name", "barcode",
    "selling_price", "cost_price", "wholesale_price",
    "default_tax_rate", "hsn_code", "brand",
]


def bulk_import_products(csv_text: str, user) -> dict:
    """
    Import products + variants from CSV.
    Expected headers (case-insensitive): name, sku, variant_name, barcode,
    selling_price, cost_price, wholesale_price, default_tax_rate, hsn_code, brand.

    Validates every row first; if any row fails, nothing is written
    (Spec UI AC: "CSV import validates before commit"). Otherwise all
    rows are committed atomically.

    Returns {"created": N, "updated": N, "failed": [{"row": N, "error": "..."}]}.
    """
    reader = csv.DictReader(io.StringIO(csv_text.strip()))
    rows = list(reader)

    parsed = []
    failed = []

    for i, row in enumerate(rows, start=2):
        row = {k.strip().lower(): v.strip() for k, v in row.items()}
        try:
            wholesale_price = row.get("wholesale_price") or ""
            parsed.append((i, {
                "sku": row["sku"],
                "name": row.get("name", row["sku"]),
                "hsn_code": row.get("hsn_code", ""),
                "brand": row.get("brand", ""),
                "default_tax_rate": Decimal(row.get("default_tax_rate", "18")),
                "variant_name": row.get("variant_name", "Default"),
                "barcode": row.get("barcode") or None,
                "selling_price": Decimal(row.get("selling_price", "0")),
                "cost_price": Decimal(row.get("cost_price", "0")),
                "wholesale_price": Decimal(wholesale_price) if wholesale_price else None,
            }))
        except Exception as exc:
            failed.append({"row": i, "error": str(exc)})

    if failed:
        return {"created": 0, "updated": 0, "failed": failed}

    created = updated = 0
    with transaction.atomic():
        for i, vd in parsed:
            product, prod_created = Product.objects.update_or_create(
                sku=vd["sku"],
                defaults={
                    "name": vd["name"],
                    "hsn_code": vd["hsn_code"],
                    "brand": vd["brand"],
                    "default_tax_rate": vd["default_tax_rate"],
                    "is_active": True,
                },
            )

            variant, var_created = ProductVariant.objects.update_or_create(
                product=product,
                variant_name=vd["variant_name"],
                defaults={
                    "barcode": vd["barcode"],
                    "selling_price": vd["selling_price"],
                    "cost_price": vd["cost_price"],
                    "wholesale_price": vd["wholesale_price"],
                    "is_active": True,
                },
            )

            if prod_created:
                created += 1
            else:
                updated += 1

    return {"created": created, "updated": updated, "failed": []}


# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────


def _emit_low_stock_alert(shop, variant, current_qty, reorder_level) -> None:
    logger.debug(
        "Low stock: %s @ %s — qty=%s reorder=%s",
        variant, shop.code, current_qty, reorder_level,
    )
    _send_whatsapp(
        phone=shop.phone,
        template_name="low_stock_alert",
        variables={
            "manager_name": "Manager",
            "item_name": str(variant),
            "current_qty": str(current_qty),
            "reorder_level": str(reorder_level),
        },
    )


def _send_whatsapp(phone, template_name, variables) -> None:
    from core.notifications import send_whatsapp
    send_whatsapp(phone=phone, template_name=template_name, variables=variables)
