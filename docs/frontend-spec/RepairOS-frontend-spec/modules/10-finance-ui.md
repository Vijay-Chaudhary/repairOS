# Module 10 — Finance (Frontend)

> Pairs with backend `modules/10-finance.md`. Petty cash, expenses, budget vs actual, assets.

## 1. Screens & routes
| Screen | Route | Reach |
|---|---|---|
| Petty cash | `/finance/petty-cash` | hr.petty_cash.manage |
| Expenses | `/finance/expenses` | erp.expenses.view/create |
| Budget | `/finance/budget` | erp.budget.manage |
| Assets | `/finance/assets` | erp.assets.manage |

## 2. Navigation & layout
Petty cash: balance card + running ledger (credit/debit/balance_after). Budget: heads × month with budgeted/actual/variance, over-budget in red. Assets: register with condition.

## 3. Components
`PettyCashLedger` + `PettyCashEntryDialog` (+ receipt photo), `ExpenseForm` (+ budget head), `BudgetMatrix` (budgeted vs actual vs variance), `AssetTable` + `AssetForm`.

## 4. Forms & validation
- Petty cash entry: type, amount, category, description, receipt photo, date → shows new balance.
- Expense: amount, category, budget head, receipt; (🔧 optional link to petty-cash debit if OQ confirmed).
- Budget allocation: head + month/year + budgeted amount.
- Asset: code unique, purchase info, supplier link, condition lifecycle.

## 5. States
Low petty-cash balance warning. Over-budget heads highlighted red (dashboard mirrors). Asset disposed excluded from active. Offline: financial entries blocked.

## 6. API wiring
`/petty-cash/{shop_id}/` · `/petty-cash/transactions/` · `/budget/` · `/budget/allocations/` · `/assets/` · `/assets/{id}/`. Keys `['pettyCash',shopId]`, `['budget',shopId,month,year]`, `['assets',f]`.

## 7. Real-time
Budget over-limit reflected on dashboard widget (expense-save signal).

## 8. Permissions in UI
Manager/admin; petty cash own gate. 

## 9. Mobile notes
Snap a receipt photo when logging petty cash/expense on the go.

## 10. Acceptance criteria
- [ ] Petty cash running balance correct + immutable ledger.
- [ ] Expense updates budget actual/variance; over-budget surfaced.
- [ ] Asset condition lifecycle works; disposed hidden from active.
