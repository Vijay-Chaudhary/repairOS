# Module 10 — Finance (Petty Cash, Expenses, Budget, Assets)

> Shop-level financial back office: petty cash accounts, expenses, budget vs actual, and fixed-asset tracking.

## 1. Purpose & scope
Track day-to-day cash (petty cash), record expenses, plan and monitor budgets (budgeted vs actual with variance), and maintain a register of shop assets. **Out of scope:** salary (`09-hr-payroll`), invoices/payments (`07-billing`).

## 2. Dependencies
foundation 01/02/03; `06-procurement` (asset purchased from supplier). Consumed by Reports, dashboard (budget over-limit widget).

## 3. Data model (tenant DB)

### 3.1 `petty_cash_accounts`
id, shop_id FK **UNIQUE** (one per shop), name DEFAULT "Petty Cash", current_balance DEFAULT 0, low_balance_threshold DEFAULT 500.

### 3.2 `petty_cash_transactions`
id, account_id FK, type (credit/debit), amount, category, description, receipt_url (S3), date, recorded_by, `balance_after`. Each txn recomputes and stores running balance atomically.

### 3.3 `expenses`
id, shop_id FK, budget_head_id FK NULL, category, amount, description, receipt_url, date, recorded_by.

### 3.4 `budget_heads`
id, shop_id FK, name, category (fixed/variable/capital).

### 3.5 `budget_allocations`
id, head_id FK, month (1-12), year, budgeted_amount, actual_amount DEFAULT 0, variance DEFAULT 0 (`actual − budgeted`), **UNIQUE(head_id, month, year)**.

### 3.6 `shop_assets`
id, shop_id FK, name, category, asset_code UNIQUE, purchase_date, purchase_cost, supplier_id FK NULL, warranty_expiry, condition (good/fair/poor/under_repair/disposed), location_description, notes, is_active.

## 4. Business rules
- **Petty cash:** each transaction adjusts `current_balance` and stores `balance_after` (immutable running ledger). Balance < threshold → `petty_cash_low` WhatsApp.
- **Budget vs actual:** Django signal on `expenses` save increments `budget_allocations.actual_amount` for matching head/month/year; recompute `variance = actual − budgeted`. Positive variance = over budget (dashboard red). Over budget → `budget_exceeded` WhatsApp to admin.
- 🔧 PROPOSED — clarify petty-cash vs expense overlap: petty-cash debits are *cash outflows from the petty box*; `expenses` are *accounting expense records* (may be paid by cash, bank, or petty cash). A petty-cash debit categorised as an expense may optionally create a linked `expenses` row. Confirm whether they should auto-link.
- **Assets:** lifecycle via `condition`; `disposed`/`is_active=false` retires.

## 5. Permissions
`erp.expenses.view/create`, `erp.budget.manage`, `erp.assets.manage`, `hr.petty_cash.manage`. Manager/Admin.

## 6. API
| Endpoint | Method | Perm |
|---|---|---|
| `/petty-cash/{shop_id}/` | GET | petty_cash.manage |
| `/petty-cash/transactions/` | POST | petty_cash.manage |
| `/budget/` | GET | budget.manage |
| `/budget/allocations/` | POST | budget.manage |
| `/assets/` | GET/POST | assets.manage |
| `/assets/{id}/` | PATCH | assets.manage |

```jsonc
// POST /petty-cash/transactions/  { "account_id":"…","type":"debit","amount":300,
//   "category":"Office supplies","description":"Printer ink","date":"2026-06-02" }
// 201 → balance_after computed
// POST /budget/allocations/  { "head_id":"…","month":6,"year":2026,"budgeted_amount":20000 }
```

## 7. Real-time events
(dashboard widget refreshes on expense-save signal — `budget_heads over limit`.)

## 8. Notifications
| Template | Trigger | Recipient | Variables |
|---|---|---|---|
| petty_cash_low | balance < threshold | manager | manager_name, shop_name, current_balance, threshold |
| budget_exceeded | actual > budgeted for a head | admin | admin_name, head_name, budgeted, actual, overage |

## 9. Reports
Expense by Category, Budget vs Actual, Petty Cash Summary. (P&L combines Billing+ERP.) Full: `11-reports`.

## 10. Acceptance criteria
- [ ] Petty cash `balance_after` is a correct, immutable running total.
- [ ] Expense save updates the right budget allocation + variance via signal.
- [ ] Over-budget triggers alert + dashboard indicator.
- [ ] Asset condition lifecycle works; disposed assets excluded from active lists.

## 11. Tests
Petty-cash running-balance integrity under ordered txns. Budget signal correctness. Asset state transitions. Isolation.

## 12. Open questions
🔧 Petty-cash ↔ expense auto-linking.
