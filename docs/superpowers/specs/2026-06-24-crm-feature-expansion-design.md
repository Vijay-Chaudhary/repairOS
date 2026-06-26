# CRM Feature Expansion — Design Spec

**Date:** 2026-06-24
**Status:** Approved (pending implementation plans)
**Relationship:** Separate from and independent of
`docs/superpowers/specs/2026-06-24-crm-overhaul-design.md` (which fills spec gaps + restructures
the menu). This spec adds **four net-new, self-contained CRM capabilities**.
**Specs paired:** `docs/backend-spec/RepairOS-dev-spec/modules/01-crm.md`,
`docs/frontend-spec/RepairOS-frontend-spec/modules/01-crm-ui.md`

## Goal

Add four new customer-relationship capabilities — **Receivables / Dues tracking, Loyalty &
Rewards, Customer Feedback (CSAT), and Duplicate detection** — chosen to fit the existing data
model and a repair shop's day-to-day needs.

**Integration decision (approved):** all four are **self-contained within CRM**. No POS /
Billing discount wiring, no invoice-level aging, no public/auto feedback collection, no new
WhatsApp templates. This ships value fast with minimal cross-module risk; deeper integrations
are listed as future work.

Each feature is an **independent implementation plan + PR**. Every feature that adds a page also
adds its own nav leaf (or action), so the menu never contains a dead link.

## Existing data this builds on

- `Customer`: `tags`, `credit_limit`, `total_billed`, `total_outstanding`, `last_visit`,
  `whatsapp_optout`, `phone` (indexed), `city`, `customer_type` — all already maintained.
- `total_billed` / `total_outstanding` are denormalized counters kept current by Billing.
- Existing `POST /customers/merge/` + `MergeCustomersDialog` (reused by Duplicate detection).

---

## Feature A — Receivables / Dues tracker

A worklist of customers who owe money, for proactive collection.

### Menu
- CRM → **Receivables**, gate `crm.customers.view`.

### Backend (small)
- `GET /api/crm/receivables/` — customers with `total_outstanding > 0`, shop-scoped, ordered by
  `-total_outstanding`. Each row flags `over_credit_limit` (`total_outstanding > credit_limit`
  when `credit_limit > 0`). Reads existing denormalized fields only — **no Billing/invoice
  integration, no true invoice-level aging**.
- Returns a summary aggregate: total outstanding across the shop, count of over-limit customers.
- **Payment-reminder action** `POST /api/crm/receivables/{customer_id}/remind/`: reuses an
  existing WhatsApp payment-reminder template **if one is already registered**; otherwise falls
  back to creating a `FollowUpTask` ("Collect dues") for the assignee. Respects
  `whatsapp_optout`. **No new template is introduced.**
- Tests: scoping, ordering, over-limit flag, opt-out respected, task fallback.

### Frontend
- `/crm/receivables`: `DataTable` (customer, outstanding, credit limit, over-limit flag, last
  visit) + a total-dues summary tile + per-row reminder button. Skeleton / empty / error states.

---

## Feature B — Loyalty & Rewards

Recognize high-value customers with tiers; track manual point adjustments — **no POS/billing
redemption**.

### Menu
- CRM → **Loyalty**, gate `crm.customers.view`. Plus a **tier badge** on the customer profile
  header.

### Backend (new models)
- `LoyaltyTier` (tenant DB, soft-delete): `name`, `min_total_billed` (DECIMAL), `perks` (text),
  `color`, `sort_order`. Seeded defaults optional (e.g. Silver/Gold/VIP); fully editable.
- Tier is **derived on read** from the customer's existing `total_billed` (highest tier whose
  `min_total_billed` ≤ `total_billed`). **No new point-earning pipeline, no POS hooks.**
- `LoyaltyTransaction` (tenant DB): `customer`, `points` (signed int), `reason`, `created_by`,
  `created_at` — a **manual** ledger for goodwill points / redemptions tracked in CRM only.
  `points_balance` = sum per customer.
- Endpoints: `GET/POST/PATCH /api/crm/loyalty/tiers/`;
  `GET/POST /api/crm/loyalty/transactions/?customer_id=`; tier + balance surfaced on
  `GET /customers/{id}/`. Reversible migration. Tests for tier derivation + ledger sum.

### Frontend
- `/crm/loyalty`: manage tiers (CRUD) + view members grouped by derived tier.
- Profile header: tier badge (color) + points balance; a "Adjust points" action (ledger entry).

---

## Feature C — Customer feedback (CSAT)

Capture post-service satisfaction; surface ratings on the profile and an aggregate score.
**Staff-logged** — no public links, no auto-trigger.

### Menu
- CRM → **Feedback**, gate `crm.customers.view`. Plus a **Feedback section** on the profile.

### Backend (new model)
- `CustomerFeedback` (tenant DB, soft-delete): `customer` (FK), `job_id` (UUID, nullable),
  `rating` (SMALLINT 1–5, CHECK), `comment` (text, nullable), `channel`
  (in_person/call/whatsapp/other), `collected_by` (FK user), `created_at`.
- Endpoints: `GET/POST /api/crm/feedback/?customer_id=` (shop-scoped, ordered `-created_at`);
  aggregate avg-rating + count per customer exposed on `GET /customers/{id}/` and as a list-page
  summary. Reversible migration. Tests: create, rating bounds, aggregate, scoping.

### Frontend
- Feedback capture sheet ("Log feedback": rating stars, comment, channel, optional job link).
- Profile **Feedback** section: avg score + recent entries.
- `/crm/feedback`: list of recent feedback across customers, shop avg score, low-rating (≤2)
  flags. Skeleton / empty / error states.

---

## Feature D — Duplicate detection

On-demand data-hygiene tool that finds likely-duplicate customers and routes them to the
existing merge flow.

### Access
- A **"Find duplicates"** action on the Customers page → `/crm/customers/duplicates` review
  screen. **Not** a permanent top-level menu leaf (keeps the menu lean).

### Backend (logic; optional tiny model)
- `GET /api/crm/customers/duplicates/` — on-demand shop-scoped scan returning candidate
  pairs/groups, each with a match reason + score:
  - **Strong:** normalized-phone exact match (strip spaces/`+`/country prefix consistently).
  - **Weak:** fuzzy `name` similarity within the same `city`.
- Optional `DuplicateDismissal` (tenant DB): `customer_a`, `customer_b`, `dismissed_by`,
  `created_at` — suppresses pairs a user marked "not a duplicate". If included, the scan filters
  out dismissed pairs.
- Tests: phone-normalization matching, fuzzy-name matching, dismissal suppression, scoping.

### Frontend
- `/crm/customers/duplicates`: side-by-side candidate pairs (key fields + counters) → **Merge**
  (reuses `MergeCustomersDialog` + existing `POST /customers/merge/`) or **Dismiss**. Empty
  state = "No likely duplicates found."

---

## Cross-cutting requirements

- **Self-contained:** no changes to POS, Billing, or notification **templates**. The Receivables
  reminder reuses an existing template if present, else falls back to a follow-up task.
- **Permissions:** every leaf/action gates on real seeded perms (`crm.customers.view`,
  `crm.customers.merge` for the merge action, `crm.customers.edit` for loyalty/feedback writes —
  verified against the seed, not the spec wording).
- **Testing:** every new endpoint gets pytest coverage; every new/changed page gets Vitest +
  clean `tsc --noEmit` (project rule: tests before merge).
- **Migrations:** all new models use `SoftDeleteModel` where appropriate and ship reversible
  migrations with no data-loss on reverse.
- **No N+1:** list endpoints use `select_related` / `prefetch_related` / aggregates.

## Non-goals (future work)

- **Loyalty:** no automatic point earning from billing events; no POS/billing **discount
  redemption**; redemption is a manual ledger entry only.
- **Receivables:** no invoice-level **aging buckets** (needs Billing invoice due-dates); reads
  the denormalized `total_outstanding` only.
- **CSAT:** no **public tokenized feedback links** and no auto-trigger after job completion;
  feedback is staff-logged.
- **Duplicate detection:** **on-demand only** — no background/scheduled dedupe job; no
  auto-merge (always human-confirmed).
- No new WhatsApp templates; no DOB-based birthday/anniversary engagement (separate idea);
  no customer document attachments (separate idea).

## Risks / notes

- **Phone normalization (Feature D)** is the crux of useful matching — define one canonical
  normalizer (reuse the customer phone-uniqueness normalizer if one exists) and test it directly.
- **Loyalty tier on read** depends on `total_billed` being current; it already is (Billing
  maintains it), so no recompute job is needed.
- **Receivables reminder template** — confirm during Feature A's plan whether a payment-reminder
  template already exists; if not, the task-fallback path is the default (keeps "no new
  templates" intact).
- **Feedback `job_id`** is a soft UUID link (no cross-app FK), matching the existing
  `FollowUpTask.job_id` pattern — avoids a hard dependency on Repair.

## Verification (per feature)

```bash
# Backend
cd backend
python manage.py makemigrations crm --check --dry-run    # confirm new models captured
python -m pytest apps/crm/tests/ --no-cov 2>&1 | tail -12

# Frontend
cd frontend
npx vitest run <changed test files> 2>&1 | tail -15
npx tsc --noEmit 2>&1 | grep "error TS" || echo "OK no errors"
```
