# ERP/CRM Blueprint — Phase 5 Design (Billing/Inventory Compliance)

**Date:** 2026-06-29
**Status:** Approved design — ready for implementation planning
**Parent spec:** `docs/superpowers/specs/2026-06-29-erp-crm-navigation-design.md` (§2 Billing/Inventory, §5 roadmap Phase 5)
**Predecessors:** Phases 0–4 (PRs #22–#26).

---

## 1. Scope

Three compliance features filling the Phase-0 stubs `/billing/credit-notes`, `/billing/refunds`,
`/purchases/returns`. Credit Notes and Refunds are **net-new** billing documents with a
create → approve workflow that **affects the linked invoice** on approval. Purchase Returns are
already built in `procurement` — Phase 5 surfaces them (list + create UI) and aligns one permission.

**Stock Ledger is already delivered** (`inventory.InventoryTransaction` + `GET /inventory/transactions/`
+ a real `/inventory/transactions` page) — **out of scope**.

| Feature | Nav | Net-new model | Footprint |
|---|---|---|---|
| A. Credit Notes | Billing › Credit Notes (`/billing/credit-notes`) | **yes (`billing.CreditNote`)** | model + CRUD + approve + page |
| B. Refunds | Billing › Refunds (`/billing/refunds`) | **yes (`billing.Refund`)** | model + CRUD + approve + page |
| C. Purchase Returns | Inventory › Purchase Returns (`/purchases/returns`) | no | perm alignment + list + create page |

**Locked decisions (from brainstorming):** approval **affects the invoice**; Purchase Returns get
**list + create**; invoice linkage is **required** for credit notes and refunds; approval guards
(credit ≤ outstanding, refund ≤ amount paid).

Permission slugs already seeded (Phase 0): `billing.credit_notes.{view,create,approve}`,
`billing.refunds.{view,create,approve}`, `erp.purchase_returns.{view,create}`.

**Out of scope:** Stock Ledger (done), GST e-invoice/IRN, credit-note/refund PDFs, partial-line credit
notes (amount-level only), wholesale/POS invoices (credit notes/refunds target `RepairInvoice`).

---

## 2. Feature A — Credit Notes

A credit note reduces what a customer owes on a repair invoice (return/overbill/adjustment).

### Backend
- **Model `billing.CreditNote`** (`BaseModel`, reversible migration): `shop` FK, `invoice` FK
  (`RepairInvoice`, `related_name="credit_notes"`, required), `credit_note_number` (unique),
  `amount` (Decimal), `reason` (Text), `status` (`TextChoices`: `pending`/`approved`/`cancelled`,
  default `pending`), `approved_by` (User, SET_NULL), `approved_at` (DateTime, null),
  `created_by` (User, SET_NULL). Index `(shop, status)`.
- **Numbering:** `DocumentCounter.next(shop, year, DocumentCounter.DocType.CREDIT_NOTE, month=month)`
  → `f"{shop.code}-CN-{year}-{month:02d}-{seq:04d}"` (mirrors invoice numbering).
- **Endpoints** under `/billing/credit-notes/` (thin `APIView`s, mirroring billing's pattern):
  - `GET /billing/credit-notes/` — list, shop-scoped, `?status`, `?invoice_id`; `billing.credit_notes.view`.
  - `POST /billing/credit-notes/` — create (status `pending`); `billing.credit_notes.create`.
  - `POST /billing/credit-notes/{id}/approve/` — `billing.credit_notes.approve`.
- **Approve effect** (`services.approve_credit_note`, `transaction.atomic`): reject if not `pending`;
  validate `0 < amount ≤ invoice.amount_outstanding`; set `invoice.amount_outstanding -= amount`
  (floored at 0); set `status=approved`, `approved_by`, `approved_at`. (Status of the invoice is left
  as-is; the reduced outstanding is what the Outstanding worklist reflects.)
- Serializer exposes `id, invoice_id, invoice_number, customer_name, credit_note_number, amount,
  reason, status, approved_by_name, approved_at, created_at`.

### Frontend
- Replace the `/billing/credit-notes` stub: list (number, invoice, customer, amount, status, date) +
  a create dialog (pick an outstanding invoice + amount + reason) + an **Approve** action gated on
  `billing.credit_notes.approve`. `billingApi.listCreditNotes/createCreditNote/approveCreditNote`;
  `qk.creditNotes(...)`.

---

## 3. Feature B — Refunds

A refund returns money already paid on a repair invoice.

### Backend
- **Model `billing.Refund`** (`BaseModel`, reversible migration): `shop` FK, `invoice` FK
  (`related_name="refunds"`, required), `refund_number` (unique), `amount` (Decimal),
  `method` (`TextChoices` mirroring `Payment.Method`: cash/upi/card/cheque/neft/other), `reason`
  (Text, blank), `status` (`pending`/`approved`/`cancelled`), `approved_by`, `approved_at`,
  `created_by`. Index `(shop, status)`.
- **Numbering:** add `REFUND = "refund"` to `core.DocumentCounter.DocType` (trivial `core` migration),
  then `DocumentCounter.next(shop, year, DocType.REFUND, month=month)` → `f"{shop.code}-RF-…"`.
- **Endpoints** under `/billing/refunds/`: list (`billing.refunds.view`); create (`billing.refunds.create`);
  `POST /{id}/approve/` (`billing.refunds.approve`).
- **Approve effect** (`services.approve_refund`, `transaction.atomic`): reject if not `pending`;
  validate `0 < amount ≤ invoice.amount_paid`; `invoice.amount_paid -= amount`,
  `invoice.amount_outstanding += amount`; recompute `status` (`paid` → `partially_paid`, or `issued`
  if `amount_paid == 0`); set approver/timestamp.
- Serializer exposes `id, invoice_id, invoice_number, customer_name, refund_number, amount, method,
  reason, status, approved_by_name, approved_at, created_at`.

### Frontend
- Replace the `/billing/refunds` stub: list + create dialog (invoice + amount + method + reason) +
  Approve action gated on `billing.refunds.approve`. `billingApi.listRefunds/createRefund/approveRefund`;
  `qk.refunds(...)`.

---

## 4. Feature C — Purchase Returns

Already built in `procurement` (`PurchaseReturn` model; `POST /procurement/purchase-returns/`,
`/purchase-returns/{id}/dispatch/`, debit notes; and a list `GET`). Surface it.

### Backend
- **Permission alignment only:** `PurchaseReturnView.get` currently requires
  `erp.purchase_orders.create`. Change the **GET** branch to require `erp.purchase_returns.view`
  (the seeded nav slug); POST stays `erp.purchase_returns.create`. (Confirm the exact current slug in
  `get_permissions` at implementation time and adjust the GET branch only.)

### Frontend
- Replace the `/purchases/returns` stub: list page over the existing `GET` (return #, purchase
  invoice, total, status, debit note, date) + a **create-return flow** (pick a purchase invoice →
  choose items + quantities + reason), wired to the existing `POST /purchase-returns/`
  (`{purchase_invoice_id, reason, items: [...]}`). `procurementApi` gains
  `listPurchaseReturns`/`createPurchaseReturn` (+ a way to fetch purchase invoices and their items
  for the picker — reuse existing procurement endpoints). `qk.purchaseReturns(...)`.

---

## 5. Cross-Cutting Requirements

- Per project rules: serializer + `permission_classes` + tests per endpoint; logic in `services.py`
  (approval effects, transactional); `select_related` — no N+1; reversible migrations; TS strict;
  React Query.
- **Multi-tenant:** all endpoints shop-scoped (mirror billing's `_shop_ids_from_token`). No hardcoded ids.
- **Tests (before merge):**
  - Credit note: create (pending); approve reduces `amount_outstanding`; over-credit (> outstanding)
    rejected; double-approve rejected; permission gates (view/create/approve).
  - Refund: create; approve adjusts `amount_paid`/`amount_outstanding` + recomputes status;
    over-refund (> paid) rejected; permission gates.
  - Purchase returns: list reachable with `erp.purchase_returns.view`.
  - Frontend (Vitest): list/dialog render for credit notes + refunds.
- **Migrations** (`CreditNote`, `Refund`, `DocType.REFUND`) reversible. **Production build** passes with
  `NODE_ENV=production`.

---

## 6. Build Order (independent task-groups)

1. `CreditNote` model + migration + endpoints/services + tests.
2. Credit Notes frontend page.
3. `Refund` model (+ `DocType.REFUND`) + migration + endpoints/services + tests.
4. Refunds frontend page.
5. Purchase Returns — GET permission alignment + list + create page.
6. Final verification.

---

## 7. Verification (Phase-5 exit criteria)

- `tsc --noEmit` clean · lint clean · all Vitest pass (incl. new tests).
- Backend `pytest apps/billing apps/procurement apps/core apps/authentication` passes (plus new tests).
- `CreditNote`/`Refund`/`DocType.REFUND` migrations apply and reverse cleanly.
- Production build (`NODE_ENV=production`) succeeds; `/billing/credit-notes`, `/billing/refunds`,
  `/purchases/returns` render live data (no ComingSoon).
- CI deny-list unchanged (comments-only).
