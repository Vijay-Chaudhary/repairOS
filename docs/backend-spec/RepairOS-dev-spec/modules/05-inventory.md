# Module 05 — Inventory & Products

> Product catalogue (categories, products, variants), per-shop stock, and the immutable stock-movement ledger.

## 1. Purpose & scope
Define what the shop sells/uses (products → variants with barcodes and prices), track stock per variant per shop, and record every movement as an immutable transaction. **Out of scope:** purchasing (`06-procurement`), selling (`03-pos`), parts on jobs (`02-repair`).

## 2. Dependencies
foundation 01/02/03. Written-to by Procurement (purchase_in/return_out), POS (sale_out/return_in), Repair (repair_out), and inter-shop transfers. Consumed by POS, Repair, Billing, Reports.

## 3. Data model (tenant DB; soft-delete on products/variants)

### 3.1 `product_categories`
id, name, `parent_id` FK self NULL (hierarchical).

### 3.2 `products`
id, category_id FK NULL, name, sku UNIQUE, brand, description, hsn_code (for GST), default_tax_rate DEFAULT 18.00, `is_for_sale` DEFAULT TRUE (POS visible), `is_for_repair_use` DEFAULT FALSE (job picker visible), is_active.

### 3.3 `product_variants`
id, product_id FK, variant_name, attributes JSONB (`{"color":"Black","resolution":"2MP"}`), barcode UNIQUE NULL, cost_price, selling_price, wholesale_price NULL, minimum_order_qty DEFAULT 1, is_active.

### 3.4 `inventory_stock`
id, shop_id FK, variant_id FK, `quantity_in_stock` DEFAULT 0 **CHECK (>= 0)**, reorder_level DEFAULT 5, **UNIQUE(shop_id, variant_id)**.

### 3.5 `inventory_transactions` (immutable ledger)
id, shop_id FK, variant_id FK INDEXED, type (purchase_in/sale_out/repair_out/return_in/return_out/transfer_in/transfer_out/adjustment/opening_stock), quantity (signed: +in/−out), reference_type (grn/sale/job/transfer/adjustment/return/opening), reference_id, note, created_by, created_at.

## 4. Business rules
- Stock per variant per shop; `quantity_in_stock` CHECK ≥ 0. Any breaching op → `400 INSUFFICIENT_STOCK`.
- **Every** change writes an `inventory_transactions` row (never mutate stock without a ledger entry). The two happen in one DB transaction.
- Reorder alert when `quantity_in_stock < reorder_level` → `stock.low_alert` event + `low_stock_alert` WhatsApp to manager.
- **Inter-shop transfer:** creates `transfer_out` (source) + `transfer_in` (dest). 🔧 PROPOSED: receiving shop confirms receipt before `transfer_in` posts — confirm (OQ-06).
- Opening stock seeded via `opening_stock` transactions.

## 5. Permissions
`erp.inventory.view`, `erp.inventory.adjust`. Manager/Admin/Billing: view. Adjust/transfer: Manager/Admin.

## 6. API
| Endpoint | Method | Perm |
|---|---|---|
| `/inventory/stock/` | GET | inventory.view |
| `/inventory/adjustment/` | POST | inventory.adjust |
| `/inventory/transfer/` | POST | inventory.adjust |
| `/inventory/transactions/` | GET | inventory.view |
| `/products/` | GET/POST | inventory.view/adjust |
| `/products/bulk-import/` | POST | inventory.adjust (CSV) |
| `/products/barcode/{barcode}/` | GET | pos.counter_sale.create |

```jsonc
// POST /inventory/adjustment/  { "shop_id":"…","variant_id":"…","quantity":-3,"note":"Damaged in storage" }
// 201 → writes adjustment transaction, decrements stock
// 400 INSUFFICIENT_STOCK if it would go negative
```

## 7. Real-time events
`stock.updated { variant_id, variant_name, new_qty, change_type }` → Manager, POS staff. `stock.low_alert { variant_id, variant_name, current_qty, reorder_level }` → Manager, Admin.

## 8. Notifications
`low_stock_alert` → Shop Manager (manager_name, item_name, current_qty, reorder_level).

## 9. Reports
Inventory Valuation (as_of, shop, category), Stock Movement Ledger (date_range, variant, shop). Full: `11-reports`.

## 10. Acceptance criteria
- [ ] Stock never negative; breaching op → 400.
- [ ] Every stock change has exactly one ledger row, in the same DB transaction.
- [ ] Low-stock event + WhatsApp fire on crossing reorder level.
- [ ] Transfer posts paired out/in transactions.
- [ ] Barcode lookup returns the right variant.

## 11. Tests
Concurrency: two simultaneous sale_out cannot oversell (row lock). Ledger sum == stock invariant. CSV bulk import validation. Isolation.

## 12. Open questions
OQ-06 (transfer receipt confirmation).
