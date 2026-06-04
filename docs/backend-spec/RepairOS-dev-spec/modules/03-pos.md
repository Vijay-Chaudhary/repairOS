# Module 03 — POS (Sales)

> Counter sales, wholesale (B2B credit), job-linked sales, returns, credit notes, and barcode scanning.

## 1. Purpose & scope
Sell products without leaving the system: walk-in counter sales, GST B2B wholesale, parts billed against a repair job, and returns with credit notes. **Out of scope:** product catalogue & stock levels (`05-inventory`), the repair invoice (`07-billing`).

## 2. Dependencies
foundation 01/02/03; `05-inventory` (variants, prices, stock deduction); `01-crm` (customer, credit limit); `07-billing` (payments share, Razorpay). Consumed by Reports, Commissions (no — commission is repair-only).

## 3. Data model (tenant DB; soft-delete on `sales`)

### 3.1 `sales`
| Column | Type | Notes |
|---|---|---|
| id | UUID | PK |
| shop_id | UUID | FK NOT NULL INDEXED |
| sale_type | VARCHAR(20) | counter / job_linked / wholesale |
| customer_id | UUID | FK NULL (guest ok for counter) |
| job_id | UUID | FK NULL (job_linked) |
| sale_number | VARCHAR(30) | UNIQUE `{SHOP_CODE}-SALE-{YYYY-MM}-{NNNN}` |
| status | VARCHAR(20) | draft/completed/partially_paid/cancelled/returned |
| subtotal | DECIMAL(12,2) | NOT NULL |
| discount_type / discount_value / discount_amount | | flat/percentage |
| cgst / sgst / igst | DECIMAL(10,2) | DEFAULT 0 |
| grand_total | DECIMAL(12,2) | NOT NULL |
| amount_paid / amount_outstanding | DECIMAL(12,2) | |
| sale_date | TIMESTAMP | DEFAULT NOW() |
| created_by | UUID | FK NOT NULL |

### 3.2 `sale_items`
id, sale_id FK, variant_id FK, `product_name_snapshot`, `variant_name_snapshot`, hsn_code, quantity, unit_price, discount_per_unit, tax_rate, line_subtotal, line_tax, line_total. **Snapshots** freeze product names at sale time.

### 3.3 `sale_payments`
id, sale_id FK, amount, method (cash/upi/card/cheque/neft/credit/other), reference_id, razorpay_payment_id, paid_at, recorded_by.

### 3.4 `sales_returns`
id, sale_id FK, return_number UNIQUE `{SHOP_CODE}-RET-{YYYY-MM}-{NNNN}`, reason, status (pending/approved/rejected), total_refund_amount, refund_method (cash/original_payment/store_credit/exchange), approved_by.

### 3.5 `credit_notes`
id, return_id FK, credit_note_number UNIQUE `{SHOP_CODE}-CN-{YYYY-MM}-{NNNN}`, amount, pdf_url (S3).

## 4. Business rules
| Type | Customer | Price tier | Stock deduct |
|---|---|---|---|
| counter | optional (guest) | selling_price | on completion |
| job_linked | inherits from job | selling_price | on job closure |
| wholesale | required (GSTIN for B2B) | wholesale_price (overridable) | on completion |

- **Credit sales (wholesale)** blocked if `customer.total_outstanding ≥ credit_limit` → `400 CREDIT_LIMIT_EXCEEDED`. 🔧 PROPOSED: auto-approve within limit, manager approval above — confirm (OQ-05).
- **Min-margin guard:** warning (not block) if `unit_price < variant.cost_price`.
- **Barcode:** ZXing-js scan → `GET /products/barcode/{barcode}/` → auto-add to cart.
- **GST** per foundation/03 §5 (same/different state).
- **Return** restocks via `return_in` inventory transaction on approval; issues credit note.

## 5. Permissions
`pos.counter_sale.create`, `pos.wholesale_sale.create`, `pos.job_sale.create`, `pos.discount.apply`, `pos.returns.create`, `pos.returns.approve`. Billing Staff + Manager: all. Receptionist: counter only (🔧 confirm).

## 6. API
| Endpoint | Method | Perm |
|---|---|---|
| `/sales/` | POST | pos.counter_sale.create |
| `/sales/{id}/` | GET | billing.sales_invoices.view |
| `/sales/{id}/return/` | POST | pos.returns.create |
| `/sales/returns/{id}/` | PATCH | pos.returns.approve |
| `/products/barcode/{barcode}/` | GET | pos.counter_sale.create |

```jsonc
// POST /sales/  request
{ "shop_id":"…","sale_type":"counter","customer_id":null,
  "items":[{"variant_id":"…","quantity":2,"unit_price":250,"discount_per_unit":0}],
  "discount_type":"flat","discount_value":50,
  "payments":[{"method":"upi","amount":520,"reference_id":"UPI123"}] }
// 201 { "success":true,"data":{ "sale_number":"HTA-SALE-2026-06-0031","grand_total":520,"status":"completed" } }
// 400 INSUFFICIENT_STOCK | 400 CREDIT_LIMIT_EXCEEDED (wholesale credit)
```

## 7. Real-time events
`sale.completed { sale_id, sale_number, grand_total, sale_type }` → Billing, Manager. `stock.updated` (emitted via inventory).

## 8. Notifications
| Template | Trigger | Recipient | Variables |
|---|---|---|---|
| sale_invoice | counter/wholesale completed | customer (if linked) | customer_name, sale_number, grand_total, invoice_link |
| wholesale_payment_reminder | outstanding > due_date | customer | customer_name, sale_number, outstanding, payment_link |
| credit_note_issued | return approved | customer | customer_name, credit_note_number, amount, invoice_link |

## 9. Reports
Outstanding Dues (Wholesale), Payment Collection Log (shared w/ Billing). Full: `11-reports`.

## 10. Acceptance criteria
- [ ] Stock deducts at the correct moment per sale type; never goes negative.
- [ ] Wholesale credit blocked at limit.
- [ ] Line snapshots frozen at sale time.
- [ ] Returns restock + issue credit note; sale status → returned/partially.
- [ ] Razorpay payment recorded via webhook idempotently (no double-count on `razorpay_payment_id`).

## 11. Tests
Counter sale w/ Razorpay mock → webhook → payment recorded → invoice. Wholesale credit sale → outstanding tracked. Return → credit note + restock. Isolation + RBAC.

## 12. Open questions
OQ-05 (wholesale credit approval), OQ-04 (thermal printer for receipts).
