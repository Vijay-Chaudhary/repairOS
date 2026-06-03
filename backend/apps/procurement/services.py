"""
Procurement business logic.

All state mutations live here. Views handle HTTP, models define structure.
"""

import logging
from decimal import ROUND_HALF_UP, Decimal
from typing import Optional

from django.db import transaction
from django.utils import timezone

from authentication.models import AuditLog
from core.models import DocumentCounter

from .models import (
    DebitNote,
    GoodsReceiptNote,
    GRNItem,
    PurchaseInvoice,
    PurchaseOrder,
    PurchaseOrderItem,
    PurchasePayment,
    PurchaseReturn,
    PurchaseReturnItem,
    Supplier,
)

logger = logging.getLogger(__name__)

_TWO_PLACES = Decimal("0.01")


# ──────────────────────────────────────────────────────────────────────────────
# Supplier
# ──────────────────────────────────────────────────────────────────────────────


def create_supplier(data: dict, user) -> Supplier:
    bank_number = data.pop("bank_account_number", "")
    supplier = Supplier(**data)
    supplier.set_bank_account(bank_number)
    supplier.save()
    AuditLog.objects.create(
        user_id=user.id, action="create", model_name="Supplier",
        object_id=supplier.id, new_value={"name": supplier.name},
    )
    return supplier


def update_supplier(supplier: Supplier, data: dict, user) -> Supplier:
    if "bank_account_number" in data:
        supplier.set_bank_account(data.pop("bank_account_number"))
    for attr, value in data.items():
        setattr(supplier, attr, value)
    supplier.save()
    return supplier


def get_supplier_ledger(supplier: Supplier) -> dict:
    invoices = supplier.invoices.select_related("grn").order_by("-bill_date")
    rows = []
    total_invoiced = Decimal("0")
    total_paid = Decimal("0")

    for inv in invoices:
        rows.append({
            "invoice_id": str(inv.id),
            "bill_number": inv.bill_number,
            "bill_date": str(inv.bill_date),
            "grand_total": str(inv.grand_total),
            "amount_paid": str(inv.amount_paid),
            "outstanding": str(inv.grand_total - inv.amount_paid),
            "payment_status": inv.payment_status,
        })
        total_invoiced += inv.grand_total
        total_paid += inv.amount_paid

    return {
        "invoices": rows,
        "total_invoiced": str(total_invoiced.quantize(_TWO_PLACES)),
        "total_paid": str(total_paid.quantize(_TWO_PLACES)),
        "outstanding": str((total_invoiced - total_paid).quantize(_TWO_PLACES)),
    }


# ──────────────────────────────────────────────────────────────────────────────
# Purchase Order
# ──────────────────────────────────────────────────────────────────────────────


def create_purchase_order(shop, supplier: Supplier, data: dict, user) -> PurchaseOrder:
    from inventory.models import ProductVariant
    from core.exceptions import BusinessRuleViolation

    items_data = data["items"]

    now = timezone.now()
    seq = DocumentCounter.next(shop, now.year, DocumentCounter.DocType.PURCHASE_ORDER)
    po_number = f"{shop.code}-PO-{now.year}-{seq:04d}"

    with transaction.atomic():
        po = PurchaseOrder.objects.create(
            shop=shop,
            supplier=supplier,
            po_number=po_number,
            status=PurchaseOrder.Status.DRAFT,
            expected_delivery_date=data.get("expected_delivery_date"),
            notes=data.get("notes", ""),
            created_by=user,
        )

        for item_data in items_data:
            try:
                variant = ProductVariant.objects.get(id=item_data["variant_id"])
            except ProductVariant.DoesNotExist:
                raise BusinessRuleViolation(f"Variant {item_data['variant_id']} not found.")

            qty = Decimal(str(item_data["quantity_ordered"]))
            cost = Decimal(str(item_data["unit_cost"]))
            tax_rate = Decimal(str(item_data.get("tax_rate", 18)))
            line_total = (qty * cost * (1 + tax_rate / 100)).quantize(_TWO_PLACES, ROUND_HALF_UP)

            PurchaseOrderItem.objects.create(
                po=po,
                variant=variant,
                quantity_ordered=qty,
                unit_cost=cost,
                tax_rate=tax_rate,
                hsn_code=item_data.get("hsn_code", ""),
                line_total=line_total,
            )

    AuditLog.objects.create(
        user_id=user.id, action="create", model_name="PurchaseOrder",
        object_id=po.id, new_value={"po_number": po_number},
    )
    return po


def update_purchase_order(po: PurchaseOrder, data: dict, user) -> PurchaseOrder:
    from core.exceptions import BusinessRuleViolation

    new_status = data.get("status")
    if new_status:
        # Validate allowed transitions
        allowed = {
            PurchaseOrder.Status.DRAFT: [PurchaseOrder.Status.SENT, PurchaseOrder.Status.CANCELLED],
            PurchaseOrder.Status.SENT: [PurchaseOrder.Status.CANCELLED],
        }
        current = po.status
        if current not in allowed or new_status not in allowed.get(current, []):
            raise BusinessRuleViolation(
                f"Cannot transition PO from '{current}' to '{new_status}'."
            )
        po.status = new_status

        if new_status == PurchaseOrder.Status.SENT:
            _notify_po_sent(po)

    if "expected_delivery_date" in data:
        po.expected_delivery_date = data["expected_delivery_date"]
    if "notes" in data:
        po.notes = data["notes"]

    po.save()
    return po


# ──────────────────────────────────────────────────────────────────────────────
# GRN
# ──────────────────────────────────────────────────────────────────────────────


def receive_grn(shop, po: PurchaseOrder, data: dict, user) -> GoodsReceiptNote:
    """
    Create GRN, post purchase_in for each accepted line, update PO status.
    All inside one DB transaction.
    """
    from core.exceptions import BusinessRuleViolation
    from inventory.services import record_purchase_in

    if po.status not in (PurchaseOrder.Status.SENT, PurchaseOrder.Status.PARTIALLY_RECEIVED):
        raise BusinessRuleViolation(
            f"Cannot receive GRN against PO with status '{po.status}'."
        )

    now = timezone.now()
    seq = DocumentCounter.next(shop, now.year, DocumentCounter.DocType.GRN)
    grn_number = f"{shop.code}-GRN-{now.year}-{seq:04d}"

    with transaction.atomic():
        grn = GoodsReceiptNote.objects.create(
            shop=shop,
            po=po,
            grn_number=grn_number,
            received_date=data["received_date"],
            received_by=user,
            challan_number=data.get("challan_number", ""),
            notes=data.get("notes", ""),
        )

        received_item_map = {}  # po_item_id → quantity_accepted

        for item_data in data["items"]:
            try:
                po_item = PurchaseOrderItem.objects.get(id=item_data["po_item_id"], po=po)
            except PurchaseOrderItem.DoesNotExist:
                raise BusinessRuleViolation(
                    f"PO item {item_data['po_item_id']} does not belong to this PO."
                )

            q_received = Decimal(str(item_data["quantity_received"]))
            q_accepted = Decimal(str(item_data["quantity_accepted"]))
            q_rejected = Decimal(str(item_data.get("quantity_rejected", 0)))

            GRNItem.objects.create(
                grn=grn,
                po_item=po_item,
                quantity_received=q_received,
                quantity_accepted=q_accepted,
                quantity_rejected=q_rejected,
                rejection_reason=item_data.get("rejection_reason", ""),
            )

            if q_accepted > 0:
                record_purchase_in(
                    shop=shop,
                    variant=po_item.variant,
                    qty=q_accepted,
                    grn_id=grn.id,
                    user=user,
                )
                received_item_map[str(po_item.id)] = q_accepted

        # Update PO status
        _refresh_po_status(po)

    logger.info("GRN %s created for PO %s", grn_number, po.po_number)
    return grn


def _refresh_po_status(po: PurchaseOrder) -> None:
    """Set PO to partially_received or received based on GRN totals."""
    po_items = list(po.items.all())
    total_ordered = {str(i.id): i.quantity_ordered for i in po_items}

    # Sum all accepted quantities across all GRNs for this PO
    from django.db.models import Sum
    from decimal import Decimal as D

    for po_item in po_items:
        accepted = po_item.grn_items.aggregate(total=Sum("quantity_accepted"))["total"] or D("0")
        if accepted < po_item.quantity_ordered:
            po.status = PurchaseOrder.Status.PARTIALLY_RECEIVED
            po.save(update_fields=["status"])
            return

    po.status = PurchaseOrder.Status.RECEIVED
    po.save(update_fields=["status"])


# ──────────────────────────────────────────────────────────────────────────────
# Purchase Invoice
# ──────────────────────────────────────────────────────────────────────────────


def create_purchase_invoice(shop, supplier: Supplier, data: dict, user) -> PurchaseInvoice:
    from core.exceptions import BusinessRuleViolation

    grn = None
    if grn_id := data.get("grn_id"):
        try:
            grn = GoodsReceiptNote.objects.get(id=grn_id, shop=shop)
        except GoodsReceiptNote.DoesNotExist:
            raise BusinessRuleViolation(f"GRN {grn_id} not found for this shop.")

    subtotal = Decimal(str(data["subtotal"]))
    tax_rate = Decimal(str(data.get("tax_rate", 18)))
    total_tax = (subtotal * tax_rate / 100).quantize(_TWO_PLACES, ROUND_HALF_UP)
    cgst, sgst, igst = _split_purchase_gst(shop, supplier, total_tax)
    grand_total = subtotal + total_tax

    invoice = PurchaseInvoice.objects.create(
        shop=shop,
        supplier=supplier,
        grn=grn,
        bill_number=data["bill_number"],
        bill_date=data["bill_date"],
        subtotal=subtotal,
        cgst=cgst,
        sgst=sgst,
        igst=igst,
        grand_total=grand_total,
        payment_status=PurchaseInvoice.PaymentStatus.UNPAID,
        due_date=data.get("due_date"),
        amount_paid=Decimal("0"),
    )

    AuditLog.objects.create(
        user_id=user.id, action="create", model_name="PurchaseInvoice",
        object_id=invoice.id,
        new_value={"bill_number": invoice.bill_number, "grand_total": str(grand_total)},
    )
    return invoice


def _split_purchase_gst(shop, supplier: Supplier, total_tax: Decimal):
    """
    Intra-state (shop.state_code == supplier.state_code) → CGST + SGST.
    Inter-state → IGST.
    """
    shop_state = shop.state_code
    supplier_state = supplier.state_code if supplier.state_code else shop_state

    if shop_state == supplier_state:
        half = (total_tax / Decimal("2")).quantize(_TWO_PLACES, ROUND_HALF_UP)
        return half, total_tax - half, Decimal("0")
    else:
        return Decimal("0"), Decimal("0"), total_tax


# ──────────────────────────────────────────────────────────────────────────────
# Purchase Payment
# ──────────────────────────────────────────────────────────────────────────────


def record_purchase_payment(invoice: PurchaseInvoice, data: dict, user) -> PurchasePayment:
    from core.exceptions import BusinessRuleViolation

    amount = Decimal(str(data["amount"]))
    outstanding = invoice.grand_total - invoice.amount_paid

    if amount > outstanding:
        raise BusinessRuleViolation(
            f"Payment amount {amount} exceeds outstanding balance {outstanding}."
        )

    with transaction.atomic():
        payment = PurchasePayment.objects.create(
            purchase_invoice=invoice,
            amount=amount,
            method=data["method"],
            reference_id=data.get("reference_id", ""),
            recorded_by=user,
        )

        invoice.amount_paid += amount
        if invoice.amount_paid >= invoice.grand_total:
            invoice.payment_status = PurchaseInvoice.PaymentStatus.PAID
        else:
            invoice.payment_status = PurchaseInvoice.PaymentStatus.PARTIALLY_PAID
        invoice.save(update_fields=["amount_paid", "payment_status"])

    return payment


# ──────────────────────────────────────────────────────────────────────────────
# Purchase Return + Debit Note
# ──────────────────────────────────────────────────────────────────────────────


def create_purchase_return(invoice: PurchaseInvoice, data: dict, user) -> PurchaseReturn:
    from inventory.models import ProductVariant
    from core.exceptions import BusinessRuleViolation

    shop = invoice.shop
    now = timezone.now()
    # Return number: shop-PR-YYYY-NNNN (using PURCHASE_ORDER counter family; or a dedicated key)
    seq = DocumentCounter.next(shop, now.year, DocumentCounter.DocType.PURCHASE_ORDER)
    return_number = f"{shop.code}-PR-{now.year}-{seq:04d}"

    with transaction.atomic():
        total_amount = Decimal("0")

        ret = PurchaseReturn.objects.create(
            purchase_invoice=invoice,
            return_number=return_number,
            reason=data["reason"],
            status=PurchaseReturn.Status.PENDING,
            total_amount=Decimal("0"),
            created_by=user,
        )

        for item_data in data["items"]:
            try:
                variant = ProductVariant.objects.get(id=item_data["variant_id"])
            except ProductVariant.DoesNotExist:
                raise BusinessRuleViolation(f"Variant {item_data['variant_id']} not found.")

            qty = Decimal(str(item_data["quantity"]))
            unit_cost = Decimal(str(item_data["unit_cost"]))
            line_total = (qty * unit_cost).quantize(_TWO_PLACES, ROUND_HALF_UP)
            total_amount += line_total

            PurchaseReturnItem.objects.create(
                purchase_return=ret,
                variant=variant,
                quantity=qty,
                unit_cost=unit_cost,
                line_total=line_total,
            )

        ret.total_amount = total_amount
        ret.save(update_fields=["total_amount"])

    return ret


def dispatch_purchase_return(ret: PurchaseReturn, user) -> PurchaseReturn:
    """
    Dispatch a purchase return:
    - Post return_out transaction per line item (reduces stock).
    - Generate debit note.
    - Update status to dispatched.
    """
    from core.exceptions import BusinessRuleViolation
    from inventory.services import update_stock
    from inventory.models import InventoryTransaction

    if ret.status == PurchaseReturn.Status.DISPATCHED:
        raise BusinessRuleViolation("This return is already dispatched.")

    shop = ret.purchase_invoice.shop
    now = timezone.now()

    with transaction.atomic():
        for item in ret.items.select_related("variant"):
            update_stock(
                shop=shop,
                variant=item.variant,
                quantity_delta=-item.quantity,
                txn_type=InventoryTransaction.TxnType.RETURN_OUT,
                reference_type=InventoryTransaction.RefType.RETURN,
                reference_id=ret.id,
                note=f"Purchase return {ret.return_number}",
                user=user,
            )

        seq = DocumentCounter.next(
            shop, now.year, DocumentCounter.DocType.DEBIT_NOTE, month=now.month
        )
        dn_number = f"{shop.code}-DN-{now.year}-{now.month:02d}-{seq:04d}"

        DebitNote.objects.create(
            purchase_return=ret,
            debit_note_number=dn_number,
            amount=ret.total_amount,
        )

        ret.status = PurchaseReturn.Status.DISPATCHED
        ret.save(update_fields=["status"])

    logger.info("Purchase return %s dispatched; debit note %s issued.", ret.return_number, dn_number)
    return ret


# ──────────────────────────────────────────────────────────────────────────────
# Notifications
# ──────────────────────────────────────────────────────────────────────────────


def _notify_po_sent(po: PurchaseOrder) -> None:
    if not po.supplier.email:
        return
    logger.info(
        "PO confirmation: supplier=%s po=%s delivery=%s",
        po.supplier.name, po.po_number, po.expected_delivery_date,
    )
