# ERP/CRM Phase 5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Credit Notes and Refunds (net-new billing documents whose approval adjusts the linked repair invoice) and surface the existing Purchase Returns with a list + create UI — filling the Phase-0 `/billing/credit-notes`, `/billing/refunds`, and `/purchases/returns` stubs.

**Architecture:** Two net-new `billing` models (`CreditNote`, `Refund`) exposed via thin `APIView`s (mirroring the existing billing views), with transactional approval services that mutate `RepairInvoice` balances. Numbering via `DocumentCounter` (`CREDIT_NOTE` exists; add `REFUND`). Purchase Returns are already built — only a GET-permission alignment + frontend. Slugs already seeded in Phase 0.

**Tech Stack:** Django 4.2 + DRF, pytest; Next.js 14 App Router + TS strict, React Query, Tailwind, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-29-erp-crm-phase-5-design.md`

---

## Reference patterns (read before starting)

- Billing thin `APIView` + `_shop_ids_from_token` + `require_permission` per method: `apps/billing/views.py:33-90`.
- Numbering + `transaction.atomic`: `apps/billing/services.py:72-95` (`DocumentCounter.next(shop, year, DocType.X, month=month)`).
- `RepairInvoice` fields (`amount_paid`, `amount_outstanding`, `status`, `customer`): `apps/billing/models.py:10-49`. `Payment.Method`: `apps/billing/models.py:76-82`.
- `DocumentCounter.DocType` (add `REFUND`): `apps/core/models.py:84-96`.
- CRUD-list + create-dialog FE page: `frontend/src/app/(app)/settings/taxes/page.tsx` (Phase 1). Aging/list page: `frontend/src/app/(app)/billing/outstanding/page.tsx`. `billingApi` + `qk`: `frontend/src/lib/api/billing.ts`, `frontend/src/lib/query/keys.ts`.
- Purchase-return endpoints: `apps/procurement/views.py` (`PurchaseReturnView` GET/POST), serializers `CreatePurchaseReturnSerializer` (`{purchase_invoice_id, reason, items[]}`), `PurchaseReturnSerializer`. `procurementApi` (has purchase-invoice list): `frontend/src/lib/api/procurement.ts`.
- Response envelope `{success, data}`; tests read `.json()["data"]`. JWT `client_with_perms` factory + a `RepairInvoice`/job builder: reuse from `apps/billing/tests/test_outstanding.py` (Phase 1) — it builds a job + invoice via `_job_invoice`.

**Shared invoice/job builder for tests** (paste into the new billing test modules; from Phase 1):

```python
import uuid
from decimal import Decimal
from datetime import timedelta
from django.utils import timezone


def _job_invoice(shop, customer, tech_user, *, number, paid, outstanding, status_val="partially_paid"):
    from billing.models import RepairInvoice
    from repair.models import JobTicket
    job = JobTicket.objects.create(
        shop=shop, customer=customer, created_by=tech_user,
        job_number=f"HTA-{uuid.uuid4().hex[:6]}", device_type="Laptop", device_brand="Dell",
        device_model="X", problem_description="p", service_charge=Decimal("1000"),
        status=JobTicket.Status.READY_FOR_PICKUP,
    )
    return RepairInvoice.objects.create(
        shop=shop, job=job, customer=customer, invoice_number=number, status=status_val,
        subtotal=Decimal("1000"), grand_total=Decimal("1000"),
        amount_paid=Decimal(paid), amount_outstanding=Decimal(outstanding),
    )
```

(Use the `shop`, `customer`, `tech_user`, `client_with_perms` fixtures exactly as defined in `apps/billing/tests/test_outstanding.py`.)

**Build order:** Tasks 1-2 (Credit Notes), 3-4 (Refunds), 5 (Purchase Returns), 6 (verify). Each task ends in a commit.

---

## Task 1: Credit Notes — backend

**Files:** Modify `apps/billing/models.py`, migration, `apps/billing/serializers.py`, `apps/billing/services.py`, `apps/billing/views.py`, `apps/billing/urls.py`; test `apps/billing/tests/test_credit_notes.py`.

- [ ] **Step 1: Failing test** (reuse `shop`/`customer`/`tech_user`/`client_with_perms` + `_job_invoice`):

```python
import pytest
from decimal import Decimal
from rest_framework import status

# ... paste shop/customer/tech_user/client_with_perms fixtures from test_outstanding.py + _job_invoice ...


@pytest.mark.django_db
def test_credit_note_create_and_approve_reduces_outstanding(shop, customer, tech_user, client_with_perms):
    inv = _job_invoice(shop, customer, tech_user, number="INV-CN1", paid="600", outstanding="400")
    client = client_with_perms(shop, ["billing.credit_notes.view", "billing.credit_notes.create", "billing.credit_notes.approve"])

    resp = client.post("/api/v1/billing/credit-notes/", {
        "invoice_id": str(inv.id), "amount": "150", "reason": "Returned part",
    }, format="json")
    assert resp.status_code == status.HTTP_201_CREATED, resp.content
    cn_id = resp.json()["data"]["id"]
    assert resp.json()["data"]["status"] == "pending"

    resp = client.post(f"/api/v1/billing/credit-notes/{cn_id}/approve/")
    assert resp.status_code == status.HTTP_200_OK
    assert resp.json()["data"]["status"] == "approved"
    inv.refresh_from_db()
    assert inv.amount_outstanding == Decimal("250")


@pytest.mark.django_db
def test_credit_note_over_outstanding_rejected_and_perms(shop, customer, tech_user, client_with_perms):
    inv = _job_invoice(shop, customer, tech_user, number="INV-CN2", paid="900", outstanding="100")
    client = client_with_perms(shop, ["billing.credit_notes.create", "billing.credit_notes.approve"])
    cn = client.post("/api/v1/billing/credit-notes/", {"invoice_id": str(inv.id), "amount": "500", "reason": "x"}, format="json")
    cn_id = cn.json()["data"]["id"]
    resp = client.post(f"/api/v1/billing/credit-notes/{cn_id}/approve/")
    assert resp.status_code == status.HTTP_400_BAD_REQUEST  # amount > outstanding

    nope = client_with_perms(shop, [])
    assert nope.get("/api/v1/billing/credit-notes/").status_code == status.HTTP_403_FORBIDDEN
```

> **Note:** `client_with_perms` in `test_outstanding.py` returns the client directly (signature `(shop, perms)`), not a `(client, user)` tuple — match that exact signature.

- [ ] **Step 2: Run → FAIL** (404). `python -m pytest apps/billing/tests/test_credit_notes.py -p no:cacheprovider -o addopts="" -q`

- [ ] **Step 3: Model** — append to `apps/billing/models.py`:

```python
class CreditNote(BaseModel):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        APPROVED = "approved", "Approved"
        CANCELLED = "cancelled", "Cancelled"

    shop = models.ForeignKey("core.Shop", on_delete=models.PROTECT, related_name="credit_notes")
    invoice = models.ForeignKey(RepairInvoice, on_delete=models.PROTECT, related_name="credit_notes")
    credit_note_number = models.CharField(max_length=40, unique=True)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    reason = models.TextField(blank=True, default="")
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    approved_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True,
                                    on_delete=models.SET_NULL, related_name="approved_credit_notes")
    approved_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True,
                                   on_delete=models.SET_NULL, related_name="created_credit_notes")

    class Meta:
        app_label = "billing"
        db_table = "credit_notes"
        indexes = [models.Index(fields=["shop", "status"])]

    def __str__(self) -> str:
        return f"{self.credit_note_number} ({self.status})"
```

- [ ] **Step 4: Migration** — `python manage.py makemigrations billing`.

- [ ] **Step 5: Serializer** — append to `apps/billing/serializers.py` (add `CreditNote` to model imports):

```python
class CreditNoteSerializer(serializers.ModelSerializer):
    invoice_id = serializers.UUIDField(source="invoice.id", read_only=True)
    invoice_number = serializers.CharField(source="invoice.invoice_number", read_only=True)
    customer_name = serializers.CharField(source="invoice.customer.name", read_only=True)
    approved_by_name = serializers.CharField(source="approved_by.full_name", read_only=True, default=None)

    class Meta:
        model = CreditNote
        fields = ["id", "invoice_id", "invoice_number", "customer_name", "credit_note_number",
                  "amount", "reason", "status", "approved_by_name", "approved_at", "created_at"]
        read_only_fields = ["id", "credit_note_number", "status", "approved_by_name", "approved_at", "created_at"]


class CreateCreditNoteSerializer(serializers.Serializer):
    invoice_id = serializers.UUIDField()
    amount = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal("0.01"))
    reason = serializers.CharField(required=False, allow_blank=True, default="")
```

- [ ] **Step 6: Service** — append to `apps/billing/services.py`:

```python
def create_credit_note(invoice, amount, reason, user):
    from core.models import DocumentCounter
    from .models import CreditNote

    now = timezone.now()
    seq = DocumentCounter.next(invoice.shop, now.year, DocumentCounter.DocType.CREDIT_NOTE, month=now.month)
    number = f"{invoice.shop.code}-CN-{now.year}-{now.month:02d}-{seq:04d}"
    return CreditNote.objects.create(
        shop=invoice.shop, invoice=invoice, credit_note_number=number,
        amount=amount, reason=reason or "", created_by=user,
    )


def approve_credit_note(credit_note, user):
    from rest_framework.exceptions import ValidationError
    from .models import CreditNote

    if credit_note.status != CreditNote.Status.PENDING:
        raise ValidationError("Only pending credit notes can be approved.")
    invoice = credit_note.invoice
    if credit_note.amount > invoice.amount_outstanding:
        raise ValidationError("Credit amount exceeds the invoice's outstanding balance.")
    with transaction.atomic():
        invoice.amount_outstanding = (invoice.amount_outstanding - credit_note.amount).quantize(_TWO_PLACES)
        invoice.save(update_fields=["amount_outstanding", "status"])
        credit_note.status = CreditNote.Status.APPROVED
        credit_note.approved_by = user
        credit_note.approved_at = timezone.now()
        credit_note.save(update_fields=["status", "approved_by", "approved_at", "updated_at"])
    return credit_note
```

> `_TWO_PLACES`, `transaction`, `timezone` are already imported in `services.py`. The
> `invoice.save(update_fields=[..., "status"])` keeps status unchanged here (included for symmetry);
> drop `"status"` from update_fields if you prefer — outstanding is the field that matters.

- [ ] **Step 7: Views** — append to `apps/billing/views.py` (import `CreditNote`, `CreditNoteSerializer`, `CreateCreditNoteSerializer`):

```python
class CreditNoteView(APIView):
    def get_permissions(self):
        if self.request.method == "GET":
            return [IsAuthenticated(), require_permission("billing.credit_notes.view")()]
        return [IsAuthenticated(), require_permission("billing.credit_notes.create")()]

    def get(self, request: Request) -> Response:
        token = getattr(request, "auth", None)
        shop_ids = _shop_ids_from_token(token)
        qs = CreditNote.objects.select_related("invoice__customer", "approved_by").order_by("-created_at")
        if shop_ids is not None:
            qs = qs.filter(shop_id__in=shop_ids)
        if s := request.query_params.get("status"):
            qs = qs.filter(status=s)
        if inv := request.query_params.get("invoice_id"):
            qs = qs.filter(invoice_id=inv)
        return Response(CreditNoteSerializer(qs, many=True).data)

    def post(self, request: Request) -> Response:
        ser = CreateCreditNoteSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        token = getattr(request, "auth", None)
        shop_ids = _shop_ids_from_token(token)
        qs = RepairInvoice.objects.select_related("shop", "customer")
        if shop_ids is not None:
            qs = qs.filter(shop_id__in=shop_ids)
        try:
            invoice = qs.get(id=ser.validated_data["invoice_id"])
        except RepairInvoice.DoesNotExist:
            return Response({"detail": "Invoice not found."}, status=status.HTTP_404_NOT_FOUND)
        cn = services.create_credit_note(invoice, ser.validated_data["amount"], ser.validated_data["reason"], request.user)
        return Response(CreditNoteSerializer(cn).data, status=status.HTTP_201_CREATED)


class CreditNoteApproveView(APIView):
    permission_classes = [IsAuthenticated, require_permission("billing.credit_notes.approve")]

    def post(self, request: Request, credit_note_id) -> Response:
        from django.shortcuts import get_object_or_404
        token = getattr(request, "auth", None)
        shop_ids = _shop_ids_from_token(token)
        qs = CreditNote.objects.select_related("invoice")
        if shop_ids is not None:
            qs = qs.filter(shop_id__in=shop_ids)
        cn = get_object_or_404(qs, id=credit_note_id)
        cn = services.approve_credit_note(cn, request.user)
        return Response(CreditNoteSerializer(cn).data)
```

> `IsAuthenticated` is imported in billing `views.py` (used by other views). Confirm and add if missing.

- [ ] **Step 8: Routes** — in `apps/billing/urls.py` add:

```python
    path("credit-notes/", views.CreditNoteView.as_view(), name="credit-notes"),
    path("credit-notes/<uuid:credit_note_id>/approve/", views.CreditNoteApproveView.as_view(), name="credit-note-approve"),
```

- [ ] **Step 9: Run → PASS** + `python -m pytest apps/billing -p no:cacheprovider -o addopts="" -q`.

- [ ] **Step 10: Commit**
```bash
git add backend/apps/billing/models.py backend/apps/billing/migrations/ backend/apps/billing/serializers.py backend/apps/billing/services.py backend/apps/billing/views.py backend/apps/billing/urls.py backend/apps/billing/tests/test_credit_notes.py
git commit -m "feat(billing): CreditNote model + approve reduces invoice outstanding"
```

---

## Task 2: Credit Notes — frontend

**Files:** Modify `frontend/src/lib/api/billing.ts`, `frontend/src/lib/query/keys.ts`; replace `frontend/src/app/(app)/billing/credit-notes/page.tsx`.

- [ ] **Step 1: API client + types** — in `billing.ts` add:

```typescript
export type DocStatus = 'pending' | 'approved' | 'cancelled';

export interface CreditNote {
  id: string; invoice_id: string; invoice_number: string; customer_name: string;
  credit_note_number: string; amount: string; reason: string; status: DocStatus;
  approved_by_name: string | null; approved_at: string | null; created_at: string;
}

// inside billingApi:
  listCreditNotes: (params: { status?: DocStatus; invoice_id?: string } = {}) =>
    apiGet<CreditNote[]>('/billing/credit-notes/', params),
  createCreditNote: (body: { invoice_id: string; amount: number; reason?: string }) =>
    apiPost<CreditNote>('/billing/credit-notes/', body),
  approveCreditNote: (id: string) =>
    apiPost<CreditNote>(`/billing/credit-notes/${id}/approve/`, {}),
```

- [ ] **Step 2: Query key** — `creditNotes: (params?: Record<string, unknown>) => ['billing', 'credit-notes', params ?? {}] as const,`

- [ ] **Step 3: Page** — replace the stub with a list (number, invoice, customer, amount, status badge,
date) + a create dialog (invoice selector loaded from `billingApi.getOutstanding()` results — i.e.
invoices with an outstanding balance — plus amount + reason) + an **Approve** action per pending row
gated with `<Can permission="billing.credit_notes.approve">`. Mirror the Phase-1 Taxes page
(rhf+zod Dialog + React Query mutations) and the Outstanding page (table). On approve/create success,
invalidate `qk.creditNotes()`.

> The invoice picker can reuse `billingApi.getOutstanding()` (Phase 1) to list invoices that still
> have a balance; show `invoice_number — customer (₹outstanding)`. Confirm its response shape.

- [ ] **Step 4: Verify** — `npx tsc --noEmit` (0); `npx vitest run` (no regressions).

- [ ] **Step 5: Commit**
```bash
git add frontend/src/lib/api/billing.ts frontend/src/lib/query/keys.ts frontend/src/app/\(app\)/billing/credit-notes/page.tsx
git commit -m "feat(billing): Credit Notes page (list + create + approve)"
```

---

## Task 3: Refunds — backend

**Files:** Modify `apps/core/models.py` (+ migration), `apps/billing/models.py` (+ migration), `apps/billing/serializers.py`, `apps/billing/services.py`, `apps/billing/views.py`, `apps/billing/urls.py`; test `apps/billing/tests/test_refunds.py`.

- [ ] **Step 1: Failing test**:

```python
import pytest
from decimal import Decimal
from rest_framework import status
# ... paste fixtures + _job_invoice ...


@pytest.mark.django_db
def test_refund_approve_adjusts_paid_and_outstanding(shop, customer, tech_user, client_with_perms):
    inv = _job_invoice(shop, customer, tech_user, number="INV-RF1", paid="1000", outstanding="0", status_val="paid")
    client = client_with_perms(shop, ["billing.refunds.view", "billing.refunds.create", "billing.refunds.approve"])

    cn = client.post("/api/v1/billing/refunds/", {"invoice_id": str(inv.id), "amount": "300", "method": "cash", "reason": "Overpaid"}, format="json")
    assert cn.status_code == status.HTTP_201_CREATED, cn.content
    rid = cn.json()["data"]["id"]

    resp = client.post(f"/api/v1/billing/refunds/{rid}/approve/")
    assert resp.status_code == status.HTTP_200_OK
    inv.refresh_from_db()
    assert inv.amount_paid == Decimal("700")
    assert inv.amount_outstanding == Decimal("300")
    assert inv.status == "partially_paid"


@pytest.mark.django_db
def test_refund_over_paid_rejected(shop, customer, tech_user, client_with_perms):
    inv = _job_invoice(shop, customer, tech_user, number="INV-RF2", paid="100", outstanding="900")
    client = client_with_perms(shop, ["billing.refunds.create", "billing.refunds.approve"])
    r = client.post("/api/v1/billing/refunds/", {"invoice_id": str(inv.id), "amount": "500", "method": "cash"}, format="json")
    rid = r.json()["data"]["id"]
    assert client.post(f"/api/v1/billing/refunds/{rid}/approve/").status_code == status.HTTP_400_BAD_REQUEST
```

- [ ] **Step 2: Run → FAIL.**

- [ ] **Step 3: Add `REFUND` doc type** — in `apps/core/models.py`, add to `DocumentCounter.DocType`:
`REFUND = "refund", "Refund"`. Then `python manage.py makemigrations core` (trivial AlterField).

- [ ] **Step 4: Model** — append to `apps/billing/models.py`:

```python
class Refund(BaseModel):
    class Status(models.TextChoices):
        PENDING = "pending", "Pending"
        APPROVED = "approved", "Approved"
        CANCELLED = "cancelled", "Cancelled"

    class Method(models.TextChoices):
        CASH = "cash", "Cash"
        UPI = "upi", "UPI"
        CARD = "card", "Card"
        CHEQUE = "cheque", "Cheque"
        NEFT = "neft", "NEFT"
        OTHER = "other", "Other"

    shop = models.ForeignKey("core.Shop", on_delete=models.PROTECT, related_name="refunds")
    invoice = models.ForeignKey(RepairInvoice, on_delete=models.PROTECT, related_name="refunds")
    refund_number = models.CharField(max_length=40, unique=True)
    amount = models.DecimalField(max_digits=12, decimal_places=2)
    method = models.CharField(max_length=20, choices=Method.choices, default=Method.CASH)
    reason = models.TextField(blank=True, default="")
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.PENDING)
    approved_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True,
                                    on_delete=models.SET_NULL, related_name="approved_refunds")
    approved_at = models.DateTimeField(null=True, blank=True)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True,
                                   on_delete=models.SET_NULL, related_name="created_refunds")

    class Meta:
        app_label = "billing"
        db_table = "refunds"
        indexes = [models.Index(fields=["shop", "status"])]

    def __str__(self) -> str:
        return f"{self.refund_number} ({self.status})"
```
Then `python manage.py makemigrations billing`.

- [ ] **Step 5: Serializer** — append to `apps/billing/serializers.py` (add `Refund` to model imports):

```python
class RefundSerializer(serializers.ModelSerializer):
    invoice_id = serializers.UUIDField(source="invoice.id", read_only=True)
    invoice_number = serializers.CharField(source="invoice.invoice_number", read_only=True)
    customer_name = serializers.CharField(source="invoice.customer.name", read_only=True)
    approved_by_name = serializers.CharField(source="approved_by.full_name", read_only=True, default=None)

    class Meta:
        model = Refund
        fields = ["id", "invoice_id", "invoice_number", "customer_name", "refund_number",
                  "amount", "method", "reason", "status", "approved_by_name", "approved_at", "created_at"]
        read_only_fields = ["id", "refund_number", "status", "approved_by_name", "approved_at", "created_at"]


class CreateRefundSerializer(serializers.Serializer):
    invoice_id = serializers.UUIDField()
    amount = serializers.DecimalField(max_digits=12, decimal_places=2, min_value=Decimal("0.01"))
    method = serializers.ChoiceField(choices=Refund.Method.choices, default=Refund.Method.CASH)
    reason = serializers.CharField(required=False, allow_blank=True, default="")
```

- [ ] **Step 6: Service** — append to `apps/billing/services.py`:

```python
def create_refund(invoice, amount, method, reason, user):
    from core.models import DocumentCounter
    from .models import Refund

    now = timezone.now()
    seq = DocumentCounter.next(invoice.shop, now.year, DocumentCounter.DocType.REFUND, month=now.month)
    number = f"{invoice.shop.code}-RF-{now.year}-{now.month:02d}-{seq:04d}"
    return Refund.objects.create(
        shop=invoice.shop, invoice=invoice, refund_number=number,
        amount=amount, method=method, reason=reason or "", created_by=user,
    )


def approve_refund(refund, user):
    from rest_framework.exceptions import ValidationError
    from .models import Refund

    if refund.status != Refund.Status.PENDING:
        raise ValidationError("Only pending refunds can be approved.")
    invoice = refund.invoice
    if refund.amount > invoice.amount_paid:
        raise ValidationError("Refund amount exceeds the amount paid on the invoice.")
    with transaction.atomic():
        invoice.amount_paid = (invoice.amount_paid - refund.amount).quantize(_TWO_PLACES)
        invoice.amount_outstanding = (invoice.amount_outstanding + refund.amount).quantize(_TWO_PLACES)
        invoice.status = (
            RepairInvoice.Status.ISSUED if invoice.amount_paid <= 0
            else RepairInvoice.Status.PARTIALLY_PAID
        )
        invoice.save(update_fields=["amount_paid", "amount_outstanding", "status"])
        refund.status = Refund.Status.APPROVED
        refund.approved_by = user
        refund.approved_at = timezone.now()
        refund.save(update_fields=["status", "approved_by", "approved_at", "updated_at"])
    return refund
```

- [ ] **Step 7: Views + routes** — append `RefundView` + `RefundApproveView` to `apps/billing/views.py`
(structurally identical to `CreditNoteView`/`CreditNoteApproveView`, using `Refund*` serializers,
`billing.refunds.view/create/approve`, `services.create_refund`/`approve_refund`, passing `method`
to create). Add routes in `apps/billing/urls.py`:

```python
    path("refunds/", views.RefundView.as_view(), name="refunds"),
    path("refunds/<uuid:refund_id>/approve/", views.RefundApproveView.as_view(), name="refund-approve"),
```

> Repeat the full `CreditNoteView` body for `RefundView`, swapping models/serializers/services/slugs
> and reading `method` from the create serializer. (Provide the complete code — do not abbreviate.)

- [ ] **Step 8: Run → PASS** + `python -m pytest apps/billing -p no:cacheprovider -o addopts="" -q`.

- [ ] **Step 9: Commit**
```bash
git add backend/apps/core/models.py backend/apps/core/migrations/ backend/apps/billing/models.py backend/apps/billing/migrations/ backend/apps/billing/serializers.py backend/apps/billing/services.py backend/apps/billing/views.py backend/apps/billing/urls.py backend/apps/billing/tests/test_refunds.py
git commit -m "feat(billing): Refund model + approve adjusts invoice paid/outstanding"
```

---

## Task 4: Refunds — frontend

**Files:** Modify `frontend/src/lib/api/billing.ts`, `frontend/src/lib/query/keys.ts`; replace `frontend/src/app/(app)/billing/refunds/page.tsx`.

- [ ] **Step 1: API client + types** — add `Refund` interface (like `CreditNote` + `method`) and
`listRefunds`/`createRefund`/`approveRefund` to `billingApi` (paths `/billing/refunds/...`).

- [ ] **Step 2: Query key** — `refunds: (params?: Record<string, unknown>) => ['billing', 'refunds', params ?? {}] as const,`

- [ ] **Step 3: Page** — replace the stub with a list + create dialog (invoice + amount + method select
+ reason) + Approve action gated `billing.refunds.approve`. Mirror the Credit Notes page from Task 2.
The invoice picker should list **paid/partially-paid** invoices (refunds need a prior payment); reuse
the invoice list (`billingApi.listInvoices`) filtered client-side to `amount_paid > 0`, or
`getOutstanding` is not suitable here — confirm and pick the invoice source that has `amount_paid`.

- [ ] **Step 4: Verify** — `npx tsc --noEmit` (0); `npx vitest run`.

- [ ] **Step 5: Commit**
```bash
git add frontend/src/lib/api/billing.ts frontend/src/lib/query/keys.ts frontend/src/app/\(app\)/billing/refunds/page.tsx
git commit -m "feat(billing): Refunds page (list + create + approve)"
```

---

## Task 5: Purchase Returns — permission alignment + frontend

**Files:** Modify `apps/procurement/views.py`; modify `frontend/src/lib/api/procurement.ts`, `frontend/src/lib/query/keys.ts`; replace `frontend/src/app/(app)/purchases/returns/page.tsx`. Test `apps/procurement/tests/` (extend or add).

- [ ] **Step 1: Permission alignment + test** — in `apps/procurement/views.py`, `PurchaseReturnView.get_permissions`,
change the **GET** branch to `require_permission("erp.purchase_returns.view")` (POST stays
`erp.purchase_returns.create`). Add a test asserting a user with only `erp.purchase_returns.view` can
GET `/api/v1/procurement/purchase-returns/` (200) and a user with neither gets 403. Run → confirm.

> Read the current `get_permissions` first; it may currently return the same slug for both methods.
> Only change the GET branch. Confirm the URL prefix (`/api/v1/procurement/purchase-returns/`).

- [ ] **Step 2: API client** — in `procurement.ts` add (mirror existing methods):

```typescript
export interface PurchaseReturnItem { id: string; variant: string; variant_name: string; quantity: number; unit_cost: string; line_total: string; }
export interface PurchaseReturn {
  id: string; purchase_invoice: string; return_number: string; reason: string;
  status: string; total_amount: string; items: PurchaseReturnItem[];
  debit_note_number: string | null; created_at: string;
}
// inside procurementApi:
  listPurchaseReturns: () => apiGet<PurchaseReturn[]>('/procurement/purchase-returns/'),
  createPurchaseReturn: (body: { purchase_invoice_id: string; reason: string; items: Array<{ variant: string; quantity: number }> }) =>
    apiPost<PurchaseReturn>('/procurement/purchase-returns/', body),
```

> Confirm `ReturnItemInputSerializer`'s exact fields (`variant`, `quantity`, maybe `unit_cost`) and
> match the `items` payload. Confirm the purchase-invoice list method already in `procurementApi`
> (it exists ~line 210) for the create picker.

- [ ] **Step 3: Query key** — `purchaseReturns: () => ['procurement', 'purchase-returns'] as const,`

- [ ] **Step 4: Page** — replace the `/purchases/returns` stub with a list (return #, purchase invoice,
total, status, debit note, date) + a **create-return** dialog: pick a purchase invoice (from the
existing purchase-invoice list endpoint), then enter return items (variant + quantity) + reason; POST
via `createPurchaseReturn`; invalidate `qk.purchaseReturns()`. Gate the page on
`erp.purchase_returns.view` and the create action on `erp.purchase_returns.create`.

> Keep the create dialog pragmatic: list the chosen invoice's line items with quantity inputs. If the
> purchase-invoice detail shape needs confirming, read `procurementApi`/the invoice serializer first.

- [ ] **Step 5: Verify** — backend test PASS; `npx tsc --noEmit` (0); `npx vitest run`.

- [ ] **Step 6: Commit**
```bash
git add backend/apps/procurement/views.py backend/apps/procurement/tests/ frontend/src/lib/api/procurement.ts frontend/src/lib/query/keys.ts frontend/src/app/\(app\)/purchases/returns/page.tsx
git commit -m "feat(procurement): Purchase Returns page (list + create) + view-perm alignment"
```

---

## Task 6: Final verification

- [ ] **Step 1: Backend suites** — from `backend/`:
`python -m pytest apps/billing apps/procurement apps/core apps/authentication -p no:cacheprovider -o addopts="" -q` → PASS.

- [ ] **Step 2: Migration reversibility** — inside the backend container, for the new `core` (REFUND
doctype) + `billing` (CreditNote, Refund) migrations: `showmigrations`, then migrate down one and back
up for each app, confirming clean apply/reverse.

- [ ] **Step 3: Frontend** — from `frontend/`: `npx tsc --noEmit`; `npx vitest run`; `npm run lint -- --no-cache` → all clean.

- [ ] **Step 4: Production build** — `docker compose exec -e NODE_ENV=production frontend sh -c "npm run build"` → exit 0; `/billing/credit-notes`, `/billing/refunds`, `/purchases/returns` real (no ComingSoon).

- [ ] **Step 5: CI deny-list** — from `backend/`: `grep -vc '^#\|^$' ci-known-failures.txt` → `0`.

---

## Notes for the implementer

- **Response envelope** `{success, data}`; backend tests read `.json()["data"]` (plain list responses → `.data`).
- **`client_with_perms` (Phase 1 billing tests)** returns the client directly with signature `(shop, perms)` — not a tuple. Match it.
- **Approval guards:** credit ≤ `amount_outstanding`; refund ≤ `amount_paid`; only `pending` → `approved`. All raise DRF `ValidationError` (→ 400).
- **Numbering:** `DocumentCounter.next(shop, year, DocType.X, month=month)`; `CREDIT_NOTE` exists, add `REFUND`.
- **Slugs already seeded** (Phase 0) — no seed changes. `erp.purchase_returns.view` exists; only the GET branch of `PurchaseReturnView` needs to use it.
- **No `any`, no `console.log`.** App Router pages export only the default component. React Query v5.
