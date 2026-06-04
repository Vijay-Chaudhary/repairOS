# Module 02 — Repair System

> The core of RepairOS. Tracks a device from intake through diagnosis, repair, QC, and pickup to a billable, warranty-covered job. This module is self-contained: everything needed to build it is here.

---

## 1. Purpose & scope

The Repair module manages the **job ticket** — the primary work order — across its entire lifecycle:

- Intake (with a mandatory device condition check-in form)
- Optional estimate → customer approval (via WhatsApp or web link)
- Multi-stage repair work (diagnosis → repair → parts → testing → QC → packing)
- Quality control, ready-for-pickup, delivery, and closure
- Warranty tracking and warranty re-repair claims
- Fault templates (reusable problem definitions that pre-fill jobs)
- Spare-parts requests raised by technicians

**In scope:** job tickets, check-in conditions, estimates, stages, fault templates, spare-parts requests, warranty.
**Out of scope (owned elsewhere):** the actual invoice and payments (`07-billing`), commission calculation (`08-commissions`), stock deduction for parts (`05-inventory`), the customer record (`01-crm`).

---

## 2. Dependencies

| Depends on | For |
|---|---|
| `foundation/01-architecture` | `shops` table, tenant DB connection, S3 path prefix `/{slug}/...` |
| `foundation/02-auth-rbac` | `users` table, technician assignment, permission checks |
| `foundation/03-conventions` | response envelope, error registry, numbering, soft-delete, audit log |
| `01-crm` | `customers` table (a job must belong to a customer) |
| `05-inventory` | `product_variants` (parts used), stock deduction on job closure |
| `07-billing` | repair invoice generation reads `service_charge` + consumed parts |
| `08-commissions` | reads `service_charge` and `job_stages` to compute technician payout |

**Consumed by:** Billing (invoicing), Commissions (payout), CRM (repair history on customer profile), Reports.

---

## 3. Data model

All tables live in the **tenant database**. No `tenant_id` column — the connection provides tenant isolation. Shop-level isolation is enforced by `shop_id` checks in the application layer.

> 🔧 **PROPOSED — soft-delete columns.** Every mutable table below gains `deleted_at TIMESTAMP NULL` and `deleted_by UUID NULL FK→users.id`. The v3.1 `404 NOT_FOUND` error already says "or is soft-deleted" but no table modelled it. All list/detail queries filter `WHERE deleted_at IS NULL` by default.

### 3.1 `fault_templates`
Reusable problem definitions. Picking one when creating a job pre-fills the problem, default SC, and parts.

| Column | Type | Constraints & notes |
|---|---|---|
| id | UUID | PK DEFAULT gen_random_uuid() |
| shop_id | UUID | FK→shops.id NOT NULL INDEXED |
| name | VARCHAR(200) | NOT NULL |
| device_type | VARCHAR(100) | NOT NULL |
| device_brand | VARCHAR(100) | NULL |
| problem_description | TEXT | NOT NULL |
| default_sc | DECIMAL(10,2) | NOT NULL — seeds job service charge |
| estimated_duration_hours | DECIMAL(5,2) | NULL |
| is_active | BOOLEAN | DEFAULT TRUE |
| deleted_at / deleted_by | TIMESTAMP / UUID | NULL — soft delete |

### 3.2 `fault_template_parts`
Parts a template typically consumes (for pre-filling the parts list).

| Column | Type | Constraints & notes |
|---|---|---|
| id | UUID | PK |
| template_id | UUID | FK→fault_templates.id NOT NULL |
| variant_id | UUID | FK→product_variants.id NULL (catalogued part) |
| custom_part_name | VARCHAR(200) | NULL (free-text part) — **CHECK: variant_id OR custom_part_name required** |
| quantity | INTEGER | DEFAULT 1 NOT NULL CHECK (quantity > 0) |

### 3.3 `job_tickets`
The work order.

| Column | Type | Constraints & notes |
|---|---|---|
| id | UUID | PK |
| shop_id | UUID | FK→shops.id NOT NULL INDEXED |
| customer_id | UUID | FK→customers.id NOT NULL |
| job_number | VARCHAR(30) | UNIQUE — `{SHOP_CODE}-{YYYY}-{NNNN}`, auto per shop/year |
| template_id | UUID | FK→fault_templates.id NULL |
| status | VARCHAR(40) | ENUM (see §4.1) INDEXED DEFAULT `draft` |
| priority | VARCHAR(20) | ENUM: normal, urgent, vip — DEFAULT normal |
| device_type | VARCHAR(100) | NOT NULL |
| device_brand / device_model | VARCHAR(100) | NULL |
| serial_number | VARCHAR(100) | NULL |
| imei | VARCHAR(20) | NULL |
| problem_description | TEXT | NOT NULL — min 10 chars (validation) |
| is_field_job | BOOLEAN | DEFAULT FALSE |
| location_lat / location_lng | DECIMAL | NULL — **required if is_field_job=TRUE** |
| location_address | TEXT | NULL |
| intake_date | TIMESTAMP | DEFAULT NOW() |
| expected_delivery_date | DATE | NULL |
| service_charge | DECIMAL(10,2) | NOT NULL DEFAULT 0 — **the SC; commission base; see §4.4** |
| advance_paid | DECIMAL(10,2) | DEFAULT 0 |
| notes | TEXT | NULL — internal, not shown to customer |
| warranty_of_job_id | UUID | FK→job_tickets.id NULL — set on warranty re-repairs |
| warranty_days | INTEGER | NULL — copied from settings at closure (see §4.5) |
| warranty_expires_at | DATE | NULL — `closed_date + warranty_days` |
| created_by | UUID | FK→users.id NOT NULL |
| created_at | TIMESTAMP | DEFAULT NOW() |
| deleted_at / deleted_by | TIMESTAMP / UUID | NULL |

**Indexes:** `(shop_id, status)`, `(customer_id)`, `(job_number)`, `(intake_date)`.

### 3.4 `job_checkin_conditions`
Mandatory device condition record at intake (protects against "you damaged it" disputes).

| Column | Type | Constraints & notes |
|---|---|---|
| id | UUID | PK |
| job_id | UUID | FK→job_tickets.id UNIQUE NOT NULL (one per job) |
| physical_condition | VARCHAR(30) | ENUM: excellent, good, fair, damaged — NOT NULL |
| has_scratches / has_cracks / has_liquid_damage / has_missing_parts | BOOLEAN | DEFAULT FALSE |
| accessory_received | TEXT[] | e.g. `{charger,case,earphones}` |
| customer_description | TEXT | NULL |
| technician_notes | TEXT | NULL |
| photos | TEXT[] | S3 keys: `/{slug}/jobs/{job_id}/checkin/photo_{n}.jpg` |
| customer_signature_url | VARCHAR(500) | NULL |
| acknowledged_at | TIMESTAMP | NULL — set when customer signs |

### 3.5 `job_estimates`
Customer-facing quote before work begins.

| Column | Type | Constraints & notes |
|---|---|---|
| id | UUID | PK |
| job_id | UUID | FK→job_tickets.id NOT NULL |
| estimate_number | VARCHAR(30) | UNIQUE — `{SHOP_CODE}-EST-{YYYY}-{NNNN}` |
| labor_charge | DECIMAL(10,2) | NOT NULL — proposed SC (see §4.4) |
| parts_cost | DECIMAL(10,2) | DEFAULT 0 |
| total_estimate | DECIMAL(10,2) | NOT NULL — `labor_charge + parts_cost` |
| valid_until | DATE | NULL |
| notes | TEXT | NULL — shown to customer |
| status | VARCHAR(20) | ENUM: draft, sent, approved, rejected, expired |
| sent_at | TIMESTAMP | NULL |
| customer_response_at | TIMESTAMP | NULL |
| customer_response_method | VARCHAR(30) | ENUM: whatsapp, in_person, call, email |

### 3.6 `job_stages`
Multi-stage workflow. Only one stage `in_progress` per job at a time (see §4.3).

| Column | Type | Constraints & notes |
|---|---|---|
| id | UUID | PK |
| job_id | UUID | FK→job_tickets.id NOT NULL INDEXED |
| stage_order | INTEGER | NOT NULL — UNIQUE per job |
| stage_type | VARCHAR(30) | ENUM: diagnosis, repair, parts_install, testing, qc, packing |
| assigned_technician_id | UUID | FK→users.id NOT NULL |
| status | VARCHAR(20) | ENUM: pending, in_progress, completed, skipped — DEFAULT pending |
| started_at / completed_at | TIMESTAMP | NULL |
| notes | TEXT | NULL |

> 🔧 **PROPOSED — added `status`, `started_at`, `completed_at`** to `job_stages` (v3.1 listed the table truncated). These are required to enforce "one stage in_progress at a time" and to compute per-stage commission timing.

### 3.7 `job_spare_part_requests`
Technician asks for a part; manager approves and (optionally) orders it.

> 🔧 **PROPOSED — table made explicit.** v3.1 referenced spare-parts requests in rules and endpoints but never defined the table.

| Column | Type | Constraints & notes |
|---|---|---|
| id | UUID | PK |
| job_id | UUID | FK→job_tickets.id NOT NULL |
| requested_by | UUID | FK→users.id NOT NULL (technician) |
| variant_id | UUID | FK→product_variants.id NULL |
| custom_part_name | VARCHAR(200) | NULL — CHECK: variant_id OR custom_part_name |
| quantity | INTEGER | NOT NULL CHECK (quantity > 0) |
| is_urgent | BOOLEAN | DEFAULT FALSE |
| status | VARCHAR(20) | ENUM: requested, approved, rejected, ordered, received — DEFAULT requested |
| reviewed_by | UUID | FK→users.id NULL (manager) |
| po_id | UUID | FK→purchase_orders.id NULL — set if ordered |
| created_at | TIMESTAMP | DEFAULT NOW() |

---

## 4. Business rules & state machine

### 4.1 Job status flow

```
draft → open → {in_progress | estimated | cancelled}
estimated → {estimate_sent | open}
estimate_sent → {estimate_approved | estimate_rejected | in_progress}
estimate_approved → in_progress
estimate_rejected → {estimated | cancelled}
in_progress → {on_hold | ready_for_qc | ready_for_pickup | cancelled}
on_hold → {in_progress | cancelled}
ready_for_qc → {ready_for_pickup | qc_failed}
qc_failed → in_progress
ready_for_pickup → {delivered | in_progress}
delivered → closed
closed → (terminal)
cancelled → open   (re-open only, Tenant Admin)
```

Any transition not in this map → **`400 INVALID_STATUS_TRANSITION`**.

| Status | Triggers customer WhatsApp | Side effects |
|---|---|---|
| open | `job_received` | Job becomes live; check-in form must already exist |
| estimate_sent | `repair_estimate` (with approval link) | — |
| estimate_approved | `estimate_approved_staff` (to technician) | Set `service_charge = estimate.labor_charge` (see §4.4) |
| on_hold | `job_on_hold` (with reason) | Reason required |
| ready_for_pickup | `device_ready` (amount due + address) | Triggers invoice readiness |
| delivered | `job_delivered` (invoice link) | Deduct parts stock (§4.6) |
| closed | none | Set `warranty_expires_at` (§4.5); finalize commission (`08-commissions`) |
| cancelled | `cancellation_notice` | — |

### 4.2 Job creation rules

- **Job number** `{SHOP_CODE}-{YYYY}-{NNNN}` — auto-increment per shop per year, unique within tenant DB. Generated atomically (row lock on a per-shop counter) to avoid duplicates under concurrency.
- **Check-in form mandatory before `draft → open`.** Bypass requires a Tenant Admin override with a logged reason.
- `problem_description` min 10 chars. If `is_field_job=TRUE`, `location_lat`/`location_lng` required.
- Picking a `template_id` pre-fills `problem_description`, `service_charge` (from `default_sc`), and seeds the parts list from `fault_template_parts`.

### 4.3 Multi-stage rules

- Stages are ordered by `stage_order`. **At most one stage may be `in_progress` per job** (enforced in service layer + partial unique index `WHERE status='in_progress'`).
- Completing a stage auto-starts the next `pending` stage and emits `stage.handoff` (§7) + `stage_handoff` WhatsApp to the next technician (§8).
- A job cannot move to `ready_for_qc` until all non-QC/packing stages are `completed` or `skipped`.

### 4.4 🔧 PROPOSED — Money flow: SC ↔ estimate ↔ invoice

v3.1 left the relationship between `service_charge`, `estimate.labor_charge`, and invoice labor lines undefined. Proposed resolution:

- **`job_tickets.service_charge` (SC) is the single source of truth for labor.** It is also the commission base (`08-commissions`).
- An **estimate proposes the SC**: `estimate.labor_charge` is what you intend to charge. `parts_cost` = sum of quoted parts. `total_estimate = labor_charge + parts_cost`.
- **On `estimate_approved`**, the system sets `job.service_charge = estimate.labor_charge`. Editing SC after approval requires `repair.jobs.edit` and writes an audit log.
- **On invoice generation** (`07-billing`): the labor line item = `job.service_charge`; component line items = parts actually consumed (not quoted); custom lines for anything else. So the *estimate* is a quote, the *invoice* reflects reality.
- **Commission** is computed on the final `job.service_charge` at closure.

If you prefer SC and estimate-labor to stay independent (e.g. estimate is purely informational), flag it and I'll revert.

### 4.5 Warranty

- On `closed`: `warranty_days` copied from shop/device-type settings; `warranty_expires_at = closed_date + warranty_days`.
- `warranty_expiry_reminder` WhatsApp sent 7 days before expiry (Celery nightly task).
- **Warranty claim** creates a *new* job with `warranty_of_job_id` = original, `service_charge = 0`, and commission = 0. Allowed only while `TODAY ≤ original.warranty_expires_at`.

### 4.6 Stock & parts

- Parts consumed on a job create `repair_out` inventory transactions (`05-inventory`) at **job delivery/closure**, not at request time.
- Spare-part request flow: technician raises (`requested`) → manager `approved`/`rejected` → if catalogued + in stock, reserve; if not, manager creates a PO (`06-procurement`) and request → `ordered` → `received` on GRN, triggering `spare_part_received` WhatsApp to the technician.

---

## 5. Permissions

| Codename | Tenant Admin | Shop Manager | Receptionist | Technician | Billing | Viewer |
|---|:--:|:--:|:--:|:--:|:--:|:--:|
| repair.jobs.view | ✅ | ✅ | ✅ | own | ✅ | ✅ |
| repair.jobs.create | ✅ | ✅ | ✅ | — | — | — |
| repair.jobs.edit | ✅ | ✅ | — | own | — | — |
| repair.jobs.change_status | ✅ | ✅ | — | own | — | — |
| repair.jobs.assign_tech | ✅ | ✅ | — | — | — | — |
| repair.estimates.send | ✅ | ✅ | — | — | — | — |
| repair.estimates.approve | ✅ | ✅ | ✅ | — | — | — |
| repair.templates.manage | ✅ | ✅ | — | — | — | — |
| repair.warranty.view | ✅ | ✅ | ✅ | own | ✅ | ✅ |
| repair.spare_parts.request | ✅ | ✅ | — | ✅ | — | — |
| repair.spare_parts.approve | ✅ | ✅ | — | — | — | — |

"own" = limited to jobs/stages where the user is the assigned technician.

---

## 6. API endpoints

Base: `https://api.repaiross.app/api/v1/` · `Authorization: Bearer {access_token}` · tenant resolved from JWT `tenant_slug`. Response envelope + error registry: `foundation/03-conventions`.

### 6.1 `GET /jobs/` — list jobs
**Perm:** `repair.jobs.view` · Filters: `status, shop_id, technician_id, customer_id, date_from, date_to, priority` · cursor-paginated.

```jsonc
// 200
{ "success": true,
  "data": [{ "id": "…", "job_number": "HTA-2026-0042", "customer_name": "Ravi Kumar",
    "device_type": "Laptop", "status": "in_progress", "priority": "normal",
    "service_charge": 1200.00, "intake_date": "2026-06-01T10:30:00Z" }],
  "meta": { "next_cursor": "eyJpZCI6…", "total": 142 } }
```

### 6.2 `POST /jobs/` — create job
**Perm:** `repair.jobs.create`

```jsonc
// request
{ "shop_id": "…", "customer_id": "…", "template_id": "…",   // template_id optional
  "device_type": "Laptop", "device_brand": "Dell", "device_model": "Inspiron 5410",
  "serial_number": "SN123", "problem_description": "Does not power on, no LED.",
  "priority": "normal", "is_field_job": false, "expected_delivery_date": "2026-06-05",
  "service_charge": 1200.00 }
// 201
{ "success": true, "data": { "id": "…", "job_number": "HTA-2026-0043", "status": "draft" } }
// errors: 400 VALIDATION_ERROR (problem_description<10, missing location on field job),
//         400 DUPLICATE_PHONE (n/a), 404 NOT_FOUND (customer/shop)
```

### 6.3 `GET /jobs/{id}/` — job detail
**Perm:** `repair.jobs.view` — returns job + check-in + estimate + stages + spare-part requests + attachments.

### 6.4 `PATCH /jobs/{id}/` — update fields
**Perm:** `repair.jobs.edit` — partial update of mutable fields (not `status`, not `job_number`).

### 6.5 `POST /jobs/{id}/checkin/` — submit check-in form
**Perm:** `repair.jobs.create` — must exist before `open`.

```jsonc
// request
{ "physical_condition": "good", "has_scratches": true, "has_cracks": false,
  "accessory_received": ["charger"], "customer_description": "Spilled water last week",
  "photos": ["/{slug}/jobs/{id}/checkin/photo_1.jpg"], "customer_signature_url": "…" }
// 201 { "success": true, "data": { "id": "…", "acknowledged_at": "…" } }
```

### 6.6 `POST /jobs/{id}/status/` — transition status
**Perm:** `repair.jobs.change_status`

```jsonc
// request  { "to_status": "on_hold", "reason": "Awaiting customer approval for extra part" }
// 200 { "success": true, "data": { "id": "…", "status": "on_hold" } }
// 400 INVALID_STATUS_TRANSITION  { "success": false,
//   "error": { "code": "INVALID_STATUS_TRANSITION",
//              "message": "Cannot move from 'draft' to 'delivered'." } }
// 422 BUSINESS_RULE_VIOLATION (e.g. open without check-in form)
```

### 6.7 `POST /jobs/{id}/stages/` — create/update stages
**Perm:** `repair.jobs.assign_tech`

```jsonc
// request — define the workflow
{ "stages": [
  { "stage_order": 1, "stage_type": "diagnosis", "assigned_technician_id": "…" },
  { "stage_order": 2, "stage_type": "repair",    "assigned_technician_id": "…" },
  { "stage_order": 3, "stage_type": "qc",        "assigned_technician_id": "…" } ] }
// to advance a stage:  { "stage_id": "…", "action": "complete", "notes": "Replaced SSD" }
// 422 if action would put two stages in_progress simultaneously
```

### 6.8 `POST /jobs/{id}/estimate/` — create + send estimate
**Perm:** `repair.estimates.send`

```jsonc
// request  { "labor_charge": 1200, "parts_cost": 3500, "valid_until": "2026-06-10",
//            "notes": "SSD 512GB + labor", "send_via": "whatsapp" }
// 201 { "success": true,
//       "data": { "estimate_number": "HTA-EST-2026-0009", "total_estimate": 4700,
//                 "status": "sent", "approval_link": "https://app.repaiross.app/e/abc123" } }
```

### 6.9 `POST /jobs/{id}/estimate/respond/` — record customer response
**Perm:** `repair.estimates.approve`

```jsonc
// request  { "response": "approved", "method": "whatsapp" }
// 200 — on approve, job.service_charge set to estimate.labor_charge; logs CRM communication
```

### 6.10 `POST /jobs/{id}/spare-parts/` — request a part
**Perm:** `repair.spare_parts.request`

```jsonc
// request  { "variant_id": "…", "quantity": 1, "is_urgent": true }
//   or      { "custom_part_name": "Hinge bracket (OEM)", "quantity": 2 }
// 201 — emits spare_part_request WhatsApp to Shop Manager
```

### 6.11 `PATCH /spare-parts/{id}/` — review request
**Perm:** `repair.spare_parts.approve` · `{ "status": "approved" | "rejected" | "ordered", "po_id": "…"? }`

### 6.12 `POST /jobs/{id}/warranty-claim/` — raise warranty claim
**Perm:** `repair.warranty.view` · creates linked job, SC=0; **422** if past `warranty_expires_at`.

### 6.13 `POST /jobs/{id}/attachments/` — upload attachment
**Perm:** `repair.jobs.edit` · multipart → S3 `/{slug}/jobs/{id}/...`. Requires explicit confirmation only for client-side; server stores reference.

### 6.14 Fault templates
- `GET /fault-templates/` · `repair.templates.manage`
- `POST /fault-templates/` · `repair.templates.manage` (body includes nested `parts[]`)
- `PATCH /fault-templates/{id}/` · `repair.templates.manage`

---

## 7. Real-time events (Django Channels)

Clients subscribe to `shop.{shop_id}`. Async router uses `contextvars.ContextVar`, not thread-local (architecture §routing).

| Event | Payload | Subscribers |
|---|---|---|
| `job.created` | `{ job_id, job_number, customer_name, device_type, priority }` | Manager, Receptionist |
| `job.status_changed` | `{ job_id, job_number, customer_name, old_status, new_status }` | All shop users |
| `stage.handoff` | `{ job_id, stage_type, assigned_tech_id, tech_name }` | Assigned technician |

---

## 8. Notifications

WhatsApp via Meta Cloud API, async over Celery, retried 3× (5/15/45 min) with SMS fallback. Opt-out (`whatsapp_optout`) checked before every send. Template registry & `notification_logs` table: `foundation/03-conventions`.

| Template | Trigger | Recipient | Variables |
|---|---|---|---|
| `job_received` | status → open | Customer | customer_name, job_number, device_type, shop_phone |
| `repair_estimate` | estimate sent | Customer | customer_name, job_number, total_amount, valid_until, approval_link |
| `estimate_approved_staff` | estimate approved | Assigned technician | tech_name, job_number, device_type |
| `job_on_hold` | status → on_hold | Customer | customer_name, job_number, hold_reason, shop_phone |
| `stage_handoff` | stage completed → next | Next technician | tech_name, job_number, stage_type |
| `device_ready` | status → ready_for_pickup | Customer | customer_name, job_number, amount_due, shop_address |
| `job_delivered` | status → delivered | Customer | customer_name, job_number, invoice_number, invoice_link |
| `warranty_expiry_reminder` | 7 days before expiry (Celery) | Customer | customer_name, job_number, expiry_date, shop_phone |
| `spare_part_request` | urgent part requested | Shop Manager | manager_name, tech_name, job_number, part_name |
| `spare_part_received` | GRN received for request | Requesting technician | tech_name, part_name, job_number |

---

## 9. Reports (sourced from this module; full catalogue in `11-reports`)

| Report | Filters | Export |
|---|---|---|
| Job Status Summary | date_range, shop, status, tech | PDF, CSV |
| Job Turnaround Time | date_range, shop, device_type | CSV |
| Warranty Claims | date_range, shop | CSV |
| Fault Template Usage | date_range, template | CSV |
| Technician Performance | month, shop, technician | PDF, CSV |

---

## 10. Acceptance criteria

- [ ] Job number is unique per shop/year and never duplicates under concurrent creation.
- [ ] `draft → open` is blocked unless a check-in form exists (or Tenant Admin override with logged reason).
- [ ] Every status transition is validated against §4.1; invalid ones return `400 INVALID_STATUS_TRANSITION`.
- [ ] At most one stage is `in_progress` per job at any time.
- [ ] Completing a stage auto-starts the next and notifies the next technician.
- [ ] Estimate approval sets `job.service_charge = estimate.labor_charge` and logs a CRM communication entry.
- [ ] Closure sets `warranty_expires_at` and triggers commission finalization.
- [ ] Warranty claim creates a linked SC=0 job and is rejected past expiry.
- [ ] Parts consumed produce `repair_out` inventory transactions at delivery/closure.
- [ ] All list/detail queries exclude soft-deleted rows.
- [ ] Every write is captured in the audit log with user, IP, old/new values.

---

## 11. Test cases

**Unit** — job-number generator under concurrency; status-transition validator (all valid + sample invalid edges); single-`in_progress`-stage invariant; warranty expiry math; estimate→SC propagation.

**Integration (API)** — happy path + primary error code for every endpoint in §6; check-in-before-open guard; warranty-claim-past-expiry → 422.

**E2E (Playwright)**
- Complete repair job *no estimate*: customer → job → check-in → stages → ready → delivered → closed.
- Complete repair job *with estimate*: job → estimate → WhatsApp send → approve → in_progress → delivered.
- Warranty claim: close job (30-day warranty) → claim within period → warranty job SC=0.

**Tenant isolation (mandatory every PR)** — Tenant A technician calls `GET /jobs/` → returns only Tenant A jobs, zero Tenant B rows. Crafted JWT with Tenant B slug + Tenant A user_id → 401.

**RBAC** — Technician JWT → billing endpoint → `403 PERMISSION_DENIED`; Technician sees only own jobs.

---

## 12. Open questions affecting this module

| ID | Question | Why it matters here |
|---|---|---|
| OQ-04 | ESC/POS thermal receipt printer in v3.1 or v4.0? | Affects the pickup/delivery print step. |
| OQ-10 | Customer self-service job status via public link, or WhatsApp only for v3.1? | Affects whether `device_ready`/`job_delivered` links go to a public status page. |
| 🔧 §4.4 | Confirm SC ↔ estimate-labor coupling (proposed: coupled). | Drives invoicing and commission. |
| 🔧 §3.6 | Confirm added stage `status`/timestamps. | Needed for stage workflow + commission timing. |
