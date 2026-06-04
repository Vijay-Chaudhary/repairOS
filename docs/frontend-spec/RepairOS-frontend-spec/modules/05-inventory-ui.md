# Module 05 — Inventory & Products (Frontend)

> Pairs with backend `modules/05-inventory.md`. Catalogue, per-shop stock, movement ledger.

## 1. Screens & routes
| Screen | Route | Reach |
|---|---|---|
| Stock list | `/inventory` | erp.inventory.view |
| Product catalogue | `/products` | erp.inventory.view |
| Product/variant editor | `/products/[id]` | erp.inventory.adjust |
| Movement ledger | `/inventory/transactions` | erp.inventory.view |
| Adjustment / transfer | `/inventory` (actions) | erp.inventory.adjust |

## 2. Navigation & layout
Stock table per active shop: variant, qty, reorder level, low-stock flag, value. Catalogue grouped by category (tree). Ledger is an immutable transaction list (filter by variant/type/date).

## 3. Components
`StockTable`, `LowStockBadge`, `ProductForm` (+ variants editor, attributes JSONB UI, barcode field), `AdjustmentDialog`, `TransferDialog`, `LedgerTable`, `CsvImporter` (bulk products), `BarcodeScanner`.

## 4. Forms & validation
- Adjustment: signed qty + note; preview resulting stock; block if would go negative (`INSUFFICIENT_STOCK`).
- Transfer: source/dest shop + items; (🔧 receipt-confirm step if OQ-06 confirmed).
- Product: sku unique, hsn_code, tax rate, is_for_sale / is_for_repair_use toggles; variants with cost/selling/wholesale prices, barcode unique.
- CSV import: validate + show row errors before commit.

## 5. States
Low-stock rows highlighted; empty catalogue CTA. Ledger read-only. Offline: adjustments/transfers blocked.

## 6. API wiring
`/inventory/stock/` · `/inventory/adjustment/` · `/inventory/transfer/` · `/inventory/transactions/` · `/products/` · `/products/bulk-import/` · `/products/barcode/{barcode}/`. Keys `['stock',shopId]`, `['products',f]`.

## 7. Real-time
`stock.updated` → refresh rows; `stock.low_alert` → toast + Inventory nav badge for managers.

## 8. Permissions in UI
View vs adjust separated; transfer/adjust manager/admin only.

## 9. Mobile notes
Barcode scan to look up / adjust on the floor. Stock list as cards on phone.

## 10. Acceptance criteria
- [ ] UI never allows negative stock; clear block.
- [ ] Every adjustment/transfer shows the resulting ledger entry.
- [ ] Low-stock surfaced live. CSV import validates before commit.
