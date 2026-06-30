# ERP/CRM Phase 8a Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the double-entry accounting **core** — a new `apps/accounts` app with a hierarchical **Chart of Accounts** (+ seeded Indian-SMB default), manual **Journal Entries** (balanced debit/credit, draft→posted, posted-immutable), and a **General Ledger + Trial Balance** — surfaced as accounting tabs in the existing `/finance` (Accounts) layout. Bank Accounts, Income, and auto-posting are **Phase 8b** (not here).

**Architecture:** New `apps/accounts` Django app at `/api/v1/accounts/`, mirroring `apps/finance` view style (`APIView` + `permission_classes=[IsAuthenticated, require_permission("…")]` + `_shop_ids_from_token` + `RepairOSPageNumberPagination`). Books are **shop-scoped**. Reuses seeded `accounts.*` perms; adds one new perm `accounts.chart.manage`. Frontend pages live under `/finance/*`; no new nav node.

**Tech Stack:** Django 4.2 + DRF, pytest; Next.js 14 App Router + TS strict, React Query v5, Tailwind, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-30-erp-crm-phase-8a-design.md`

---

## Reference patterns (read before starting)

- View/scoping style to mirror: `apps/finance/views.py` (`APIView`, `_shop_ids_from_token(request)`, `RepairOSPageNumberPagination`, `require_permission`). URL include: `config/urls.py` (`path("api/v1/finance/", include("finance.urls"))`).
- Models base: `core.models.BaseModel` (uuid id, created_at, updated_at). Existing tenant-scoped finance models: `apps/finance/models.py`.
- Test fixtures to copy — `shop` + `client_with_perms(shop, perms)` factory (JWT with `permissions` + `shop_ids`): `apps/finance/tests/test_cash_book.py` (top).
- Permission seed list: `apps/master/services.py` (the `accounts.*` block, "accounts" module). Seed test EXPECTED set: `apps/master/tests/test_permission_seed.py` (lines ~23-26).
- App registration: follow how `hr`/`finance` are added to `INSTALLED_APPS` (config/settings) and `config/urls.py`.
- Frontend Accounts tabs: `frontend/src/app/(app)/finance/layout.tsx` (TABS array — add accounting tabs + per-tab perm gating via `useAuthStore`). Existing finance CRUD page to mirror styling: `frontend/src/app/(app)/finance/expenses/page.tsx`. Query keys: `frontend/src/lib/query/keys.ts`.
- Response envelope `{success, data}`; backend tests read `.json()["data"]`.

**Build order:** Task 1 (app + perm) → 2 (Chart) → 3 (Journal) → 4 (Ledger/TB) → 5 (Frontend) → 6 (Verify). Each task ends in a commit.

---

## Task 1: New `accounts` app + `accounts.chart.manage` permission

**Files:** create `apps/accounts/` (app scaffold: `__init__.py`, `apps.py`, `models.py`, `serializers.py`, `views.py`, `urls.py`, `services.py`, `migrations/__init__.py`, `tests/__init__.py`); modify `config/settings*.py` (INSTALLED_APPS), `config/urls.py`; `apps/master/services.py`, `apps/master/tests/test_permission_seed.py`.

- [x] **Step 1: Failing test** — `apps/master/tests/test_permission_seed.py`: add `"accounts.chart.manage"` to the EXPECTED slug set (the existing test asserts seeded+granted-to-admin).
- [x] **Step 2: Run → FAIL** (slug not seeded). `python -m pytest apps/master/tests/test_permission_seed.py -p no:cacheprovider -o addopts="" --create-db -q`
- [x] **Step 3: Seed the perm** — add `("accounts.chart.manage", "accounts")` to the `accounts.*` block in `apps/master/services.py`.
- [x] **Step 4: Scaffold the app** — create `apps/accounts` with an `AppConfig` (label `accounts`); register in `INSTALLED_APPS` and add `path("api/v1/accounts/", include("accounts.urls"))` to `config/urls.py` (empty `urlpatterns = []` for now).
- [x] **Step 5: Run → PASS** (seed test) + `python -m pytest apps/master -p no:cacheprovider -o addopts="" --create-db -q`.
- [x] **Step 6: Commit** — `git commit -m "feat(accounts): scaffold accounts app + accounts.chart.manage permission"`

---

## Task 2: Chart of Accounts — model + CRUD + seed

**Files:** `apps/accounts/models.py`, `serializers.py`, `views.py`, `urls.py`, `services.py`; migration; `apps/accounts/tests/test_chart_of_accounts.py`.

- [x] **Step 1: Failing test** (copy `shop` + `client_with_perms` from `test_cash_book.py`):
  - `test_create_account_requires_chart_manage` — POST `/api/v1/accounts/chart/` without `accounts.chart.manage` → 403.
  - `test_create_and_list_account` — with `["accounts.chart.manage","accounts.ledger.view"]`, POST `{code,name,account_type}` → 201; GET list (read `accounts.ledger.view`) returns it.
  - `test_account_code_unique_per_shop` — duplicate `code` same shop → 400.
  - `test_seed_default_chart_idempotent` — POST `/chart/seed/` creates the default chart; calling again is a no-op (count unchanged); seeded rows are `is_system=True`.
  - `test_cannot_delete_system_account` — DELETE a seeded account → deactivates/blocks (not hard delete).
- [x] **Step 2: Run → FAIL** (404).
- [x] **Step 3: Model** — `Account(BaseModel)`: `shop` FK (PROTECT, related_name `accounts`); `code` (CharField 20); `name` (CharField 120); `account_type` (TextChoices asset/liability/equity/income/expense); `parent` self-FK (null, SET_NULL, related_name `children`); `is_active` (default True); `is_system` (default False). `normal_balance` property (asset/expense→debit else credit). `Meta`: `unique_together=(("shop","code"),)`, index `(shop, account_type)`, `ordering=["code"]`. Migration.
- [x] **Step 4: Seed service** — `services.seed_default_chart(shop)`: idempotent; creates the standard Indian-SMB heads (Cash, Bank, Debtors, GST Input, Inventory / Creditors, GST Payable / Capital, Retained Earnings / Sales, Other Income / Purchases, Salaries, Rent, Utilities, Bank Charges, Misc) with `is_system=True`. No-op if the shop already has accounts.
- [x] **Step 5: Serializers + views + routes** — `AccountSerializer` (ModelSerializer: id, code, name, account_type, parent_id, is_active, is_system, normal_balance) + `CreateAccountSerializer`/`UpdateAccountSerializer`. `AccountListCreateView` (GET `accounts.ledger.view`, POST `accounts.chart.manage`, per-shop unique code → 400), `AccountDetailView` (GET read / PATCH+DELETE `accounts.chart.manage`; DELETE → deactivate, block when `is_system` or has posted lines), `SeedChartView` (POST `accounts.chart.manage`). Wire `urls.py`.
- [x] **Step 6: Run → PASS** + `python -m pytest apps/accounts -p no:cacheprovider -o addopts="" --create-db -q`.
- [x] **Step 7: Commit** — `git commit -m "feat(accounts): Chart of Accounts model + CRUD + seeded default chart"`

---

## Task 3: Journal Entries — balanced double-entry + post workflow

**Files:** `apps/accounts/models.py`, `serializers.py`, `views.py`, `urls.py`, `services.py`; migration; `apps/accounts/tests/test_journal.py`.

- [x] **Step 1: Failing test:**
  - `test_create_balanced_draft` — POST `/api/v1/accounts/journal/` (`accounts.journal.create`) with 2 balanced lines → 201, status `draft`.
  - `test_unbalanced_entry_rejected` — Σdebit ≠ Σcredit → 422 (or 400).
  - `test_line_requires_debit_xor_credit` — a line with both/neither → 422.
  - `test_post_sets_status_and_immutable` — POST `/journal/<id>/post/` (`accounts.journal.post`) → 200 status `posted`; subsequent PATCH/DELETE → 422.
  - `test_post_requires_post_perm` — posting without `accounts.journal.post` → 403.
- [x] **Step 2: Run → FAIL**.
- [x] **Step 3: Models** — `JournalEntry(BaseModel)`: `shop` FK; `entry_number` (per-shop sequence — allocate on create); `date`; `narration`; `reference` (blank); `status` (TextChoices draft/posted, default draft); `posted_by` (FK user, null), `posted_at` (null). `JournalLine(BaseModel)`: `entry` FK (CASCADE, related_name `lines`); `account` FK (PROTECT); `debit`/`credit` (Decimal 14,2 default 0); `line_narration` (blank). Migration.
- [x] **Step 4: Services** — `create_journal_entry(shop, data)` validates line debit-xor-credit + balance (Σdebit==Σcredit, ≥2 lines, total>0) → creates draft. `post_journal_entry(entry, user)` re-validates, sets posted/posted_by/posted_at. Mutations of a posted entry raise. (Design `post_journal_entry` to accept an optional `source_ref` for future auto-posting.)
- [x] **Step 5: Serializers + views + routes** — `JournalEntrySerializer` (with nested lines) + `CreateJournalEntrySerializer` (lines list). `JournalListCreateView` (GET `accounts.journal.view` + date/status filters, POST `accounts.journal.create`), `JournalDetailView` (GET read / PATCH+DELETE draft-only `accounts.journal.create` → 422 if posted), `PostJournalView` (POST `accounts.journal.post`). Validation failures → 422.
- [x] **Step 6: Run → PASS** + `python -m pytest apps/accounts -p no:cacheprovider -o addopts="" --create-db -q`.
- [x] **Step 7: Commit** — `git commit -m "feat(accounts): Journal Entries — balanced double-entry + post workflow"`

---

## Task 4: General Ledger + Trial Balance

**Files:** `apps/accounts/views.py`, `serializers.py`, `urls.py`, `services.py`; `apps/accounts/tests/test_ledger.py`.

- [x] **Step 1: Failing test** (seed 2 accounts, post a couple of balanced entries):
  - `test_ledger_running_balance` — GET `/api/v1/accounts/ledger/<account_id>/` (`accounts.ledger.view`) returns posted lines ordered by date with a correct running balance + opening/closing.
  - `test_ledger_excludes_draft` — draft entries don't appear.
  - `test_trial_balance_balances` — GET `/accounts/trial-balance/` returns per-account totals where Σdebit == Σcredit.
- [x] **Step 2: Run → FAIL**.
- [x] **Step 3: Implement** — `services.account_ledger(account, date_from, date_to)` (DB aggregation, running balance respecting `normal_balance`) and `services.trial_balance(shop, as_of)` (`annotate(Sum())`, no N+1). `LedgerView` (GET, `accounts.ledger.view`; CSV path gated `accounts.ledger.export`), `TrialBalanceView` (GET, `accounts.ledger.view`). Routes.
- [x] **Step 4: Run → PASS** + full `apps/accounts` suite.
- [x] **Step 5: Commit** — `git commit -m "feat(accounts): General Ledger + Trial Balance endpoints"`

---

## Task 5: Frontend — Accounts tabs (Chart / Journal / Ledger)

**Files:** create `frontend/src/lib/api/accounts.ts`; modify `frontend/src/lib/query/keys.ts`, `frontend/src/app/(app)/finance/layout.tsx`; create pages `finance/chart-of-accounts/page.tsx`, `finance/journal/page.tsx`, `finance/ledger/page.tsx`; tests under each `__tests__`.

- [ ] **Step 1: API + keys** — `accounts.ts`: types (`Account`, `JournalEntry`, `JournalLine`, `LedgerRow`, `TrialBalanceRow`) + methods (`listAccounts`, `createAccount`, `updateAccount`, `deactivateAccount`, `seedChart`; `listJournal`, `getJournal`, `createJournal`, `postJournal`; `getLedger`, `getTrialBalance`). Add `qk.accounts`, `qk.journal`, `qk.ledger`, `qk.trialBalance` to `keys.ts`.
- [ ] **Step 2: Layout tabs** — add **Chart of Accounts** (`/finance/chart-of-accounts`, `accounts.ledger.view`), **Journal** (`/finance/journal`, `accounts.journal.view`), **Ledger** (`/finance/ledger`, `accounts.ledger.view`) to `finance/layout.tsx`; add a `permission?` field to the TABS entries and filter visible tabs with `useAuthStore((s) => s.hasPermission)`.
- [ ] **Step 3: Chart of Accounts page** — grouped-by-type list + create/edit dialog (code, name, type, parent, active) + "Seed default chart" when empty; `Can permission="accounts.chart.manage"` on writes.
- [ ] **Step 4: Journal page** — list (number, date, narration, total, status) + create form with a **multi-row debit/credit grid** (account Select + debit/credit), a **live balance** indicator, submit disabled until balanced; detail with **Post** action (`Can permission="accounts.journal.post"`); posted entries read-only.
- [ ] **Step 5: Ledger page** — account picker → ledger table (date, entry #, debit, credit, running balance) with date range; **Trial Balance** sub-view with a balancing totals row.
- [ ] **Step 6: Tests** — vitest smoke per page (mock `accounts` api + stores): chart row renders + dialog opens; journal create form balance gating; ledger/trial-balance render. Mirror the HR departments test (ResizeObserver shim already global).
- [ ] **Step 7: Verify** — from `frontend/`: `npx tsc --noEmit` (0); `npx vitest run` (pass); `npm run lint -- --no-cache` (clean).
- [ ] **Step 8: Commit** — `git commit -m "feat(accounts): Accounts tabs — Chart of Accounts, Journal, Ledger/Trial Balance"`

---

## Task 6: Final verification

- [ ] **Step 1: Backend** — `python -m pytest apps/accounts apps/master apps/authentication -p no:cacheprovider -o addopts="" --create-db -q` → PASS.
- [ ] **Step 2: Migration reversibility** — `accounts` initial migrations apply forward cleanly (covered by `--create-db`); migrate the app down to zero and back up (container/CI if no local DB).
- [ ] **Step 3: Frontend** — `npx tsc --noEmit`; `npx vitest run`; `npm run lint -- --no-cache` → all clean.
- [ ] **Step 4: Production build** — `docker compose exec -e NODE_ENV=production frontend sh -c "npm run build"` → exit 0 (container/CI).
- [ ] **Step 5: CI deny-list** — `grep -vc '^#\|^$' ci-known-failures.txt` → `0`.

---

## Notes for the implementer
- **Net-new module** — new `apps/accounts`; mirror `apps/finance` (APIView + `_shop_ids_from_token`), not a ViewSet.
- **The correctness core is the balance invariant + posted-immutability** — write those tests first (Task 3 Step 1).
- **Manual entries only** in 8a; `post_journal_entry` takes an optional `source_ref` so 8b auto-posting can reuse it.
- **Seed is idempotent**, rows `is_system=True`; **deactivate over delete** everywhere; never drop columns.
- **Money is `Decimal(14,2)`** — never floats; balance checks in `Decimal`.
- Frontend pages live under `/finance/*` (the Accounts nav area) — **no new nav node**.
- **No `any`, no `console.log`.** App Router default-export only. React Query v5.
- Local backend runs may need `--create-db`; CI runs fresh.
