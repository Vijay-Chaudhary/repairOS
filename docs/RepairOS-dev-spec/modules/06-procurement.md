# Module 06 — Suppliers & Procurement

> Suppliers, purchase orders, goods receipt (GRN with QC), purchase invoices, supplier payments, purchase returns, and debit notes.

## 1. Purpose & scope
The buy-side: manage suppliers, raise POs, receive goods (accept/reject), record supplier bills, pay them, and handle returns with debit notes. **Out of scope:** stock counts (Inventory holds them; this module emits `purchase_in`/`return_out` transactions).

## 2. Dependencies
foundation 01/02/03; `05-inventory` (variants, stock movements); `02-repair` (spare-part request → PO linkage). Consumed by Reports (payables), Finance.

## 3. Data model (tenant DB; soft-delete on suppliers/POs)

### 3.1 `suppliers`
id, name, contact_person, phone NOT NULL, email, address, state, state_code (IGST), gstin, payment_terms_days DEFAULT 30, credit_limit DEFAULT 0, `bank_account_number` (column-encrypted AES-256), bank_ifsc, is_active.

### 3.2 `purchase_orders`
id, shop_id FK, supplier_id FK, po_number UNIQUE `{SHOP_CODE}-PO-{YYYY}-{NNNN}`, status (draft/sent/partially_received/received/cancelled), expected_delivery_date, notes, created_by.

### 3.3 `purchase_order_items`
id, po_id FK, variant_id FK, quantity_ordered, unit_cost, tax_rate, hsn_code, line_total.

### 3.4 `goods_receipt_notes`
id, shop_id FK, po_id FK, grn_number UNIQUE `{SHOP_CODE}-GRN-{YYYY}-{NNNN}`, received_date, received_by FK, challan_number, notes.

### 3.5 `grn_items`
id, grn_id FK, po_item_id FK, quantity_received, quantity_accepted, quantity_rejected DEFAULT 0, rejection_reason (required if rejected > 0). **Accepted qty posts `purchase_in` to inventory.**

### 3.6 `purchase_invoices`
id, shop_id FK, supplier_id FK, grn_id FK NULL, bill_number (supplier's), bill_date, subtotal, cgst/sgst/igst, grand_total, payment_status (unpaid/partially_paid/paid), due_date.

### 3.7 `purchase_payments`
id, purchase_invoice_id FK, amount, method (cash/upi/card/cheque/neft/other), reference_id, paid_at, recorded_by.

### 3.8 `purchase_returns`
id, purchase_invoice_id FK, return_number UNIQUE, reason, status (pending/approved/dispatched), total_amount, created_by. **Dispatched posts `return_out` to inventory.**

### 3.9 `debit_notes`
id, return_id FK, debit_note_number UNIQUE `{SHOP_CODE}-DN-{YYYY-MM}-{NNNN}`, amount, pdf_url (S3).

## 4. Business rules
- PO flow: draft → sent → partially_received → received. GRN against PO records accepted/rejected per item; **accepted quantities increment stock** (one `purchase_in` transaction per accepted line).
- A PO is `received` when all items fully received; else `partially_received`.
- Purchase invoice GST per foundation/03 §5 (supplier state vs shop state). ITC tracked from purchase GST for GSTR-2 proxy.
- Supplier payment updates `payment_status`; `purchase_bill_due` reminder 3 days before `due_date`.
- Return → debit note; dispatched return posts `return_out` (stock down).
- Spare-part request from Repair can spawn a PO (`po_id` linked); GRN receipt notifies the requesting technician.

## 5. Permissions
`erp.suppliers.manage`, `erp.purchase_orders.create`, `erp.grn.receive`, `erp.purchase_invoices.record`, `erp.purchase_returns.create`. Manager/Admin.

## 6. API
| Endpoint | Method | Perm |
|---|---|---|
| `/suppliers/` | GET/POST | suppliers.manage |
| `/suppliers/{id}/ledger/` | GET | suppliers.manage |
| `/purchase-orders/` | POST | purchase_orders.create |
| `/purchase-orders/{id}/` | PATCH | purchase_orders.create |
| `/grn/` | POST | grn.receive |
| `/purchase-invoices/` | POST | purchase_invoices.record |
| `/purchase-payments/` | POST | purchase_invoices.record |

```jsonc
// POST /grn/  request
{ "po_id":"…","received_date":"2026-06-02","challan_number":"CH-9981",
  "items":[{"po_item_id":"…","quantity_received":10,"quantity_accepted":9,"quantity_rejected":1,
            "rejection_reason":"1 unit damaged"}] }
// 201 → posts purchase_in (+9) to inventory; PO → partially_received/received
```

## 7. Real-time events
(none distinct; inventory emits `stock.updated` on GRN accept.)

## 8. Notifications
| Template | Trigger | Recipient | Variables |
|---|---|---|---|
| po_confirmation_supplier | PO sent | supplier (email + opt WA) | supplier_name, po_number, delivery_date, total_value |
| purchase_bill_due | bill due in 3 days | manager, admin | manager_name, supplier_name, amount_due, due_date |
| spare_part_received | GRN received for request PO | requesting technician | tech_name, part_name, job_number |

## 9. Reports
Supplier Payable (Aged), Purchase Summary, GSTR-2 Proxy (Inward). Full: `11-reports`.

## 10. Acceptance criteria
- [ ] GRN accepted qty increments stock exactly once (paired ledger row).
- [ ] PO status reflects partial vs full receipt.
- [ ] Rejected qty requires reason; not stocked.
- [ ] Purchase GST correct intra/inter-state; ITC captured.
- [ ] Return dispatched decrements stock + debit note generated.

## 11. Tests
E2E: supplier → PO → GRN (QC) → purchase invoice → payment → return + debit note. Bank field encryption at rest. Isolation.

## 12. Open questions
None blocking. ITC/GSTR via Tally export (`07-billing`).
