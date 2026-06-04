# Module 07 — Billing & GST (Frontend)

> Pairs with backend `modules/07-billing.md`. Repair invoices, payments, Razorpay, outstanding, Tally export.

## 1. Screens & routes
| Screen | Route | Reach |
|---|---|---|
| Invoices | `/invoices` | billing.repair_invoices.view |
| Invoice detail | `/invoices/[id]` | billing.repair_invoices.view |
| Payments | `/payments` | billing.payments.record |
| Outstanding | `/invoices?tab=outstanding` | billing.outstanding.view |
| Tally export | `/reports?tab=gst` | billing.tally_export |

## 2. Navigation & layout
Invoice list (status, customer, date filters). Invoice detail: line items (labor SAC / component HSN), `GstBreakdown`, payment history, "Add payment", "Send WhatsApp", "Download PDF". Outstanding tab = aged buckets with reminder action.

## 3. Components
`InvoiceView`, `InvoiceLineItems`, `GstBreakdown`, `AddPaymentDialog` (+ Razorpay link), `PaymentHistory`, `AgedOutstandingTable`, `TallyExportPanel`, `PdfPreview`.

## 4. Forms & validation
- Generate invoice from job: confirm labor (=job SC), consumed parts auto-listed, optional discount, due date. Preview totals before issue.
- Add payment: amount ≤ outstanding, method, reference; Idempotency-Key; partial allowed.
- Razorpay: create link → show QR → poll; confirmed only on webhook.

## 5. States
Draft vs issued vs paid badges. Partial payment progress bar. PDF via signed URL (handle expiry → re-fetch). Offline: payment/generation blocked. Razorpay pending state until confirmed.

## 6. API wiring
`POST /repair-invoices/` · `GET /repair-invoices/{id}/pdf/` · `POST /repair-invoices/{id}/send-whatsapp/` · `POST /payments/` · `POST /payments/razorpay/create-link/`. Keys `['invoices',f]`, `['invoice',id]`. Payment success invalidates invoice + dashboard revenue + customer outstanding.

## 7. Real-time
`payment.received` → update invoice + dashboard + toast.

## 8. Permissions in UI
View vs create vs payments.record vs tally_export separated. Billing staff + manager + admin.

## 9. Mobile notes
Quick "collect payment" from job detail (deep link). Show QR full-screen for UPI. PDF opens in viewer/share.

## 10. Acceptance criteria
- [ ] Invoice labor == job SC; components == consumed parts; GST split correct.
- [ ] Partial payments roll status; outstanding never negative.
- [ ] Razorpay shows paid only after webhook; no double count.
- [ ] PDF served via signed URL; WhatsApp send confirmed.
