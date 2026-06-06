"""
POS business logic.
"""

import logging
from decimal import ROUND_HALF_UP, Decimal
from typing import Optional

from django.db import transaction
from django.utils import timezone

from authentication.models import AuditLog
from core.models import DocumentCounter

from .models import CreditNote, Sale, SaleItem, SalePayment, SalesReturn

logger = logging.getLogger(__name__)

_TWO_PLACES = Decimal("0.01")


# ──────────────────────────────────────────────────────────────────────────────
# Sale creation
# ──────────────────────────────────────────────────────────────────────────────


def create_sale(shop, data: dict, user) -> Sale:
    """
    Atomically create a sale with its items and payments.

    data keys:
      sale_type, customer, job_id (optional), items (list), payments (list),
      discount_type, discount_value, notes
    """
    from core.exceptions import BusinessRuleViolation

    sale_type = data["sale_type"]
    customer = data.get("customer")
    job_id = data.get("job_id")
    items_data = data["items"]
    payments_data = data.get("payments", [])

    # Wholesale requires customer with credit-limit check
    if sale_type == Sale.SaleType.WHOLESALE:
        if not customer:
            raise BusinessRuleViolation("Wholesale sales require a customer.")
        _check_credit_limit(customer, _calculate_grand_total_estimate(items_data, data))

    # Job-linked requires job_id
    if sale_type == Sale.SaleType.JOB_LINKED and not job_id:
        raise BusinessRuleViolation("Job-linked sales require a job_id.")

    now = timezone.now()
    number = DocumentCounter.next(
        shop, now.year, DocumentCounter.DocType.SALES_INVOICE, month=now.month
    )
    sale_number = f"{shop.code}-SALE-{now.year}-{now.month:02d}-{number:04d}"

    with transaction.atomic():
        # ── Build line items ──────────────────────────────────────────────────
        items_built, subtotal = _build_items(items_data)

        # ── Sale-level discount ───────────────────────────────────────────────
        discount_type = data.get("discount_type", Sale.DiscountType.NONE)
        discount_value = Decimal(str(data.get("discount_value", 0)))
        discount_amount = _calc_discount(subtotal, discount_type, discount_value)

        # ── GST ───────────────────────────────────────────────────────────────
        taxable = subtotal - discount_amount
        cgst, sgst, igst = _split_gst(shop, customer, items_built, discount_amount, subtotal)
        total_tax = cgst + sgst + igst

        grand_total = (taxable + total_tax).quantize(_TWO_PLACES, rounding=ROUND_HALF_UP)

        # ── Build payments ────────────────────────────────────────────────────
        amount_paid = sum(
            (Decimal(str(p["amount"])) for p in payments_data), Decimal("0")
        ).quantize(_TWO_PLACES, rounding=ROUND_HALF_UP)
        amount_outstanding = (grand_total - amount_paid).quantize(_TWO_PLACES, rounding=ROUND_HALF_UP)

        # ── Derive status ─────────────────────────────────────────────────────
        if amount_paid >= grand_total:
            sale_status = Sale.Status.COMPLETED
            amount_outstanding = Decimal("0")
        elif amount_paid > 0:
            sale_status = Sale.Status.PARTIALLY_PAID
        else:
            sale_status = Sale.Status.DRAFT

        # ── Persist ───────────────────────────────────────────────────────────
        sale = Sale.objects.create(
            shop=shop,
            sale_type=sale_type,
            customer=customer,
            job_id=job_id,
            sale_number=sale_number,
            status=sale_status,
            subtotal=subtotal,
            discount_type=discount_type,
            discount_value=discount_value,
            discount_amount=discount_amount,
            cgst=cgst,
            sgst=sgst,
            igst=igst,
            grand_total=grand_total,
            amount_paid=amount_paid,
            amount_outstanding=amount_outstanding,
            notes=data.get("notes", ""),
            created_by=user,
        )

        for item_data in items_built:
            SaleItem.objects.create(sale=sale, **item_data)

        for pay_data in payments_data:
            _record_payment(sale, pay_data, user)

        # ── Post-completion side-effects ──────────────────────────────────────
        if sale_status == Sale.Status.COMPLETED and sale_type != Sale.SaleType.JOB_LINKED:
            _deduct_stock(items_built)

        if sale_status == Sale.Status.COMPLETED and sale_type == Sale.SaleType.WHOLESALE:
            _update_customer_outstanding(customer, amount_outstanding)

    _write_audit(user, AuditLog.Action.CREATE, "Sale", sale.id)
    _broadcast(shop.id, "sale.completed", {
        "sale_id": str(sale.id),
        "sale_number": sale.sale_number,
        "grand_total": str(sale.grand_total),
        "sale_type": sale.sale_type,
    })

    return sale


def add_payment(sale: Sale, payment_data: dict, user) -> Sale:
    """Add a payment to an existing sale, updating its status."""
    from core.exceptions import BusinessRuleViolation

    if sale.status in (Sale.Status.CANCELLED, Sale.Status.RETURNED):
        raise BusinessRuleViolation(f"Cannot add payment to a {sale.status} sale.")

    with transaction.atomic():
        _record_payment(sale, payment_data, user)

        # Recalculate amount_paid from DB to avoid race conditions
        from django.db.models import Sum
        total = sale.payments.aggregate(t=Sum("amount"))["t"] or Decimal("0")
        sale.amount_paid = Decimal(str(total)).quantize(_TWO_PLACES, rounding=ROUND_HALF_UP)
        sale.amount_outstanding = (sale.grand_total - sale.amount_paid).quantize(
            _TWO_PLACES, rounding=ROUND_HALF_UP
        )
        if sale.amount_paid >= sale.grand_total:
            sale.status = Sale.Status.COMPLETED
            sale.amount_outstanding = Decimal("0")
            _deduct_stock_for_sale(sale)
        else:
            sale.status = Sale.Status.PARTIALLY_PAID

        sale.save(update_fields=["amount_paid", "amount_outstanding", "status", "updated_at"])

    return sale


# ──────────────────────────────────────────────────────────────────────────────
# Returns
# ──────────────────────────────────────────────────────────────────────────────


def create_return(sale: Sale, data: dict, user) -> SalesReturn:
    from core.exceptions import BusinessRuleViolation

    if sale.status not in (Sale.Status.COMPLETED, Sale.Status.PARTIALLY_PAID):
        raise BusinessRuleViolation("Only completed or partially-paid sales can be returned.")

    total_refund_amount = data.get("total_refund_amount")
    if total_refund_amount is None:
        items_input = data.get("items", [])
        total_refund_amount = _compute_return_refund(sale, items_input)

    now = timezone.now()
    number = DocumentCounter.next(
        sale.shop, now.year, DocumentCounter.DocType.SALES_RETURN, month=now.month
    )
    return_number = f"{sale.shop.code}-RET-{now.year}-{now.month:02d}-{number:04d}"

    ret = SalesReturn.objects.create(
        sale=sale,
        return_number=return_number,
        reason=data["reason"],
        total_refund_amount=Decimal(str(total_refund_amount)),
        refund_method=data["refund_method"],
    )
    _write_audit(user, AuditLog.Action.CREATE, "SalesReturn", ret.id)
    return ret


def approve_return(ret: SalesReturn, user) -> SalesReturn:
    from core.exceptions import BusinessRuleViolation

    if ret.status != SalesReturn.Status.PENDING:
        raise BusinessRuleViolation(f"Cannot approve a return with status '{ret.status}'.")

    with transaction.atomic():
        ret.status = SalesReturn.Status.APPROVED
        ret.approved_by = user
        ret.approved_at = timezone.now()
        ret.save(update_fields=["status", "approved_by", "approved_at", "updated_at"])

        # Restock inventory (stub — wire to inventory module when built)
        _restock_items(ret.sale)

        # Issue credit note
        cn = _issue_credit_note(ret, user)

        # Update sale status
        ret.sale.status = Sale.Status.RETURNED
        ret.sale.save(update_fields=["status", "updated_at"])

        # Update customer outstanding for wholesale credit sales
        if ret.sale.sale_type == Sale.SaleType.WHOLESALE and ret.sale.customer:
            _update_customer_outstanding(ret.sale.customer, -ret.total_refund_amount)

    _send_whatsapp(
        phone=ret.sale.customer.phone if ret.sale.customer else None,
        template_name="credit_note_issued",
        variables={
            "customer_name": ret.sale.customer.name if ret.sale.customer else "",
            "credit_note_number": cn.credit_note_number,
            "amount": str(cn.amount),
            "invoice_link": "",
        },
        customer=ret.sale.customer,
    )
    return ret


def reject_return(ret: SalesReturn, user) -> SalesReturn:
    from core.exceptions import BusinessRuleViolation

    if ret.status != SalesReturn.Status.PENDING:
        raise BusinessRuleViolation(f"Cannot reject a return with status '{ret.status}'.")

    ret.status = SalesReturn.Status.REJECTED
    ret.approved_by = user
    ret.approved_at = timezone.now()
    ret.save(update_fields=["status", "approved_by", "approved_at", "updated_at"])
    return ret


# ──────────────────────────────────────────────────────────────────────────────
# Internal helpers
# ──────────────────────────────────────────────────────────────────────────────


def _build_items(items_data: list) -> tuple[list, Decimal]:
    """Build item dicts and compute total subtotal."""
    built = []
    subtotal = Decimal("0")

    for item in items_data:
        qty = Decimal(str(item["quantity"]))
        unit_price = Decimal(str(item["unit_price"]))
        disc_per_unit = Decimal(str(item.get("discount_per_unit", 0)))
        tax_rate = Decimal(str(item.get("tax_rate", 0)))

        line_subtotal = (qty * (unit_price - disc_per_unit)).quantize(_TWO_PLACES, rounding=ROUND_HALF_UP)
        line_tax = (line_subtotal * tax_rate / Decimal("100")).quantize(_TWO_PLACES, rounding=ROUND_HALF_UP)
        line_total = line_subtotal + line_tax

        subtotal += line_subtotal
        built.append({
            "variant_id": item.get("variant_id"),
            "product_name_snapshot": item.get("product_name_snapshot", "Product"),
            "variant_name_snapshot": item.get("variant_name_snapshot", ""),
            "hsn_code": item.get("hsn_code", ""),
            "quantity": qty,
            "unit_price": unit_price,
            "discount_per_unit": disc_per_unit,
            "tax_rate": tax_rate,
            "line_subtotal": line_subtotal,
            "line_tax": line_tax,
            "line_total": line_total,
        })

    return built, subtotal.quantize(_TWO_PLACES, rounding=ROUND_HALF_UP)


def _calc_discount(subtotal: Decimal, discount_type: str, discount_value: Decimal) -> Decimal:
    if discount_type == Sale.DiscountType.FLAT:
        return min(discount_value, subtotal).quantize(_TWO_PLACES, rounding=ROUND_HALF_UP)
    if discount_type == Sale.DiscountType.PERCENTAGE:
        return (subtotal * discount_value / Decimal("100")).quantize(_TWO_PLACES, rounding=ROUND_HALF_UP)
    return Decimal("0")


def _split_gst(shop, customer, items_built: list, discount_amount: Decimal, subtotal: Decimal) -> tuple:
    """
    Split total tax into CGST+SGST (intra-state) or IGST (inter-state).
    GST rate comes from each item's tax_rate; discount is applied proportionally.
    """
    scale = (Decimal("1") - discount_amount / subtotal) if subtotal > 0 else Decimal("1")
    total_tax = sum(
        item["line_tax"] for item in items_built
    ) * scale

    total_tax = total_tax.quantize(_TWO_PLACES, rounding=ROUND_HALF_UP)

    # Determine intra/inter state
    shop_state = shop.state_code
    if customer and customer.gstin and len(customer.gstin) >= 2:
        counterparty_state = customer.gstin[:2]
    else:
        counterparty_state = shop_state  # default intra-state

    if counterparty_state == shop_state:
        half = (total_tax / Decimal("2")).quantize(_TWO_PLACES, rounding=ROUND_HALF_UP)
        return half, total_tax - half, Decimal("0")
    else:
        return Decimal("0"), Decimal("0"), total_tax


def _record_payment(sale: Sale, pay_data: dict, user) -> SalePayment:
    razorpay_id = pay_data.get("razorpay_payment_id", "")
    if razorpay_id and SalePayment.objects.filter(razorpay_payment_id=razorpay_id).exists():
        logger.warning("Duplicate Razorpay payment id %s — skipping", razorpay_id)
        return None

    return SalePayment.objects.create(
        sale=sale,
        amount=Decimal(str(pay_data["amount"])),
        method=pay_data["method"],
        reference_id=pay_data.get("reference_id", ""),
        razorpay_payment_id=razorpay_id,
        recorded_by=user,
    )


def _compute_return_refund(sale: Sale, items_input: list) -> Decimal:
    """Derive total refund amount from a list of {sale_item_id, quantity} entries."""
    total = Decimal("0")
    for item_data in items_input:
        try:
            item = sale.items.get(pk=item_data["sale_item_id"])
        except SaleItem.DoesNotExist:
            continue
        qty = Decimal(str(item_data["quantity"]))
        line_unit_total = (item.line_total / item.quantity) if item.quantity else Decimal("0")
        total += (line_unit_total * qty).quantize(_TWO_PLACES, rounding=ROUND_HALF_UP)
    return total


def _issue_credit_note(ret: SalesReturn, user) -> CreditNote:
    now = timezone.now()
    number = DocumentCounter.next(
        ret.sale.shop, now.year, DocumentCounter.DocType.CREDIT_NOTE, month=now.month
    )
    cn_number = f"{ret.sale.shop.code}-CN-{now.year}-{now.month:02d}-{number:04d}"
    return CreditNote.objects.create(
        return_record=ret,
        credit_note_number=cn_number,
        amount=ret.total_refund_amount,
    )


def _check_credit_limit(customer, estimated_total: Decimal) -> None:
    from core.exceptions import BusinessRuleViolation

    if customer.credit_limit <= 0:
        return  # No limit set

    if customer.total_outstanding + estimated_total > customer.credit_limit:
        raise BusinessRuleViolation(
            f"Credit limit of ₹{customer.credit_limit} would be exceeded. "
            f"Current outstanding: ₹{customer.total_outstanding}."
        )


def _calculate_grand_total_estimate(items_data: list, data: dict) -> Decimal:
    """Quick estimate of grand total for credit limit check (before full calculation)."""
    subtotal = sum(
        Decimal(str(i["quantity"])) * Decimal(str(i["unit_price"]))
        for i in items_data
    )
    return subtotal


def _update_customer_outstanding(customer, delta: Decimal) -> None:
    from django.db.models import F
    from crm.models import Customer
    Customer.objects.filter(pk=customer.pk).update(
        total_outstanding=F("total_outstanding") + delta
    )


def _deduct_stock(items_built: list) -> None:
    """Stub: deduct stock for each item. Wire to inventory module when built."""
    for item in items_built:
        if item.get("variant_id"):
            logger.debug("Stub stock deduction: variant=%s qty=%s", item["variant_id"], item["quantity"])


def _deduct_stock_for_sale(sale: Sale) -> None:
    items = [
        {"variant_id": item.variant_id, "quantity": item.quantity}
        for item in sale.items.all()
    ]
    _deduct_stock(items)


def _restock_items(sale: Sale) -> None:
    """Stub: restock items on return approval. Wire to inventory module when built."""
    for item in sale.items.all():
        if item.variant_id:
            logger.debug("Stub restock: variant=%s qty=%s", item.variant_id, item.quantity)


def _write_audit(user, action, model_name, object_id, old_value=None, new_value=None):
    try:
        AuditLog.objects.create(
            user_id=user.id,
            action=action,
            model_name=model_name,
            object_id=object_id,
            old_value=old_value,
            new_value=new_value,
        )
    except Exception:
        logger.exception("Audit log write failed")


def _broadcast(shop_id, event_type: str, payload: dict) -> None:
    logger.debug("WS broadcast shop=%s event=%s", shop_id, event_type)


def _send_whatsapp(phone, template_name: str, variables: dict, customer=None) -> None:
    if not phone:
        return
    if customer and getattr(customer, "whatsapp_optout", False):
        return
    logger.debug("WhatsApp → %s template=%s", phone, template_name)
