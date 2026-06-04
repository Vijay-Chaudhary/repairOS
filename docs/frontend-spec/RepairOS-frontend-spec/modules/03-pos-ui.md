# Module 03 — POS (Frontend)

> Pairs with backend `modules/03-pos.md`. Fast counter sales, wholesale, job-linked sales, and returns.

## 1. Screens & routes
| Screen | Route | Reach |
|---|---|---|
| POS terminal | `/pos` | pos.counter_sale.create |
| Sale detail / receipt | `/sales/[id]` | billing.sales_invoices.view |
| Returns | `/sales/[id]` (return action) | pos.returns.create / approve |

## 2. Navigation & layout
Two-pane POS: left = product search + `BarcodeScanner`; right = cart with live totals, discount, GST split, customer (optional), payment methods (split payments). Big "Charge" button. Mode toggle: Counter / Wholesale / Job-linked (job-linked is reached from a job too).

## 3. Components
`PosTerminal`, `ProductSearch`, `BarcodeScanner`, `Cart` + `CartLine` (qty stepper, per-line discount), `GstBreakdown`, `PaymentSplit` (cash/upi/card/cheque/neft + Razorpay link), `CustomerSearch`, `ReturnDialog`, `ReceiptView`.

## 4. Forms & validation
- Cart line: qty ≥1; live `INSUFFICIENT_STOCK` check (disable charge, show available). Min-margin warning (non-blocking) if price < cost.
- Wholesale: customer required (GSTIN for B2B); `CREDIT_LIMIT_EXCEEDED` blocks with outstanding vs limit shown.
- Payment: sum of splits must equal grand total (or mark partially_paid for wholesale credit).
- Return: pick items+qty, reason, refund method → credit note.

## 5. States
Empty cart → scan/search prompt. Out of stock inline on line. Offline → POS **blocked** (financial + stock) with clear message. Razorpay link → QR/poll until webhook confirms, then receipt.

## 6. API wiring
`POST /sales/` · `GET /sales/{id}` · `POST /sales/{id}/return/` · `PATCH /sales/returns/{id}/` · `GET /products/barcode/{barcode}/` · `POST /payments/razorpay/create-link/`. Idempotency-Key on sale+payment. Invalidate `['stock',shopId]` and dashboard revenue on completion.

## 7. Real-time
`sale.completed` → manager toast; `stock.updated` → refresh availability in terminal.

## 8. Permissions in UI
Counter for receptionist/billing; wholesale + discount gated; returns.create vs returns.approve separated (approve shows pending queue).

## 9. Mobile notes
Single-column on phone: search/scan on top, cart below, sticky charge bar. Numeric keypad for qty/price. Camera scan primary on mobile.

## 10. Acceptance criteria
- [ ] Totals/GST compute locally <100ms; backend is authoritative on submit.
- [ ] Stock can't be oversold from the UI; clear block.
- [ ] Wholesale credit honored; split payments sum-validated.
- [ ] Razorpay flow confirms via webhook before showing paid.
- [ ] Returns produce a credit note + restock indication.
