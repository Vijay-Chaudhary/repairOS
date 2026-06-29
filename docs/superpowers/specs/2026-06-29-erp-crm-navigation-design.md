# ERP/CRM Navigation & Information-Architecture Blueprint

**Date:** 2026-06-29
**Status:** Approved design — ready for implementation planning
**Scope of this document:** Navigation + information-architecture blueprint. It defines the
target sidebar, the permission convention, the cross-cutting systems, and a phased module
roadmap. The only code change it authorizes directly is **Phase 0** (nav restructure + stub
routes + header shells + new permission slugs). Every net-new feature module gets its own
later spec → plan → build cycle.

---

## 1. Context & Goals

RepairOS is a multi-tenant (database-per-tenant) Repair Management ERP with integrated CRM,
POS, Inventory, Billing, AMC, HR, and Finance. Target users: repair shops, service centers,
and electronics/mobile/laptop repair businesses, including multi-branch operations. The UI
must stay simple for daily operators while remaining powerful for managers and admins.

This blueprint improves the existing navigation **without redesigning the architecture**. It
builds on what already exists rather than starting over.

### Existing architecture (verified against the codebase)

- **Nav is data-driven:** `frontend/src/components/shared/AppShell.tsx` exports `NAV_ITEMS`,
  a flat array of `section` / `group` (one level of `children`) / `leaf` nodes. Each leaf
  carries a `permission?: string` or `anyOf?: string[]`. Guarded by
  `frontend/src/components/shared/__tests__/navItems.test.ts`. The 2-level model already
  supports everything this blueprint needs — no nav-engine rewrite.
- **CRM is already partly expanded:** Overview, Customers, Leads, Quotes, Tasks, Activity,
  Segments, Campaigns all ship today.
- **Routes that already exist** (some not yet surfaced in nav): `products`, `suppliers`,
  `tasks`, `sales`, `purchases`, `invoices`, `payments`, `finance`, `commissions`, `hr`,
  `reports`, `settings`, plus all Operations routes.
- **Permission source of truth:** `backend/apps/master/services.py` seeds the permission
  catalogue and role grants. Convention is `module.resource.action` with **domain-specific
  verbs**, not uniform CRUD — e.g. `crm.leads.convert`, `repair.jobs.change_status`,
  `repair.estimates.approve`, `pos.discount.apply`, `erp.grn.receive`. Inventory/purchasing/
  expenses/assets live under the `erp.*` prefix; `erp.assets.manage` is already seeded.
- **Cross-cutting infra already present:** `authentication.AuditLog` model exists;
  `core.NotificationLog` (outbound dispatch log) exists; per-resource `?search=`/`?q=`
  filtering exists on list endpoints.

### Key decisions (locked during brainstorming)

1. **Deliverable = nav/IA blueprint** (not a full build). Each net-new module is its own
   later spec.
2. **Permission convention = keep existing domain verbs.** Formalize `module.resource.action`
   with domain-specific verbs. Add new slugs only for new nav nodes. **Zero changes to
   existing slugs.** Add `export`/`approve` only where a real action exists.
3. **Dense areas = landing page + in-page secondary nav.** Settings (~12), Reports (~6),
   Accounts (~6), HR (~5) each show a single sidebar leaf; sub-items live as tabs inside the
   landing page. Matches Salesforce/Zoho/Odoo; keeps the sidebar short.

---

## 2. Final Sidebar Hierarchy

Legend: ✅ exists · 🔶 stub now (landing/coming-soon) · 🔨 build-later module ·
*(tabs)* = landing page with in-page secondary nav.

```
OPERATIONS
  Dashboard                      ✅ /dashboard
  Repair ▾
    Overview                     ✅ /repair
    Jobs                         ✅ /jobs        (Job Cards = print/detail view of a Job, not a nav item)
    Estimates                    🔨 /repair/estimates
    Spare Parts                  ✅ /repair/spare-parts
    Fault Templates              ✅ /repair/fault-templates
    Warranty                     🔶 /repair/warranty
  CRM ▾
    Overview                     ✅ /crm
    Leads                        ✅ /leads
    Deals                        🔨 /crm/deals      (Opportunity pipeline)
    Contacts                     🔨 /crm/contacts   (multiple per customer)
    Customers                    ✅ /customers
    Quotes                       ✅ /crm/quotes
    Activity                     ✅ /crm/activity
    Segments                     ✅ /crm/segments
    Campaigns                    ✅ /crm/campaigns
  POS                            ✅ /pos
  AMC                            ✅ /amc
  Tasks (tabs)                   ✅ /tasks   ← moved OUT of CRM, now global. Tabs: My / Team / Calendar / Kanban

FINANCE
  Inventory ▾
    Products                     ✅ /products   (independent from stock)
    Stock                        ✅ /inventory  (leaf "Inventory"→"Stock" to disambiguate)
    Suppliers                    ✅ /suppliers
    Purchase Orders              ✅ /purchases
    Purchase Returns             🔶 /purchases/returns
  Billing ▾
    Invoices                     ✅ /invoices
    Payments                     ✅ /payments
    Outstanding                  🔶 /billing/outstanding   (perm already seeded)
    Credit Notes                 🔨 /billing/credit-notes
    Refunds                      🔨 /billing/refunds
  Accounts (tabs)                ✅ /finance (leaf "Finance"→"Accounts"; route stays /finance this pass)
        Tabs: Expenses ✅ · Income 🔨 · Cash Book 🔶 · Bank Accounts 🔨 · Ledger 🔨 · Journal Entries 🔨

MANAGEMENT
  Commissions                    ✅ /commissions
  HR (tabs)                      ✅ /hr   Tabs: Employees ✅ · Attendance 🔶 · Leave 🔶 · Payroll 🔶 · Departments 🔶
  Reports (tabs)                 ✅ /reports   Tabs: Repair · CRM · Inventory · Billing · Finance · HR
  Audit Log                      🔨 /audit   (admin-only system audit; distinct from CRM Activity)

CONFIG
  Settings (tabs)                ✅ /settings
        Tabs: Company · Branches · Users · Roles · Permissions · Taxes · Email · SMS · WhatsApp · Integrations · Backup · System Preferences
```

**Header bar (not sidebar):** Global Search (⌘K / Ctrl-K command palette) · Notifications (bell).

### Deliberate departures from the original request (with reasoning)

1. **"Job Cards" is not a nav item.** A job card is the printable/detail view of a Job;
   a separate list would duplicate Jobs. It lives on the Job detail page.
2. **No standalone "Calendar" sidebar module.** Folded into Tasks as a *Calendar* tab. A
   calendar that only shows tasks does not earn a top-level slot (goal: keep nav clean). Can
   be promoted later if it aggregates jobs/AMC visits too.
3. **"Technicians" dropped from Repair nav.** Technician identity = HR Employees; technician
   *workload* is better as a filter/board inside Jobs than a separate page.

---

## 3. Permission Convention & New Slugs

**Convention:** `module.resource.action`, domain-specific verbs. Zero changes to existing
slugs. `export`/`approve` only where a real action exists. New leaves covered by an existing
slug get no new slug.

### New slugs to register in `backend/apps/master/services.py` (and grant to Admin)

| Nav node | New slug(s) |
|---|---|
| CRM › Deals | `crm.deals.view`, `crm.deals.create`, `crm.deals.edit`, `crm.deals.change_stage`, `crm.deals.close` |
| CRM › Contacts | `crm.contacts.view`, `crm.contacts.create`, `crm.contacts.edit` |
| Repair › Estimates | `repair.estimates.view` (`repair.estimates.send/approve` already exist) |
| Inventory › Products | `erp.products.view`, `erp.products.manage` |
| Inventory › Purchase Returns | `erp.purchase_returns.view` (`erp.purchase_returns.create` already exists) |
| Billing › Credit Notes | `billing.credit_notes.view`, `billing.credit_notes.create`, `billing.credit_notes.approve` |
| Billing › Refunds | `billing.refunds.view`, `billing.refunds.create`, `billing.refunds.approve` |
| Accounts › Income | `accounts.income.view`, `accounts.income.record` |
| Accounts › Cash Book | `accounts.cashbook.view` |
| Accounts › Bank Accounts | `accounts.bank.view`, `accounts.bank.manage` |
| Accounts › Ledger | `accounts.ledger.view`, `accounts.ledger.export` |
| Accounts › Journal Entries | `accounts.journal.view`, `accounts.journal.create`, `accounts.journal.post` |
| Tasks (global) | `tasks.tasks.view`, `tasks.tasks.manage` |
| HR › Departments | `hr.departments.manage` |
| Settings › Taxes | `settings.taxes.manage` |
| Settings › Branches | `settings.branches.manage` |
| Settings › Integrations | `settings.integrations.manage` |
| Settings › Backup | `settings.backup.manage` |
| Audit Log | `settings.audit.view` |

### Reuse — no new slug (gate on existing perms)

- Repair › Warranty → `repair.warranty.view`
- Billing › Outstanding → `billing.outstanding.view`
- Accounts › Expenses → `erp.expenses.view` (expenses stay under `erp.*` — see decision below)
- HR tabs Attendance/Leave/Payroll → `hr.attendance.view` / `hr.leaves.manage` / `hr.salary.view`
- Reports tabs (all 6) → existing `reports.*.view` (Billing tab → `reports.revenue.view`,
  Finance tab → `reports.pl.view`)
- Settings tabs Company/Users/Roles/Permissions/Email/SMS/WhatsApp/System →
  `settings.shop.edit` / `settings.users.manage` / `settings.roles.manage` /
  `settings.notifications.manage`

### Convention decisions

1. **Accounting prefix split.** New accounting resources use a new `accounts.*` prefix
   (ledger, journal, bank, income, cashbook), but **Expenses stays `erp.expenses.*`** to
   avoid churning working code/tests. The inconsistency (expenses shown in the Accounts UI
   but keeping its `erp` slug) is invisible to users. A future `accounts.expenses.*` alias
   can be introduced with the accounting module (Phase 8) if desired.
2. **Tasks transition.** New `tasks.tasks.*` slugs are added, but since `crm.tasks.manage`
   is already seeded and granted, the Tasks leaf gates on
   `anyOf: ['tasks.tasks.view', 'crm.tasks.manage']` so no role loses access on day one.

---

## 4. Cross-Cutting Systems

### 4a. Audit Log — model exists, surface it

`authentication.AuditLog` already exists with the right shape: `user_id`, `action`
(`create/update/delete/login/logout/permission_denied`), `model_name`, `object_id`,
`old_value`, `new_value`, `ip_address`, `user_agent`, `created_at`.

**Build-later (not Phase 0):**
- A write path — DRF mixin / signals / middleware that records rows on writes + auth events.
  *Verify whether anything populates it today; the model existing does not mean it is written.*
- Read API `GET /audit/` with filters (user, action, model_name, date range), gated on
  `settings.audit.view`.
- UI `/audit` page (admin-only nav leaf).

Status changes and payments map to `update`/`create` rows. **Inventory movement is NOT an
audit concern** — it belongs in a dedicated Stock Ledger (see §5), not generic audit rows.

### 4b. Notifications — outbound log exists, in-app feed is new

`core.NotificationLog` logs **outbound** dispatches (WhatsApp/email/SMS); it is **not** a
per-user in-app feed. The notification *center* is net-new:
- New model `Notification` (recipient user, type, title, body, link/route, `read_at`) —
  distinct from `NotificationLog`.
- Producers (per module): job status change, new lead, payment received, low-stock alert,
  AMC renewal due, task assigned, @mention.
- API: `GET /notifications/` (own), `POST /notifications/{id}/read`, unread count. Scoped to
  the requesting user — no special permission.
- UI: bell + dropdown in the `AppShell` header.
- Delivery: poll on an interval for v1; WebSocket/Channels later (Redis channels infra
  already configured).

### 4c. Global Search ⌘K — per-resource search exists, unified is new

Today each list endpoint has its own `?search=`/`?q=`; no unified endpoint.
- New `GET /search/?q=` aggregator fanning out across Customers, Leads, Jobs, Invoices,
  Products, Technicians (Employees), Payments, Purchase Orders — returning typed results
  `{type, id, label, sublabel, route}`.
- **Security:** each result type filtered by the caller's existing per-module `view`
  permission. No new permission slug.
- Performance: start with indexed `icontains` over a small field set per model (matches the
  current approach), capped (e.g. top 5 per type). Full-text/trigram is a later optimization.
- UI: command palette in `AppShell`, bound to ⌘K / Ctrl-K.

**Phase-0 footprint for cross-cutting:** Audit gets a nav leaf; Search + Notifications get
header UI shells pointing at stub endpoints. Their backends are build-later roadmap items.

---

## 5. Module Roadmap

### Build status of net-new nav nodes

| Item | Status | Effort | Notes |
|---|---|---|---|
| Billing › Outstanding | stub→build | S | Perm + likely data exist; view over invoices |
| Reports tabs (6) | build | S–M | Perms exist; wire existing report endpoints into tabs |
| Settings › Taxes | build | S | Config CRUD |
| Accounts › Cash Book | build | S | Reads existing petty-cash/expense data |
| CRM › Contacts | build | M | New model (many per customer) |
| CRM › Deals | build | M–L | Pipeline, stages, win/loss — highest sales value |
| Repair › Estimates | build | M | Core repair flow; send/approve perms exist |
| Repair › Warranty | stub→build | M | `repair.warranty.view` exists |
| Inventory › Purchase Returns | build | M | `create` perm exists |
| Billing › Credit Notes / Refunds | build | M | GST-relevant; approve actions |
| Tasks (global, 4 tabs) | build | M | Move from CRM; My/Team/Calendar/Kanban |
| HR › Attendance/Leave/Payroll/Departments | build | L | Largest HR expansion |
| Accounts › Income/Bank/Ledger/Journal | build | XL | Full double-entry accounting — heaviest |
| Notification center | build | M | New `Notification` model + header bell |
| Global search ⌘K | build | M | New `/search` aggregator + palette |
| Audit log read+write | build | M | Model exists; needs write hooks + API + page |

### Suggested build order (each phase = its own spec → plan → build)

- **Phase 0 — this PR:** nav restructure, seed new slugs, stub pages, header shells.
- **Phase 1 — quick wins over existing data:** Outstanding, Reports tabs, Cash Book,
  Settings › Taxes.
- **Phase 2 — daily-UX leverage:** Global Search ⌘K, Notification center.
- **Phase 3 — CRM sales pipeline:** Contacts, then Deals.
- **Phase 4 — Repair depth:** Estimates, Warranty, + Serial/IMEI tracking & Job attachments.
- **Phase 5 — Billing/Inventory compliance:** Credit Notes, Refunds, Purchase Returns,
  + Stock Ledger.
- **Phase 6 — Tasks module** (global, with Calendar/Kanban).
- **Phase 7 — HR expansion.**
- **Phase 8 — Accounting** (Ledger/Journal/Bank/Income). Biggest; do last.
- **Phase 9 — Audit write-path + viewer.**

### Missing modules essential for a Repair ERP (recommendations)

Near-essential for the target verticals, folded into the roadmap:

1. **Stock Ledger / Inventory Movements** *(essential).* Running quantity ledger (purchase
   in, sale/job-consumption out, adjustment, return) with per-item balance. The correct home
   for "inventory movement" tracking (not the audit log). → Phase 5.
2. **Serial / IMEI tracking** *(essential for mobile/laptop/electronics).* Track device
   serial/IMEI on jobs; link to warranty + history. → Phase 4.
3. **Job attachments / device photos** *(near-essential).* Before/after photos + documents on
   jobs; critical for damage disputes. → Phase 4.

Keep in the existing "future" bucket (designed later, not now):

4. **Customer status-tracking link** — public tokenized "track your repair" page. High value,
   low cost; recommend pulling earlier than full Customer Portal.
5. **GST returns / e-invoice (IRN)** — complements existing `tally_export` for full Indian
   compliance.

Out of scope by YAGNI for now: Vendor Portal, Knowledge Base, full Workflow Automation,
API Manager. Keep as future; do not design yet.

---

## 6. Phase-0 Implementation Notes (the nav PR)

### Frontend

- `frontend/src/components/shared/AppShell.tsx` — rewrite `NAV_ITEMS` to the §2 tree. No
  changes to `NavSection/NavGroup/NavLeaf` types or rendering. Key edits:
  - Move **Tasks** from the CRM group to an Operations top-level leaf
    (`anyOf: ['tasks.tasks.view', 'crm.tasks.manage']`).
  - Add **Deals** and **Contacts** to the CRM group.
  - Rename group **Inventory & Purchases** → **Inventory**; rename leaf **Inventory** →
    **Stock**; surface existing **Products** and **Suppliers** leaves; add **Purchase Returns**.
  - Add Billing leaves **Outstanding**, **Credit Notes**, **Refunds**.
  - Rename the **Finance** leaf label → **Accounts** (route stays `/finance` this pass).
  - Add **Audit Log** leaf under Management (`settings.audit.view`).
- `frontend/src/components/shared/__tests__/navItems.test.ts` — update to assert the new
  structure: labels, hrefs, every leaf has a `permission`/`anyOf`, no orphan slugs.
- **9 new stub routes**, each a `page.tsx` rendering a shared `<ComingSoon/>`:
  `/repair/estimates`, `/repair/warranty`, `/crm/deals`, `/crm/contacts`,
  `/purchases/returns`, `/billing/outstanding`, `/billing/credit-notes`,
  `/billing/refunds`, `/audit`. (All other target routes already exist.)
- New `frontend/src/components/shared/ComingSoon.tsx` — title + "coming soon" + back link.
- **Header shells** in the `AppShell` top bar: a ⌘K search box (stubbed palette modal) and a
  notification bell (stubbed dropdown). UI only.

### Backend

- `backend/apps/master/services.py` — append the new slugs from §3 to the permission
  catalogue and grant them to the **Admin** role seed. Idempotent.
- **Backfill:** seeding runs at tenant provisioning, so existing tenants will not receive the
  new slugs automatically. Phase 0 must include an idempotent re-sync (management command or
  `post_migrate`/data step) that adds the new permissions to already-provisioned tenant DBs.

### Tests

- `navItems.test.ts` updated for the new tree.
- Backend test asserting the new slugs are present in the seed and granted to Admin (mirrors
  the existing slug-drift guard).

### Phase-0 decisions (defaults chosen)

1. **Accounts route** — keep `/finance`, change only the label. A `/accounts` rename with
   redirect waits for the accounting module (Phase 8).
2. **Dense-area tabs** — Phase 0 adds only the landing pages + a secondary-nav shell.
   Populating tabs (Settings 12, Reports 6, HR 5, Accounts 6) happens in their phases;
   unbuilt tabs render `<ComingSoon/>`.

---

## 7. Out of Scope

- Implementing any net-new feature module (Deals, Contacts, Estimates, Accounting, HR
  expansion, Tasks module, Credit Notes/Refunds, etc.) — each is its own later spec.
- Migrating permissions to uniform CRUD — explicitly rejected; domain verbs retained.
- Adding a 3rd nav nesting level — rejected; dense areas use landing + tabs.
- Vendor Portal, Knowledge Base, Workflow Automation, API Manager — future, not designed here.
