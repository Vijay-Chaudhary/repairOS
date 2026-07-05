# ERP/CRM Phase 9 Implementation Plan — Financial Statements (P&L + Balance Sheet)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Turn the posted ledger into the two statements a shop owner actually reads — a **Profit & Loss (Income Statement)** over a date range and a **Balance Sheet** as of a date — both derived from the same posted `JournalLine` data that already backs the Trial Balance (Phase 8a). Grouped by `account_type` (and optionally by `parent` head), with CSV export, surfaced as two new tabs in the existing `/finance` layout.

**Architecture:** Extend the existing `apps/accounts` app — **no new app, no new model**. Two new pure-Python service functions (`profit_and_loss`, `balance_sheet`) computed over `JournalLine` via aggregation (same single-query discipline as `trial_balance`), two new read-only `APIView`s under `/api/v1/accounts/reports/`, mirroring `TrialBalanceView` (shop-scoped via `_resolve_shop`, `_parse_date`, optional `format=csv`). One new permission pair `accounts.reports.view` / `accounts.reports.export`. Frontend: two pages under `/finance/*`, two tabs, gated on `accounts.reports.view`.

**Tech Stack:** Django 4.2 + DRF, pytest; Next.js 14 App Router + TS strict, React Query v5, Tailwind, Vitest.

**Design spec:** none separate — design decisions are embedded in the "Design decisions" section below (this phase is a read-only reporting layer over existing 8a/8b data, so a full spec doc would only restate this).

---

## Design decisions (read before starting)

The whole phase hangs on getting the accounting right. These are the locked rules:

1. **Single source of truth = posted lines.** Both statements read only `JournalEntry.Status.POSTED` lines, exactly like `trial_balance`. Draft entries never appear.

2. **Sign convention (reuse `Account.normal_balance`).**
   - **P&L** — income accounts are credit-normal: `income_amount = Σcredit − Σdebit`. Expense accounts are debit-normal: `expense_amount = Σdebit − Σcredit`. `net_profit = total_income − total_expense`. A reversal/refund naturally reduces the figure because it flips debit/credit.
   - **Balance Sheet** — assets are debit-normal (`Σdebit − Σcredit`); liabilities and equity are credit-normal (`Σcredit − Σdebit`).

3. **The retained-earnings rollup is the crux.** Income and expense accounts do **not** appear on the Balance Sheet — their net rolls into equity. So `balance_sheet(shop, as_of)` computes a synthetic **"Current Period Earnings"** line = `Σincome − Σexpense` for all posted lines **up to and including `as_of`**, and adds it to the Equity section. Without this, Assets ≠ Liabilities + Equity.

4. **The balance assertion is the correctness test, not decoration.** `balance_sheet` returns `total_assets`, `total_liabilities`, `total_equity` (equity **including** current-period earnings), and `is_balanced = (total_assets == total_liabilities + total_equity)`. Because every posted entry is itself balanced (8a enforces Σdebit == Σcredit at post time), this identity holds by construction — the test asserts it on real data to catch a sign/grouping regression.

5. **P&L window vs. Balance Sheet point-in-time.** P&L takes `date_from`/`date_to` (inclusive range; both optional → all-time). Balance Sheet takes a single `as_of` (inclusive; optional → latest). This mirrors the real semantics: P&L is a flow over a period, the Balance Sheet is a snapshot.

6. **Grouping.** Each statement returns rows grouped by section. Within a section, one row per account that has a non-zero balance (skip zero rows, like `trial_balance`), ordered by `code`. Each row carries `account_id, code, name, amount`. Section objects carry `rows` + `subtotal`. Do **not** build a deep parent/child tree this phase — a flat, code-ordered list per section is the deliverable; `parent`-based nesting is a future enhancement (note it, don't build it).

7. **Money = `Decimal`, quantized to `TWO_PLACES`** (reuse the module constant), `ROUND_HALF_UP` semantics as elsewhere. Never floats.

8. **No new Celery, no new model, no migration.** Pure read-side. Reuse `_resolve_shop`, `_parse_date`, the CSV-export gate pattern (`accounts.reports.export`), and `RepairOSPageNumberPagination` is **not** needed (statements are whole documents, returned un-paginated like the Trial Balance).

---

## Reference patterns (read before starting)

- **Service to mirror:** `apps/accounts/services.py` → `trial_balance(shop, as_of)` (lines ~275-319) — the aggregation shape (`Coalesce(Sum(...), zero, output_field=dec)`, filtered `Q` on posted status + `date__lte`), zero-row skipping, `TWO_PLACES` quantization. Also `_signed_movement` and `Account.normal_balance`.
- **View to mirror:** `apps/accounts/views.py` → `TrialBalanceView` (lines ~366-379) for shop resolution + `as_of`; `LedgerView` + `_ledger_csv_response` (lines ~311-363) for the `format=csv` export gate pattern (`HasPermission("accounts.reports.export")`).
- **URL wiring:** `apps/accounts/urls.py` — add two `path("reports/pnl/", ...)` / `path("reports/balance-sheet/", ...)` entries.
- **Serializers:** `apps/accounts/serializers.py` — copy the style of `TrialBalanceRowSerializer` for the new statement row/section serializers.
- **Permission seed list:** `apps/master/services.py` — the `accounts.*` block (lines ~410-416). Seed test EXPECTED set: `apps/master/tests/test_permission_seed.py` (lines ~23-27).
- **Test fixtures to copy:** `apps/accounts/tests/test_ledger.py` (top) — `shop`, `client_with_perms(shop, perms)`, and the `_entry` helper that posts balanced entries via `services.create_journal_entry` + `services.post_journal_entry`.
- **Frontend tabs:** `frontend/src/app/(app)/finance/layout.tsx` (`TABS` array — add "P&L" + "Balance Sheet", `permission: 'accounts.reports.view'`). Page to mirror for a read-only table + date filters + React Query: `frontend/src/app/(app)/finance/ledger/page.tsx` (trial-balance/ledger style). Query keys: `frontend/src/lib/query/keys.ts`.
- Response envelope `{success, data}`; backend tests read `.json()["data"]`.

**Build order:** Task 1 (perms) → 2 (P&L service+API) → 3 (Balance Sheet service+API) → 4 (Frontend) → 5 (Verify). Each task ends in a commit.

---

## Task 1: `accounts.reports.view` + `accounts.reports.export` permissions

**Files:** `apps/master/services.py`, `apps/master/tests/test_permission_seed.py`.

- [x] **Step 1: Failing test** — `apps/master/tests/test_permission_seed.py`: add `"accounts.reports.view"` and `"accounts.reports.export"` to the EXPECTED slug set (the existing test asserts each slug is seeded **and** granted to Tenant Admin).
- [x] **Step 2: Run → FAIL** (slugs not seeded).
  `cd backend && python -m pytest apps/master/tests/test_permission_seed.py -p no:cacheprovider -o addopts="" --create-db -q`
- [x] **Step 3: Seed the perms** — add `("accounts.reports.view", "accounts")` and `("accounts.reports.export", "accounts")` to the `accounts.*` block in `apps/master/services.py`.
- [x] **Step 4: Run → PASS** — the seed test, then `python -m pytest apps/master -p no:cacheprovider -o addopts="" --create-db -q`.
- [x] **Step 5: Commit** — `git commit -m "feat(accounts): accounts.reports.view + accounts.reports.export permissions"`

---

## Task 2: Profit & Loss — service + API

**Files:** `apps/accounts/services.py`, `serializers.py`, `views.py`, `urls.py`; `apps/accounts/tests/test_financial_statements.py` (new).

- [ ] **Step 1: Failing tests** (copy `shop` + `client_with_perms` + the balanced-`_entry` helper from `test_ledger.py`). Build a small fixture: seed the default chart, post a sale (Dr Cash / Cr Sales 1000) and an expense (Dr Rent / Cr Cash 300), one of them dated outside the query window.
  - `test_pnl_requires_reports_view` — GET `/api/v1/accounts/reports/pnl/` without `accounts.reports.view` → 403.
  - `test_pnl_income_expense_and_net` — with `accounts.reports.view`: income section subtotal == 1000, expense subtotal == 300, `net_profit` == 700; each section lists only non-zero accounts, ordered by code.
  - `test_pnl_date_window_excludes_out_of_range` — `date_from`/`date_to` excludes the out-of-window entry (subtotal reflects only in-window lines).
  - `test_pnl_ignores_draft_entries` — a draft entry in range does not affect any subtotal.
  - `test_pnl_reversal_reduces_income` — a reversing entry (Dr Sales / Cr Cash) nets the income figure back down.
  - `test_pnl_csv_export_requires_export_perm` — `?format=csv` without `accounts.reports.export` → 403; with it → `text/csv` attachment.
- [ ] **Step 2: Run → FAIL** (404 / route missing).
  `cd backend && python -m pytest apps/accounts/tests/test_financial_statements.py -p no:cacheprovider -o addopts="" --create-db -q`
- [ ] **Step 3: Service** — add `profit_and_loss(shop, date_from=None, date_to=None) -> dict` to `services.py`. Aggregate posted `JournalLine` per account with a `Q(journal_lines__entry__status=POSTED)` filter plus optional `date__gte`/`date__lte`, restricted to `account_type in {income, expense}`. Build two sections:
  ```
  {
    "income":  {"rows": [{account_id, code, name, amount}], "subtotal": Decimal},
    "expense": {"rows": [...], "subtotal": Decimal},
    "net_profit": Decimal,   # income.subtotal - expense.subtotal
    "date_from": date|None, "date_to": date|None,
  }
  ```
  Income amount = `Σcredit − Σdebit`; expense amount = `Σdebit − Σcredit`; skip zero rows; quantize to `TWO_PLACES`; order rows by `code`. Single aggregated query (no N+1), same construction as `trial_balance`.
- [ ] **Step 4: Serializers** — `StatementRowSerializer` (account_id, code, name, amount) and `StatementSectionSerializer` (rows, subtotal). Add to `serializers.py`.
- [ ] **Step 5: View + route** — `ProfitLossView(APIView)` with `permission_classes = [IsAuthenticated, require_permission("accounts.reports.view")]`; resolve shop via `_resolve_shop`, parse `date_from`/`date_to` via `_parse_date`, call the service, serialize sections. Add `format=csv` branch gated on `HasPermission("accounts.reports.export")` (mirror `_ledger_csv_response`) writing a two-section CSV with a Net Profit footer. Wire `path("reports/pnl/", views.ProfitLossView.as_view(), name="report-pnl")` in `urls.py`.
- [ ] **Step 6: Run → PASS** + `python -m pytest apps/accounts -p no:cacheprovider -o addopts="" --create-db -q`.
- [ ] **Step 7: Commit** — `git commit -m "feat(accounts): Profit & Loss statement — service + API + CSV export"`

---

## Task 3: Balance Sheet — service + API (with retained-earnings rollup + balance assertion)

**Files:** `apps/accounts/services.py`, `views.py`, `urls.py`; extend `apps/accounts/tests/test_financial_statements.py`.

- [ ] **Step 1: Failing tests** (reuse the fixture chart). Post opening capital (Dr Cash / Cr Capital), a sale, and an expense.
  - `test_balance_sheet_requires_reports_view` — GET `/reports/balance-sheet/` without perm → 403.
  - `test_balance_sheet_sections` — assets / liabilities / equity sections each list non-zero accounts ordered by code, with correct signs (assets `Σdebit−Σcredit`, liab+equity `Σcredit−Σdebit`).
  - `test_balance_sheet_current_period_earnings` — the synthetic "Current Period Earnings" line in Equity == `Σincome − Σexpense` up to `as_of`; income/expense accounts themselves do **not** appear as rows.
  - `test_balance_sheet_is_balanced` — `total_assets == total_liabilities + total_equity` and `is_balanced is True` on the posted data.
  - `test_balance_sheet_as_of_snapshot` — an entry dated after `as_of` is excluded from every section and from current-period earnings.
- [ ] **Step 2: Run → FAIL.**
  `cd backend && python -m pytest apps/accounts/tests/test_financial_statements.py -p no:cacheprovider -o addopts="" --create-db -q`
- [ ] **Step 3: Service** — add `balance_sheet(shop, as_of=None) -> dict`:
  - Aggregate posted lines per account up to `as_of` (`date__lte` when given), grouped into asset / liability / equity sections (signed per `normal_balance`), skip zero rows, order by `code`.
  - Compute `current_period_earnings = Σ(income credit−debit) − Σ(expense debit−credit)` up to `as_of` and append it as a synthetic row (no real `account_id`; `code=None`, `name="Current Period Earnings"`) into the **equity** section, folded into `equity.subtotal`.
  - Return:
    ```
    {
      "assets":      {"rows": [...], "subtotal": Decimal},
      "liabilities": {"rows": [...], "subtotal": Decimal},
      "equity":      {"rows": [...], "subtotal": Decimal},  # incl. current-period earnings
      "total_assets": Decimal,
      "total_liabilities": Decimal,
      "total_equity": Decimal,
      "is_balanced": bool,   # total_assets == total_liabilities + total_equity
      "as_of": date|None,
    }
    ```
  - Keep it to a small, fixed number of aggregate queries (one per grouping is fine; no per-account query loop).
- [ ] **Step 4: View + route** — `BalanceSheetView(APIView)` (`accounts.reports.view`), `_resolve_shop` + `_parse_date("as_of")`, serialize the three sections with the Task-2 serializers (the synthetic earnings row serializes fine — `account_id`/`code` nullable in `StatementRowSerializer`). Add `format=csv` gated on `accounts.reports.export`. Wire `path("reports/balance-sheet/", views.BalanceSheetView.as_view(), name="report-balance-sheet")`.
- [ ] **Step 5: Run → PASS** + full `apps/accounts` suite.
- [ ] **Step 6: Commit** — `git commit -m "feat(accounts): Balance Sheet — service + API + CSV export"`

---

## Task 4: Frontend — P&L + Balance Sheet pages + tabs

**Files:** `frontend/src/app/(app)/finance/pnl/page.tsx`, `frontend/src/app/(app)/finance/balance-sheet/page.tsx` (new); `frontend/src/app/(app)/finance/layout.tsx`; `frontend/src/lib/query/keys.ts`; API client module under `frontend/src/lib/api/` (mirror the ledger/trial-balance client); Vitest specs alongside.

- [ ] **Step 1: Failing test (Vitest)** — a render test per page: mock the API to return a two/three-section statement and assert section subtotals + Net Profit / Is-Balanced badge render. (Mirror the existing finance page test style.)
- [ ] **Step 2: Run → FAIL.** `cd frontend && npx vitest run src/app/\(app\)/finance/pnl src/app/\(app\)/finance/balance-sheet`
- [ ] **Step 3: Add tabs** — in `finance/layout.tsx` `TABS`, add `{ label: 'P&L', href: '/finance/pnl', permission: 'accounts.reports.view' }` and `{ label: 'Balance Sheet', href: '/finance/balance-sheet', permission: 'accounts.reports.view' }`.
- [ ] **Step 4: Pages** — each a client page: date filter(s) (P&L: from/to; BS: as-of), React Query fetch (add keys to `keys.ts`), sectioned table with subtotals, and a footer (P&L: Net Profit; BS: an "In balance ✓ / Out of balance ✗" badge from `is_balanced`). TS strict, no `any`, Tailwind, mobile-first. Add a "Export CSV" link that hits `?format=csv`, shown only when `hasPermission('accounts.reports.export')`.
- [ ] **Step 5: Run → PASS** (Vitest) + `cd frontend && npx tsc --noEmit`.
- [ ] **Step 6: Commit** — `git commit -m "feat(finance): P&L + Balance Sheet report pages"`

---

## Task 5: Verify

- [ ] **Step 1: Backend full suite** — `cd backend && python -m pytest apps/accounts apps/master -p no:cacheprovider --create-db -q`. All green.
- [ ] **Step 2: Cross-check invariants** — in a shell/test, assert on seeded data that: P&L `net_profit` for all-time == the Balance-Sheet `current_period_earnings` at the latest `as_of`; and Balance Sheet `is_balanced is True`. These two ties are the accounting acceptance gate.
- [ ] **Step 3: Frontend** — `cd frontend && npx tsc --noEmit && npx vitest run`.
- [ ] **Step 4: Commit** (if any verify-driven fixes) — `git commit -m "test(accounts): financial-statements verification — P&L↔BS earnings tie + balance check"`

---

## Notes for the implementer

- **The two acceptance invariants are the whole point:** (a) Balance Sheet always balances (`total_assets == total_liabilities + total_equity`), and (b) all-time P&L `net_profit` equals Balance-Sheet `current_period_earnings` at the latest date. Write those assertions first (Task 2 net, Task 3 balanced + earnings) — everything else is presentation.
- **Reuse, don't duplicate.** Both services aggregate the same posted-`JournalLine` data as `trial_balance`; copy its query construction (`Coalesce(Sum(..., filter=Q(...)), zero, output_field=dec)`) rather than inventing a new pattern. `Account.normal_balance` already encodes the sign rules — use it, don't hardcode type sets in the reporting code.
- **No new model, no migration, no Celery, no pagination** — statements are whole documents returned un-paginated like the Trial Balance.
- **Draft exclusion + date bounds** are the two easiest regressions; they each get an explicit test.
- **Nullable synthetic row:** the "Current Period Earnings" equity row has no `account_id`/`code` — make those fields nullable in `StatementRowSerializer` so the same serializer covers real and synthetic rows.
- **Skip-zero-rows** keeps statements readable and matches `trial_balance` behavior; make sure a fully-offset account (equal debit/credit) drops out.
- **Parent/child nesting is explicitly out of scope** — flat, code-ordered rows per section. Note the follow-up; don't build the tree.
