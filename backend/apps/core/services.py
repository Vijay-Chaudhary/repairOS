"""Core cross-module services: in-app notification producers + global search."""

from .models import Notification


# ── Notification producer helpers ───────────────────────────────────────────────


def users_with_permission(codename, shop_ids=None):
    """Distinct users holding `codename` (optionally scoped to shops via their UserRole)."""
    from authentication.models import User

    qs = User.objects.filter(
        user_roles__role__role_permissions__permission__codename=codename
    )
    if shop_ids is not None:
        qs = qs.filter(user_roles__shop_id__in=shop_ids)
    return qs.distinct()


def record_notifications(users, *, type, title, body="", route="", exclude=None):
    """Bulk-create one Notification per distinct user, skipping `exclude` (the actor)."""
    exclude_id = getattr(exclude, "id", None)
    seen = set()
    rows = []
    for u in users:
        if u is None or u.id == exclude_id or u.id in seen:
            continue
        seen.add(u.id)
        rows.append(Notification(recipient=u, type=type, title=title, body=body, route=route))
    if rows:
        Notification.objects.bulk_create(rows)
    return len(rows)


def notify_dedup(user, type, route) -> bool:
    """True if an unread notification of the same type+route already exists for `user`."""
    return Notification.objects.filter(
        recipient=user, type=type, route=route, read_at__isnull=True
    ).exists()


# ── Global search (⌘K) ──────────────────────────────────────────────────────────

from django.db.models import Q  # noqa: E402

SEARCH_CAP = 5


def _search_shop_ids(token):
    """Return shop_ids list, or None for tenant-wide (mirrors billing/finance helpers)."""
    if token is None:
        return []
    if token.get("is_tenant_wide") or token.get("is_platform_admin"):
        return None
    return token.get("shop_ids", [])


def global_search(term, token):
    term = (term or "").strip()
    if len(term) < 2:
        return []
    perms = (token or {}).get("permissions", []) if token else []
    shop_ids = _search_shop_ids(token)
    results = []

    def scoped(qs, *, shop_field="shop_id"):
        if shop_ids is not None and shop_field:
            qs = qs.filter(**{f"{shop_field}__in": shop_ids})
        return qs

    if "crm.customers.view" in perms:
        from crm.models import Customer
        qs = scoped(Customer.objects.filter(Q(name__icontains=term) | Q(phone__icontains=term)))[:SEARCH_CAP]
        results += [{"type": "customer", "id": str(c.id), "label": c.name,
                     "sublabel": c.phone or "", "route": f"/customers/{c.id}"} for c in qs]

    if "crm.leads.view" in perms:
        from crm.models import Lead
        qs = scoped(Lead.objects.filter(Q(name__icontains=term) | Q(phone__icontains=term)))[:SEARCH_CAP]
        results += [{"type": "lead", "id": str(x.id), "label": x.name,
                     "sublabel": x.phone or "", "route": f"/leads/{x.id}"} for x in qs]

    if "repair.jobs.view" in perms:
        from repair.models import JobTicket
        qs = scoped(JobTicket.objects.select_related("customer").filter(
            Q(job_number__icontains=term) | Q(device_brand__icontains=term)
            | Q(device_model__icontains=term) | Q(customer__name__icontains=term)
        ))[:SEARCH_CAP]
        results += [{"type": "job", "id": str(j.id), "label": j.job_number,
                     "sublabel": f"{j.device_brand} {j.device_model}".strip() or j.customer.name,
                     "route": f"/jobs/{j.id}"} for j in qs]

    if "billing.repair_invoices.view" in perms:
        from billing.models import RepairInvoice
        qs = scoped(RepairInvoice.objects.select_related("customer").filter(
            Q(invoice_number__icontains=term) | Q(customer__name__icontains=term)
        ))[:SEARCH_CAP]
        results += [{"type": "invoice", "id": str(i.id), "label": i.invoice_number,
                     "sublabel": i.customer.name, "route": f"/invoices/{i.id}"} for i in qs]

    if "erp.products.view" in perms:
        from inventory.models import Product
        # Product is tenant-global (no shop FK) — do not shop-scope.
        qs = Product.objects.filter(Q(name__icontains=term) | Q(sku__icontains=term))[:SEARCH_CAP]
        results += [{"type": "product", "id": str(p.id), "label": p.name,
                     "sublabel": p.sku, "route": f"/products/{p.id}"} for p in qs]

    if "hr.employees.view" in perms:
        from hr.models import Employee
        qs = scoped(Employee.objects.filter(
            Q(full_name__icontains=term) | Q(designation__icontains=term)
        ))[:SEARCH_CAP]
        results += [{"type": "technician", "id": str(e.id), "label": e.full_name,
                     "sublabel": e.designation or "", "route": f"/hr/employees/{e.id}"} for e in qs]

    if "billing.payments.record" in perms:
        from billing.models import Payment
        qs = scoped(Payment.objects.select_related("invoice").filter(
            Q(reference_id__icontains=term) | Q(razorpay_payment_id__icontains=term)
        ), shop_field="invoice__shop_id")[:SEARCH_CAP]
        results += [{"type": "payment", "id": str(p.id), "label": f"₹{p.amount}",
                     "sublabel": p.method, "route": "/payments"} for p in qs]

    if "erp.purchase_orders.create" in perms:
        from procurement.models import PurchaseOrder
        qs = scoped(PurchaseOrder.objects.select_related("supplier").filter(
            Q(po_number__icontains=term) | Q(supplier__name__icontains=term)
        ))[:SEARCH_CAP]
        results += [{"type": "purchase_order", "id": str(po.id), "label": po.po_number,
                     "sublabel": po.supplier.name, "route": f"/purchases/{po.id}"} for po in qs]

    return results
