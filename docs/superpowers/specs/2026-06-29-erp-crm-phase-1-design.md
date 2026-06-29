# ERP/CRM Blueprint — Phase 1 Design ("Quick wins over existing data")

**Date:** 2026-06-29
**Status:** Approved design — ready for implementation planning
**Parent spec:** `docs/superpowers/specs/2026-06-29-erp-crm-navigation-design.md` (§5 roadmap, Phase 1)
**Predecessor:** Phase 0 (nav/IA restructure, stub routes, header shells, permission slugs) — merged in PR #22.

---

## 1. Scope

Phase 1 delivers four thin features that sit on data and infrastructure that already
exists. Nothing here adds a cross-cutting system; each item is independently shippable.

| # | Feature | Nav location | Net-new model? | Footprint |
|---|---|---|---|---|
| 1 | Reports — fix permission-slug drift | Management › Reports | no | frontend-only |
| 2 | Billing › Outstanding | Finance › Billing › Outstanding | no | new read endpoint + page |
| 3 | Accounts › Cash Book | Finance › Accounts (`/finance`) tab | no | new read endpoint + page |
| 4 | Settings › Taxes | Config › Settings › Taxes | **yes (`TaxRate`)** | model + CRUD + page |

**Build order** (independent; ascending effort): Reports drift fix → Cash Book → Outstanding → Taxes.

**Locked scope decisions (from brainstorming):**
- Reports: *fix the drift only* — do not restyle sections into literal tabs, do not add new slugs.
- Outstanding: *repair invoices only* (`RepairInvoice`); wholesale/POS receivables deferred.
- Taxes: *simple GST-slab master* — no HSN/SAC mapping, no per-product default tax.
- Cash Book: *petty-cash transactions only* — not a unified cash ledger across payments/expenses.

**Out of scope (later phases):** Accounts › Income/Bank/Ledger/Journal tabs (Phase 8), HSN/SAC
mapping, wholesale receivables, converting Reports module-sections into tabbed UI.

---

## 2. Feature 1 — Reports permission-slug drift (frontend-only)

### Problem (verified in code)

- `frontend/src/lib/api/reports.ts` gates every report on a `permission` and groups them by
  `MODULE_PERMISSIONS`, using **invented slugs** `reports.billing.view` and `reports.erp.view`.
- Those slugs are **not seeded** (`backend/apps/master/services.py` seeds only
  `reports.{revenue,hr,crm,repair,inventory,gst,pl,amc}.view`).
- The backend dispatcher (`apps/reports/views.py` → `ReportView`) enforces
  `perm = f"reports.{group}.view"`, where `group` is the first element of each
  `REPORT_REGISTRY` tuple, drawn from **`{revenue, inventory, repair, hr, crm, amc}`**.
- **Consequence:** the FE Billing and ERP report sections (`<Can anyOf={['reports.billing.view']}>`
  / `['reports.erp.view']`) are hidden for every normal role; only tenant-wide/platform admins
  (who bypass `Can`) see them. Conversely a report the FE *shows* may 403 on the backend if its
  FE `permission` does not match the registry group.

### Fix (source of truth = backend `REPORT_REGISTRY` group)

Set each catalogue entry's `permission` to `reports.<group>.view` using the registry group, and
set each module gate to `anyOf` the distinct slugs its reports use. No backend change; no new slugs.

Per-report mapping (FE `type` → backend group → FE `permission`):

| Report `type`(s) | Backend group | New FE `permission` |
|---|---|---|
| revenue-summary, outstanding-dues-repair, payment-collection-log, pl-summary, gstr-1, gstr-2 | revenue | `reports.revenue.view` |
| outstanding-dues-wholesale, inventory-valuation, stock-movement-ledger, supplier-payable, purchase-summary, expense-by-category, budget-vs-actual | inventory | `reports.inventory.view` |
| job-status-summary, job-turnaround-time, warranty-claims, fault-template-usage, technician-performance | repair | `reports.repair.view` |
| commission-ledger, hr-attendance-summary, salary-register, petty-cash-summary | hr | `reports.hr.view` |
| lead-conversion, customer-acquisition, customer-lifetime-value | crm | `reports.crm.view` |
| amc-contract-summary, amc-visit-compliance, amc-revenue | amc | `reports.amc.view` |

Resulting `MODULE_PERMISSIONS` (anyOf):
- **Billing** → `['reports.revenue.view', 'reports.inventory.view']` (wholesale dues are inventory-group)
- **Repair** → `['reports.repair.view', 'reports.hr.view']` (commission-ledger is hr-group)
- **CRM** → `['reports.crm.view']`
- **AMC** → `['reports.amc.view']`
- **ERP** → `['reports.inventory.view']`
- **HR** → `['reports.hr.view']`

### Notes

- Seeded `reports.pl.view` and `reports.gst.view` are **dead** (the dispatcher resolves P&L and
  GSTR to the `revenue` group). Leave them seeded — removing seeded slugs is risky and out of
  scope. Documented here so the dead slugs are not mistaken for the fix target.
- **Test:** add a Vitest guard asserting every `REPORT_CATALOGUE[i].permission` is one of the six
  enforced slugs, and that each `MODULE_PERMISSIONS` entry is a superset of its reports' slugs.

---

## 3. Feature 2 — Billing › Outstanding (new read endpoint + page)

### Backend

- **Endpoint:** `GET /billing/outstanding/` → `RepairInvoiceView`-style `APIView`, gated
  `require_permission("billing.outstanding.view")`.
- **Query:** `RepairInvoice` where `status ∈ {issued, partially_paid}` and
  `amount_outstanding > 0`, shop-scoped (multi-branch — mirror the shop-id scoping the reports
  views use). `select_related("customer")` to avoid N+1.
- **Aging:** bucket each invoice by days past `due_date` (fallback to `created_at` when `due_date`
  is null) into `current` (not yet due) / `1-30` / `31-60` / `61-90` / `90+`.
- **Response shape:**
  ```json
  {
    "summary": {
      "total_outstanding": "12500.00",
      "invoice_count": 8,
      "buckets": {"current": "...", "1-30": "...", "31-60": "...", "61-90": "...", "90+": "..."}
    },
    "results": [
      {"id", "invoice_number", "customer_name", "grand_total", "amount_paid",
       "amount_outstanding", "due_date", "days_overdue", "bucket", "status"}
    ]
  }
  ```
- Logic in `apps/billing/services.py` (`build_outstanding_report(shop_ids, ...)`); the view stays thin.
- Optional query params: `?shop=<id>`, `?overdue_days=<n>` (min days overdue), `?customer=<id>`.

### Frontend

- Replace the `/billing/outstanding` ComingSoon stub
  (`frontend/src/app/(app)/billing/outstanding/page.tsx`) with:
  - an **aging summary strip** (5 bucket totals + grand total),
  - a **table** (customer, invoice #, total, paid, outstanding, due date, days overdue, status badge),
  - row links to the existing repair-invoice detail.
- React Query (`@tanstack/react-query`); add a `billingApi.getOutstanding` client + typed result.
- Gate the page/nav on `billing.outstanding.view` (already seeded; nav leaf already exists).

---

## 4. Feature 3 — Accounts › Cash Book (new read endpoint + page)

### Backend

- **Endpoint:** `GET /finance/cash-book/` → read-only `APIView`, gated
  `require_permission("accounts.cashbook.view")`.
- **Source:** `PettyCashTransaction` (immutable running ledger; `balance_after` is already stored
  at creation). Fields available: `txn_type` (credit/debit), `amount`, `category`, `description`,
  `date`, `balance_after`, `account` → shop, `recorded_by`.
- **Query:** filter by date range (`?date_from`, `?date_to`) and `?shop=<id>` / `?account=<id>`;
  order by `date`, then creation. `select_related("account", "recorded_by")`.
- **Response:** opening balance (balance_after of the last txn before `date_from`, else 0),
  the ordered transactions (each with its stored `balance_after`), and closing balance
  (last txn's `balance_after`), plus period credit/debit totals.
- Logic in `apps/finance/services.py` (`build_cash_book(shop_ids, date_from, date_to, ...)`).
- **No writes** — petty-cash entries continue to be created via the existing
  `/finance/petty-cash/transactions/` endpoint; Cash Book only reads.

### Frontend

- Cash Book lives under the Accounts area (`/finance`). Phase 0 renders unbuilt Accounts tabs as
  `<ComingSoon/>`; Phase 1 replaces the Cash Book tab with the ledger view.
- UI: date-range filter + shop selector; opening-balance row, ledger table
  (date, particulars/category, debit, credit, running balance), closing-balance row.
- React Query; `financeApi.getCashBook` client + typed result.

> **Plan-time check:** confirm how the Accounts tabs are wired in Phase 0 (single `/finance`
> landing with in-page secondary nav vs. separate routes). Build the Cash Book tab to match the
> existing pattern; do not invent a new routing scheme.

---

## 5. Feature 4 — Settings › Taxes (net-new `TaxRate` model + CRUD)

There is no `settings` Django app; settings are federated per domain (roles→authentication,
commissions→commissions, shop→core). GST tax is billing domain, so the model lives in **`billing`**.

### Backend

- **Model `billing.TaxRate`** (reversible migration):
  - `name` (`CharField`, e.g. "GST 18%") — unique per tenant DB.
  - `rate` (`DecimalField(max_digits=5, decimal_places=2)`) — percent, e.g. `18.00`.
  - `tax_type` (`TextChoices`): `gst` (CGST+SGST split), `igst` (inter-state), `exempt`.
  - `is_active` (`BooleanField`, default `True`).
  - timestamps via the project base model.
  - `__str__` → `"{name} ({rate}%)"`.
- **Endpoints** under `billing` (`/billing/tax-rates/`), all gated
  `require_permission("settings.taxes.manage")`:
  - `GET /billing/tax-rates/` — list (optional `?is_active=`),
  - `POST /billing/tax-rates/` — create,
  - `GET/PATCH/DELETE /billing/tax-rates/<id>/` — retrieve/update/soft-handle.
  - **Delete policy:** deactivate (`is_active=False`) rather than hard-delete, to preserve any
    future references (consistent with the "deprecate, don't drop" project DB rule). Hard delete
    only when never referenced.
- Serializer + `services.py` helpers; validation: `rate` in `[0, 100]`, unique `name`.
- **Seed standard Indian slabs as data** (0/5/12/18/28 GST) via the migration's data step or the
  tenant-seed path — not hardcoded in code. Idempotent (`get_or_create` on `name`).

### Frontend

- New page `frontend/src/app/(app)/settings/taxes/page.tsx`:
  - table of slabs (name, rate %, type, active toggle),
  - create/edit dialog (react-hook-form + zod),
  - activate/deactivate action.
- React Query; `settingsApi.taxRates` client (or `billingApi`) + typed `TaxRate`.
- Gate on `settings.taxes.manage`. Surface a Settings › Taxes entry in the Settings landing/tabs.

---

## 6. Cross-Cutting Requirements

- **Per project rules:** every endpoint has a serializer + `permission_classes` + tests; business
  logic in `services.py` (never in views); `select_related`/`prefetch_related` — no N+1;
  TypeScript strict, no `any`; Tailwind; React Query for server state.
- **Tests (before merge):**
  - Backend (pytest): Outstanding aging buckets + permission gate; Cash Book opening/closing
    balance + permission gate; TaxRate CRUD + validation + permission gate.
  - Frontend (Vitest): reports-catalogue permission guard; smoke tests for the three new pages'
    data rendering.
- **Migrations:** the one new migration (`TaxRate`) must be reversible.
- **Multi-tenant:** all new endpoints operate within the tenant DB and shop-scope like existing
  billing/finance/reports endpoints. No hardcoded tenant/shop IDs.
- **Production build:** must pass with `NODE_ENV=production` (see Phase-0 note); App Router pages
  export only the default component — keep helpers in sibling modules.

---

## 7. Verification (Phase-1 exit criteria)

- `tsc --noEmit` clean · lint clean · all Vitest tests pass (incl. new guards).
- Backend `pytest apps/billing apps/finance apps/reports apps/master apps/authentication` passes.
- Production build (`NODE_ENV=production`) succeeds; `/billing/outstanding`, the Cash Book tab,
  and `/settings/taxes` render real data (no ComingSoon).
- New `TaxRate` migration applies and reverses cleanly; standard slabs seeded idempotently.
- Reports: a non-admin role with `reports.revenue.view` now sees the Billing report section; the
  catalogue permission guard test passes.

---

## 8. Open Items for the Plan

1. Confirm the exact shop-scoping helper used by billing/finance views (mirror it; don't
   re-implement tenant/shop resolution).
2. Confirm Phase-0 Accounts (`/finance`) tab wiring before placing the Cash Book tab.
3. Decide the TaxRate seed mechanism (migration data step vs. `_seed_*` in `master.services`) at
   plan time — prefer whichever the existing per-tenant seed uses for config data.
