# ERP/CRM Blueprint — Phase 3 Design (CRM Sales Pipeline: Contacts + Deals)

**Date:** 2026-06-29
**Status:** Approved design — ready for implementation planning
**Parent spec:** `docs/superpowers/specs/2026-06-29-erp-crm-navigation-design.md` (§2 CRM group, §5 roadmap Phase 3)
**Predecessors:** Phase 0 (nav + stubs + slugs, PR #22), Phase 1 (PR #23), Phase 2 (PR #24).

---

## 1. Scope

Two net-new CRM features that fill the Phase-0 `/crm/contacts` and `/crm/deals` ComingSoon stubs.
Permission slugs were seeded in Phase 0. Both are models in the existing `crm` app, exposed as DRF
ViewSets on the existing CRM router (`/api/v1/crm/`). Independent and shippable in order:
**Contacts first** (smaller), then **Deals**.

| Feature | Nav | Net-new model | Footprint |
|---|---|---|---|
| A. Contacts | CRM › Contacts (`/crm/contacts`) | `crm.Contact` | model + ViewSet + standalone page + customer-detail tab |
| B. Deals | CRM › Deals (`/crm/deals`) | `crm.Deal` | model + ViewSet (+ stage/close actions) + Kanban board |

**Locked decisions (from brainstorming):**
- **Deal stages = fixed enum** (`qualification → proposal → negotiation → won → lost`), like `Lead.Status`.
- **Deal customer = optional** — a deal may stand alone (its own `title`) or link to a `Customer`.
- **Contacts UI = standalone page + customer-detail tab** (both).
- **Win/loss = free-text reason**, required only on *lost* (mirrors `Lead.lost_reason`).

**Out of scope (later/never):** configurable pipelines, lead→deal conversion, deals/contacts in the
⌘K global search, a deals pipeline report, deal notification producers. All deferrable follow-ups.

---

## 2. Feature A — Contacts

Multiple contact people per customer.

### Backend

- **Model `crm.Contact`** (`SoftDeleteModel`, reversible migration):
  - `shop` FK (`core.Shop`) — set from `customer.shop` on create (enables `ShopScopedMixin`).
  - `customer` FK (`crm.Customer`, `on_delete=CASCADE`, `related_name="contacts"`) — required.
  - `name` (CharField), `designation` (CharField, blank), `email` (EmailField, null/blank),
    `phone` (CharField, blank), `notes` (TextField, blank), `is_primary` (Bool, default False).
  - Meta: `db_table="contacts"`, index `(customer, is_primary)`.
- **`ContactViewSet`** (`ShopScopedMixin` + `ModelViewSet`), registered `router.register("contacts", …)`:
  - `get_permissions` maps action → slug: list/retrieve → `crm.contacts.view`; create → `crm.contacts.create`;
    partial_update/destroy → `crm.contacts.edit`.
  - `get_queryset`: `Contact.objects.filter(self._shop_filter()).select_related("customer")`, optional
    `?customer_id=` filter, ordered (is_primary desc, name).
  - `perform_create`: set `shop = serializer.validated_data["customer"].shop`.
  - Serializer exposes `id, customer_id, customer_name, name, designation, email, phone, notes, is_primary, created_at`.

### Frontend

- **Standalone `/crm/contacts`** (replace stub): React-Query list (name, designation, customer,
  email, phone) + create/edit dialog (rhf+zod; customer selector, fields, is_primary toggle).
- **Customer-detail tab**: add a **Contacts** tab to `/customers/[id]` (shadcn `Tabs`, lazy-loaded
  like the existing Sales/AMC tabs) listing that customer's contacts with inline add/edit.
- `crmApi` gains `listContacts({ customer_id? })`, `createContact`, `updateContact`, `deleteContact`;
  typed `Contact`. New `qk.contacts(...)` keys.

---

## 3. Feature B — Deals (Opportunities)

### Backend

- **Model `crm.Deal`** (`SoftDeleteModel`, reversible migration):
  - `shop` FK (required, from payload — `ShopScopedMixin`).
  - `title` (CharField) — required.
  - `customer` FK (`crm.Customer`, null/blank, `on_delete=SET_NULL`, `related_name="deals"`) — optional.
  - `contact` FK (`crm.Contact`, null/blank, `on_delete=SET_NULL`) — optional.
  - `stage` — `TextChoices`: `QUALIFICATION, PROPOSAL, NEGOTIATION, WON, LOST` (default QUALIFICATION).
  - `expected_revenue` (Decimal, default 0), `probability` (Int 0–100, default 0),
    `expected_close_date` (Date, null/blank).
  - `assigned_to` (User, null/blank, `SET_NULL`, `related_name="assigned_deals"`).
  - `lost_reason` (TextField, blank), `closed_at` (DateTime, null/blank), `created_by` (User, SET_NULL).
  - Meta: `db_table="deals"`, indexes `(shop, stage)`, `(assigned_to)`.
- **`DealViewSet`** (`ShopScopedMixin` + `ModelViewSet`), registered `router.register("deals", …)`:
  - Permissions: list/retrieve → `crm.deals.view`; create → `crm.deals.create`; partial_update → `crm.deals.edit`;
    destroy → `crm.deals.edit`; `change_stage` action → `crm.deals.change_stage`; `close` action → `crm.deals.close`.
  - `get_queryset`: filter by shop; optional `?stage=`, `?assigned_to=`; `select_related("customer", "contact", "assigned_to")`.
  - Actions (logic in `crm/services.py`, thin views):
    - `POST /deals/{id}/stage/` `{to_stage}` → `change_deal_stage(deal, to_stage, user)`: only among the
      three **open** stages (qualification/proposal/negotiation); reject moving to/from won/lost here
      (use `close`/re-open). Raises a validation error on illegal transition.
    - `POST /deals/{id}/close/` `{outcome: "won"|"lost", reason?}` → `close_deal(deal, outcome, reason, user)`:
      sets `stage=won|lost`, `closed_at=now`; **`reason` required when `outcome=lost`** → stored in
      `lost_reason`. Returns the updated deal.
  - Serializer exposes `id, title, stage, customer_id, customer_name, contact_id, contact_name,
    expected_revenue, probability, expected_close_date, assigned_to_id, assigned_to_name, lost_reason,
    closed_at, created_at`.

### Frontend

- **Pipeline board `/crm/deals`** (replace stub): a `DealBoard` mirroring `LeadBoard` over the shared
  `KanbanBoard<T>`:
  - Columns = the **open** stages (Qualification / Proposal / Negotiation) plus terminal **Won** / **Lost**
    columns (read-style). Per-column React-Query queries by `stage` (mirrors `LEAD_PIPELINE_COLS`).
  - Card shows: title, customer/contact, expected revenue, probability %, assignee.
  - `onCardMove`: between open stages → `changeDealStage`; into Won/Lost → use `KanbanBoard`'s built-in
    `TransitionDialog` to capture the win/loss reason, then `closeDeal`.
  - A salesperson filter + a create-deal dialog (title, optional customer/contact, stage, expected
    revenue, probability, close date, assignee).
- `crmApi` gains `listDeals({ stage?, assigned_to? })`, `createDeal`, `updateDeal`, `changeDealStage`,
  `closeDeal`; typed `Deal` + `DEAL_PIPELINE_COLS`. New `qk.deals(...)` keys.

---

## 4. Cross-Cutting Requirements

- Per project rules: serializer + `permission_classes` + tests on every endpoint; business logic in
  `services.py` (stage transitions + close); `select_related` — no N+1; TS strict, no `any`; Tailwind;
  React Query; reversible migrations.
- **Multi-tenant:** both models carry `shop`; `ShopScopedMixin` enforces JWT shop scoping. No hardcoded ids.
- **Tests (before merge):**
  - Contacts: CRUD; `?customer_id` filter; shop scoping; permission gates; `shop` auto-set from customer.
  - Deals: CRUD; `change_stage` legal vs illegal (won/lost rejected); `close` win, `close` lost requires
    reason; permission gates; shop scoping.
  - Frontend (Vitest): contacts list/dialog render; deal board column grouping + close-dialog reason flow.
- **Migrations** reversible. **Production build** must pass with `NODE_ENV=production`; App Router pages
  export only the default component.

---

## 5. Build Order (independent task-groups)

1. `crm.Contact` model + migration.
2. `ContactViewSet` + serializer + URL registration + tests.
3. Contacts frontend — standalone `/crm/contacts` page + `crmApi`/`qk`.
4. Contacts frontend — customer-detail Contacts tab.
5. `crm.Deal` model + migration.
6. `DealViewSet` + serializer + `services` (change_stage, close) + URL + tests.
7. Deals frontend — `crmApi`/`qk` + create/edit + `DealBoard`.
8. Deals frontend — `/crm/deals` page wiring (per-column queries, filters, board).
9. Final verification.

---

## 6. Verification (Phase-3 exit criteria)

- `tsc --noEmit` clean · lint clean · all Vitest pass (incl. new contacts/deals tests).
- Backend `pytest apps/crm apps/core apps/authentication` passes (plus new contact/deal tests).
- `Contact` + `Deal` migrations apply and reverse cleanly.
- Production build (`NODE_ENV=production`) succeeds; `/crm/contacts`, `/crm/deals`, and the customer
  Contacts tab render live data (no stubs).
- CI deny-list unchanged (comments-only).
