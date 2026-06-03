# Module 07 — Billing & GST

> Repair invoices, payments (cash/UPI/card/cheque/NEFT + Razorpay), GST computation, outstanding tracking, and Tally export.

## 1. Purpose & scope
Generate GST-compliant repair invoices, record payments against them, integrate Razorpay (links + webhook), maintain customer outstanding, and export to Tally. **Out of scope:** sales invoices (`03-pos` issues them but shares the payment pattern), salary/commission payouts (HR/Commissions). Per AD-09, repair and sales invoices live in separate tables (different GST: SAC vs HSN, sequences, line types). Per AD-12, AMC renewals reuse `repair_invoices`.

## 2. Dependencies
foundation 01/02/03; `02-repair` (job, service_charge, consumed parts); `01-crm` (customer, maintains `total_billed`/`total_outstanding`); `04-amc` (renewal invoices). Consumed by Reports, CRM profile.

## 3. Data model (tenant DB; soft-delete on invoices)

### 3.1 `repair_invoices`
| Column | Type | Notes |
|---|---|---|
| id | UUID | PK |
| shop_id | UUID | FK NOT NULL |
| job_id | UUID | FK→job_tickets UNIQUE NOT NULL |
| customer_id | UUID | FK NOT NULL |
| invoice_number | VARCHAR(30) | UNIQUE `{SHOP_CODE}-INV-{YYYY-MM}-{NNNN}` |
| status | VARCHAR(20) | draft/issued/partially_paid/paid/cancelled |
| subtotal | DECIMAL(12,2) | NOT NULL |
| discount_amount | DECIMAL(10,2) | DEFAULT 0 |
| cgst / sgst / igst | DECIMAL(10,2) | DEFAULT 0 |
| grand_total | DECIMAL(12,2) | NOT NULL |
| amount_paid / amount_outstanding | DECIMAL(12,2) | |
| due_date | DATE | NULL |
| pdf_url | VARCHAR(500) | S3, signed 7-day expiry |

### 3.2 `repair_invoice_items`
id, invoice_id FK, item_type (labor/component/custom), description, sac_code (labor), hsn_code (component), quantity DEFAULT 1, unit_price, tax_rate, line_total.

### 3.3 `payments` (repair invoice payments)
id, invoice_id FK, amount, method (cash/upi/card/cheque/neft/other), reference_id, `razorpay_payment_id` UNIQUE NULL (prevents duplicate webhook recording), razorpay_order_id, paid_at, recorded_by, notes.

## 4. Business rules
- **Invoice from job** (`02-repair` §4.4): labor line = `job.service_charge` (SAC code); component lines = parts actually consumed (HSN); custom lines as needed. `subtotal` = Σ lines; GST per foundation/03 §5; `grand_total = subtotal − discount + tax`.
- **Payments**: each payment decrements `amount_outstanding`; status flips issued → partially_paid → paid. Partial payments allowed.
- **Razorpay**: `POST /payments/razorpay/create-link/` returns a link; webhook `POST /webhooks/razorpay/` (HMAC-verified, deduped via `webhook_events` + `razorpay_payment_id` UNIQUE) records payment automatically.
- **Outstanding & reminders**: `repair_payment_reminder` if outstanding repair > 7 days. CRM `customers.total_billed/total_outstanding` updated on every invoice/payment (denormalized counters — single source maintained here).
- **Tally export**: GSTR-1 (outward) + GSTR-2 proxy (inward) as Tally-compatible CSV (`billing.tally_export`).

## 5. Permissions
`billing.repair_invoices.view/create`, `billing.sales_invoices.view`, `billing.payments.record`, `billing.outstanding.view`, `billing.tally_export`. Billing Staff + Manager + Admin.

## 6. API
| Endpoint | Method | Perm |
|---|---|---|
| `/repair-invoices/` | POST | repair_invoices.create |
| `/repair-invoices/{id}/pdf/` | GET | repair_invoices.view (signed URL) |
| `/repair-invoices/{id}/send-whatsapp/` | POST | repair_invoices.create |
| `/payments/` | POST | payments.record |
| `/payments/razorpay/create-link/` | POST | payments.record |
| `/webhooks/razorpay/` | POST | signature-verified |

```jsonc
// POST /repair-invoices/  { "job_id":"…","discount_amount":0,"due_date":"2026-06-10" }
// 201 { "invoice_number":"HTA-INV-2026-06-0021","grand_total":4720,"status":"issued","pdf_url":"…" }

// POST /payments/  (Idempotency-Key header)
// { "invoice_id":"…","amount":4720,"method":"upi","reference_id":"UPI998" }
// 201 → status paid, amount_outstanding 0
```

## 7. Real-time events
`payment.received { invoice_type, invoice_id, amount, outstanding }` → Billing, Manager.

## 8. Notifications
| Template | Trigger | Recipient | Variables |
|---|---|---|---|
| repair_payment_reminder | outstanding repair > 7 days | customer | customer_name, invoice_number, outstanding, payment_link |
| payment_received_confirmation | payment recorded | customer | customer_name, amount_paid, outstanding_remaining |
| (job_delivered carries invoice_link — owned by Repair) | | | |

## 9. Reports
Revenue Summary, Outstanding Dues (Repair), Payment Collection Log, P&L Summary, GSTR-1, GSTR-2 Proxy. Full: `11-reports`.

## 10. Acceptance criteria
- [ ] Invoice labor == job.service_charge; components == consumed parts.
- [ ] GST split correct intra/inter-state; SAC on labor, HSN on goods.
- [ ] Partial payments roll status correctly; outstanding never negative.
- [ ] Razorpay webhook records payment exactly once (dedup).
- [ ] CRM denormalized totals stay consistent with invoices/payments.
- [ ] PDF served via signed 7-day S3 URL.

## 11. Tests
Invoice math (discount + GST). Razorpay webhook replay → single payment. Partial payment sequence. Tally CSV format snapshot. Isolation.

## 12. Open questions
OQ-01 (Razorpay account model — platform vs per-tenant; affects settlement/TDS/GST), OQ-02 (data retention).
