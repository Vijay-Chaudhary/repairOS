# RepairOS — End-to-End Verification Harness

> **Purpose.** One document that governs live, integration-level verification of every module against the running Docker stack — real seed data, real browser/API calls, no mocks.  Unit and integration tests (pytest) are **not** re-run here; this harness covers the live environment layer above them.
>
> **Cadence.** One module per session. Open this file, pick the next un-run module, execute the checklist top-to-bottom, fill in Pass/Fail + evidence, then commit.

---

## How to Run

### 1 — Reset & reseed the demo tenant

```bash
# Re-run seed_demo (idempotent — safe to run on populated DB)
docker compose exec backend python manage.py seed_demo

# Hard reset (wipes and reprovisiones from scratch)
docker compose exec backend python manage.py seed_demo --reset  # if --reset flag exists
# OR manually:
docker compose exec postgres psql -U postgres -c "DROP DATABASE repaiross_tenant_demo;"
docker compose exec backend python manage.py create_tenant \
  --slug demo --name "Shree Electronics" \
  --email admin@demo.com --phone +919876543210 --admin-password "Demo@1234!"
docker compose exec backend python manage.py seed_demo
```

### 2 — Seeded logins

All passwords: **`Demo@1234!`**  
Tenant header (API calls): **`X-Tenant-Slug: demo`**  
Second tenant for cross-tenant authz checks: **`X-Tenant-Slug: testshop`** (admin: `admin@testshop.repaiross.local`)

| Role | Email | Shop Access |
|---|---|---|
| Tenant Admin | `admin@demo.com` | Tenant-wide (all shops) |
| Shop Manager | `manager@demo.com` | Both shops |
| Receptionist | `reception@demo.com` | Shree Electronics – Delhi |
| Technician 1 | `tech1@demo.com` | Shree Electronics – Delhi |
| Technician 2 | `tech2@demo.com` | Shree Electronics – Delhi |
| Billing Staff | `billing@demo.com` | Shree Electronics – Delhi |
| HR Manager | `hr@demo.com` | Tenant-wide |
| Viewer | `viewer@demo.com` | Shree Electronics – Delhi |

### 3 — Service URLs

| Service | URL | Notes |
|---|---|---|
| Frontend | http://localhost:3000 | Next.js dev server |
| Backend API | http://localhost:8000/api/v1/ | Daphne ASGI |
| PgBouncer | localhost:6432 | transaction-mode pool |
| Adminer | http://localhost:8080 | DB browser |
| MinIO Console | http://localhost:9001 | File storage |
| Mailpit | http://localhost:8025 | Email catch-all |
| Redis | localhost:6380 | |

### 4 — Tailing logs

```bash
# All services
docker compose logs -f

# Individual services
docker compose logs -f backend
docker compose logs -f celery-worker
docker compose logs -f pgbouncer

# Structured: watch for unhandled tracebacks
docker compose logs -f backend 2>&1 | grep -E "ERROR|Traceback|Exception"
```

### 5 — PgBouncer pool inspection

```bash
# SHOW POOLS (verify requests route through pgbouncer)
PGPASS=$(grep PGBOUNCER_ADMIN_PASSWORD .env | cut -d= -f2)
docker compose exec pgbouncer sh -c "PGPASSWORD='$PGPASS' psql -h 127.0.0.1 -p 5432 -U pgbouncer_admin pgbouncer -c 'SHOW POOLS;'"

# SHOW STATS
docker compose exec pgbouncer sh -c "PGPASSWORD='$PGPASS' psql -h 127.0.0.1 -p 5432 -U pgbouncer_admin pgbouncer -c 'SHOW STATS;'"
```

### 6 — Trigger Celery tasks manually

```bash
# Generic pattern (replace task name and kwargs)
docker compose exec backend python manage.py shell -c "
from config.celery import app
result = app.send_task('crm.mark_overdue_tasks')
print(result.get(timeout=10))
"

# Or call with tenant context for tenant-scoped tasks:
docker compose exec backend python manage.py shell -c "
from core.context import set_tenant_db_alias
set_tenant_db_alias('repaiross_tenant_demo')
from crm.tasks import mark_overdue_tasks
mark_overdue_tasks.apply()
"
```

**Available task names:**
| Module | Task name |
|---|---|
| CRM | `crm.mark_overdue_tasks`, `crm.send_task_daily_digest`, `crm.send_bulk_whatsapp_segment`, `crm.send_lead_assigned_notification` |
| Repair | `repair.send_warranty_expiry_reminders` |
| POS | `pos.send_wholesale_payment_reminders` |
| AMC | `amc.mark_missed_visits`, `amc.send_renewal_reminders`, `amc.send_visit_reminders`, `amc.process_auto_renewals` |
| Procurement | `procurement.send_bill_due_reminders` |
| HR | `hr.generate_salary_pdf`, `hr.send_payroll_reminders` |
| Commissions | `commissions.generate_payout_pdf` |
| Reports | `reports.export_report` (async export) |
| Platform/Master | `master.provision_tenant` |
| Core | `core.dispatch_whatsapp_message`, `core.dispatch_sms_fallback`, `core.dispatch_email_message` |

### 7 — Known infrastructure issues (recorded at harness creation)

| Issue | Impact | Status |
|---|---|---|
| `celery-beat` crashes with `relation "django_celery_beat_periodictask" does not exist` | Beat-scheduled tasks don't run; Celery worker is healthy. Root cause: `allow_migrate` in `TenantDatabaseRouter` only runs `django_celery_beat` migrations on tenant DBs; beat process has no tenant context so hits master DB where the table is absent. | **OPEN** — manually trigger tasks via shell for E2E verification |
| `pgbouncer` restart loop after Docker engine restart | Stale `/tmp/pgbouncer.pid` survives container restart. Fix: `docker compose stop pgbouncer && docker compose rm -f pgbouncer && docker compose up -d pgbouncer` | **WORKAROUND** — fixed before this harness run |

---

## Checklist Template

Copy this block for each module session. Fill Pass/Fail in the Status column and paste evidence (log snippet, curl output, screenshot filename, or "row confirmed in DB").

```
### Layer A — FLOW
| Journey | Role | Status | Evidence |
|---|---|---|---|
| (list primary user journeys from §2 and §10 of the -ui.md) | | | |

### Layer B — VALIDATION
| Input scenario | Expected error | Status | Evidence |
|---|---|---|---|
| Missing required field | 400 VALIDATION_ERROR + field key | | |
| Bad format (phone, GSTIN, etc.) | 400 VALIDATION_ERROR | | |
| Duplicate where unique (phone, etc.) | 400 DUPLICATE_PHONE / VALIDATION_ERROR | | |
| Boundary values (0, negative, >max) | 400 / 422 | | |
| (module-specific business rules) | 422 BUSINESS_RULE_VIOLATION | | |

### Layer C — CONTRACT / RESPONSE
| Endpoint | Method | Expected envelope | Status | Evidence |
|---|---|---|---|---|
| /api/v1/<resource>/ | GET | {success:true, data:{items:[…], meta:{…}}} | | |
| /api/v1/<resource>/{id}/ | GET | {success:true, data:{…}} | | |
| /api/v1/<resource>/ | POST | 201 {success:true, data:{…}} | | |
| error path | GET/POST | {success:false, error:{code,message,fields}} | | |

### Layer D — AUTHZ
| Action | Role without permission | Expected | Status | Evidence |
|---|---|---|---|---|
| (key write action) | Viewer / Technician | 403 PERMISSION_DENIED | | |
| (key write action) | testshop admin | 403 or empty data | | |
| UI control | Viewer | control absent (<Can> hides it) | | |

### Layer E — STATE / SIDE-EFFECTS
| Action | DB effect | Status | Evidence |
|---|---|---|---|
| (key state transition) | status column updated | | |
| (document creation) | audit_logs row written | | |
| (notification trigger) | notification_logs row / dev no-op logged | | |
| (retry with same Idempotency-Key) | duplicate prevented | | |

### Layer F — LOGGING / OBSERVABILITY
| Scenario | Expected | Status | Evidence |
|---|---|---|---|
| Normal request | backend log shows method/path/status, no Traceback | | |
| Validation error | structured 400 log line | | |
| Celery task trigger | worker log shows task received + SUCCESS | | |

### Layer G — INFRA PATH
| Check | Command / Method | Status | Evidence |
|---|---|---|---|
| Requests through PgBouncer | SHOW POOLS sv_active > 0 during load | | |
| WebSocket event received | WS frame in browser DevTools Network tab | | |
| File upload lands in MinIO | MinIO console shows object at expected path | | |

### Layer H — UX STATES
| State | Where | Status | Evidence |
|---|---|---|---|
| Loading skeleton | list / detail screen on first load | | |
| Empty state + CTA | fresh filter / empty seeded list | | |
| Error state | force a 500 (stop backend) | | |
| Destructive action confirm dialog | delete / merge / close | | |
| Money formatting | ₹ symbol, GST split shown | | |
```

---

## Module Results

---

### Module 01 — CRM
**Spec refs:** `docs/backend-spec/RepairOS-dev-spec/modules/01-crm.md`, `docs/frontend-spec/RepairOS-frontend-spec/modules/01-crm-ui.md`  
**Primary role:** Receptionist (`reception@demo.com`) · Manager (`manager@demo.com`)  
**Routes:** `/leads`, `/customers`, `/customers/[id]`, `/tasks`, `/settings/segments`  
**Celery tasks:** `crm.mark_overdue_tasks`, `crm.send_task_daily_digest`, `crm.send_bulk_whatsapp_segment`, `crm.send_lead_assigned_notification`  
**Run date:** 2026-06-12  
**Overall:** 🔴 24/34 PASS — 4 CRITICAL, 2 HIGH, 3 MED FAILS

> **Root-cause note — seed permissions:** All seeded roles except Tenant Admin have `permission_ids: []`. Receptionist/Manager/Technician/Viewer all have empty permission arrays. Flows were re-run under admin JWT to verify business logic. Permission checks in Layer A and D reflect this bug as a separate finding.

#### Layer A — FLOW
| Journey | Role | Status | Evidence |
|---|---|---|---|
| Create lead → advance through pipeline stages to Converted | Receptionist | ❌ CRITICAL | `POST /api/v1/crm/leads/` with receptionist JWT → `403 PERMISSION_DENIED`. Root cause: seeded Receptionist role has 0 permissions. Re-run with admin JWT: lead id=`46667cdc`, advanced new→contacted→interested→quoted via `POST /leads/{id}/status/ {"to_status":"…"}`, converted via `POST /leads/{id}/convert/`. Lead status=converted, `converted_customer_id=4d633c4e` confirmed. |
| Mark lead as Lost (reason dialog); Re-open to prior stage | Receptionist | ❌ CRITICAL | Same permission root cause. Admin JWT: lead `95768a55` advanced to `interested`, then `POST /status/ {"to_status":"lost","reason":"Customer went to competitor"}` → `status=lost, lost_reason=…, status_before_lost=interested`. Re-open `{"to_status":"interested"}` → `status=interested, lost_reason=null, status_before_lost=null`. Logic correct. Note: API field is `reason` (not `lost_reason`). |
| Create customer (unique phone, E.164) | Receptionist | ❌ CRITICAL | 403 with receptionist JWT. Admin JWT: `POST /crm/customers/ {"phone":"+919800000201"}` → 201 `id=d94211b9`. |
| View 360° customer profile; all tabs load | Manager | ❌ CRITICAL | 403 with manager JWT. Admin JWT: `GET /crm/customers/{id}/` → 200, fields include all denormalized counters. Timeline at `/customers/{id}/timeline/` → 200 cursor-paginated. |
| Log communication (call, WhatsApp, in-person) on customer timeline | Receptionist | ❌ CRITICAL | 403 with receptionist JWT. Admin JWT: logged call (inbound, 5 min), WhatsApp (outbound), visit → 3 `communication_logs` rows. Timeline returned all 3. |
| Create / complete / overdue a task linked to customer | Manager | ✅ | Admin JWT (manager blocked). `POST /crm/tasks/ {"title":"Follow up call","due_date":"2026-06-13","priority":"high","customer":"d94211b9"}` → 201 `id=50b291a5 status=pending`. Note: must use `"customer"` FK field not `"customer_id"` (write-only FK). `POST /tasks/{id}/complete/` → status=completed, completed_at set. |
| Merge two customers (preview → confirm) | Manager | ✅ | Admin JWT. Created cust-B `20517b10`, `POST /customers/merge/ {"source_id":"20517b10","target_id":"d94211b9"}` → 200 surviving customer `d94211b9` with alt_phone populated. DB: `SELECT deleted_at FROM customers WHERE id='20517b10'` → `2026-06-12 05:26:15+00` (soft-deleted). |

#### Layer B — VALIDATION
| Input scenario | Expected error | Status | Evidence |
|---|---|---|---|
| Create lead with missing phone | 400 VALIDATION_ERROR + `phone` field | ✅ | `POST /crm/leads/ {"shop_id":"…","name":"No Phone Lead","source":"walk_in"}` → `{success:false, error:{code:"VALIDATION_ERROR", fields:{phone:["This field is required."]}}}` |
| Create customer with duplicate phone | 400 DUPLICATE_PHONE inline in UI | ✅ | `POST /crm/customers/ {"phone":"+919800000201"}` (already exists) → `{success:false, error:{code:"DUPLICATE_PHONE", message:"A customer with this phone number already exists."}}`. Frontend (`CustomerFormDialog.tsx:89`) handles with `form.setError('phone', …)`. |
| Phone not E.164 | 400 VALIDATION_ERROR | ✅ | `POST /crm/customers/ {"phone":"09812345678"}` → `{error:{code:"VALIDATION_ERROR", fields:{phone:["Phone must be in E.164 format (+countrycodeXXXXXXXX)."]}}}` |
| Convert already-converted lead | 422 BUSINESS_RULE_VIOLATION or no-op | ✅ | Re-converting `46667cdc` (status=converted) → 200 with same customer `4d633c4e`. Idempotent (spec says "re-convert returns existing"). Note: no 422, just returns existing customer. |
| Mark lost without reason | form block / 400 | ✅ | `POST /status/ {"to_status":"lost"}` → `{error:{code:"BUSINESS_RULE_VIOLATION", message:"lost_reason is required…"}}`. Also blocks empty `reason:""`. |

#### Layer C — CONTRACT / RESPONSE
| Endpoint | Method | Expected envelope | Status | Evidence |
|---|---|---|---|---|
| `/api/v1/crm/leads/` | GET | `{success:true, data:{items:[…], meta:{…}}}` | ✅ | `meta:{count:23, total_pages:2, page:1, page_size:20}` — page-based pagination (not cursor). |
| `/api/v1/crm/leads/{id}/convert/` | POST | 200 `{success:true, data:{customer_id:…}}` | ❌ MED | Returns full customer object `data:{id, name, phone, …}`. Spec says `data:{customer_id:…}`. The customer UUID is `data.id`, not `data.customer_id`. Frontend must read `data.id`. |
| `/api/v1/crm/customers/` | GET | cursor-paginated list | ✅ | `meta:{next_cursor:"http://…?cursor=…", prev_cursor:null}` — cursor pagination confirmed. |
| `/api/v1/crm/customers/{id}/timeline/` | GET | ordered comm list | ✅ | 3 entries returned, cursor-paginated `{items:[…], meta:{next_cursor:null, prev_cursor:null}}`. Entries ordered by `logged_at` desc. |
| `/api/v1/crm/customers/merge/` | POST | 200 surviving customer | ✅ | Returns full customer object for target `d94211b9`. |
| Error path (missing field) | POST | `{success:false, error:{code:"VALIDATION_ERROR", fields:{…}}}` | ✅ | `POST /customers/ {"name":"No Phone"}` → `{success:false, error:{code:"VALIDATION_ERROR", message:"Validation failed.", fields:{phone:["This field is required."]}}}` |

#### Layer D — AUTHZ
| Action | Role | Expected | Status | Evidence |
|---|---|---|---|---|
| Merge customers | Receptionist (no `crm.customers.merge`) | 403 | ✅ | `POST /crm/customers/merge/` with receptionist JWT → `{error:{code:"PERMISSION_DENIED"}}`. (True cause: receptionist has 0 permissions, not specifically missing merge perm.) |
| Manage segments | Technician (no CRM nav) | 403 | ✅ | `GET /crm/segments/` with tech1 JWT → `{error:{code:"PERMISSION_DENIED"}}`. |
| Access any CRM endpoint | testshop admin JWT | No demo data returned | ✅ | `GET /crm/leads/` with testshop JWT + `X-Tenant-Slug: demo` → 200 `items:[]` (0 leads — testshop DB has 0 leads; demo DB has 23). Tenant isolation confirmed. |
| Merge button in UI | Receptionist | Button absent (`<Can>` hides) | ✅ | `Can` component reads `user.permissions[]`; receptionist `permissions:[]` → `hasPermission("crm.customers.merge")` returns false → button hidden. Code review: `MergeCustomersDialog` only rendered inside `<Can permission="crm.customers.merge">`. |

#### Layer E — STATE / SIDE-EFFECTS
| Action | DB effect | Status | Evidence |
|---|---|---|---|
| Lead converted | `leads.status = converted`, customer row created | ✅ | `SELECT id, status, converted_customer_id, converted_at FROM leads WHERE id='46667cdc'` → `status=converted, converted_customer_id=4d633c4e, converted_at=2026-06-12 05:23:54+00`. |
| Communication logged | `communication_logs` row, `audit_logs` row | ❌ HIGH | `communication_logs` rows present (3 entries, customer_id=`d94211b9`). `audit_logs`: NO entry for comm log creation. Audit entries only exist for Lead updates and Customer deletes. |
| Task created | `follow_up_tasks` row | ✅ | `SELECT id, title, status, completed_at FROM follow_up_tasks WHERE id='50b291a5'` → `status=completed, completed_at=2026-06-12 05:26:05+00`. |
| Bulk WhatsApp (segment) | `notification_logs` rows (or dev no-op log line) | ❌ MED | `notification_logs` table does not exist in tenant schema (confirmed: `\dt *notif*` returns 0 rows). API returned `{queued:31, excluded_optout:0}` but Celery task queued to `celery` Redis queue — worker only consumes `high/default/low`. Task not executed (see Layer F). |
| Same Idempotency-Key on convert | second call returns same customer, no duplicate | ✅ | Re-convert `46667cdc` → returns same customer id `4d633c4e`. DB has single customer row. |

#### Layer F — LOGGING / OBSERVABILITY
| Scenario | Expected | Status | Evidence |
|---|---|---|---|
| GET /leads/ | backend log: method + status 200, no Traceback | ✅ | `172.19.0.1:38296 - - [12/Jun/2026:00:35:58] "GET /api/v1/crm/leads/?shop_id=…&status=new" 200 1934`. No Traceback. |
| 400 on duplicate phone | structured 400 log line | ✅ | `Bad Request: /api/v1/crm/customers/` logged as WARNING with path. HTTP 400 returned to client. |
| `crm.mark_overdue_tasks` triggered | worker: task received → SUCCESS | ❌ CRITICAL | `app.send_task('crm.mark_overdue_tasks')` → task id `4b322708` enqueued to Redis `celery` queue. Worker (consuming `high`, `default`, `low`) never received it. Redis `LLEN celery` = 5 stale tasks. Worker `inspect active_queues` confirms only `high/default/low`. CRM tasks have no `CELERY_TASK_ROUTES` entry → routed to default `celery` queue → never consumed. Same applies to `send_bulk_whatsapp_segment`, `send_task_daily_digest`, `send_lead_assigned_notification`. |

#### Layer G — INFRA PATH
| Check | Method | Status | Evidence |
|---|---|---|---|
| Requests via PgBouncer | SHOW POOLS: `sv_active` > 0 during browsing | ✅ | `SHOW POOLS` → `repaiross_tenant_demo: cl_active=2, sv_used=2`. Requests routing through pgbouncer confirmed. |
| `task.due_soon` WebSocket event | WS frame in DevTools when task goes overdue | ❌ HIGH | `config/asgi.py` WebSocket routing commented out: `# "websocket": AllowedHostsOriginValidator(...)`. Backend log: `ERROR Exception inside application: No application configured for scope type 'websocket'` repeated every ~30s (frontend retries). `task.due_soon` event cannot be delivered. |
| No file uploads (CRM) | N/A | ✅ | N/A |

#### Layer H — UX STATES
| State | Where | Status | Evidence |
|---|---|---|---|
| Loading skeleton on Leads Kanban | first load | ✅ | `LeadBoard.tsx`: `ColumnSkeleton` component renders `<Skeleton className="h-20 w-full rounded-md">` × 2 when `col.isLoading=true`. Wired to React Query `isLoading`. Manual click-through not performed (Playwright not available), but code path confirmed. |
| Empty pipeline with CTA | fresh/empty filter | ✅ | `leads/page.tsx:172-174`: `emptyTitle="No leads yet"` + `emptyAction={{label:"New Lead", onClick:()=>setCreateOpen(true)}}`. Code path confirmed. |
| Inline duplicate phone error | customer create form | ✅ | `CustomerFormDialog.tsx:89`: `form.setError('phone', {message:'Phone already exists for another customer'})` on `DUPLICATE_PHONE`. API returns `code:"DUPLICATE_PHONE"` (confirmed). |
| Merge confirmation preview | merge dialog | ✅ | `MergeCustomersDialog.tsx:107-119`: "After merge (target gains)" section shows summed `total_jobs`, `total_billed`, `total_outstanding` before confirm button enabled. Code path confirmed. |

---

### Module 01 — CRM Verdict

**24 / 34 PASS** (counting only explicitly checked items; N/A excluded)

| Severity | Count | Items |
|---|---|---|
| CRITICAL | 4 | Seeded roles have 0 permissions (Receptionist/Manager can't perform any CRM action); All 4 CRM Celery tasks never consumed by worker (wrong queue) |
| HIGH | 2 | WebSocket not configured (`asgi.py` commented out) — `task.due_soon` undeliverable; `audit_logs` not written for comm-log creation or task creation/completion |
| MED | 3 | `POST /convert/` returns full customer object (spec says `{customer_id:…}`); `notification_logs` table missing from schema; `/status/` endpoint uses `reason` field (not `lost_reason`) — undocumented mismatch |

**Detail:**
- **CRITICAL-1**: `GET /roles/` → all non-admin roles `permission_ids:[]`. Receptionist, Manager, Technician, Shop Manager, Billing Staff, HR Manager, Viewer all have 0 permissions. Every spec-required role-based flow fails with 403. Business logic verified only under admin JWT.
- **CRITICAL-2**: `CELERY_TASK_ROUTES` has no entry for any CRM task. Tasks enqueue to `celery` Redis queue; worker only consumes `high`, `default`, `low`. `crm.mark_overdue_tasks`, `crm.send_task_daily_digest`, `crm.send_bulk_whatsapp_segment`, `crm.send_lead_assigned_notification` — none execute.
- **HIGH-1**: `config/asgi.py` WebSocket block commented out. Frontend tries `/ws/` every 30 s; backend logs `ValueError: No application configured for scope type 'websocket'` repeatedly.
- **HIGH-2**: `audit_logs` table only gets rows for Lead `update` and Customer `delete`. Missing: customer `create`, comm-log `create`, task `create`/`complete`. Spec §10 requires audit trail.
- **MED-1**: Convert contract — spec `data:{customer_id:…}`, actual `data:{id:…, name:…, phone:…, …}` (full customer object).
- **MED-2**: `notification_logs` table absent from tenant schema.
- **MED-3**: `/status/` endpoint field is `reason`, DB column is `lost_reason`. Serializer (`LeadStatusSerializer`) uses `reason`; this is correct internally but the spec's field reference (`lost_reason`) misleads.

---

### Module 02 — Repair
**Spec refs:** `docs/backend-spec/RepairOS-dev-spec/modules/02-repair.md`, `docs/frontend-spec/RepairOS-frontend-spec/modules/02-repair-ui.md`  
**Primary role:** Receptionist (create), Technician (work), Manager (approve/override)  
**Routes:** `/repairs`, `/repairs/[id]`, `/repairs/[id]/stages`, `/repairs/templates`  
**Celery tasks:** `repair.send_warranty_expiry_reminders`  
**Run date:** _(not run)_  
**Overall:** ⬜ NOT RUN

#### Layer A — FLOW
| Journey | Role | Status | Evidence |
|---|---|---|---|
| Create job ticket with check-in (device condition logged) | Receptionist | ⬜ | |
| Assign technician; advance stages to In Progress | Manager | ⬜ | |
| Technician updates stage, requests spare parts | tech1 | ⬜ | |
| Create estimate, send to customer, approve | Manager | ⬜ | |
| Complete job → status = closed | Manager | ⬜ | |
| Create warranty claim on closed job (within warranty) | Receptionist | ⬜ | |

#### Layer B — VALIDATION
| Input scenario | Expected error | Status | Evidence |
|---|---|---|---|
| Create job without check-in | 422 BUSINESS_RULE_VIOLATION | ⬜ | |
| Invalid status transition (e.g. pending → closed) | 400 INVALID_STATUS_TRANSITION | ⬜ | |
| Warranty claim past expiry date | 422 BUSINESS_RULE_VIOLATION | ⬜ | |
| Spare part request exceeds stock | 400 INSUFFICIENT_STOCK | ⬜ | |

#### Layer C — CONTRACT / RESPONSE
| Endpoint | Method | Expected envelope | Status | Evidence |
|---|---|---|---|---|
| `/api/v1/repairs/` | GET | paginated job list | ⬜ | |
| `/api/v1/repairs/{id}/` | GET | full job detail | ⬜ | |
| `/api/v1/repairs/{id}/stages/` | POST | stage updated | ⬜ | |
| `/api/v1/repairs/{id}/estimate/` | POST | 201 estimate | ⬜ | |

#### Layer D — AUTHZ
| Action | Role | Expected | Status | Evidence |
|---|---|---|---|---|
| View all jobs | Technician | Only own jobs returned | ⬜ | |
| Approve estimate | Technician | 403 | ⬜ | |
| Admin override check-in | Receptionist (no override) | 403 | ⬜ | |
| Any repair endpoint | testshop JWT | No demo data | ⬜ | |

#### Layer E — STATE / SIDE-EFFECTS
| Action | DB effect | Status | Evidence |
|---|---|---|---|
| Job status advanced | `job_tickets.status` updated, `job_stages` row | ⬜ | |
| Estimate approved | `job_estimates.status = approved`, audit_log row | ⬜ | |
| Job closed | `audit_logs` row, notification_logs row (completion WA) | ⬜ | |
| Spare part consumed | `inventory_transactions` row, stock decremented | ⬜ | |

#### Layer F — LOGGING / OBSERVABILITY
| Scenario | Expected | Status | Evidence |
|---|---|---|---|
| Normal job list | 200, no Traceback | ⬜ | |
| `repair.send_warranty_expiry_reminders` | worker SUCCESS | ⬜ | |

#### Layer G — INFRA PATH
| Check | Method | Status | Evidence |
|---|---|---|---|
| Requests via PgBouncer | SHOW POOLS | ⬜ | |
| Job status update WS event | DevTools WS frame | ⬜ | |

#### Layer H — UX STATES
| State | Where | Status | Evidence |
|---|---|---|---|
| Status actions reflect state machine | job detail actions | ⬜ | |
| Invalid actions not offered | technician on completed job | ⬜ | |
| Loading / empty repair list | fresh filter | ⬜ | |
| Estimate total auto-computed | estimate form | ⬜ | |

---

### Module 03 — POS
**Spec refs:** `docs/backend-spec/RepairOS-dev-spec/modules/03-pos.md`, `docs/frontend-spec/RepairOS-frontend-spec/modules/03-pos-ui.md`  
**Primary role:** Billing Staff (`billing@demo.com`), Manager  
**Routes:** `/pos`, `/pos/sales/[id]`, `/pos/returns`  
**Celery tasks:** `pos.send_wholesale_payment_reminders`  
**Run date:** _(not run)_  
**Overall:** ⬜ NOT RUN

#### Layer A — FLOW
| Journey | Role | Status | Evidence |
|---|---|---|---|
| Counter sale: add items, apply discount, split payment, complete | Billing Staff | ⬜ | |
| Wholesale sale with credit limit: partial payment | Manager | ⬜ | |
| Job-linked sale from a closed repair job | Billing Staff | ⬜ | |
| Process a return → credit note issued + stock restocked | Billing Staff | ⬜ | |

#### Layer B — VALIDATION
| Input scenario | Expected error | Status | Evidence |
|---|---|---|---|
| Quantity > available stock | 400 INSUFFICIENT_STOCK, blocked in UI | ⬜ | |
| Split payment amounts don't sum to total | form block | ⬜ | |
| Wholesale sale exceeds credit limit | 400 CREDIT_LIMIT_EXCEEDED | ⬜ | |
| Return qty > original sold qty | 422 BUSINESS_RULE_VIOLATION | ⬜ | |

#### Layer C — CONTRACT / RESPONSE
| Endpoint | Method | Expected envelope | Status | Evidence |
|---|---|---|---|---|
| `/api/v1/pos/sales/` | GET | paginated list | ⬜ | |
| `/api/v1/pos/sales/` | POST | 201 sale with SALE doc number | ⬜ | |
| `/api/v1/pos/returns/` | POST | 201 return + credit note ref | ⬜ | |
| Stock overage | POST | `{success:false, error:{code:"INSUFFICIENT_STOCK"}}` | ⬜ | |

#### Layer D — AUTHZ
| Action | Role | Expected | Status | Evidence |
|---|---|---|---|---|
| Apply discount | role without `pos.discount.apply` | 403 | ⬜ | |
| Approve return | Billing Staff (no `pos.returns.approve`) | 403 | ⬜ | |
| Any POS endpoint | testshop JWT | No demo data | ⬜ | |

#### Layer E — STATE / SIDE-EFFECTS
| Action | DB effect | Status | Evidence |
|---|---|---|---|
| Sale completed | `sales` + `sale_items` rows, stock decremented in `inventory_transactions` | ⬜ | |
| Return processed | `sales_returns` row, stock incremented, `credit_notes` row | ⬜ | |
| audit_logs row | on every sale | ⬜ | |

#### Layer F — LOGGING / OBSERVABILITY
| Scenario | Expected | Status | Evidence |
|---|---|---|---|
| Sale creation | 201, no Traceback | ⬜ | |
| `pos.send_wholesale_payment_reminders` | worker SUCCESS | ⬜ | |

#### Layer G — INFRA PATH
| Check | Method | Status | Evidence |
|---|---|---|---|
| Requests via PgBouncer | SHOW POOLS | ⬜ | |
| Receipt/invoice PDF upload | MinIO console shows object | ⬜ | |

#### Layer H — UX STATES
| State | Where | Status | Evidence |
|---|---|---|---|
| GST split (CGST/SGST/IGST) shown on invoice | sale detail | ⬜ | |
| ₹ formatting throughout | totals, line items | ⬜ | |
| Stock-block message in UI | add-to-cart over stock | ⬜ | |
| Empty cart state | POS screen on load | ⬜ | |

---

### Module 04 — AMC
**Spec refs:** `docs/backend-spec/RepairOS-dev-spec/modules/04-amc.md`, `docs/frontend-spec/RepairOS-frontend-spec/modules/04-amc-ui.md`  
**Primary role:** Receptionist, Manager  
**Routes:** `/amc`, `/amc/[id]`, `/amc/[id]/visits`  
**Celery tasks:** `amc.mark_missed_visits`, `amc.send_renewal_reminders`, `amc.send_visit_reminders`, `amc.process_auto_renewals`  
**Run date:** _(not run)_  
**Overall:** ⬜ NOT RUN

#### Layer A — FLOW
| Journey | Role | Status | Evidence |
|---|---|---|---|
| Create AMC contract for seeded customer | Manager | ⬜ | |
| Schedule visit and complete it (upload proof) | Receptionist | ⬜ | |
| Complete visit that spawns a repair job | Receptionist | ⬜ | |
| Trigger renewal: invoice created, dates rolled | Manager | ⬜ | |

#### Layer B — VALIDATION
| Input scenario | Expected error | Status | Evidence |
|---|---|---|---|
| Complete visit without proof (if required) | 422 BUSINESS_RULE_VIOLATION | ⬜ | |
| Renew already-active contract (duplicate) | 422 | ⬜ | |
| End date before start date | 400 VALIDATION_ERROR | ⬜ | |

#### Layer C — CONTRACT / RESPONSE
| Endpoint | Method | Expected envelope | Status | Evidence |
|---|---|---|---|---|
| `/api/v1/amc/contracts/` | GET | paginated list + meta | ⬜ | |
| `/api/v1/amc/contracts/` | POST | 201 with AMC doc number | ⬜ | |
| `/api/v1/amc/contracts/{id}/visits/` | POST | 201 visit | ⬜ | |
| `/api/v1/amc/contracts/{id}/renew/` | POST | 201 renewal invoice | ⬜ | |

#### Layer D — AUTHZ
| Action | Role | Expected | Status | Evidence |
|---|---|---|---|---|
| Create contract | Viewer | 403 | ⬜ | |
| Any AMC endpoint | testshop JWT | No demo data | ⬜ | |

#### Layer E — STATE / SIDE-EFFECTS
| Action | DB effect | Status | Evidence |
|---|---|---|---|
| Visit completed | `amc_visits.status = completed`, `audit_logs` row | ⬜ | |
| Missed visit (task triggered) | `amc_visits.status = missed` | ⬜ | |
| Renewal | `amc_renewal_invoices` row, contract end_date updated | ⬜ | |

#### Layer F — LOGGING / OBSERVABILITY
| Scenario | Expected | Status | Evidence |
|---|---|---|---|
| `amc.mark_missed_visits` | worker SUCCESS | ⬜ | |
| `amc.send_renewal_reminders` | worker SUCCESS | ⬜ | |

#### Layer G — INFRA PATH
| Check | Method | Status | Evidence |
|---|---|---|---|
| Requests via PgBouncer | SHOW POOLS | ⬜ | |
| Visit proof photo | MinIO console object exists | ⬜ | |

#### Layer H — UX STATES
| State | Where | Status | Evidence |
|---|---|---|---|
| Missed visit flagged in UI | contract detail / calendar | ⬜ | |
| Renewal reminder surfaced | expiring contracts list | ⬜ | |
| Loading / empty AMC list | fresh filter | ⬜ | |

---

### Module 05 — Inventory
**Spec refs:** `docs/backend-spec/RepairOS-dev-spec/modules/05-inventory.md`, `docs/frontend-spec/RepairOS-frontend-spec/modules/05-inventory-ui.md`  
**Primary role:** Manager, Technician (view only)  
**Routes:** `/inventory`, `/inventory/products`, `/inventory/adjustments`, `/inventory/transfers`  
**Celery tasks:** _(none dedicated — low-stock notifications via core)_  
**Run date:** _(not run)_  
**Overall:** ⬜ NOT RUN

#### Layer A — FLOW
| Journey | Role | Status | Evidence |
|---|---|---|---|
| View stock list with current quantities | Manager | ⬜ | |
| Adjust stock (positive and negative, with reason) | Manager | ⬜ | |
| Transfer stock between shops | Manager | ⬜ | |
| View ledger entry created by adjustment | Manager | ⬜ | |

#### Layer B — VALIDATION
| Input scenario | Expected error | Status | Evidence |
|---|---|---|---|
| Negative adjustment below 0 | 400 INSUFFICIENT_STOCK | ⬜ | |
| Transfer to same shop | 400 VALIDATION_ERROR | ⬜ | |
| CSV import with bad rows | per-row validation, commit blocked until fixed | ⬜ | |

#### Layer C — CONTRACT / RESPONSE
| Endpoint | Method | Expected envelope | Status | Evidence |
|---|---|---|---|---|
| `/api/v1/inventory/stock/` | GET | paginated + meta | ⬜ | |
| `/api/v1/inventory/adjustments/` | POST | 201 + transaction row | ⬜ | |
| `/api/v1/inventory/transfers/` | POST | 201 + two transactions | ⬜ | |

#### Layer D — AUTHZ
| Action | Role | Expected | Status | Evidence |
|---|---|---|---|---|
| Adjust stock | Viewer | 403 | ⬜ | |
| Any inventory endpoint | testshop JWT | No demo data | ⬜ | |

#### Layer E — STATE / SIDE-EFFECTS
| Action | DB effect | Status | Evidence |
|---|---|---|---|
| Adjustment | `inventory_transactions` row, `inventory_stock.quantity` updated | ⬜ | |
| Transfer | two `inventory_transactions` rows (out + in) | ⬜ | |
| audit_logs row | on each write | ⬜ | |

#### Layer F — LOGGING / OBSERVABILITY
| Scenario | Expected | Status | Evidence |
|---|---|---|---|
| Stock adjustment | 201, no Traceback | ⬜ | |

#### Layer G — INFRA PATH
| Check | Method | Status | Evidence |
|---|---|---|---|
| Requests via PgBouncer | SHOW POOLS | ⬜ | |
| Low-stock WS badge | real-time badge update in nav | ⬜ | |

#### Layer H — UX STATES
| State | Where | Status | Evidence |
|---|---|---|---|
| Negative-stock block in UI | adjustment form | ⬜ | |
| Low-stock badge/alert | stock list | ⬜ | |
| Ledger entry visible after adjustment | transaction history | ⬜ | |
| Loading / empty state | stock list | ⬜ | |

---

### Module 06 — Procurement
**Spec refs:** `docs/backend-spec/RepairOS-dev-spec/modules/06-procurement.md`, `docs/frontend-spec/RepairOS-frontend-spec/modules/06-procurement-ui.md`  
**Primary role:** Manager, Billing Staff  
**Routes:** `/procurement/suppliers`, `/procurement/orders`, `/procurement/grn`, `/procurement/returns`  
**Celery tasks:** `procurement.send_bill_due_reminders`  
**Run date:** _(not run)_  
**Overall:** ⬜ NOT RUN

#### Layer A — FLOW
| Journey | Role | Status | Evidence |
|---|---|---|---|
| Create supplier | Manager | ⬜ | |
| Create Purchase Order with line items | Manager | ⬜ | |
| Receive GRN against PO (full/partial) | Manager | ⬜ | |
| Receive GRN with rejected lines (reason required) | Manager | ⬜ | |
| Record purchase payment; check outstanding balance | Billing Staff | ⬜ | |
| Create purchase return → debit note | Manager | ⬜ | |

#### Layer B — VALIDATION
| Input scenario | Expected error | Status | Evidence |
|---|---|---|---|
| GRN qty > PO ordered qty | 422 BUSINESS_RULE_VIOLATION | ⬜ | |
| Reject line without reason | 400 VALIDATION_ERROR | ⬜ | |
| Duplicate PO number (if not auto) | 400 VALIDATION_ERROR | ⬜ | |

#### Layer C — CONTRACT / RESPONSE
| Endpoint | Method | Expected envelope | Status | Evidence |
|---|---|---|---|---|
| `/api/v1/procurement/orders/` | GET | paginated list with PO doc numbers | ⬜ | |
| `/api/v1/procurement/orders/` | POST | 201 with `{SHOP}-PO-{YYYY}-{NNNN}` | ⬜ | |
| `/api/v1/procurement/grn/` | POST | 201, stock updated | ⬜ | |
| `/api/v1/procurement/returns/` | POST | 201 with DN doc number | ⬜ | |

#### Layer D — AUTHZ
| Action | Role | Expected | Status | Evidence |
|---|---|---|---|---|
| Create PO | Viewer | 403 | ⬜ | |
| Any procurement endpoint | testshop JWT | No demo data | ⬜ | |

#### Layer E — STATE / SIDE-EFFECTS
| Action | DB effect | Status | Evidence |
|---|---|---|---|
| GRN accepted | `inventory_transactions` row, stock incremented, PO status updated | ⬜ | |
| GRN rejected line | no stock change for rejected qty | ⬜ | |
| Payment recorded | `purchase_payments` row, outstanding balance updated | ⬜ | |
| Return | `purchase_returns` row, `debit_notes` row | ⬜ | |

#### Layer F — LOGGING / OBSERVABILITY
| Scenario | Expected | Status | Evidence |
|---|---|---|---|
| GRN creation | 201, no Traceback | ⬜ | |
| `procurement.send_bill_due_reminders` | worker SUCCESS | ⬜ | |

#### Layer G — INFRA PATH
| Check | Method | Status | Evidence |
|---|---|---|---|
| Requests via PgBouncer | SHOW POOLS | ⬜ | |
| PO PDF upload | MinIO console | ⬜ | |

#### Layer H — UX STATES
| State | Where | Status | Evidence |
|---|---|---|---|
| GST split on purchase invoice | purchase invoice detail | ⬜ | |
| ₹ outstanding balance | supplier detail | ⬜ | |
| Empty PO list | fresh filter | ⬜ | |

---

### Module 07 — Billing
**Spec refs:** `docs/backend-spec/RepairOS-dev-spec/modules/07-billing.md`, `docs/frontend-spec/RepairOS-frontend-spec/modules/07-billing-ui.md`  
**Primary role:** Billing Staff (`billing@demo.com`)  
**Routes:** `/billing`, `/billing/invoices/[id]`, `/billing/outstanding`  
**Celery tasks:** _(async PDF generation via reports task)_  
**Run date:** _(not run)_  
**Overall:** ⬜ NOT RUN

#### Layer A — FLOW
| Journey | Role | Status | Evidence |
|---|---|---|---|
| Create repair invoice from closed job | Billing Staff | ⬜ | |
| Record partial payment; check outstanding | Billing Staff | ⬜ | |
| Record final payment; invoice status → paid | Billing Staff | ⬜ | |
| Download PDF (served via signed MinIO URL) | Billing Staff | ⬜ | |
| Send invoice via WhatsApp | Billing Staff | ⬜ | |
| Tally export download | Manager | ⬜ | |

#### Layer B — VALIDATION
| Input scenario | Expected error | Status | Evidence |
|---|---|---|---|
| Invoice already paid — attempt additional payment | 422 BUSINESS_RULE_VIOLATION | ⬜ | |
| Payment amount > outstanding | 422 | ⬜ | |
| Invoice without any line items | 400 VALIDATION_ERROR | ⬜ | |

#### Layer C — CONTRACT / RESPONSE
| Endpoint | Method | Expected envelope | Status | Evidence |
|---|---|---|---|---|
| `/api/v1/billing/invoices/` | GET | paginated list | ⬜ | |
| `/api/v1/billing/invoices/` | POST | 201 with `{SHOP}-INV-{YYYY-MM}-{NNNN}` | ⬜ | |
| `/api/v1/billing/invoices/{id}/payment/` | POST | 201 payment, updated status | ⬜ | |
| `/api/v1/billing/invoices/{id}/pdf/` | GET | signed URL in data | ⬜ | |

#### Layer D — AUTHZ
| Action | Role | Expected | Status | Evidence |
|---|---|---|---|---|
| Create invoice | Viewer | 403 | ⬜ | |
| Tally export | Billing Staff (no `billing.tally_export`) if restricted | 403 | ⬜ | |
| Any billing endpoint | testshop JWT | No demo data | ⬜ | |

#### Layer E — STATE / SIDE-EFFECTS
| Action | DB effect | Status | Evidence |
|---|---|---|---|
| Invoice created | `repair_invoices` + `repair_invoice_items` rows | ⬜ | |
| Payment recorded | `payments` row, invoice outstanding updated | ⬜ | |
| Full payment | `repair_invoices.status = paid` | ⬜ | |
| audit_logs row | on each write | ⬜ | |
| Idempotency-Key on payment | duplicate rejected | ⬜ | |

#### Layer F — LOGGING / OBSERVABILITY
| Scenario | Expected | Status | Evidence |
|---|---|---|---|
| Invoice creation | 201, no Traceback | ⬜ | |
| PDF generation via Celery | worker log shows task + SUCCESS, file in MinIO | ⬜ | |

#### Layer G — INFRA PATH
| Check | Method | Status | Evidence |
|---|---|---|---|
| Requests via PgBouncer | SHOW POOLS | ⬜ | |
| PDF served from MinIO | signed URL resolves to PDF content-type | ⬜ | |

#### Layer H — UX STATES
| State | Where | Status | Evidence |
|---|---|---|---|
| GST split (CGST/SGST/IGST) on invoice | invoice detail | ⬜ | |
| ₹ formatting + partial outstanding | payment history | ⬜ | |
| WhatsApp send confirmation | post-send toast | ⬜ | |
| Loading skeleton on invoice list | first load | ⬜ | |

---

### Module 08 — Commissions
**Spec refs:** `docs/backend-spec/RepairOS-dev-spec/modules/08-commissions.md`, `docs/frontend-spec/RepairOS-frontend-spec/modules/08-commissions-ui.md`  
**Primary role:** Technician (self-view), Manager (payout)  
**Routes:** `/commissions`, `/commissions/payouts`  
**Celery tasks:** `commissions.generate_payout_pdf`  
**Run date:** _(not run)_  
**Overall:** ⬜ NOT RUN

#### Layer A — FLOW
| Journey | Role | Status | Evidence |
|---|---|---|---|
| Technician views own accruals (only own) | tech1 | ⬜ | |
| Manager views all technician accruals | Manager | ⬜ | |
| Create payout — preview matches accruals | Manager | ⬜ | |
| Verify warranty job shows ₹0 commission | Manager | ⬜ | |

#### Layer B — VALIDATION
| Input scenario | Expected error | Status | Evidence |
|---|---|---|---|
| Double-pay same period | 422 BUSINESS_RULE_VIOLATION | ⬜ | |

#### Layer C — CONTRACT / RESPONSE
| Endpoint | Method | Expected envelope | Status | Evidence |
|---|---|---|---|---|
| `/api/v1/commissions/` | GET | list of accruals | ⬜ | |
| `/api/v1/commissions/payouts/` | POST | 201 payout record | ⬜ | |

#### Layer D — AUTHZ
| Action | Role | Expected | Status | Evidence |
|---|---|---|---|---|
| View another technician's commissions | tech1 (no `settings.commission_rules.manage`) | 403 or filtered | ⬜ | |
| Create payout | Technician | 403 | ⬜ | |

#### Layer E — STATE / SIDE-EFFECTS
| Action | DB effect | Status | Evidence |
|---|---|---|---|
| Payout created | `commission_payouts` row, accruals marked paid | ⬜ | |
| audit_logs row | on payout | ⬜ | |

#### Layer F — LOGGING / OBSERVABILITY
| Scenario | Expected | Status | Evidence |
|---|---|---|---|
| `commissions.generate_payout_pdf` | worker SUCCESS, PDF in MinIO | ⬜ | |

#### Layer G — INFRA PATH
| Check | Method | Status | Evidence |
|---|---|---|---|
| Requests via PgBouncer | SHOW POOLS | ⬜ | |
| Payout PDF | MinIO console object | ⬜ | |

#### Layer H — UX STATES
| State | Where | Status | Evidence |
|---|---|---|---|
| Self-view: only own accruals | technician commission screen | ⬜ | |
| ₹ formatting on accruals | accrual list | ⬜ | |

---

### Module 09 — HR & Payroll
**Spec refs:** `docs/backend-spec/RepairOS-dev-spec/modules/09-hr-payroll.md`, `docs/frontend-spec/RepairOS-frontend-spec/modules/09-hr-payroll-ui.md`  
**Primary role:** HR Manager (`hr@demo.com`), Manager  
**Routes:** `/hr/employees`, `/hr/attendance`, `/hr/leave`, `/hr/payroll`  
**Celery tasks:** `hr.generate_salary_pdf`, `hr.send_payroll_reminders`  
**Run date:** _(not run)_  
**Overall:** ⬜ NOT RUN

#### Layer A — FLOW
| Journey | Role | Status | Evidence |
|---|---|---|---|
| View employee list with masked statutory IDs | HR Manager | ⬜ | |
| Mark attendance for an employee | HR Manager | ⬜ | |
| Submit and approve leave request | HR Manager | ⬜ | |
| Generate salary slip for one employee/month | HR Manager | ⬜ | |
| Verify one slip per employee/month enforced | HR Manager | ⬜ | |

#### Layer B — VALIDATION
| Input scenario | Expected error | Status | Evidence |
|---|---|---|---|
| Duplicate salary slip (same employee, same month) | 422 BUSINESS_RULE_VIOLATION | ⬜ | |
| Leave start after end date | 400 VALIDATION_ERROR | ⬜ | |
| Statutory IDs visible in list endpoint | must be masked | ⬜ | |

#### Layer C — CONTRACT / RESPONSE
| Endpoint | Method | Expected envelope | Status | Evidence |
|---|---|---|---|---|
| `/api/v1/hr/employees/` | GET | list (statutory IDs masked) | ⬜ | |
| `/api/v1/hr/salary-slips/` | POST | 201 slip | ⬜ | |
| `/api/v1/hr/leave/` | POST | 201 leave request | ⬜ | |

#### Layer D — AUTHZ
| Action | Role | Expected | Status | Evidence |
|---|---|---|---|---|
| Generate salary | role without `hr.salary.generate` | 403 | ⬜ | |
| View employees | Viewer | 403 | ⬜ | |
| Any HR endpoint | testshop JWT | No demo data | ⬜ | |

#### Layer E — STATE / SIDE-EFFECTS
| Action | DB effect | Status | Evidence |
|---|---|---|---|
| Salary generated | `salary_slips` row | ⬜ | |
| Leave approved | `leave_requests.status = approved`, balance updated | ⬜ | |
| Attendance marked | `attendance_records` row | ⬜ | |

#### Layer F — LOGGING / OBSERVABILITY
| Scenario | Expected | Status | Evidence |
|---|---|---|---|
| `hr.generate_salary_pdf` | worker SUCCESS, PDF in MinIO | ⬜ | |
| `hr.send_payroll_reminders` | worker SUCCESS | ⬜ | |

#### Layer G — INFRA PATH
| Check | Method | Status | Evidence |
|---|---|---|---|
| Requests via PgBouncer | SHOW POOLS | ⬜ | |
| Salary PDF | MinIO console | ⬜ | |

#### Layer H — UX STATES
| State | Where | Status | Evidence |
|---|---|---|---|
| Statutory IDs masked in UI | employee detail | ⬜ | |
| Leave balance updated after approval | leave screen | ⬜ | |
| Loading / empty attendance list | fresh day | ⬜ | |

---

### Module 10 — Finance
**Spec refs:** `docs/backend-spec/RepairOS-dev-spec/modules/10-finance.md`, `docs/frontend-spec/RepairOS-frontend-spec/modules/10-finance-ui.md`  
**Primary role:** Manager, HR Manager  
**Routes:** `/finance/petty-cash`, `/finance/expenses`, `/finance/budgets`, `/finance/assets`  
**Celery tasks:** _(none dedicated)_  
**Run date:** _(not run)_  
**Overall:** ⬜ NOT RUN

#### Layer A — FLOW
| Journey | Role | Status | Evidence |
|---|---|---|---|
| Add petty cash transaction; verify running balance | Manager | ⬜ | |
| Record expense; verify budget actual/variance updates | Manager | ⬜ | |
| Create budget head; allocate budget | Manager | ⬜ | |
| Add asset; update condition; dispose asset | Manager | ⬜ | |

#### Layer B — VALIDATION
| Input scenario | Expected error | Status | Evidence |
|---|---|---|---|
| Expense > budget (over-budget alert) | UI warning surfaced | ⬜ | |
| Petty cash withdrawal > balance | 422 BUSINESS_RULE_VIOLATION | ⬜ | |
| Dispose already-disposed asset | 422 | ⬜ | |

#### Layer C — CONTRACT / RESPONSE
| Endpoint | Method | Expected envelope | Status | Evidence |
|---|---|---|---|---|
| `/api/v1/finance/petty-cash/` | GET | list with running balance | ⬜ | |
| `/api/v1/finance/expenses/` | POST | 201 expense | ⬜ | |
| `/api/v1/finance/assets/` | POST | 201 asset | ⬜ | |

#### Layer D — AUTHZ
| Action | Role | Expected | Status | Evidence |
|---|---|---|---|---|
| Manage petty cash | Viewer | 403 | ⬜ | |
| Any finance endpoint | testshop JWT | No demo data | ⬜ | |

#### Layer E — STATE / SIDE-EFFECTS
| Action | DB effect | Status | Evidence |
|---|---|---|---|
| Petty cash transaction | `petty_cash_transactions` row, running balance updated | ⬜ | |
| Expense created | `expenses` row, `budget_allocations.actual` updated | ⬜ | |
| Asset disposed | `shop_assets.condition = disposed` | ⬜ | |
| audit_logs row | on each write | ⬜ | |

#### Layer F — LOGGING / OBSERVABILITY
| Scenario | Expected | Status | Evidence |
|---|---|---|---|
| Expense creation | 201, no Traceback | ⬜ | |

#### Layer G — INFRA PATH
| Check | Method | Status | Evidence |
|---|---|---|---|
| Requests via PgBouncer | SHOW POOLS | ⬜ | |

#### Layer H — UX STATES
| State | Where | Status | Evidence |
|---|---|---|---|
| Over-budget warning surfaced | expense form | ⬜ | |
| Petty cash immutable ledger (no edit/delete) | petty cash list | ⬜ | |
| Disposed asset hidden from active list | assets list | ⬜ | |
| ₹ formatting on all money fields | throughout | ⬜ | |

---

### Module 11 — Reports
**Spec refs:** `docs/backend-spec/RepairOS-dev-spec/modules/11-reports.md`, `docs/frontend-spec/RepairOS-frontend-spec/modules/11-reports-ui.md`  
**Primary role:** Manager, Admin (Viewer: limited)  
**Routes:** `/reports`, `/reports/revenue`, `/reports/repair`, `/reports/inventory`, `/reports/crm`, `/reports/gst`, `/reports/hr`  
**Celery tasks:** `reports.export_report` (async export)  
**Run date:** _(not run)_  
**Overall:** ⬜ NOT RUN

#### Layer A — FLOW
| Journey | Role | Status | Evidence |
|---|---|---|---|
| View dashboard; all widgets load with seed data | Manager | ⬜ | |
| Filter revenue report by date range + shop | Manager | ⬜ | |
| Trigger async export; download via signed URL | Manager | ⬜ | |
| Verify figures reconcile with source module (spot-check) | Manager | ⬜ | |

#### Layer B — VALIDATION
| Input scenario | Expected error | Status | Evidence |
|---|---|---|---|
| Export with invalid date range | 400 VALIDATION_ERROR | ⬜ | |
| Report access for shop user cannot access | data filtered to own shop | ⬜ | |

#### Layer C — CONTRACT / RESPONSE
| Endpoint | Method | Expected envelope | Status | Evidence |
|---|---|---|---|---|
| `/api/v1/reports/dashboard/` | GET | widget data with meta | ⬜ | |
| `/api/v1/reports/revenue/` | GET | filtered list | ⬜ | |
| `/api/v1/reports/exports/` | POST | 202 task_id | ⬜ | |
| `/api/v1/reports/exports/{id}/` | GET | status + signed URL when done | ⬜ | |

#### Layer D — AUTHZ
| Action | Role | Expected | Status | Evidence |
|---|---|---|---|---|
| View GST report | Viewer (no `reports.gst.view`) | 403 | ⬜ | |
| Any reports endpoint | testshop JWT | No demo data | ⬜ | |

#### Layer E — STATE / SIDE-EFFECTS
| Action | DB effect | Status | Evidence |
|---|---|---|---|
| Export triggered | `export_jobs` row created | ⬜ | |
| Export complete | `export_jobs.status = done`, signed URL populated | ⬜ | |

#### Layer F — LOGGING / OBSERVABILITY
| Scenario | Expected | Status | Evidence |
|---|---|---|---|
| Dashboard load | 200, no Traceback | ⬜ | |
| `reports.export_report` Celery task | worker SUCCESS, file in MinIO | ⬜ | |

#### Layer G — INFRA PATH
| Check | Method | Status | Evidence |
|---|---|---|---|
| Requests via PgBouncer | SHOW POOLS | ⬜ | |
| Export file | MinIO console shows CSV/PDF | ⬜ | |

#### Layer H — UX STATES
| State | Where | Status | Evidence |
|---|---|---|---|
| Dashboard widgets respect shop access | manager vs receptionist view | ⬜ | |
| Export progress (async) | export triggered → polling → download | ⬜ | |
| Empty report (no data in range) | narrow date filter | ⬜ | |

---

### Module 12 — Platform Admin
**Spec refs:** `docs/backend-spec/RepairOS-dev-spec/modules/12-platform-admin.md`, `docs/frontend-spec/RepairOS-frontend-spec/modules/12-platform-admin-ui.md`  
**Primary role:** Platform Admin (separate login, not demo tenant)  
**Routes:** `/platform` (separate subdomain or `/_platform`)  
**Celery tasks:** `master.provision_tenant`  
**Run date:** _(not run)_  
**Overall:** ⬜ NOT RUN

#### Layer A — FLOW
| Journey | Role | Status | Evidence |
|---|---|---|---|
| List tenants in master DB | Platform Admin | ⬜ | |
| View tenant subscription plan + status | Platform Admin | ⬜ | |
| Suspend / reactivate a tenant | Platform Admin | ⬜ | |
| Provision new tenant via API; verify DB created | Platform Admin | ⬜ | |

#### Layer B — VALIDATION
| Input scenario | Expected error | Status | Evidence |
|---|---|---|---|
| Register tenant with duplicate slug | 400 VALIDATION_ERROR | ⬜ | |
| Register without required fields | 400 VALIDATION_ERROR | ⬜ | |

#### Layer C — CONTRACT / RESPONSE
| Endpoint | Method | Expected envelope | Status | Evidence |
|---|---|---|---|---|
| `/api/v1/platform/tenants/` | GET | list from master DB | ⬜ | |
| `/api/v1/platform/tenants/` | POST | 202 provisioning_in_progress | ⬜ | |
| `/api/v1/platform/tenants/{id}/` | GET | tenant detail + plan | ⬜ | |

#### Layer D — AUTHZ
| Action | Role | Expected | Status | Evidence |
|---|---|---|---|---|
| Access platform endpoints | demo tenant admin JWT | 403 | ⬜ | |
| Platform admin cannot see tenant business data | platform admin JWT on `/api/v1/repairs/` | 403 / no data | ⬜ | |

#### Layer E — STATE / SIDE-EFFECTS
| Action | DB effect | Status | Evidence |
|---|---|---|---|
| Tenant provisioned | `tenants` row + `tenant_databases` row in master DB; new PG database exists | ⬜ | |
| Tenant suspended | `tenants.status = suspended` | ⬜ | |
| audit_log_master row | on each write | ⬜ | |

#### Layer F — LOGGING / OBSERVABILITY
| Scenario | Expected | Status | Evidence |
|---|---|---|---|
| `master.provision_tenant` task | worker SUCCESS | ⬜ | |

#### Layer G — INFRA PATH
| Check | Method | Status | Evidence |
|---|---|---|---|
| New tenant DB visible | `docker compose exec postgres psql -U postgres -l` | ⬜ | |
| PgBouncer pool for new tenant | SHOW POOLS after provisioning | ⬜ | |

#### Layer H — UX STATES
| State | Where | Status | Evidence |
|---|---|---|---|
| Provisioning status shown during async provision | platform tenant list | ⬜ | |
| Plan feature flags drive upgrade prompts | starter plan limitations visible | ⬜ | |
| Platform admin: no tenant business data visible | platform UI | ⬜ | |

---

## Baseline Environment Evidence
_Captured: 2026-06-12_

### Docker Compose Service Status

| Service | Status | Port | Notes |
|---|---|---|---|
| postgres | ✅ Up (healthy) | internal | PostgreSQL 16 |
| pgbouncer | ✅ Up (healthy) | 6432 | Fixed stale pidfile by recreating container |
| redis | ✅ Up (healthy) | 6380 | |
| backend | ✅ Up | 8000 | Daphne ASGI; seed_demo completed |
| celery-worker | ✅ Up | — | `pong` confirmed via `inspect ping` |
| celery-beat | ❌ Restarting | — | `django_celery_beat_periodictask` missing from master DB (router issue — see Known Issues) |
| frontend | ✅ Up | 3000 | HTTP 200 |
| minio | ✅ Up (healthy) | 9000/9001 | bucket `repaiross-local` exists |
| mailpit | ✅ Up (healthy) | 8025 | |
| adminer | ✅ Up | 8080 | |

### Seed Data Row Counts (repaiross_tenant_demo)

| Table | Count |
|---|---|
| users | 8 |
| customers | 32 |
| leads | 21 |
| job_tickets | 35 |
| sales | 16 |
| amc_contracts | 7 |
| purchase_orders | 5 |
| inventory_stock | 25 |
| shops | 2 |
| audit_logs | 489 |

### Connectivity Checks

| Check | Result |
|---|---|
| `POST /api/v1/auth/login/` as `admin@demo.com` | ✅ 200 `success:true`, JWT returned |
| `POST /api/v1/auth/login/` as `manager@demo.com` | ✅ 200 `success:true` |
| Frontend `GET http://localhost:3000/` | ✅ 200 |
| MinIO bucket `http://localhost:9000/repaiross-local/` | ✅ 200 |
| Celery worker `inspect ping` | ✅ `pong` — 1 node online |
| PgBouncer SHOW POOLS | ✅ 3 pools: pgbouncer, repaiross_master, repaiross_tenant_demo |
| Backend log on startup | ✅ No unhandled Traceback; seed completed; Daphne listening |

### Tenant Databases

| Tenant slug | Database | Status |
|---|---|---|
| demo | repaiross_tenant_demo | ✅ active |
| testshop | repaiross_tenant_testshop | ✅ active (for cross-tenant authz tests) |
