# Module 06 — Suppliers & Procurement (Frontend)

> Pairs with backend `modules/06-procurement.md`. Suppliers, POs, GRN, purchase invoices, payments, returns.

## 1. Screens & routes
| Screen | Route | Reach |
|---|---|---|
| Suppliers | `/suppliers` | erp.suppliers.manage |
| Supplier ledger | `/suppliers/[id]` | erp.suppliers.manage |
| Purchase orders | `/purchases` | erp.purchase_orders.create |
| PO detail / GRN | `/purchases/[id]` | erp.grn.receive |
| Purchase invoices | `/purchases?tab=invoices` | erp.purchase_invoices.record |

## 2. Navigation & layout
PO list with status (draft/sent/partially_received/received). PO detail shows ordered vs received, with a **GRN panel** to receive (accept/reject per line). Supplier ledger = bills + payments + balance.

## 3. Components
`SupplierForm` (encrypted bank fields masked), `PoBuilder` (line items, variant search, costs, tax), `GrnReceiveForm` (accepted/rejected/reason per line), `PurchaseInvoiceForm`, `PurchasePaymentDialog`, `ReturnDialog` (+ debit note), `AgedPayableTable`.

## 4. Forms & validation
- PO: supplier, expected date, lines (variant, qty, unit_cost, tax). 
- GRN: per line received/accepted/rejected; reason required if rejected>0; accepted posts stock (show resulting stock).
- Purchase invoice: supplier bill no/date, amounts, GST (auto intra/inter from supplier state), due date.
- Payment: amount ≤ outstanding, method, reference.
- Return → debit note generation.

## 5. States
PO partial vs full receipt clearly shown. Bank fields masked, reveal on permission. Aged payable buckets. Loading skeletons.

## 6. API wiring
`/suppliers/` · `/suppliers/{id}/ledger/` · `/purchase-orders/` · `/purchase-orders/{id}/` · `/grn/` · `/purchase-invoices/` · `/purchase-payments/`. Keys `['suppliers',f]`, `['po',f]`, `['po',id]`.

## 7. Real-time
GRN accept triggers `stock.updated` (inventory refresh). Spare-part request → PO link surfaces in Repair.

## 8. Permissions in UI
All procurement actions manager/admin. Supplier bank reveal extra-gated.

## 9. Mobile notes
GRN receiving usable at the delivery dock: per-line accept/reject with quick qty entry; photo of challan.

## 10. Acceptance criteria
- [ ] GRN posts accepted qty to stock once; PO status updates.
- [ ] Rejected lines require a reason and don't stock.
- [ ] Purchase GST auto intra/inter-state; payments tracked to balance.
- [ ] Returns generate a debit note.
