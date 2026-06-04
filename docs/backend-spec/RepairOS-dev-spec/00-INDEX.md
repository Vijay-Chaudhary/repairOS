# RepairOS — Developer Specification (v3.1-dev)

> **What this is.** A restructuring of FSD v3.1 from a *layered* document (all schemas in one section, all APIs in another) into *dedicated, self-contained module specs*. Every module file contains everything needed to build that module — schema, rules, state machine, endpoints with example payloads, permissions, notifications, reports, acceptance criteria, and tests — so a developer or Claude Code can build it without jumping between sections.
>
> **Nothing from v3.1 was removed.** Content was regrouped, missing detail was inlined, and a small number of ambiguities were resolved (each flagged with `🔧 PROPOSED` so you can confirm or reject).

---

## 1. Product goal (one paragraph)

RepairOS replaces the spreadsheets, paper registers, standalone billing tools, and scattered WhatsApp threads a repair shop runs on, with one affordable, mobile-first (PWA) SaaS platform. Each **tenant** (a repair-shop business) gets a **completely isolated, dedicated PostgreSQL database**, provisioned automatically in seconds at signup. One tenant can run **many shops** out of that single database. The platform covers the entire lifecycle: find the customer (CRM), repair the device (Repair), sell parts/products (POS), service contracts (AMC), run the back office (Inventory, Procurement, HR, Finance), bill with full Indian GST compliance (Billing), and see everything (Reports). Isolation is enforced at the database connection level — there is no `tenant_id` column anywhere, because the connection *is* the tenant.

---

## 2. File structure

```
RepairOS-dev-spec/
├── 00-INDEX.md                    ← you are here (read first)
│
├── foundation/                    ← shared; every module depends on these
│   ├── 01-architecture.md         ← db-per-tenant, routing, provisioning, migrations, stack
│   ├── 02-auth-rbac.md            ← JWT design, system roles, permission catalogue
│   └── 03-conventions.md          ← API standards, response envelope, error registry,
│                                     numbering, GST rules, soft-delete, idempotency, audit
│
└── modules/                       ← the 12 dedicated modules
    ├── 01-crm.md
    ├── 02-repair.md               ← ✅ BUILT (pilot — defines the template)
    ├── 03-pos.md
    ├── 04-amc.md
    ├── 05-inventory.md
    ├── 06-procurement.md          ← suppliers, PO, GRN, purchase invoices/returns
    ├── 07-billing.md              ← repair invoices, payments, Razorpay, GST, Tally
    ├── 08-commissions.md
    ├── 09-hr-payroll.md
    ├── 10-finance.md              ← petty cash, expenses, budget vs actual, assets
    ├── 11-reports.md              ← dashboard + report catalogue (cross-module)
    └── 12-platform-admin.md       ← master DB, subscriptions, tenant lifecycle, onboarding
```

### 🔧 PROPOSED — module list reconciliation

The FSD's tenant-isolation test (§11.3) names "12 modules": *CRM, Repair, POS, AMC, ERP, HR, Billing, Commissions, Inventory, Suppliers, Assets, Budget*. That list double-counts: **ERP** is an umbrella over Inventory + Suppliers + Assets + Budget + HR, so listing ERP *and* its children is redundant for development.

The 12 above replace the umbrella "ERP" with its real parts and add **Platform Admin** (the master-DB / provisioning / subscriptions domain, which the FSD covers but never names as a module). This gives 12 clean, non-overlapping build units. If you'd rather keep a literal "ERP" grouping, say so and I'll merge 05/06/10 back together.

---

## 3. The module template

Every `modules/NN-*.md` file follows this exact structure. (See `02-repair.md` for the worked example.)

| # | Section | Purpose |
|---|---------|---------|
| 1 | **Purpose & scope** | What the module does, in plain language, and where its boundary is. |
| 2 | **Dependencies** | Which other modules / foundation docs it reads or writes. |
| 3 | **Data model** | Every table for this module — full columns, types, constraints, validation, indexes, soft-delete. Self-contained (no "see §3.x"). |
| 4 | **Business rules & state machine** | Code-ready logic: status flows with guards, calculations, invariants. |
| 5 | **Permissions** | Permission codenames + which system roles get them. |
| 6 | **API endpoints** | Every endpoint with method, permission, **request body example, success response example, error codes**, and validation. |
| 7 | **Real-time events** | WebSocket events this module emits/consumes. |
| 8 | **Notifications** | WhatsApp/SMS templates this module triggers, with variables and trigger conditions. |
| 9 | **Reports** | Reports sourced from this module's data. |
| 10 | **Acceptance criteria** | Definition-of-done checklist a reviewer can tick off. |
| 11 | **Test cases** | Unit, integration, E2E, and isolation tests specific to the module. |
| 12 | **Open questions** | OQ items from the decisions log that block or affect this module. |

---

## 4. Where each FSD v3.1 section went

So you can verify nothing was lost.

| FSD v3.1 section | Lands in |
|---|---|
| §1 Introduction, Vision, Scope, Definitions | `00-INDEX` + `foundation/01-architecture` |
| §2 System Architecture (db-per-tenant, routing, provisioning, migrations, stack) | `foundation/01-architecture` |
| §3.1 Master DB tables | `modules/12-platform-admin` |
| §3.2 Shops & Org | `foundation/01-architecture` (shared) |
| §3.3 Users & RBAC | `foundation/02-auth-rbac` |
| §3.4 CRM | `modules/01-crm` |
| §3.5 Repair | `modules/02-repair` ✅ |
| §3.6 AMC | `modules/04-amc` |
| §3.7 Inventory & Products | `modules/05-inventory` |
| §3.8 Suppliers & Procurement | `modules/06-procurement` |
| §3.9 Sales / POS | `modules/03-pos` |
| §3.10 Billing & Payments | `modules/07-billing` |
| §3.11 HR, Petty Cash & Assets | `modules/09-hr-payroll` + `modules/10-finance` |
| §3.12 Commissions + notification_logs | `modules/08-commissions` (+ `notification_logs` → `foundation/03-conventions`) |
| §4 Auth & RBAC | `foundation/02-auth-rbac` |
| §5 Feature specs (CRM, Repair, ERP, POS, AMC, Billing) | split into each module's §4 Business rules |
| §6 API standards, envelope, errors | `foundation/03-conventions`; endpoints split per module §6 |
| §6.5 WebSocket events | split into each module's §7 |
| §7 Notifications | split into each module's §8 (template registry + log table in conventions) |
| §8 Reports & dashboard | `modules/11-reports` (cross-references each module) |
| §9 Non-functional requirements | `foundation/01-architecture` §NFR |
| §10 Subscription plans & onboarding | `modules/12-platform-admin` |
| §11 Testing | split into each module's §11 + a global isolation suite in `foundation/01-architecture` |
| §12 Deployment / CI-CD | `foundation/01-architecture` §Deployment |
| §13 Decisions & open questions | decisions stay in `foundation/01-architecture`; open questions split into each module's §12 |

---

## 5. Improvements applied across all modules

These are the fixes I flagged. Each is marked `🔧 PROPOSED` at the point it appears, so you approve them per module rather than all at once.

1. **Self-contained.** All "refer to FSD v3.0" pointers are replaced with the actual inlined detail.
2. **Example payloads.** Every endpoint gets a request + response JSON example (v3.1 only had them for auth).
3. **Soft-delete made real.** `deleted_at TIMESTAMP NULL` + `deleted_by UUID NULL` added to mutable business tables (the FSD's 404 error and "soft delete user" assumed this but never modelled it). Global convention documented in `foundation/03-conventions`.
4. **Idempotency made real.** An `idempotency_keys` table + a `webhook_events` dedup table added in `foundation/03-conventions` (the FSD required `Idempotency-Key` and signature-verified webhooks but stored neither).
5. **Money-flow pinned down.** The SC → estimate labor → invoice labor relationship is defined explicitly (see `02-repair` §4).
6. **Schema smells fixed:** dropped the single-value `commission_rules.base` enum; made the User↔Employee link one-directional (`employees.user_id` is the single source of truth, `users.employee_id` removed).

---

## 6. Status

All foundation docs and all 12 modules are built to the same template. ✅ Complete.

| File | Status |
|---|---|
| `foundation/01-architecture` · `02-auth-rbac` · `03-conventions` | ✅ |
| `modules/01-crm` … `12-platform-admin` (all 12) | ✅ |

**Review order suggestion:** read `foundation/` first (shared rules everything references), then any module. Each module is self-contained — you can hand a single module file to Claude Code and it has everything needed to build that slice.

**Open items to confirm** (all marked `🔧 PROPOSED` in-file): the SC↔estimate money-flow coupling (repair §4.4), global soft-delete + idempotency tables (conventions §6–7), the spare-parts-request table + stage status fields (repair §3), the commission multi-tech split formula (commissions §4), the module reconciliation (this doc §2), and the smaller schema fixes. Reject any and I'll revert that one.
