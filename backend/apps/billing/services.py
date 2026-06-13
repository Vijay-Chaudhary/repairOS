"""
Billing business logic.

All state mutations live here. Views handle HTTP, models define structure.
"""

import csv
import hashlib
import hmac
import io
import logging
from decimal import ROUND_HALF_UP, Decimal

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from authentication.models import AuditLog
from core.models import DocumentCounter

from .models import Payment, RepairInvoice, RepairInvoiceItem

logger = logging.getLogger(__name__)

_TWO_PLACES = Decimal("0.01")

# Default GST rate applied to repair labor (SAC 998714 — repair & maintenance).
# Replace with shop-level config when platform-admin module is built.
LABOR_GST_RATE = Decimal("18.00")
LABOR_SAC_CODE = "998714"


# ──────────────────────────────────────────────────────────────────────────────
# Invoice creation
# ──────────────────────────────────────────────────────────────────────────────


def create_repair_invoice(job, data: dict, user) -> RepairInvoice:
    """
    Build a GST-compliant repair invoice from a job ticket.

    Lines:
      - Labor: job.service_charge @ 18% GST, SAC 998714
      - Components: received spare-part requests (custom_part_name or variant description)

    GST split:
      - Intra-state (shop.state_code == customer GSTIN[:2]): CGST + SGST
      - Inter-state: IGST only
    """
    from core.exceptions import BusinessRuleViolation

    if RepairInvoice.objects.filter(job=job).exists():
        raise ValueError("An invoice already exists for this job.")

    customer = job.customer
    shop = job.shop
    discount_amount = Decimal(str(data.get("discount_amount", "0"))).quantize(_TWO_PLACES)
    due_date = data.get("due_date")

    items_data = _build_line_items(job)
    if not items_data:
        raise BusinessRuleViolation("Cannot create an invoice with no billable items.")
    subtotal = sum((i["line_subtotal"] for i in items_data), Decimal("0")).quantize(_TWO_PLACES)

    # Discount scale (applied proportionally to each line's tax)
    scale = (1 - discount_amount / subtotal) if subtotal > 0 else Decimal("1")
    total_tax = sum((i["line_tax"] for i in items_data), Decimal("0")) * scale
    total_tax = total_tax.quantize(_TWO_PLACES, rounding=ROUND_HALF_UP)

    cgst, sgst, igst = _split_gst(shop, customer, total_tax)
    grand_total = (subtotal - discount_amount + cgst + sgst + igst).quantize(_TWO_PLACES)

    now = timezone.now()
    seq = DocumentCounter.next(
        shop, now.year, DocumentCounter.DocType.REPAIR_INVOICE, month=now.month
    )
    invoice_number = f"{shop.code}-INV-{now.year}-{now.month:02d}-{seq:04d}"

    with transaction.atomic():
        invoice = RepairInvoice.objects.create(
            shop=shop,
            job=job,
            customer=customer,
            invoice_number=invoice_number,
            status=RepairInvoice.Status.ISSUED,
            subtotal=subtotal,
            discount_amount=discount_amount,
            cgst=cgst,
            sgst=sgst,
            igst=igst,
            grand_total=grand_total,
            amount_paid=Decimal("0"),
            amount_outstanding=grand_total,
            due_date=due_date,
        )

        for item in items_data:
            RepairInvoiceItem.objects.create(
                invoice=invoice,
                item_type=item["item_type"],
                description=item["description"],
                sac_code=item.get("sac_code", ""),
                hsn_code=item.get("hsn_code", ""),
                quantity=item["quantity"],
                unit_price=item["unit_price"],
                tax_rate=item["tax_rate"],
                line_total=item["line_subtotal"],
            )

        _update_crm_on_invoice(customer, grand_total)

    logger.info("Invoice %s created for job %s", invoice_number, job.job_number)
    _write_audit(user, AuditLog.Action.CREATE, "RepairInvoice", invoice.id)

    # Queue PDF generation asynchronously
    try:
        from core.context import get_tenant_db_alias
        from billing.tasks import generate_invoice_pdf
        alias = get_tenant_db_alias() or ""
        tenant_slug = alias.removeprefix("tenant_") if alias.startswith("tenant_") else ""
        generate_invoice_pdf.delay(str(invoice.id), tenant_slug)
    except Exception as exc:
        logger.warning("Could not queue PDF generation for invoice %s: %s", invoice.id, exc)

    return invoice


def _build_line_items(job) -> list[dict]:
    """Return list of line item dicts for a job."""
    from repair.models import JobSparePartRequest

    items = []

    # Labor line
    if job.service_charge > 0:
        line_tax = (job.service_charge * LABOR_GST_RATE / 100).quantize(_TWO_PLACES)
        items.append({
            "item_type": RepairInvoiceItem.ItemType.LABOR,
            "description": "Service Charge",
            "sac_code": LABOR_SAC_CODE,
            "quantity": Decimal("1"),
            "unit_price": job.service_charge,
            "tax_rate": LABOR_GST_RATE,
            "line_subtotal": job.service_charge,
            "line_tax": line_tax,
        })

    # Component lines — only received/approved spare part requests
    received_parts = list(
        job.spare_part_requests.filter(status=JobSparePartRequest.RequestStatus.RECEIVED)
    )

    # Bulk-fetch variant info for all parts that reference an inventory variant
    variant_ids = {p.variant_id for p in received_parts if p.variant_id}
    variant_map: dict = {}
    if variant_ids:
        try:
            from inventory.models import ProductVariant
            variant_map = {
                str(v.id): v
                for v in ProductVariant.objects.filter(id__in=variant_ids)
            }
        except Exception:
            pass  # inventory module not yet available; fall back to ₹0

    for part in received_parts:
        variant = variant_map.get(str(part.variant_id)) if part.variant_id else None

        # Prefer explicit custom name; fall back to variant name, never expose raw UUID
        if part.custom_part_name:
            description = part.custom_part_name
        elif variant:
            description = variant.variant_name
        else:
            description = "Part"

        # Use variant cost_price so invoice and GSTR-1 reflect actual parts cost
        unit_price = variant.cost_price if variant else Decimal("0")
        line_subtotal = (unit_price * Decimal(str(part.quantity))).quantize(_TWO_PLACES)
        items.append({
            "item_type": RepairInvoiceItem.ItemType.COMPONENT,
            "description": description,
            "hsn_code": "",
            "quantity": Decimal(str(part.quantity)),
            "unit_price": unit_price,
            "tax_rate": Decimal("0"),
            "line_subtotal": line_subtotal,
            "line_tax": Decimal("0"),
        })

    return items


def _split_gst(shop, customer, total_tax: Decimal) -> tuple[Decimal, Decimal, Decimal]:
    """Return (cgst, sgst, igst) based on intra/inter-state determination."""
    shop_state = shop.state_code
    if customer and customer.gstin and len(customer.gstin) >= 2:
        counterparty_state = customer.gstin[:2]
    else:
        counterparty_state = shop_state  # default intra-state

    if counterparty_state == shop_state:
        half = (total_tax / 2).quantize(_TWO_PLACES, rounding=ROUND_HALF_UP)
        return half, total_tax - half, Decimal("0")
    return Decimal("0"), Decimal("0"), total_tax


def _update_crm_on_invoice(customer, grand_total: Decimal) -> None:
    from django.db.models import F
    customer.__class__.objects.filter(pk=customer.pk).update(
        total_billed=F("total_billed") + grand_total,
        total_outstanding=F("total_outstanding") + grand_total,
    )


# ──────────────────────────────────────────────────────────────────────────────
# Payment recording
# ──────────────────────────────────────────────────────────────────────────────


def record_payment(invoice: RepairInvoice, data: dict, user) -> Payment:
    from core.exceptions import BusinessRuleViolation

    razorpay_id = data.get("razorpay_payment_id") or None
    if razorpay_id:
        existing = Payment.objects.filter(razorpay_payment_id=razorpay_id).first()
        if existing:
            logger.warning("Duplicate Razorpay payment %s — skipping", razorpay_id)
            return existing

    amount = Decimal(str(data["amount"])).quantize(_TWO_PLACES)
    outstanding = invoice.amount_outstanding

    if amount > outstanding:
        raise BusinessRuleViolation(
            f"Payment {amount} exceeds outstanding {outstanding}."
        )

    paid_at = data.get("paid_at") or timezone.now()

    with transaction.atomic():
        payment = Payment.objects.create(
            invoice=invoice,
            amount=amount,
            method=data["method"],
            reference_id=data.get("reference_id", ""),
            razorpay_payment_id=razorpay_id,
            razorpay_order_id=data.get("razorpay_order_id", ""),
            paid_at=paid_at,
            recorded_by=user,
            notes=data.get("notes", ""),
        )

        invoice.amount_paid = (invoice.amount_paid + amount).quantize(_TWO_PLACES)
        invoice.amount_outstanding = (invoice.amount_outstanding - amount).quantize(_TWO_PLACES)

        if invoice.amount_outstanding <= 0:
            invoice.amount_outstanding = Decimal("0")
            invoice.status = RepairInvoice.Status.PAID
        else:
            invoice.status = RepairInvoice.Status.PARTIALLY_PAID

        invoice.save(update_fields=["amount_paid", "amount_outstanding", "status"])

        _update_crm_on_payment(invoice.customer, amount)

    _write_audit(user, AuditLog.Action.CREATE, "Payment", payment.id)
    return payment


def _write_audit(user, action, model_name, object_id) -> None:
    try:
        AuditLog.objects.create(
            user_id=user.id if user else None,
            action=action,
            model_name=model_name,
            object_id=object_id,
        )
    except Exception:
        logger.exception("Audit log write failed")


def _update_crm_on_payment(customer, amount: Decimal) -> None:
    from django.db.models import F
    customer.__class__.objects.filter(pk=customer.pk).update(
        total_outstanding=F("total_outstanding") - amount,
    )


# ──────────────────────────────────────────────────────────────────────────────
# Razorpay webhook
# ──────────────────────────────────────────────────────────────────────────────


def verify_razorpay_signature(payload: bytes, signature: str) -> bool:
    secret = getattr(settings, "RAZORPAY_WEBHOOK_SECRET", "")
    expected = hmac.new(secret.encode(), payload, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, signature)


def handle_razorpay_webhook(payload: bytes, signature: str) -> Payment | None:
    """
    Verify HMAC signature, extract payment data, record against invoice.
    Returns Payment if recorded, None if event type is not payment.captured.
    Duplicate razorpay_payment_id is silently ignored (idempotent).
    """
    import json

    if not verify_razorpay_signature(payload, signature):
        raise ValueError("Invalid Razorpay signature.")

    data = json.loads(payload)
    event = data.get("event")
    if event != "payment.captured":
        return None

    entity = data["payload"]["payment"]["entity"]
    razorpay_payment_id = entity["id"]
    razorpay_order_id = entity.get("order_id", "")
    amount_paise = entity["amount"]
    amount = Decimal(str(amount_paise)) / 100
    notes = entity.get("notes", {})
    invoice_id = notes.get("invoice_id")

    if not invoice_id:
        logger.warning("Razorpay webhook: no invoice_id in notes for %s", razorpay_payment_id)
        return None

    try:
        invoice = RepairInvoice.objects.get(id=invoice_id)
    except RepairInvoice.DoesNotExist:
        logger.error("Razorpay webhook: invoice %s not found", invoice_id)
        return None

    _METHOD_MAP = {
        "upi": Payment.Method.UPI,
        "card": Payment.Method.CARD,
        "netbanking": Payment.Method.NEFT,
        "cheque": Payment.Method.CHEQUE,
    }
    method = _METHOD_MAP.get(entity.get("method", ""), Payment.Method.OTHER)

    return record_payment(invoice, {
        "amount": str(amount),
        "method": method,
        "razorpay_payment_id": razorpay_payment_id,
        "razorpay_order_id": razorpay_order_id,
    }, user=None)


# ──────────────────────────────────────────────────────────────────────────────
# Tally export
# ──────────────────────────────────────────────────────────────────────────────


def tally_export_csv(shop, from_date, to_date) -> str:
    """
    Generate GSTR-1 compatible CSV for the given date range.
    Returns CSV string.
    """
    invoices = (
        RepairInvoice.objects
        .filter(shop=shop, created_at__date__gte=from_date, created_at__date__lte=to_date)
        .exclude(status=RepairInvoice.Status.CANCELLED)
        .select_related("customer", "job")
        .order_by("created_at")
    )

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "invoice_number", "date", "customer_name", "gstin",
        "subtotal", "discount_amount", "cgst", "sgst", "igst", "grand_total",
        "amount_paid", "amount_outstanding", "status",
    ])

    for inv in invoices:
        writer.writerow([
            inv.invoice_number,
            inv.created_at.strftime("%Y-%m-%d"),
            inv.customer.name,
            inv.customer.gstin or "",
            str(inv.subtotal),
            str(inv.discount_amount),
            str(inv.cgst),
            str(inv.sgst),
            str(inv.igst),
            str(inv.grand_total),
            str(inv.amount_paid),
            str(inv.amount_outstanding),
            inv.status,
        ])

    return output.getvalue()
