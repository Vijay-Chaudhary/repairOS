# ERP/CRM Blueprint — Phase 8a Design (Accounting core: Chart of Accounts + Journal + Ledger)

**Parent spec:** `docs/superpowers/specs/2026-06-29-erp-crm-navigation-design.md` (§2 Accounts tabs, §5 roadmap Phase 8 — Accounting, §6 `accounts.*` permission prefix)

**Status:** Design / scoping. Spec → plan → build.

---

## 1. Scope

Phase 8 (full double-entry accounting) is the roadmap's only **XL** item. Per the scoping decision it
is **split**: Phase **8a** delivers the double-entry *core*; **8b** (later) adds Bank Accounts +
reconciliation + Income.

### Reality check
- **No double-entry models exist** anywhere — Chart of Accounts / Journal / Ledger are 100% net-new.
- **All `accounts.*` permissions are already seeded** (`apps/master/services.py`, module `"accounts"`):
  `accounts.ledger.view/export`, `accounts.journal.view/create/post`, plus `income/bank/cashbook` (8b).
- The **Accounts area is the existing `/finance/*` tabbed layout** (`finance/layout.tsx`: Petty Cash ·
  Cash Book · Expenses · Budget · Assets; `/finance` redirects to petty-cash). 8a adds accounting tabs
  here — it does **not** touch the existing operational-finance pages.
- Finance backend pattern to mirror: `APIView` + `permission_classes=[IsAuthenticated,
  require_permission("…")]` + `_shop_ids_from_token(request)` + `RepairOSPageNumberPagination`
  (`apps/finance/views.py`).

### In scope (8a)
- **A. Chart of Accounts** — `Account` model (hierarchical), CRUD, and a **seeded default Indian-SMB
  chart** per shop.
- **B. Journal Entries** — balanced double-entry entries (header + debit/credit lines), draft→posted
  workflow with immutability and balance enforcement.
- **C. General Ledger + Trial Balance** — per-account running balance from posted lines; trial-balance
  summary (Σdebit == Σcredit).
- **D. Accounts hub/tabs wiring** — accounting tabs in the `/finance` layout, permission-gated.

### Out of scope (→ Phase 8b / later)
- **Bank Accounts + reconciliation; Income** (8b).
- **Auto-posting** from invoices/payments/expenses/payroll/POS — designed as a later integration; 8a is
  a self-contained manual ledger.
- Financial statements beyond Trial Balance (P&L, Balance Sheet) — later.
- Multi-currency, fiscal-year locking/closing entries — later.

### Decisions locked (product owner, 2026-06-30)
1. **Core-first** — CoA + Journal + Ledger now; Bank + Income → 8b.
2. **Manual double-entry now**, auto-posting later.
3. **Ship a default Indian-SMB chart of accounts seed** per shop (editable).

---

## 2. Architecture

- **New Django app `apps/accounts`** (matches the `accounts.*` perm module; keeps double-entry separate
  from operational `apps/finance`). Register in settings + URL include at `/api/v1/accounts/`.
- **Books are shop-scoped** (each shop keeps its own ledger), consistent with the rest of `apps/finance`.
  `Account` and `JournalEntry` carry a `shop` FK; scoping via `_shop_ids_from_token`.
- **One new permission** — `accounts.chart.manage` (managing the chart is administrative and distinct
  from posting journals). Add to the `apps/master/services.py` seed + `test_permission_seed.py`. Reads
  use `accounts.ledger.view`. (The roadmap explicitly allows new `accounts.*` perms in Phase 8.)

---

## 3. Feature A — Chart of Accounts

### Backend (`apps/accounts/models.py`)
- `Account(BaseModel)`:
  - `shop` FK (PROTECT). `code` (CharField, e.g. "1000"). `name`. `account_type` ∈
    {`asset`, `liability`, `equity`, `income`, `expense`} (TextChoices). `parent` self-FK
    (null, SET_NULL) for hierarchy. `is_active` (default True). `is_system` (seeded accounts —
    not deletable). `normal_balance` derived from `account_type` (asset/expense = debit;
    liability/equity/income = credit) — store or compute via property.
  - `Meta`: `unique_together = (("shop", "code"),)`, index on `(shop, account_type)`, `ordering=["code"]`.
- **Endpoints** (`/api/v1/accounts/chart/`):
  - `GET` list (grouped/sortable by type; read `accounts.ledger.view`); `POST` create (`accounts.chart.manage`).
  - `GET/PATCH/DELETE /chart/<id>/` — write `accounts.chart.manage`. **DELETE** → soft-deactivate;
    never delete `is_system` accounts or accounts with posted journal lines (deactivate instead).
  - `POST /chart/seed/` — idempotent seed of the default Indian-SMB chart for the shop
    (`accounts.chart.manage`); no-op if accounts already exist.
- **Seed service** `seed_default_chart(shop)` — standard heads: Assets (Cash, Bank, Accounts
  Receivable/Debtors, GST Input Credit, Inventory), Liabilities (Accounts Payable/Creditors, GST
  Payable, Duties & Taxes), Equity (Capital, Retained Earnings), Income (Sales/Service Revenue, Other
  Income), Expenses (Purchases, Salaries & Wages, Rent, Utilities, Bank Charges, Misc). Marked
  `is_system=True`. Hook into tenant/shop provisioning later; for existing shops, the `/chart/seed/`
  action (or a data migration) seeds on demand.

### Frontend (`/finance/chart-of-accounts`)
- Tree/list grouped by `account_type` with code + name + active state; create/edit dialog (code, name,
  type, parent, active). "Seed default chart" button when empty. `Can permission="accounts.chart.manage"`
  on writes.

---

## 4. Feature B — Journal Entries

### Backend
- `JournalEntry(BaseModel)`: `shop` FK; `entry_number` (per-shop sequence); `date`; `narration`;
  `reference` (optional); `status` ∈ {`draft`, `posted`} (default draft); `created_by`, `posted_by`
  (nullable), `posted_at` (nullable). `Meta`: index `(shop, date)`, `(shop, status)`.
- `JournalLine(BaseModel)`: `entry` FK (CASCADE, `related_name="lines"`); `account` FK (PROTECT);
  `debit`/`credit` (Decimal 14,2, default 0); `line_narration` (optional).
- **Invariants** (enforced in a service, not the view):
  - Each line: exactly one of debit/credit > 0 (the other 0); no negatives.
  - Entry: ≥ 2 lines; **Σdebit == Σcredit** and total > 0.
  - `draft` is editable/deletable; **`posted` is immutable** (no edit/delete) — corrections are made by
    a **reversing entry** (a later nicety; 8a minimally blocks mutation of posted entries).
- **Endpoints** (`/api/v1/accounts/journal/`):
  - `GET` list (date/status filters, read `accounts.journal.view`); `POST` create draft
    (`accounts.journal.create`) — body includes the lines; validates balance.
  - `GET/PATCH/DELETE /journal/<id>/` — PATCH/DELETE draft only, `accounts.journal.create`; mutating a
    posted entry → 422.
  - `POST /journal/<id>/post/` — validates + posts (sets status, `posted_by`, `posted_at`),
    `accounts.journal.post`. Posting an unbalanced entry → 422.

### Frontend (`/finance/journal`)
- List (number, date, narration, total, status badge). Create form: date, narration, **multi-row
  debit/credit grid** (account Select + debit/credit inputs) with a **live running balance**
  (Σdebit − Σcredit) and a disabled submit until balanced. Row add/remove. Detail view with a **Post**
  action (`Can permission="accounts.journal.post"`); posted entries render read-only.

---

## 5. Feature C — General Ledger + Trial Balance

### Backend (`/api/v1/accounts/`)
- `GET /ledger/<account_id>/` — posted lines for the account in a date range, ordered by date, with a
  **running balance**; opening/closing balances. Read `accounts.ledger.view`; CSV via
  `accounts.ledger.export`.
- `GET /trial-balance/` — per-account totals (debit, credit, net) for posted entries as of a date;
  asserts Σdebit == Σcredit. Read `accounts.ledger.view`. Aggregate in the DB (`annotate(Sum())`),
  no N+1.

### Frontend (`/finance/ledger`)
- Account picker → ledger table (date, entry #, narration, debit, credit, running balance) with date
  range + export. **Trial Balance** sub-view: all accounts with debit/credit columns and a totals row
  that must balance.

---

## 6. Feature D — Accounts hub/tabs wiring
- Add accounting tabs to `frontend/src/app/(app)/finance/layout.tsx`: **Chart of Accounts**
  (`/finance/chart-of-accounts`), **Journal** (`/finance/journal`), **Ledger** (`/finance/ledger`) —
  alongside the existing operational tabs. Add **per-tab permission gating** to the layout (the tabs
  array currently has none): accounting tabs gated on `accounts.ledger.view` /
  `accounts.journal.view` / `accounts.chart.manage` as appropriate.
- The nav "Accounts" leaf (`/finance`) stays; consider redirecting `/finance` to the first tab the user
  can see (out of scope to change here unless trivial).

---

## 7. Cross-cutting requirements
- **Permissions**: reuse seeded `accounts.*`; add only `accounts.chart.manage` (seed + seed-test).
- **Money**: `Decimal(14,2)`; never floats. Balance checks use `Decimal`.
- **Tenant/shop scoping** via `_shop_ids_from_token`; all aggregates DB-side (no N+1).
- **Immutability**: posted journal entries cannot be mutated — enforced in the service + covered by tests.
- **Migrations reversible**; new `accounts` app initial migration + (optional) seed data migration.
- **No `any`, no `console.log`; App Router default-export only; React Query v5; TS strict.**
- **Tests** (every endpoint: serializer + `permission_classes` + tests): account CRUD + seed; journal
  balance enforcement (unbalanced → 422), post workflow, posted-immutability; trial-balance balances;
  ledger running-balance correctness; permission gating per resource.

---

## 8. Build order (each task = its own commit, TDD)
1. **App + permission** — create `apps/accounts`, register, URL include; add `accounts.chart.manage` to
   the seed + `test_permission_seed.py`.
2. **Chart of Accounts** — `Account` model + migration + CRUD endpoints + seed service + `/chart/seed/` + tests.
3. **Journal Entries** — `JournalEntry`/`JournalLine` models + migration + create/list/detail + post
   workflow + balance/immutability invariants + tests.
4. **Ledger + Trial Balance** — endpoints + aggregation + tests.
5. **Frontend** — `accounts.ts` API + `qk` keys; Chart of Accounts, Journal (with live-balance grid),
   Ledger/Trial-Balance pages; finance-layout tabs + per-tab perm gating; vitest.
6. **Verification** — backend + frontend suites, migration reversibility, prod build, CI deny-list.

---

## 9. Notes for the planner
- **Net-new module** — new `apps/accounts`; mirror `apps/finance` view/scoping style, not a ViewSet.
- **Manual entries only** in 8a; design the post step so auto-posting (8b+) can later call the same
  `post_journal_entry` service with a `source_ref`.
- **Seed is idempotent** and marks rows `is_system`; deactivate-over-delete everywhere.
- **The hard correctness core is the balance invariant + posted-immutability** — write those tests first.
- Frontend accounting pages live under `/finance/*` (the "Accounts" nav area); do not add a new nav node.
- 8b (later, its own spec): Bank Accounts + reconciliation, Income, and the first auto-posting hooks.
