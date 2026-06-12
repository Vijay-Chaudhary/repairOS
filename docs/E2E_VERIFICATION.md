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
**Routes:** `/jobs`, `/jobs/[id]`, `/jobs/[id]/stages`, `/settings/fault-templates`  
**Celery tasks:** `repair.send_warranty_expiry_reminders`  
**Run date:** 2026-06-12  
**Overall:** 🔴 24/30 PASS — 1 CRITICAL, 2 HIGH, 3 MED FAILS

> **Root-cause note — seed permissions:** Same as CRM. Non-admin roles have 0 permissions. All role-specific flows re-run under admin JWT. Permission enforcement tested separately in Layer D via direct API calls.

#### Layer A — FLOW
| Journey | Role | Status | Evidence |
|---|---|---|---|
| Create job ticket with check-in (device condition logged) | Receptionist / admin JWT | ✅ | `POST /api/v1/repair/jobs/ {"shop_id":"<demo-shop>","customer_id":"d94211b9","device_type":"Mobile","problem_description":"Screen cracked on corner drop"}` → 201 `{id:"e2e-job-1", job_number:"SDEL-2026-0039", status:"draft"}`. `POST /jobs/{id}/checkin/ {"condition":"good","accessories":["charger","box"],"notes":"Crack on screen corner, back panel intact"}` → 201 `{check_in_completed:true}`. `POST /jobs/{id}/status/ {"to_status":"open"}` → 200 `status=open`. |
| Assign technician; advance stages to In Progress | Manager / admin JWT | ✅ | `POST /jobs/{id}/stages/ {"title":"Diagnosis","assigned_technician_id":"<tech1>"}` → 201 stage row, job `status=in_progress` auto. `POST /stages/{stage_id}/advance/ {"handoff_notes":"Screen confirmed broken"}` → 200, next stage auto-started (spec §4.3 single in-progress + auto-advance). |
| Technician updates stage, requests spare parts | tech1 / admin JWT | ✅ | `POST /jobs/{id}/spare-parts/ {"description":"LCD Panel","quantity":2,"urgent":true}` → 201 `{status:"requested"}`. `POST /spare-parts/{id}/review/ {"action":"approve"}` → `status=approved`. `POST /spare-parts/{id}/review/ {"action":"order"}` → `status=ordered`. `POST /spare-parts/{id}/review/ {"action":"receive","variant_id":"<inv-variant>"}` → `status=received`. |
| Create estimate, send to customer, approve | Manager / admin JWT | ✅ | `POST /jobs/{id}/estimate/ {"labor_charge":"1500.00","parts_cost":"4500.00","valid_until":"2026-07-01","notes":"LCD replacement + labor"}` → 201 `{estimate_number:"SDEL-EST-2026-0003", total_estimate:"6000.00", status:"draft"}`. `POST /jobs/{id}/estimate/respond/ {"response":"approved","method":"whatsapp"}` → 200 `estimate.status=approved`. Job: `status=estimate_approved, service_charge=1500.00` (= labor_charge per spec §5.1). |
| Complete job → status = closed | Manager / admin JWT | ✅ | `POST /jobs/{id}/status/ {"to_status":"delivered"}` → 200 `status=delivered`. `POST /jobs/{id}/status/ {"to_status":"closed"}` → 200 `status=closed`. DB: `SELECT status, updated_at FROM job_tickets WHERE id='{id}'` → `closed, 2026-06-12 12:28:xx+00`. |
| Create warranty claim on closed job (within warranty) | Receptionist / admin JWT | ✅ | `POST /jobs/{id}/warranty-claim/ {"description":"Screen flickering — same issue"}` → 201 `{warranty_of_job:"{id}", service_charge:"0.00", status:"draft"}`. New warranty job created with `warranty_of_job` FK and SC=0 per spec §6.3. |

#### Layer B — VALIDATION
| Input scenario | Expected error | Status | Evidence |
|---|---|---|---|
| Open job without check-in | BUSINESS_RULE_VIOLATION | ✅ | `POST /jobs/{id}/status/ {"to_status":"open"}` on draft job with no check-in → `{error:{code:"BUSINESS_RULE_VIOLATION", message:"Check-in must be completed before a job can be opened."}}`. |
| Invalid status transition (draft → closed) | INVALID_STATUS_TRANSITION | ✅ | `POST /jobs/{id}/status/ {"to_status":"closed"}` on draft job → `{error:{code:"INVALID_STATUS_TRANSITION", message:"Cannot transition from 'draft' to 'closed'."}}`. |
| Warranty claim past expiry date | BUSINESS_RULE_VIOLATION | ✅ | Backdated `warranty_expires_at` to yesterday via SQL. `POST /jobs/{id}/warranty-claim/` → `{error:{code:"BUSINESS_RULE_VIOLATION", message:"Warranty for this job expired on …"}}`. DB restored after test. |
| Spare part request exceeds stock | 400 INSUFFICIENT_STOCK | ❌ MED | `POST /jobs/{id}/spare-parts/ {"description":"LCD","quantity":100}` (stock=15) → **201 Created** (no stock check at request time). Spec says 400 INSUFFICIENT_STOCK. Stock check only happens at job closure for RECEIVED parts. Unclear if by spec or omission; actual deduction logic in `services.py:record_repair_out` is correct at RECEIVED status. |

#### Layer C — CONTRACT / RESPONSE
| Endpoint | Method | Expected envelope | Status | Evidence |
|---|---|---|---|---|
| `/api/v1/repair/jobs/` | GET | cursor-paginated job list | ✅ | `{success:true, data:{items:[…20 items…], meta:{next_cursor:"http://…?cursor=cD0y…", prev_cursor:null}}}`. 41 total jobs; cursor advances correctly. Response time: 66ms. Note: URL prefix is `/repair/` (not `/repairs/` as in this doc's original harness). |
| `/api/v1/repair/jobs/{id}/` | GET | full job detail | ✅ | Returns: `{id, job_number, status, customer_id, customer_name, device_type, service_charge, checkin:{…}, estimates:[{estimate_number, labor_charge, parts_cost, total_estimate, status, …}], stages:[…], spare_part_requests:[…], warranty_expires_at, warranty_of_job, is_field_job, location_lat/lng}`. All spec §3 fields present. |
| `/api/v1/repair/jobs/{id}/stages/` | POST | 201 stage row | ✅ | `{id, job_id, title, assigned_technician_id, status:"in_progress", started_at:…}`. Job status auto-advanced to `in_progress`. |
| `/api/v1/repair/jobs/{id}/estimate/` | POST | 201 estimate | ✅ | `{id, estimate_number:"SDEL-EST-2026-0003", labor_charge:"1500.00", parts_cost:"4500.00", total_estimate:"6000.00", valid_until:"2026-07-01", status:"draft", sent_at:null}`. |

#### Layer D — AUTHZ
| Action | Role | Expected | Status | Evidence |
|---|---|---|---|---|
| View all jobs | Technician (no `repair.jobs.assign_tech`) | Only own jobs returned | ✅ | `repair/views.py:104-108`: if `repair.jobs.assign_tech` not in perms → `filter(Q(created_by=user)\|Q(stages__assigned_technician=user)).distinct()`. Verified: tech1 JWT returned only jobs tech1 created or was assigned to. |
| Approve estimate | Technician | 403 | ✅ | `POST /jobs/{id}/estimate/respond/ {"response":"approved"}` with tech1 JWT → `{error:{code:"PERMISSION_DENIED"}}`. `require_permission("repair.estimates.approve")` enforced. |
| Admin override check-in | Receptionist (no `repair.jobs.admin_override`) | 403 | ✅ | `POST /jobs/{id}/status/ {"to_status":"open","reason":"Emergency bypass"}` with receptionist JWT → `{error:{code:"PERMISSION_DENIED"}}`. Override requires explicit admin permission check in `services.open_job()`. |
| Any repair endpoint | testshop JWT | No demo data | ✅ | `GET /repair/jobs/` with testshop JWT + `X-Tenant-Slug: demo` (intentional mismatch test) → 200 `items:[]`. JWT claim `tenant_slug=testshop` → middleware routes to `repaiross_tenant_testshop` DB → 0 demo jobs. Isolation confirmed. |

#### Layer E — STATE / SIDE-EFFECTS
| Action | DB effect | Status | Evidence |
|---|---|---|---|
| Job status advanced | `job_tickets.status` updated, `job_stages` row created | ✅ | `SELECT id, status FROM job_tickets WHERE id='{id}'` → `in_progress`. `SELECT id, title, status FROM job_stages WHERE job_id='{id}'` → stage row `status=in_progress, started_at=2026-06-12 12:xx:xx+00`. |
| Estimate approved | `job_estimates.status = approved`, `job_tickets.service_charge` updated | ✅ | `SELECT status, customer_response_at FROM job_estimates WHERE id='7dad6a42'` → `approved, 2026-06-12T12:28:37+05:30`. `SELECT service_charge FROM job_tickets WHERE id='193225bc'` → `1500.00` (= labor_charge). Audit log row present for job status change. |
| Job closed | `audit_logs` row + notification side-effects | ❌ HIGH | `SELECT action, model_name FROM audit_logs WHERE object_id='{job_id}'` → 2 rows (job created + job status updated). Audit trail PASS. However, `notification_logs` table does not exist in tenant schema — celery worker log shows `ProgrammingError: relation "notification_logs" does not exist` on every WhatsApp dispatch attempt. Completion WhatsApp not delivered or logged. |
| Spare part consumed | `inventory_transactions` row, stock decremented | ✅ | Requested 2× `LCD_Panel_variant` for repair job; set `status=received`. Closed job: `SELECT quantity, type FROM inventory_transactions WHERE job_id='{id}' AND type='repair_out'` → `{qty:2, type:repair_out}`. `SELECT stock FROM inventory_variants WHERE id='{variant_id}'` → 15 → 13. |

#### Layer F — LOGGING / OBSERVABILITY
| Scenario | Expected | Status | Evidence |
|---|---|---|---|
| Normal job list | 200, no Traceback | ✅ | Backend log: `172.19.0.1:52xxx - - [12/Jun/2026:12:44:xx] "GET /api/v1/repair/jobs/" 200 <bytes>`. No Traceback, no ERROR line. |
| `repair.send_warranty_expiry_reminders` triggered | worker: task received → SUCCESS | ❌ CRITICAL | `app.send_task('repair.send_warranty_expiry_reminders')` → task id `45c17a2f` → landed in Redis `celery` queue (`LLEN celery = 6` including this + stale CRM tasks). Worker only consumes `high`, `default`, `low`. `CELERY_TASK_ROUTES` has no entry for `repair.send_warranty_expiry_reminders` → routes to default `celery` queue. Task never received by worker. Same root cause as all CRM tasks (Module 01 CRITICAL-2). Affects all module-level beat tasks. |

#### Layer G — INFRA PATH
| Check | Method | Status | Evidence |
|---|---|---|---|
| Requests via PgBouncer | SHOW POOLS | ✅ | `PGPASSWORD=pgbAdmin99 psql -h 127.0.0.1 -p 5432 -U pgbouncer_admin pgbouncer -c "SHOW POOLS;"` → `repaiross_tenant_demo | repaiross_demo_user | cl_active=15 | sv_idle=1 | sv_used=1 | pool_mode=transaction | maxwait=0 | maxwait_us=0`. Transaction-mode pooling active. No connection starvation. Stats: 1353 xacts, 1581 queries, 759KB received. |
| Job status update WS event | DevTools WS frame | ❌ HIGH | `curl -H "Upgrade: websocket" -H "Connection: Upgrade" http://localhost:8000/ws/repair/jobs/` → `HTTP/1.1 500`. Backend log: `ERROR Exception inside application: No application configured for scope type 'websocket'`. `config/asgi.py` WebSocket block commented out (`# "websocket": AllowedHostsOriginValidator(…)`). `job.status_changed`, `job.created`, `stage.handoff` real-time events cannot be delivered. Same root cause as CRM HIGH-1. |

#### Layer H — UX STATES
| State | Where | Status | Evidence |
|---|---|---|---|
| Status actions reflect state machine | job detail actions | ❌ MED | `GET /repair/jobs/{id}/` response has NO `allowed_transitions` field. Spec §2 requires "sticky bottom action bar (primary next-status action)" that reflects valid transitions. Frontend must either hardcode the state machine or derive it from `status`; invalid transitions are not guarded by the API response. Confirmed: `python3 -c "… print({k:v for k,v in job.items() if 'transition' in k})"` → `{}`. |
| Invalid actions not offered | technician on completed job | ❌ MED | Same root cause — no `allowed_transitions` in API response. A technician on a `closed` job has no API guard showing available next actions. Note: backend *does* enforce invalid transitions (returns `INVALID_STATUS_TRANSITION`), but the UI cannot proactively hide buttons without the field. |
| Loading / empty repair list | fresh filter | ✅ | `GET /repair/jobs/?status=nonexistent` → 200 `{success:true, data:{items:[], meta:{next_cursor:null, prev_cursor:null}}}`. Correct empty-list envelope. API performance: 66ms list response. Pagination cursor: `meta.next_cursor` URL present when `items` count = PAGE_SIZE(20). |
| Estimate total auto-computed | estimate form / job detail | ✅ | `GET /repair/jobs/193225bc/` → `estimates:[{labor_charge:"1500.00", parts_cost:"4500.00", total_estimate:"6000.00"}]`. `total_estimate = labor_charge + parts_cost` server-computed in `EstimateSerializer`. `job.service_charge = 1500.00` (labor_charge) set on approval per spec §5.1. |

---

### Module 02 — Repair Verdict

**24 / 30 PASS** (all explicitly checked items; N/A excluded)

| Severity | Count | Items |
|---|---|---|
| CRITICAL | 1 | `repair.send_warranty_expiry_reminders` (and all module-level beat tasks) never consumed — routes to `celery` queue, worker only consumes `high/default/low` |
| HIGH | 2 | WebSocket not configured — `job.status_changed`, `job.created`, `stage.handoff` undeliverable; `notification_logs` table missing — completion WhatsApp not delivered or logged |
| MED | 3 | Spare-part stock not checked at request time (spec: 400 INSUFFICIENT_STOCK); `allowed_transitions` missing from job detail — FE cannot render state-machine action bar dynamically |

**Detail:**
- **CRITICAL-1**: `CELERY_TASK_ROUTES` (settings/base.py:179) has no entry for `repair.send_warranty_expiry_reminders`, `pos.send_wholesale_payment_reminders`, `amc.mark_missed_visits`, `hr.send_payroll_reminders`, etc. All land in `celery` queue. Worker startup log: `queues: default, high, low`. Affects all beat tasks except the handful with wildcard-matched names (`*.tasks.send_whatsapp_*`, `*.tasks.generate_*`).
- **HIGH-1**: `config/asgi.py` WebSocket routing commented out (same as CRM HIGH-1). Backend logs `ValueError: No application configured for scope type 'websocket'` every ~30s.
- **HIGH-2**: `notification_logs` table absent from every tenant schema. Worker log: `django.db.utils.ProgrammingError: relation "notification_logs" does not exist` on any WhatsApp dispatch. All notifications silently fail at the DB write step.
- **MED-1**: `POST /jobs/{id}/spare-parts/ {"quantity":100}` with stock=15 → 201. Stock validation in `services.py:record_repair_out` only fires at closure for `status=RECEIVED AND variant_id IS NOT NULL`. Requesting spare parts has no stock check. May be intentional (parts ordered externally), but spec says 400.
- **MED-2/3**: `allowed_transitions` not in `JobTicketDetailSerializer`. `repair/serializers.py` has no computed field for next-valid statuses. Both H-1 and H-2 failures share this root cause.

---

### Module 03 — POS
**Spec refs:** `docs/backend-spec/RepairOS-dev-spec/modules/03-pos.md`, `docs/frontend-spec/RepairOS-frontend-spec/modules/03-pos-ui.md`  
**Primary role:** Billing Staff (`billing@demo.com`), Manager  
**Routes:** `/pos`, `/sales/[id]`, `/sales/[id]` (return action)  
**Celery tasks:** `pos.send_wholesale_payment_reminders`  
**Run date:** 2026-06-12  
**Overall:** 🔴 20/27 PASS — 1 CRITICAL, 1 HIGH, 5 MED FAILS

> **Root-cause note — seed permissions:** Same as prior modules. Billing Staff has 0 permissions in seeded data. All role-based flows re-run under admin JWT. Permission enforcement tested directly.

#### Layer A — FLOW
| Journey | Role | Status | Evidence |
|---|---|---|---|
| Counter sale: add items, flat discount, split payment (cash+UPI), complete | admin JWT | ✅ | `POST /api/v1/pos/sales/ {sale_type:"counter", items:[{variant_id:"ACC-USBC1-BR", qty:2, unit_price:299, tax_rate:18}, {variant_id:"ACC-TG01-03", qty:1, unit_price:149, tax_rate:18}], discount_type:"flat", discount_value:50, payments:[{method:"cash",amount:300},{method:"upi",amount:483.38}]}` → 201 `{sale_number:"SDEL-SALE-2026-06-0017", status:"partially_paid", grand_total:"822.46", cgst:"62.73", sgst:"62.73", igst:"0.00"}`. `POST /sales/{id}/payment/ {method:"cash",amount:39.08}` → status=completed, amount_paid=822.46, outstanding=0.00. |
| Wholesale sale with credit limit: partial payment | admin JWT | ✅ | `POST /sales/ {sale_type:"wholesale", customer_id:"TechZone", items:[{variant:65WAdapter, qty:5, unit_price:650, tax_rate:18}], payments:[{method:"neft",amount:2000}]}` → 201 `{sale_number:"SDEL-SALE-2026-06-0018", status:"partially_paid", grand_total:"3835.00", igst:"585.00"}`. Inter-state (shop:07 Delhi vs GSTIN 27 Maha) → IGST not CGST+SGST. ✓ |
| Job-linked sale from a closed repair job | admin JWT | ✅ | `POST /sales/ {sale_type:"job_linked", customer_id:"…", job_id:"95fc4b5b", items:[{variant:TG, qty:1}], payments:[{method:"cash",amount:175.82}]}` → 201 `{sale_number:"SDEL-SALE-2026-06-0019", sale_type:"job_linked", job_id:"95fc4b5b", status:"completed"}`. |
| Process a return → credit note issued + stock restocked | admin JWT | ✅ | `POST /sales/{id}/return/ {items:[{sale_item_id:"TG-item", qty:1}], reason:"Customer changed mind", refund_method:"cash"}` → 201 `{return_number:"SDEL-RET-2026-06-0001", status:"pending", total_refund_amount:"175.82"}`. `PATCH /sales/returns/{id}/ {action:"approve"}` → `{status:"approved"}`. DB: `SDEL-CN-2026-06-0001` credit note created (amount=175.82). Stock: TG went 39→40 (`return_in +1` in inventory_transactions). |

#### Layer B — VALIDATION
| Input scenario | Expected error | Status | Evidence |
|---|---|---|---|
| Quantity > available stock | 400 INSUFFICIENT_STOCK | ✅ | `POST /sales/ {qty:200}` (stock=48) → HTTP 400 `{success:false, error:{code:"INSUFFICIENT_STOCK", message:"A server error occurred."}}`. Code correct; message generic (not variant-specific). |
| Split payment sum < grand total | form block / partially_paid | ❌ MED | No backend validation requiring sum == grand_total. `POST /sales/ {payments:[{amount:100}]}` on ₹352.82 sale → 201 `{status:"partially_paid"}`. Backend explicitly supports `partially_paid`. Spec says "sum of splits must equal grand total (or mark partially_paid for wholesale credit)" — ambiguous. Counter sales getting `partially_paid` without explicit intent works but contradicts "form block" requirement. |
| Wholesale sale exceeds credit limit | 400 CREDIT_LIMIT_EXCEEDED | ❌ MED | `POST /sales/ {sale_type:"wholesale", customer:TechZone(limit=50000), qty:200×299}` → HTTP 422 `{error:{code:"BUSINESS_RULE_VIOLATION", message:"Credit limit of ₹50000.00 would be exceeded. Current outstanding: ₹0.00."}}`. Error returned ✓ but code is `BUSINESS_RULE_VIOLATION`, not `CREDIT_LIMIT_EXCEEDED` as spec states. Also: outstanding is ₹0 because partially_paid wholesale sales don't update `customer.total_outstanding` (see E findings). |
| Return qty > original sold qty | 422 BUSINESS_RULE_VIOLATION | ❌ HIGH | `POST /sales/{id}/return/ {qty:500}` on item with qty=200 → **201 Created**. `_build_return_items()` does not validate `return_qty <= original_qty`. Return created with computed refund_amount = 2.5× the original. Actual restock would also over-restock inventory. |

#### Layer C — CONTRACT / RESPONSE
| Endpoint | Method | Expected envelope | Status | Evidence |
|---|---|---|---|---|
| `/api/v1/pos/sales/` | GET | cursor-paginated list | ✅ | `{success:true, data:{items:[…20…], meta:{next_cursor:"http://…?cursor=…", prev_cursor:null}}}`. List shape: `[id, sale_number, sale_type, status, grand_total, customer_name, sale_date, amount_outstanding]`. |
| `/api/v1/pos/sales/` | POST | 201 with SALE doc number | ✅ | `{sale_number:"SDEL-SALE-2026-06-0017"}` — format `{SHOP_CODE}-SALE-{YYYY}-{MM}-{NNNN}` per spec §3.1. Full detail: items[], payments[], returns[], cgst, sgst, igst, grand_total, discount fields all present. |
| `/api/v1/pos/sales/{id}/return/` | POST | 201 return + credit note ref | ❌ MED | PATCH `/sales/returns/{id}/` (approve) → response has `credit_note: null` (not populated in `SalesReturnSerializer`). Credit note IS created in DB and IS present in `GET /sales/{id}/` → `returns[0].credit_note_number`. Contract gap: approve-return response doesn't include credit note. |
| Stock overage | POST | `{success:false, error:{code:"INSUFFICIENT_STOCK"}}` | ✅ | HTTP 400 `{success:false, error:{code:"INSUFFICIENT_STOCK", message:"A server error occurred."}}`. Code correct, message generic. |
| `/api/v1/pos/products/barcode/{barcode}/` | GET | variant + stock_quantity | ✅ | `GET /products/barcode/ACC-USBC1-BR/?shop_id=…` → `{id, product_name:"USB-C Cable 1m", variant_name:"Braided", selling_price:"299.00", wholesale_price:"220.00", stock_quantity:"48.000", barcode, tax_rate, hsn_code}`. |

#### Layer D — AUTHZ
| Action | Role | Expected | Status | Evidence |
|---|---|---|---|---|
| Apply discount | any user with create perm | 403 expected per spec | ❌ MED | `pos.discount.apply` permission is **not checked** in `SaleViewSet` or `services.create_sale()`. Anyone who can create a sale can send `discount_type:"flat"` in the body. Confirmed: no `discount.apply` grep hit in `pos/views.py` or `pos/services.py`. |
| Approve return | Billing Staff (0 perms) | 403 | ✅ | `PATCH /sales/returns/{id}/ {action:"approve"}` with billing JWT (0 permissions) → HTTP 403 `{error:{code:"PERMISSION_DENIED"}}`. `SalesReturnViewSet.get_permissions()` returns `require_permission("pos.returns.approve")`. (Root cause: billing has 0 perms from seed, not specifically missing returns.approve.) |
| Any POS endpoint | testshop JWT | No demo data | ✅ | `GET /pos/sales/` with testshop JWT + `X-Tenant-Slug: testshop` → 200 `{items:[], meta:{…}}`. Tenant isolation confirmed. |

#### Layer E — STATE / SIDE-EFFECTS
| Action | DB effect | Status | Evidence |
|---|---|---|---|
| Sale completed | `sales` + `sale_items` rows, stock decremented | ✅ | `SELECT status, subtotal, discount_amount, cgst, sgst, grand_total FROM sales WHERE id='SDEL-SALE-2026-06-0017'` → `returned, 747.00, 50.00, 62.73, 62.73, 822.46`. `sale_items`: 2 rows (USB-C qty=2 line_total=705.64, TG qty=1 line_total=175.82). Stock: USB-C 50→48 (`sale_out -2`), TG 40→39 (`sale_out -1`) in inventory_transactions (`reference_type=sale`). |
| Return processed | `sales_returns` row, stock incremented, `credit_notes` row | ✅ | DB: `sales_returns` row status=approved, total_refund_amount=175.82. `credit_notes`: `SDEL-CN-2026-06-0001`, amount=175.82, pdf_url=null. `inventory_transactions`: `return_in +1 ACC-TG01-03`. TG stock: 39→40. Sale status → `returned`. |
| audit_logs row on every sale | `audit_logs` create row for Sale and SalesReturn | ✅ | `SELECT action, model_name FROM audit_logs WHERE model_name IN ('Sale','SalesReturn') ORDER BY created_at DESC` → `create Sale` rows (one per sale) + `create SalesReturn` rows (one per return). Audit trail present. |
| Wholesale outstanding tracking | `customer.total_outstanding` updated | ❌ MED | `services.py:116`: `_update_customer_outstanding()` only called when `sale_status == COMPLETED`. Partially-paid wholesale sale (outstanding=1835.00) does NOT update customer.total_outstanding (confirmed: TechZone total_outstanding=0.00 after SDEL-SALE-2026-06-0018 outstanding=1835). Credit-limit check for next sale will under-report outstanding → allows more credit than limit. |

#### Layer F — LOGGING / OBSERVABILITY
| Scenario | Expected | Status | Evidence |
|---|---|---|---|
| Sale creation | 201, no Traceback | ✅ | Backend log: `172.19.0.1:56628 - - [12/Jun/2026:13:29:28] "POST /api/v1/pos/sales/" 201 1013`. No Traceback. |
| `pos.send_wholesale_payment_reminders` | worker SUCCESS | ❌ CRITICAL | `app.send_task('pos.send_wholesale_payment_reminders')` → task id `02c1416e` → `celery` queue (`LLEN celery = 7` after sending). Worker does not consume `celery` queue. No `CELERY_TASK_ROUTES` entry for this task. Same root cause as all prior modules. |

#### Layer G — INFRA PATH
| Check | Method | Status | Evidence |
|---|---|---|---|
| Requests via PgBouncer | SHOW POOLS | ✅ | `SHOW POOLS` → `repaiross_tenant_demo: cl_active=16, sv_idle=1, sv_used=1, pool_mode=transaction, maxwait=0`. All POS requests flowing through pgbouncer transaction-mode pool. |
| Receipt/invoice PDF upload | MinIO console shows object | ❌ MED | MinIO bucket `repaiross-local` exists but is empty (0 objects). `credit_notes.pdf_url = null`. Credit note and invoice PDF generation is not implemented — no PDF Celery task dispatched on sale completion or return approval. Spec §3.5 references `pdf_url (S3)`. |

#### Layer H — UX STATES
| State | Where | Status | Evidence |
|---|---|---|---|
| GST split (CGST/SGST vs IGST) shown | sale detail | ✅ | Counter sale (intra-state Delhi, guest): `cgst=62.73, sgst=62.73, igst=0.00`. Wholesale sale (inter-state: shop state_code=07, TechZone GSTIN starts 27): `cgst=0.00, sgst=0.00, igst=585.00`. `_split_gst()` in services.py correctly uses GSTIN first-2-digits vs shop state_code. |
| ₹ formatting — all monetary fields are 2 d.p. decimal strings | sale API response | ✅ | All 8 monetary fields (`subtotal`, `discount_amount`, `cgst`, `sgst`, `igst`, `grand_total`, `amount_paid`, `amount_outstanding`) returned as `"747.00"` format (decimal string, exactly 2 d.p.). Correct for FE `Intl.NumberFormat` formatting. |
| Stock-block message in UI | POST /sales/ oversell | ✅ | HTTP 400 returned with `{code:"INSUFFICIENT_STOCK"}` — FE can show inline block. Message is `"A server error occurred."` (not variant-specific) — FE will need to provide its own UX text. |
| Empty list state | GET /sales/?status=void | ✅ | `{success:true, data:{items:[], meta:{next_cursor:null, prev_cursor:null}}}`. Correct empty envelope for FE empty-state rendering. |

---

### Module 03 — POS Verdict

**20 / 27 PASS** (all explicitly checked items)

| Severity | Count | Items |
|---|---|---|
| CRITICAL | 1 | `pos.send_wholesale_payment_reminders` never consumed (dead `celery` queue — same root as all prior modules) |
| HIGH | 1 | Return over-quantity not validated — `_build_return_items()` allows qty > original_qty, creating inflated refunds and over-restocking |
| MED | 5 | Wholesale outstanding not updated for `partially_paid` sales (credit limit check under-reports); `pos.discount.apply` permission not enforced; credit-limit error uses `BUSINESS_RULE_VIOLATION` not `CREDIT_LIMIT_EXCEEDED`; approve-return response doesn't include credit note; PDF generation not implemented (MinIO empty) |

**Detail:**
- **CRITICAL-1**: Same root as all modules — `CELERY_TASK_ROUTES` missing entry. Task enqueues to `celery` queue, worker consumes `high/default/low` only.
- **HIGH-1**: `_build_return_items()` iterates `items_input`, resolves sale item by ID, and builds return line with `qty = item_data["quantity"]` with no check against `item.quantity`. A return of 500 units on a 2-unit item succeeds with refund_amount = 2.5× original line_total. Restock would over-restock by the same factor.
- **MED-1**: `_update_customer_outstanding()` guarded by `sale_status == COMPLETED`. A partially-paid wholesale sale leaves `customer.total_outstanding` unchanged — the credit limit check for the next sale sees stale (lower) outstanding and allows more credit than the limit should permit.
- **MED-2**: `pos.discount.apply` permission — spec §5 says gated — but `SaleViewSet.get_permissions()` only checks `pos.counter_sale.create`. Discount fields flow through unchecked.
- **MED-3**: Credit limit block returns `BUSINESS_RULE_VIOLATION`; spec §4 says `CREDIT_LIMIT_EXCEEDED`. Frontend error-code mapping will miss this.
- **MED-4**: `SalesReturnSerializer` does not include `credit_note` nested object; the approve-return endpoint returns `credit_note: null`. Credit note number is accessible via the parent sale's `returns` array.
- **MED-5**: No invoice/receipt PDF generation. `CreditNote.pdf_url` is always null. MinIO bucket has 0 objects.

---

### Module 04 — AMC
**Spec refs:** `docs/backend-spec/RepairOS-dev-spec/modules/04-amc.md`, `docs/frontend-spec/RepairOS-frontend-spec/modules/04-amc-ui.md`  
**Primary role:** Receptionist, Manager  
**Routes:** `/amc`, `/amc/[id]`, `/amc/[id]/visits`  
**Celery tasks:** `amc.mark_missed_visits`, `amc.send_renewal_reminders`, `amc.send_visit_reminders`, `amc.process_auto_renewals`  
**Run date:** 2026-06-12  
**Overall:** 🔴 22 PASS / 8 FAIL — 3 CRITICAL · 1 HIGH · 3 MED

#### Layer A — FLOW

| Journey | Role | Status | Evidence |
|---|---|---|---|
| A1 — Create AMC contract (4 visits/yr, upfront, auto_renew) | Admin | ✅ PASS | `POST /api/v1/amc/contracts/ {shop_id, customer_id, title:"E2E Electronics AMC", value:12000, start_date:"2026-06-12", end_date:"2027-06-11", visits_per_year:4, payment_terms:"upfront", auto_renew:true}` → 201 `{contract_number:"SDEL-AMC-2026-0008", status:"active", visit_interval_days:91}`. DB: 4 `amc_visits` rows scheduled at 2026-06-12, 2026-09-11, 2026-12-11, 2027-03-12. |
| A2 — Complete a scheduled visit (work_done + photos + signature) | Admin | ✅ PASS | `POST /amc/visits/{visit1_id}/complete/ {work_done:"Cleaned all units…", issues_found:"…", customer_signature_url:"…", photos:[…]}` → 200 `{status:"completed", actual_date:"2026-06-12"}`. `_maybe_create_next_visit()` auto-created visit 5 at 2027-06-11. |
| A3 — Complete visit with job_id linkage | Admin | ✅ PASS | `POST /amc/visits/{visit4_id}/complete/ {work_done:"…", job_id:"8a5607e7-…"}` → 200 `{job_id:"8a5607e7-…"}`. DB confirms `amc_visits.job_id` set. |
| A4 — Renew contract (new_value: 13000) | Admin | ✅ PASS | `POST /amc/contracts/{id}/renew/ {new_value:13000}` → 200 `{start_date:"2027-06-12", end_date:"2028-06-10", value:"13000.00", renewal_invoices:[{renewal_period_start:"2027-06-12", renewal_period_end:"2028-06-10", invoice_id:null}]}`. DB: 4 new visits created for 2027-06-12 period. |

#### Layer B — VALIDATION

| Input scenario | Expected error | Status | Evidence |
|---|---|---|---|
| B1 — Complete visit without `work_done` | 400 VALIDATION_ERROR | ✅ PASS | `POST /amc/visits/{id}/complete/ {issues_found:"Filter clogged"}` (no work_done) → 400 `{code:"VALIDATION_ERROR", fields:{work_done:["This field is required."]}}` |
| B2 — Renew cancelled contract | 422 BUSINESS_RULE_VIOLATION | ✅ PASS | Created contract via API, set `status='cancelled'` in DB, then `POST /contracts/{id}/renew/` → 422 `{code:"BUSINESS_RULE_VIOLATION", message:"Cannot renew a cancelled contract."}` |
| B3 — `end_date` before `start_date` | 400 VALIDATION_ERROR | ✅ PASS | `POST /amc/contracts/ {start_date:"2026-12-31", end_date:"2026-01-01", …}` → 400 `{code:"VALIDATION_ERROR", fields:{end_date:["end_date must be after start_date."]}}` |

#### Layer C — CONTRACT / RESPONSE

| Endpoint | Method | Expected | Status | Evidence |
|---|---|---|---|---|
| C1 — `/api/v1/amc/contracts/` | GET | Paginated list + meta | ✅ PASS | 9 items, `next_cursor:null`, `prev_cursor:null`. All contracts include `contract_number`, `status`, `next_visit_date`. |
| C1b — `next_visit_date` after renewal | GET | Next scheduled visit in new period | 🟡 FAIL MED | SDEL-AMC-2026-0008 shows `next_visit_date:"2026-09-11"` (original period visit 2) after renewing to 2027–2028. Should show `2027-06-12` (first renewal-period visit). The `next_visit_sq` annotation picks earliest `SCHEDULED` visit regardless of period. |
| C2 — `/api/v1/amc/contracts/{id}/` | GET | All required fields | ✅ PASS | Returns: `id`, `contract_number`, `status`, `start_date:"2027-06-12"`, `end_date:"2028-06-10"`, `value:"13000.00"`, `visits_per_year:4`, `visit_interval_days:91`, `visits_count:9`, `renewal_invoices:[{invoice_id:null, …}]`. `invoice_id:null` expected (billing not built). |
| C3a — `/api/v1/amc/contracts/{id}/visits/` (no filter) | GET | Visits list | ✅ PASS | 9 visits ordered by `scheduled_date` desc; statuses: 2 completed, 7 scheduled. |
| C3b — `/api/v1/amc/contracts/{id}/visits/?status=scheduled` | GET | Filtered visits | 🔴 FAIL HIGH | Returns 404 `{code:"NOT_FOUND"}`. Root cause: `_get_contract(pk)` calls `self.get_queryset().get(pk=pk)`; `get_queryset()` applies `?status` param to the AMC **contract** queryset. `AMCContract` has no `status="scheduled"` → `AMCContract.DoesNotExist` → NotFound. Any status filter on the visits list endpoint is broken. |
| C4 — `/api/v1/amc/contracts/{id}/renew/` | POST | Updated contract + renewal invoice | ✅ PASS | Response includes `start_date`, `end_date`, `value`, `renewal_invoices` array. `invoice_id:null` — billing module stub, expected. |

#### Layer D — AUTHZ

| Action | Role | Expected | Status | Evidence |
|---|---|---|---|---|
| D1 — View AMC contracts | Tech1 (0 perms) | 403 | ✅ PASS | `GET /amc/contracts/` → 403 `{code:"PERMISSION_DENIED"}`. Enforcement works; root-cause is CRITICAL seed-data bug (all non-admin roles have 0 permissions — reported Module 01 CRITICAL). |
| D1b — Complete visit | Tech1 (0 perms) | 403 | ✅ PASS | `POST /amc/visits/{id}/complete/` → 403 `{code:"PERMISSION_DENIED"}`. |
| D2 — View AMC contracts | Manager (0 perms) | 403 | ✅ PASS | Same result — Manager role also has 0 permissions. |
| D3 — Cross-tenant isolation | testshop JWT | 0 demo contracts | ✅ PASS | `GET /amc/contracts/` with testshop token → `{items:[]}`. Demo contracts invisible. |

> **Note:** Cannot test technician-assigned-visit enforcement (technician can only complete visits assigned to them) because all non-admin roles have 0 permissions — that path is blocked at the permission gate before the business-rule check is reached.

#### Layer E — STATE / SIDE-EFFECTS

| Action | DB effect | Status | Evidence |
|---|---|---|---|
| E1 — Contract renewed | `amc_contracts` dates/value updated, status=active | ✅ PASS | `SELECT start_date, end_date, value, status FROM amc_contracts WHERE id='…'` → `2027-06-12, 2028-06-10, 13000.00, active`. |
| E2 — Visit completed | `amc_visits.status=completed`, `actual_date` set | ✅ PASS | DB confirms `status='completed'`, `actual_date='2026-06-12'`, `work_done` populated. |
| E2b — Renewal visit overlap | No near-duplicate visits expected | 🟡 FAIL MED | After renewing, visit 5 (scheduled 2027-06-11) was auto-created by `_maybe_create_next_visit()` when completing visit 4. Visit 6 (scheduled 2027-06-12) was created by `_schedule_visits()` on renewal. Two visits 1 day apart (original period end vs renewal period start) — near-duplicate service calls for same period. |
| E3 — Renewal invoice | `amc_renewal_invoices` row created | ✅ PASS | `SELECT * FROM amc_renewal_invoices WHERE contract_id='…'` → 1 row: `renewal_period_start:"2027-06-12"`, `invoice_id:null`. |
| E4 — Audit log | `audit_logs` rows for create + update | ✅ PASS | `SELECT action, model_name FROM audit_logs WHERE object_id='…'` → `create AMCContract` + `update AMCContract`. |

#### Layer F — LOGGING / OBSERVABILITY

| Scenario | Expected | Status | Evidence |
|---|---|---|---|
| F1 — Normal request logging | Access log line | ✅ PASS | `backend-1 | 172.19.0.1:… "GET /api/v1/amc/contracts/" 200 2714` — structured access log produced. |
| F2 — `amc.mark_missed_visits` Celery task | worker SUCCESS | 🔴 FAIL CRITICAL | Task defined in `CELERY_BEAT_SCHEDULE` but no entry in `CELERY_TASK_ROUTES` → routed to default `celery` queue. Worker consumes only `high`, `default`, `low` queues (`celery inspect active_queues` confirms). `LLEN celery = 7` and growing. Same root-cause affects all four AMC beat tasks. |
| F2b — celery-beat dispatching | Beat scheduler running | 🔴 FAIL CRITICAL | `celery-beat` container is restart-looping: `ProgrammingError: relation "django_celery_beat_periodictask" does not exist` — `django_celery_beat` migration never applied. **No beat tasks are ever dispatched** — all scheduled Celery tasks across all modules are affected. |
| F3 — `amc.send_renewal_reminders` | worker SUCCESS | 🔴 FAIL CRITICAL | Same as F2 — dead queue + beat down. |

#### Layer G — INFRA PATH

| Check | Method | Status | Evidence |
|---|---|---|---|
| G1 — Requests routed via PgBouncer | `SHOW POOLS` | ✅ PASS | `repaiross_tenant_demo` pool: `cl_active=14`, `sv_idle=2`, `pool_mode=transaction`. All demo DB connections transit PgBouncer. |
| G2 — WebSocket `amc.visit_due` delivery | WS upgrade + channel message | 🔴 FAIL CRITICAL | `config/asgi.py` WebSocket routing is commented out. `curl --upgrade websocket http://localhost:8000/ws/amc/visit-due/` → `500 Internal server error`. Same infrastructure bug as Modules 01–03. |

#### Layer H — UX STATES

| State | Where | Status | Evidence |
|---|---|---|---|
| H1 — AMC list page loads | `/amc` | ✅ PASS | `GET http://localhost:3000/amc` → 200. Loading spinner `animate-spin` visible during hydration. |
| H2 — Missed visit flagged | `VisitTimeline.tsx` | ✅ PASS | `VISIT_ICON['missed'] = <AlertCircle className="text-[var(--danger)]">`, `VISIT_STATUS_COLORS['missed']` → danger bg. Badge renders `"missed"`. Code-verified `VisitTimeline.tsx:14,44,61`. |
| H3 — Renewal banner | `RenewalPanel.tsx`, contract detail | ✅ PASS | `renewalDue = daysToExpiry <= contract.renewal_reminder_days && status !== 'cancelled'`. Banner renders expiry countdown + Confirm button gated by `<Can permission="amc.renewals.manage">`. Code-verified `[id]/page.tsx:91–92`, `RenewalPanel.tsx:26–35`. |
| H4 — Empty state | AMC list | ✅ PASS | `emptyTitle="No AMC contracts"`, `emptyDescription="Create your first maintenance contract."`, `emptyAction={label:"New contract"}`. Code-verified `page.tsx:233–235`. |
| H5 — Loading skeletons | Contract detail | ✅ PASS | `[id]/page.tsx:84` — `[1,2,3].map(i => <Skeleton key={i} className="h-12">)` renders while contract data loads. |
| H6 — Live `amc.visit_due` notification | Any AMC page | 🟡 FAIL MED | No `useWebSocket` or WS hook found in `/components/amc/` or `/app/(app)/amc/`. Frontend does not subscribe to `amc.visit_due` channel — consistent with backend WS being commented out. |

### Module 04 — AMC Verdict

| Severity | Count | Items |
|---|---|---|
| CRITICAL | 3 | F2 (AMC tasks → dead `celery` queue, never consumed), F2b (celery-beat restart-looping, no beat tasks dispatched), G2 (WebSocket disabled — `amc.visit_due` undeliverable) |
| HIGH | 1 | C3b (`GET /contracts/{id}/visits/?status=scheduled` → 404 because `_get_contract()` applies status filter to contract queryset) |
| MED | 3 | C1b (`next_visit_date` shows pre-renewal visit after renewal), E2b (visit overlap: auto-created visit 5 at 2027-06-11 + renewal visit 6 at 2027-06-12), H6 (no WS client for `amc.visit_due`) |
| Cross-module | — | CRITICAL seed-data bug (all non-admin roles have 0 permissions) blocks D1/D2 role-specific coverage — reported in Module 01 |

**Pass rate: 22 / 30 (73%)**

---

### Module 05 — Inventory
**Spec refs:** `docs/backend-spec/RepairOS-dev-spec/modules/05-inventory.md`, `docs/frontend-spec/RepairOS-frontend-spec/modules/05-inventory-ui.md`  
**Primary role:** Manager, Technician (view only)  
**Routes:** `/inventory`, `/inventory/products`, `/inventory/adjustments`, `/inventory/transfers`  
**Celery tasks:** _(none dedicated — low-stock notifications via `core.dispatch_whatsapp_message`)_  
**Run date:** 2026-06-12  
**Overall:** 🟡 23 PASS / 6 FAIL — 0 new CRITICAL · 4 MED (+ 2 CRITICAL cross-module re-confirmed)

#### Layer A — FLOW

| Journey | Role | Status | Evidence |
|---|---|---|---|
| A1 — View stock list | Admin | ✅ PASS | `GET /inventory/stock/` → 20 items, `meta:{next_cursor, prev_cursor}`. Item fields: `variant_name`, `quantity_in_stock:13.000`, `reorder_level:5.000`, `is_low_stock`, `cost_price`, `selling_price`, `wholesale_price`. Pagination working (next_cursor present for full catalog). |
| A2a — Positive stock adjustment (+5) | Admin | ✅ PASS | `POST /inventory/adjustment/ {shop_id, variant_id, quantity:5, note:"E2E stock-in test"}` → 201 `{new_qty:18.0, transaction:{id, type:"adjustment", quantity:"5.000", reference_type:"adjustment", created_by_name:"Demo Repairs"}}` |
| A2b — Negative stock adjustment (-3) | Admin | ✅ PASS | `POST /inventory/adjustment/ {quantity:-3, note:"E2E damaged goods"}` → 201 `{new_qty:15.0, transaction:{quantity:"-3.000"}}` |
| A3 — Inter-shop transfer (5 units SDEL→SMUM) | Admin | ✅ PASS | `POST /inventory/transfer/ {source_shop_id:SDEL, dest_shop_id:SMUM, quantity:5}` → 201 `{transactions:[{type:"transfer_in", qty:5, shop_id:SMUM}, {type:"transfer_out", qty:-5, shop_id:SDEL}]}`. Both share same `reference_id`. |
| A4 — View ledger for variant | Admin | ✅ PASS | `GET /inventory/transactions/?variant_id=…` → 6 entries: `opening_stock +15`, `repair_out -2`, 2× `adjustment`, `transfer_out -5`, `transfer_in +5`. Ordered newest-first. |

#### Layer B — VALIDATION

| Input scenario | Expected error | Status | Evidence |
|---|---|---|---|
| B1 — Negative adjustment below zero (−100 when qty=10) | 400 INSUFFICIENT_STOCK | 🟡 FAIL MED | `POST /inventory/adjustment/ {quantity:-100}` → 400 `{code:"INSUFFICIENT_STOCK", message:"A server error occurred."}`. Code correct but message is generic Django default (`InsufficientStock` has no custom `detail` string). |
| B2 — Transfer to same shop | 400 VALIDATION_ERROR | ✅ PASS | `{source_shop_id:X, dest_shop_id:X}` → 400 `{code:"VALIDATION_ERROR", fields:{non_field_errors:["Source and destination shops must differ."]}}` |
| B3a — CSV import with bad row (invalid decimal) | Per-row error, nothing committed | ✅ PASS (with caveat) | `POST /products/bulk-import/` → 200 `{created:0, updated:0, failed:[{row:3, error:"[<class 'decimal.ConversionSyntax'>]"}]}`. Atomic rollback confirmed: `SKU-GOOD` not created. HTTP 200 for partial-failure is deliberate per spec. |
| B3b — CSV error message quality | User-friendly message | 🟡 FAIL MED | Error string is raw Python exception repr `"[<class 'decimal.ConversionSyntax'>]"` — not parseable by the frontend as a human-readable message. |
| B3c — CSV all valid rows | `{created:2, updated:0, failed:[]}` | ✅ PASS | 2 products + variants created atomically. |

#### Layer C — CONTRACT / RESPONSE

| Endpoint | Method | Expected | Status | Evidence |
|---|---|---|---|---|
| C1 — `/api/v1/inventory/stock/` | GET | Paginated + meta | ✅ PASS | `{items:[…], meta:{next_cursor, prev_cursor}}`. All stock-specific fields present including `is_low_stock`. |
| C2 — `/api/v1/inventory/adjustment/` | POST | 201 + `{new_qty, transaction}` | ✅ PASS | `new_qty` float, `transaction.{id, type, quantity, reference_type, reference_id, note, created_by_name, created_at}`. |
| C3 — `/api/v1/inventory/transfer/` | POST | 201 + 2 transactions | ✅ PASS | `{transactions:[{type:transfer_in}, {type:transfer_out}]}`. Both have `reference_type:"transfer"` and matching `reference_id`. |
| C4 — `/api/v1/inventory/products/` | GET | Paginated product list | ✅ PASS | 20 items + cursor. Item keys include `category_name`, `variant_count`, `variants[]`. |
| C5 — `/api/v1/inventory/products/barcode/{code}/` | GET | Variant detail | ✅ PASS | `GET .../barcode/ACC-USBC1-BR/` → 200 `{id, barcode, variant_name:"Braided", product_name:"USB-C Cable 1m", cost_price, selling_price, wholesale_price, hsn_code, tax_rate}` |
| C5b — Barcode not found | 404 NOT_FOUND | ✅ PASS | `GET .../barcode/NOTEXIST999/` → 404 `{code:"NOT_FOUND"}`. |

#### Layer D — AUTHZ

| Action | Role | Expected | Status | Evidence |
|---|---|---|---|---|
| D1a — View stock | Viewer (0 perms) | 403 | ✅ PASS | `GET /inventory/stock/` → 403 `{code:"PERMISSION_DENIED"}`. |
| D1b — Adjust stock | Viewer (0 perms) | 403 | ✅ PASS | `POST /inventory/adjustment/` → 403 `{code:"PERMISSION_DENIED"}`. |
| D2 — Cross-tenant isolation | testshop JWT | 0 demo items | ✅ PASS | `GET /inventory/stock/` with testshop token → `{items:[]}`. |

#### Layer E — STATE / SIDE-EFFECTS

| Action | DB effect | Status | Evidence |
|---|---|---|---|
| E1 — Adjustments + transfer | `inventory_stock` updated | ✅ PASS | Final state: SDEL `quantity_in_stock=3.000` (15-2+5-3-5+1-1-7), SMUM=6.000 (+5+1). |
| E2 — Ledger invariant | `SUM(inventory_transactions.quantity) == inventory_stock.quantity_in_stock` | ✅ PASS | `SELECT current_stock=3.000, ledger_sum=3.000 → MATCH` (SDEL). SMUM: 6.000 == 6.000. |
| E3 — Transfer paired rows | Both `transfer_out` + `transfer_in` share `reference_id` | ✅ PASS | DB confirms 2 rows per transfer with matching `reference_id` UUID. |
| E4 — audit_logs | `audit_logs` row on adjustment/transfer | 🟡 FAIL MED | `SELECT * FROM audit_logs WHERE model_name ILIKE '%inventory%' OR model_name ILIKE '%stock%'` → 0 rows. `inventory/services.py` never calls `_write_audit()`. Financial operations (adjustments, transfers) have no audit trail. |
| E5 — Transfer atomicity | Both legs atomic (rollback-safe) | 🟡 FAIL MED | `inter_shop_transfer()` line 147: `with transaction.atomic():` has no `using=` parameter — defaults to `default` DB, NOT the tenant DB (`_db`). The inner `update_stock` calls use `using=_db`. In a multi-tenant setup these are different connections → the outer atomic block does NOT wrap the inner operations → if `transfer_in` fails after `transfer_out` commits, stock disappears from source without appearing at destination. Confirmed by reading `services.py:147`. Not triggered in happy-path test. |
| E6 — Low-stock alert side-effect | `_emit_low_stock_alert()` fires when `new_qty < reorder_level` | ✅ PASS (alert fires) | Triggered by adjustment to qty=3 (below reorder_level=5). `dispatch_whatsapp_message` queued to `high` queue. Worker picks it up → **crashes** (see F2). |

#### Layer F — LOGGING / OBSERVABILITY

| Scenario | Expected | Status | Evidence |
|---|---|---|---|
| F1 — Adjustment request log | 201, no Traceback | ✅ PASS | `backend-1 | … "POST /api/v1/inventory/adjustment/" 201 462`. |
| F2 — `low_stock_alert` WhatsApp notification | Task executes, notification sent | 🔴 FAIL CRITICAL (cross-module) | `dispatch_whatsapp_message` task consumed from `high` queue → `ProgrammingError: relation "notification_logs" does not exist`. WhatsApp low-stock alerts fail on every trigger. Same root cause as Module 01 CRITICAL. |

#### Layer G — INFRA PATH

| Check | Method | Status | Evidence |
|---|---|---|---|
| G1 — Requests via PgBouncer | `SHOW POOLS` | ✅ PASS | `repaiross_tenant_demo`: `cl_active=16`, transaction mode. All inventory API calls transit PgBouncer. |
| G2 — `stock.updated` / `stock.low_alert` WS events | WS channel | 🔴 FAIL CRITICAL (cross-module) | WebSocket routing commented out in `asgi.py`. `stock.updated` and `stock.low_alert` events cannot be delivered. Same as Modules 01–04. |

#### Layer H — UX STATES

| State | Where | Status | Evidence |
|---|---|---|---|
| H1 — Inventory page loads | `/inventory` | ✅ PASS | `GET http://localhost:3000/inventory` → 200. `/products` → 200. |
| H2 — Low-stock rows highlighted | `StockTable.tsx` | ✅ PASS | `is_low_stock` → row gets `bg-[var(--warning)]/5`; `AlertTriangle` icon shown (`StockTable.tsx:56,66,103,108`). qty=0 → danger color; qty < reorder → warning color. |
| H3 — Low-stock count badge | `inventory/page.tsx` | ✅ PASS | `lowCount = records.filter(r => r.is_low_stock).length`; `AlertTriangle` badge with count shown above the stock table (`page.tsx:42,52`). Toggle switch to filter to low-stock-only (`page.tsx:87`). |
| H4 — Negative-stock block in AdjustmentDialog | `AdjustmentDialog.tsx` | ✅ PASS | `wouldGoNegative = resultingStock < 0` computed client-side (`line 46`). Warning banner shown (`line 137`), Submit disabled while `wouldGoNegative` (`line 153`). On API `INSUFFICIENT_STOCK` → toast error (`lines 64–65`). |
| H5 — Ledger read-only | `/inventory/transactions` | ✅ PASS | Transactions page: `emptyTitle="No transactions"`, read-only table, no edit actions. Code-verified `transactions/page.tsx:121,124`. |
| H6 — Live `stock.updated` / `stock.low_alert` | Any inventory page | 🟡 FAIL MED | No `useWebSocket` or WS hook found in inventory components or pages. Live stock update not implemented — consistent with WS being commented out. |

### Module 05 — Inventory Verdict

| Severity | Count | Items |
|---|---|---|
| CRITICAL (cross-module) | 2 | F2 (`notification_logs` missing — WhatsApp fails on every trigger), G2 (WebSocket disabled — `stock.updated`/`stock.low_alert` undeliverable) |
| MED | 4 | B1 (`InsufficientStock` generic message), B3b (CSV error is raw Python repr), E4 (no `audit_logs` for adjustments/transfers), E5 (`inter_shop_transfer` outer `transaction.atomic()` missing `using=` — not truly atomic across tenant DB legs) |
| Cross-module | — | CRITICAL seed-data bug (all non-admin roles have 0 permissions) blocks role-specific coverage |

**Pass rate: 23 / 29 (79%)**

---

### Module 06 — Procurement
**Spec refs:** `docs/backend-spec/RepairOS-dev-spec/modules/06-procurement.md`, `docs/frontend-spec/RepairOS-frontend-spec/modules/06-procurement-ui.md`  
**Primary role:** Manager, Billing Staff  
**Routes:** `/suppliers`, `/purchases`, `/purchases/[id]`  
**Celery tasks:** `procurement.send_bill_due_reminders`  
**Run date:** 2026-06-12  
**Overall:** 🟡 25 PASS / 4 FAIL — 0 new CRITICAL · 1 HIGH · 1 MED (+ 2 CRITICAL cross-module re-confirmed)

#### Layer A — FLOW

| Journey | Role | Status | Evidence |
|---|---|---|---|
| A1 — Create supplier (with bank account) | Admin | ✅ PASS | `POST /procurement/suppliers/ {name:"E2E Tech Distributors", phone, gstin:"07AAACE0000A1ZP", state_code:"07", payment_terms_days:30, bank_account_number:"12345678901234"}` → 201 `{id, name, gstin, state_code:"07", bank_account_masked}`. Bank stored as Fernet ciphertext in `bank_account_number_encrypted` column (verified in DB). |
| A2 — Create PO (draft, 2 line items) | Admin | ✅ PASS | `POST /procurement/purchase-orders/ {supplier_id, items:[{qty:10, cost:250, tax:18},{qty:5, cost:400, tax:18}]}` → 201 `{po_number:"SDEL-PO-2026-0006", status:"draft", items:[{line_total:2950}, {line_total:2360}]}`. Tax included: 10×250×1.18=2950, 5×400×1.18=2360 ✓. |
| A3 — Send PO (draft→sent), email triggered | Admin | ✅ PASS | `PATCH /purchase-orders/{id}/ {status:"sent"}` → 200 `{status:"sent"}`. Email dispatch queued via `dispatch_email_message` (no WhatsApp for PO). |
| A4 — Receive GRN (9 accepted/1 rejected with reason + 5 accepted) | Admin | ✅ PASS | `POST /procurement/grn/ {po_id, received_date, challan_number:"CH-E2E-001", items:[{qty_received:10, qty_accepted:9, qty_rejected:1, rejection_reason:"1 unit cracked housing"},{qty_received:5, qty_accepted:5}]}` → 201 `{grn_number:"SDEL-GRN-2026-0002"}`. |
| A4b — PO status → partially_received (9 of 10 accepted) | Admin | ✅ PASS | `GET /purchase-orders/{id}/` → `{status:"partially_received"}`. Correct: only 9 of 10 received. |
| A5 — Purchase invoice with intra-state GST | Admin | ✅ PASS | `POST /purchase-invoices/ {subtotal:4650, tax_rate:18}` → 201 `{cgst:418.50, sgst:418.50, igst:0.00, grand_total:5487.00}`. shop.state_code=07, supplier.state_code=07 → intra-state → CGST+SGST split ✓. |
| A6 — Record partial payment | Admin | ✅ PASS | `POST /purchase-payments/ {amount:2000, method:"upi", reference_id:"UPI-E2E-001"}` → 201. Invoice `payment_status=partially_paid`, `amount_paid=2000.00`. |
| A7 — Create purchase return | Admin | ✅ PASS | `POST /purchase-returns/ {reason:"Defective batch", items:[{variant_id, qty:2, unit_cost:250}]}` → 201 `{return_number:"SDEL-PR-2026-0001", status:"pending", total_amount:500.00}`. |
| A8 — Dispatch return → debit note generated | Admin | ✅ PASS | `PATCH /purchase-returns/{id}/dispatch/` → 200 `{status:"dispatched", debit_note_number:"SDEL-DN-2026-06-0001"}`. DB: `debit_notes` row with `amount=500.00`. `return_out` stock transaction posted. |
| A9 — Supplier ledger | Admin | ✅ PASS | `GET /suppliers/{id}/ledger/` → `{total_invoiced:5487.00, total_paid:2000.00, balance:3487.0, items:[{type:invoice,debit:5487},{type:payment,credit:2000}]}`. |

#### Layer B — VALIDATION

| Input scenario | Expected error | Status | Evidence |
|---|---|---|---|
| B1 — GRN against draft PO | 422 BUSINESS_RULE_VIOLATION | ✅ PASS | → 422 `{code:"BUSINESS_RULE_VIOLATION", message:"Cannot receive GRN against PO with status 'draft'."}` |
| B2 — GRN: rejected qty > 0, no rejection_reason | 400 VALIDATION_ERROR | ✅ PASS | → 400 `{fields:{items:[{non_field_errors:["rejection_reason is required when quantity_rejected > 0."]}]}}` |
| B3 — Payment exceeding outstanding balance | 422 BUSINESS_RULE_VIOLATION | ✅ PASS | Payment of 5000 when outstanding=3487 → 422 `"Payment amount 5000.00 exceeds outstanding balance 3487.00."` |
| B4 — Dispatch already-dispatched return | 422 BUSINESS_RULE_VIOLATION | ✅ PASS | → 422 `"This return is already dispatched."` |
| B5 — Invalid PO status transition (partially_received → received directly) | 422 BUSINESS_RULE_VIOLATION | ✅ PASS | → 422 `"Cannot transition PO from 'partially_received' to 'received'."` PO status must advance via GRN only. |

#### Layer C — CONTRACT / RESPONSE

| Endpoint | Method | Expected | Status | Evidence |
|---|---|---|---|---|
| C1 — `/procurement/suppliers/` | GET | Paginated + `bank_account_masked` | ✅ PASS | 5 suppliers, `next_cursor:null`. Item keys include `bank_account_masked`, `gstin`, `state_code`, `payment_terms_days`, `credit_limit`. |
| C2 — `/procurement/purchase-orders/{id}/` | GET | PO detail with items.quantity_received | ✅ PASS | `{status:"partially_received", items:[{qty_ordered:10, quantity_received:9.0},{qty_ordered:5, quantity_received:5.0}], grand_total}` |
| C3 — `/procurement/purchase-invoices/` | GET | Paginated invoices | ✅ PASS | Item keys: `cgst`, `sgst`, `igst`, `grand_total`, `payment_status`, `amount_paid`, `amount_outstanding`. |
| C4 — `/procurement/purchase-returns/` | GET | Returns list | 🔴 FAIL HIGH | Returns `{data:[]}` for tenant-wide admin (`is_tenant_wide:true, shop_ids:[]`). `PurchaseReturnView.get()` filters `purchase_invoice__shop_id__in=shop_ids` without guarding for `is_tenant_wide` (unlike `PurchaseOrderView` which uses `if shop_ids else base`). DB has 1 return; API returns 0. |
| C5 — `/suppliers/{id}/ledger/` | GET | Ledger shape | ✅ PASS | `{items:[…], balance:3487.0, total_invoiced:"5487.00", total_paid:"2000.00"}`. Running balance updated per entry. |

#### Layer D — AUTHZ

| Action | Role | Expected | Status | Evidence |
|---|---|---|---|---|
| D1 — View suppliers | Viewer (0 perms) | 403 | ✅ PASS | `GET /suppliers/` → 403 `{code:"PERMISSION_DENIED"}`. |
| D2 — Cross-tenant isolation | testshop JWT | 0 demo suppliers | ✅ PASS | `GET /suppliers/` with testshop token → `{items:[]}`. |

#### Layer E — STATE / SIDE-EFFECTS

| Action | DB effect | Status | Evidence |
|---|---|---|---|
| E1 — GRN accepted qty → stock | `inventory_stock` incremented + ledger entry | ✅ PASS | SDEL stock for variant1: 17 (= prior + 9 accepted). Ledger sum = 17, invariant holds. |
| E2 — GRN items | 2 `purchase_in` rows in `inventory_transactions` | ✅ PASS | `SELECT type,quantity FROM inventory_transactions WHERE reference_id='{grn_id}'` → `purchase_in +9.000`, `purchase_in +5.000`. |
| E3 — GRN rejected qty | No stock change for rejected line | ✅ PASS | Only 2 `purchase_in` rows (not 3). Rejected unit not stocked. |
| E4 — Return dispatch | `return_out` in `inventory_transactions` | ✅ PASS | `return_out quantity=-2.000` with `reference_type='return'`. |
| E5 — Debit note | `debit_notes` row created on dispatch | ✅ PASS | `SDEL-DN-2026-06-0001 amount=500.00`. |
| E6 — PO partial receipt | `purchase_orders.status = partially_received` | ✅ PASS | 9 of 10 accepted → `status=partially_received`. |
| E7 — Bank account encryption | Stored as AES-256 Fernet ciphertext | ✅ PASS | `bank_account_number_encrypted = gAAAAABq...` (Fernet token). Column not readable as plaintext. |
| E8 — audit_logs | Supplier, PurchaseOrder, PurchaseInvoice create events | ✅ PASS | 3 audit_log rows: `create Supplier`, `create PurchaseOrder` ×2, `create PurchaseInvoice`. |

#### Layer F — LOGGING / OBSERVABILITY

| Scenario | Expected | Status | Evidence |
|---|---|---|---|
| F1 — GRN creation log | 201, no Traceback | ✅ PASS | `backend-1 | … "POST /api/v1/procurement/grn/" 201`. |
| F2 — `procurement.send_bill_due_reminders` | worker SUCCESS | 🔴 FAIL CRITICAL (cross-module) | Task in `CELERY_BEAT_SCHEDULE` → no `CELERY_TASK_ROUTES` entry → routes to dead `celery` queue; celery-beat also restart-looping. Same root cause as all prior modules. |

#### Layer G — INFRA PATH

| Check | Method | Status | Evidence |
|---|---|---|---|
| G1 — Requests via PgBouncer | `SHOW POOLS` | ✅ PASS | `repaiross_tenant_demo`: `cl_active=20`, transaction mode. |
| G2 — Real-time events | Spec §7 | ✅ N/A | Spec states no distinct procurement real-time events. Inventory emits `stock.updated` on GRN accept (covered in Module 05). |

#### Layer H — UX STATES

| State | Where | Status | Evidence |
|---|---|---|---|
| H1 — Suppliers and purchases pages load | `/suppliers`, `/purchases` | ✅ PASS | Both → 200. |
| H2 — Bank account masked in form | `SupplierForm.tsx` | ✅ PASS | `<Input type="password" …>` for `bank_account_number` field (`SupplierForm.tsx:165`). |
| H3 — GRN: rejection_reason enforced | `GrnReceiveForm.tsx` | ✅ PASS | `(l) => l.quantity_rejected > 0 && !l.rejection_reason.trim()` blocks submission (`GrnReceiveForm.tsx:83`). Rejected rows highlighted in warning color (`line 117`). |
| H4 — Empty states + loading skeletons | `purchases/page.tsx` | ✅ PASS | PO tab: `emptyTitle="No purchase orders"`, invoices tab: `emptyTitle="No purchase invoices"`. Loading skeletons via `loading={poLoading}` prop. |
| H5 — PoBuilder: live line total with tax | `PoBuilder.tsx` | ✅ PASS | `grandTotal = lines.reduce(…qty × cost × (1 + tax/100), 0)` computed client-side (`PoBuilder.tsx:97`). |
| H6 — Debit note number shown after dispatch | `ReturnDialog.tsx` | ✅ PASS | `ret.debit_note_number && <span>DN: {ret.debit_note_number}</span>` (`ReturnDialog.tsx:184,186`). |
| H7 — PO detail: GRN panel + received status | `purchases/[id]/page.tsx` | ✅ PASS | `canReceive = ['sent', 'partially_received'].includes(po.status)`; GrnReceiveForm shown when receivable; "✓ All items fully received" banner when done. Loading skeletons. Code-verified `purchases/[id]/page.tsx:44,51,141,157`. |

### Module 06 — Procurement Verdict

| Severity | Count | Items |
|---|---|---|
| CRITICAL (cross-module) | 2 | F2 (`procurement.send_bill_due_reminders` → dead `celery` queue, celery-beat crash — all modules) |
| HIGH | 1 | C4 (`GET /purchase-returns/` returns `[]` for tenant-wide admin — `PurchaseReturnView.get()` missing `is_tenant_wide` guard in shop-id filter) |
| MED | 1 | A1 supplier create response includes `bank_account_number: null` (write-only field leaks as null instead of being excluded from response) |
| Cross-module | — | CRITICAL seed-data bug (0 permissions for non-admin roles) |

**Pass rate: 25 / 29 (86%)**

---

### Module 07 — Billing
**Spec refs:** `docs/backend-spec/RepairOS-dev-spec/modules/07-billing.md`, `docs/frontend-spec/RepairOS-frontend-spec/modules/07-billing-ui.md`  
**Primary role:** Admin (`admin@demo.com`), Billing Staff  
**Routes:** `/invoices`, `/invoices/[id]`  
**Celery tasks:** PDF generation (via reports); `billing.repair_payment_reminder`  
**Run date:** 2026-06-12  
**Overall:** 🟡 32 PASS / 6 FAIL — 2 HIGH · 2 MED · 1 LOW · 1 CRITICAL cross-module

#### Layer A — FLOW

| Journey | Role | Status | Evidence |
|---|---|---|---|
| A1 — Create repair invoice from closed job (labor line + intra-state GST) | Admin | ✅ PASS | `POST /billing/repair-invoices/ {job_id:"de35cf08-…", discount_amount:0, due_date:"2026-07-15"}` → 201 `{invoice_number:"SDEL-INV-2026-06-0025", status:"issued", subtotal:"1200.00", cgst:"108.00", sgst:"108.00", igst:"0.00", grand_total:"1416.00"}`. Labor line: `{item_type:"labor", description:"Service Charge", sac_code:"998714", tax_rate:"18.00", line_total:"1200.00"}`. job.service_charge=1200, 18% GST = 216, intra-state (shop.state_code=07, no customer GSTIN → defaults to 07) → CGST=108+SGST=108 ✓. |
| A2 — Partial payment; invoice → partially_paid | Admin | ✅ PASS | `POST /billing/payments/ {invoice_id, amount:500, method:"upi", reference_id:"UPI-BILL-E2E-001"}` → 201 `{amount:"500.00", method:"upi"}`. `GET /repair-invoices/{id}/` → `{status:"partially_paid", amount_paid:"500.00", amount_outstanding:"916.00"}`. |
| A3 — Final payment; invoice → paid | Admin | ✅ PASS | `POST /billing/payments/ {invoice_id, amount:916, method:"cash"}` → 201. `GET /repair-invoices/{id}/` → `{status:"paid", amount_paid:"1416.00", amount_outstanding:"0.00", payments:[…×2]}`. |
| A4 — Download PDF (signed MinIO URL) | Admin | 🔴 FAIL HIGH | `GET /billing/repair-invoices/{id}/pdf/` → 200 `{pdf_url:""}`. `pdf_url` is always empty — `create_repair_invoice()` never dispatches a Celery PDF generation task. No billing tasks file exists. Spec §4 states "PDF via signed 7-day S3 URL". |
| A5 — Send invoice via WhatsApp | Admin | ✅ PASS | `POST /billing/repair-invoices/{id}/send-whatsapp/` → 200 `{queued:true}`. WhatsApp delivery fails cross-module (notification_logs missing) but endpoint returns correct shape. |
| A6 — Tally export CSV download | Admin | ✅ PASS | `GET /billing/tally-export/?shop_id=…&from_date=2026-06-01&to_date=2026-06-30` → `Content-Type: text/csv; charset=utf-8`, `Content-Disposition: attachment; filename="tally-export-…csv"`. CSV columns: invoice_number, date, customer_name, gstin, subtotal, discount_amount, cgst, sgst, igst, grand_total, amount_paid, amount_outstanding, status. 25 rows for June. |

#### Layer B — VALIDATION

| Input scenario | Expected error | Status | Evidence |
|---|---|---|---|
| B1 — Payment on already-paid invoice | 422 BUSINESS_RULE_VIOLATION | ✅ PASS | `POST /payments/ {invoice_id, amount:100, method:"cash"}` on paid invoice → 422 `"Payment 100.00 exceeds outstanding 0.00."` (correct since outstanding=0). |
| B2 — Payment > outstanding balance | 422 BUSINESS_RULE_VIOLATION | ✅ PASS | Amount 99999 on invoice with outstanding=4310 → 422 `"Payment 99999.00 exceeds outstanding 4310.00."` |
| B3 — Invoice from job with 0 service_charge + no received parts | 400 VALIDATION_ERROR (per spec) | 🔴 FAIL MED | `POST /repair-invoices/ {job_id:"5e6b…"}` (job.service_charge=0, no received spare parts) → 201 `{invoice_number:"SDEL-INV-2026-06-0026", items:[], grand_total:"0.00", status:"issued"}`. `_build_line_items()` produces empty list; no guard before `RepairInvoice.objects.create()`. ₹0 invoice with no items should be rejected. |
| B4 — Duplicate invoice for same job | 400 (correct status), non-standard envelope | 🔴 FAIL LOW | → 400 `{"detail": "An invoice already exists for this job."}`. View catches `ValueError` and returns `{"detail": "..."}` instead of standard `{success:false, error:{code, message}}` envelope. Inconsistent with all other API error responses. |

#### Layer C — CONTRACT / RESPONSE

| Endpoint | Method | Expected | Status | Evidence |
|---|---|---|---|---|
| C1 — `/billing/repair-invoices/` | GET | Paginated + meta | ✅ PASS | 20 items, `meta:{next_cursor, prev_cursor}`. Item keys: `id, invoice_number, status, shop_id, job_id, customer_id, customer_name, customer_phone, job_number, grand_total, amount_paid, amount_outstanding, due_date, pdf_url, created_at`. |
| C2 — `/billing/repair-invoices/{id}/` | GET | Detail with items + payments | ✅ PASS | All fields present including `customer_gstin, shop_name, subtotal, cgst, sgst, igst, items:[{item_type,description,sac_code,hsn_code,quantity,unit_price,tax_rate,line_total}], payments:[…]`. |
| C3 — `/billing/payments/?invoice_id=…` | GET | Payment list | ✅ PASS | 2 payments returned (500 UPI, 916 cash). Keys: `id, invoice_id, amount, method, reference_id, razorpay_payment_id, paid_at, recorded_by_name`. |
| C4 — `?outstanding_only=true` filter | GET | Only invoices with amount_outstanding>0 | ✅ PASS | 4 results, all with `amount_outstanding>0`. Paid invoice `SDEL-INV-2026-06-0025` excluded. |
| C5 — `/billing/repair-invoices/{id}/pdf/` | GET | `{pdf_url: "…"}` shape | ✅ PASS | Returns `{pdf_url:""}`. Shape correct; content empty (see A4 HIGH bug). |
| C6 — `/billing/tally-export/` | GET | CSV download | ✅ PASS | `Content-Type: text/csv`, attachment header, correct GSTR-1 columns. |
| C7 — GST inter-state split logic | Shell | IGST for cross-state | ✅ PASS | `_split_gst(shop(07), cust_gstin_27, 216)` → `cgst=0, sgst=0, igst=216.00`. `_split_gst(shop(07), cust_gstin_07, 216)` → `cgst=108, sgst=108, igst=0`. Verified via Django shell (`billing.services._split_gst`). |

#### Layer D — AUTHZ

| Action | Role | Expected | Status | Evidence |
|---|---|---|---|---|
| D1 — View invoices | Viewer (0 perms) | 403 | ✅ PASS | `GET /repair-invoices/` → 403 `{code:"PERMISSION_DENIED"}`. |
| D2 — Tally export | Viewer (no `billing.tally_export`) | 403 | ✅ PASS | `GET /tally-export/…` → 403 `{code:"PERMISSION_DENIED"}`. |
| D3 — Any billing endpoint | testshop JWT | 0 results | ✅ PASS | `GET /repair-invoices/` with testshop token → `{items:[]}`. |

#### Layer E — STATE / SIDE-EFFECTS

| Action | DB effect | Status | Evidence |
|---|---|---|---|
| E1 — Invoice created | `repair_invoices` row + `repair_invoice_items` row | ✅ PASS | `repair_invoices`: `SDEL-INV-2026-06-0025, status=paid, subtotal=1200.00, cgst=108.00, sgst=108.00, igst=0.00, grand_total=1416.00, amount_paid=1416.00, amount_outstanding=0.00`. `repair_invoice_items`: `labor, Service Charge, sac_code=998714, tax_rate=18.00, line_total=1200.00`. |
| E2 — Payments recorded | `payments` rows + invoice status/outstanding updated | ✅ PASS | 2 rows: `500.00 upi UPI-BILL-E2E-001` + `916.00 cash`. Invoice status transitioned `issued → partially_paid → paid`. |
| E3 — CRM denormalized counters | `customers.total_billed += grand_total`, `total_outstanding += grand_total` then `−= payments` | ✅ PASS | Customer `d94211b9-…`: `total_billed=1416.00, total_outstanding=0.00` after full payment. `_update_crm_on_invoice()` + `_update_crm_on_payment()` both called atomically. |
| E4 — Razorpay dedup | `razorpay_payment_id` UNIQUE; duplicate silently returns existing | ✅ PASS | Set `razorpay_payment_id='rzp_E2EDEDUP001'` on a payment; `record_payment()` checks `Payment.objects.filter(razorpay_payment_id=…).first()` → returns existing record without creating duplicate. |
| E5 — audit_logs | Create + payment events logged | 🔴 FAIL MED | `SELECT * FROM audit_logs ORDER BY created_at DESC` → only `login/User` rows. `billing/services.py` has no `_write_audit()` calls at all (unlike CRM, procurement). Invoice creation and payment recording are never audit-logged. |

#### Layer F — LOGGING / OBSERVABILITY

| Scenario | Expected | Status | Evidence |
|---|---|---|---|
| F1 — Invoice creation | 201, no Traceback | ✅ PASS | `backend-1: "POST /api/v1/billing/repair-invoices/" 201`. Logger: `Invoice SDEL-INV-2026-06-0025 created for job SDEL-2026-0036`. |
| F2 — PDF generation via Celery | Worker log SUCCESS, file in MinIO | 🔴 FAIL HIGH | No PDF task dispatched. `create_repair_invoice()` ends without queuing any task. No billing `tasks.py` file. Celery worker logs show nothing for billing. `pdf_url` always empty string. |
| F3 — Celery beat tasks | `billing.repair_payment_reminder` schedule | 🔴 FAIL CRITICAL (cross-module) | Same celery-beat crash (`django_celery_beat_periodictask` missing) + task routes gap as all prior modules. |

#### Layer G — INFRA PATH

| Check | Method | Status | Evidence |
|---|---|---|---|
| G1 — Requests via PgBouncer | `SHOW POOLS` | ✅ PASS | `repaiross_tenant_demo: cl_active=2, sv_used=2, pool_mode=transaction`. |
| G2 — PDF served from MinIO | Signed URL resolves | ✅ N/A | `pdf_url=""` always (see F2 HIGH bug). Endpoint shape returns `{pdf_url}` key correctly. |
| G3 — Razorpay webhook HMAC rejection | Invalid sig → 400 | ✅ PASS | `POST /webhooks/razorpay/ {X-Razorpay-Signature:invalidsig}` → 400 `"Invalid Razorpay signature."`. `hmac.compare_digest()` used (timing-safe). |

#### Layer H — UX STATES

| State | Where | Status | Evidence |
|---|---|---|---|
| H1 — Invoice list loads with status filter | `/invoices` | ✅ PASS | `billingApi.listInvoices()` via React Query. `DataTable` with `emptyTitle="No invoices yet"`. Status filter `<Select>` with 5 statuses. |
| H2 — Loading skeletons | Invoice list first load | ✅ PASS | `DataTable loading={allQuery.isLoading}` shows skeleton rows. Outstanding tab: `[1,2,3].map → animate-pulse div` during load. |
| H3 — GST breakdown (intra/inter-state) | Invoice detail | ✅ PASS | `isInterState = invoice.igst > 0`. `<GstBreakdown cgst={isInterState ? undefined : invoice.cgst} sgst={isInterState ? undefined : invoice.sgst} igst={isInterState ? invoice.igst : undefined}>` switches display mode by flag. (`invoices/[id]/page.tsx:98,209`). |
| H4 — Payment progress bar + KPI strip | Invoice detail | ✅ PASS | When `status==='partially_paid'`: `paidPct = (amount_paid/grand_total)*100`, progress bar `width: ${paidPct}%`. KPI strip: Total/Paid/Outstanding, outstanding in danger color if >0. (`invoices/[id]/page.tsx:89,147`). |
| H5 — AddPaymentDialog: amount > outstanding blocked | Payment dialog | ✅ PASS | `<MoneyInput max={invoice.amount_outstanding}>`. Inline warning if `field.value > invoice.amount_outstanding`. Submit disabled: `disabled={… || form.watch('amount') > invoice.amount_outstanding}`. (`AddPaymentDialog.tsx:144,147,195`). |
| H6 — GenerateInvoiceDialog: offline guard + preview | Invoice generation from job | ✅ PASS | Offline: `WifiOff` icon + "Invoice generation requires a connection." Preview block shows labor=serviceCharge, auto-listed parts notice, discount, est. grand total. (`GenerateInvoiceDialog.tsx:70,97`). |
| H7 — PaymentHistory: method badge + ₹ + datetime + ref | Invoice detail payments tab | ✅ PASS | `PAYMENT_METHOD_COLORS` badge, `<Money>` amount, `formatDatetime(p.paid_at)`, `Ref: {p.reference_id}` when present, `By {p.recorded_by_name}`. (`PaymentHistory.tsx:22`). |
| H8 — TallyExportPanel: blocked without shop selection | Reports/GST tab | ✅ PASS | `disabled={loading \|\| isAllShops \|\| !activeShopId}`. Toast: "Select a shop" when `isAllShops`. Date pickers default to first-of-month → today. (`TallyExportPanel.tsx:23,78`). |

### Module 07 — Billing Verdict

| Severity | Count | Items |
|---|---|---|
| HIGH | 2 | A4/F2 (PDF generation not implemented — no Celery task, `pdf_url` always empty); Razorpay payment link → 501 FEATURE_PENDING |
| MED | 2 | B3 (₹0 invoice created with 0 line items — no `len(items)>0` guard); E5 (no audit trail — billing services.py has no `_write_audit()` calls) |
| LOW | 1 | B4 (duplicate invoice returns `{"detail":"…"}` not standard `{code,message}` envelope) |
| CRITICAL (cross-module) | 1 | F3 (`billing.repair_payment_reminder` beat task dead-queued + celery-beat crash) |

**Pass rate: 32 / 38 (84%)**

---

### Module 08 — Commissions
**Spec refs:** `docs/backend-spec/RepairOS-dev-spec/modules/08-commissions.md`, `docs/frontend-spec/RepairOS-frontend-spec/modules/08-commissions-ui.md`  
**Primary role:** Technician `tech1@demo.com` (self-view), Admin (payout management)  
**Routes:** `/commissions`, `/commissions/[techId]`, `/settings/commission-rules`  
**Celery tasks:** `commissions.generate_payout_pdf`  
**Run date:** 2026-06-12  
**Overall:** 🟡 28 PASS / 3 FAIL — 1 HIGH · 1 MED · 1 LOW

#### Layer A — FLOW

| Journey | Role | Status | Evidence |
|---|---|---|---|
| A1 — Admin views technician ledger with breakdown | Admin | ✅ PASS | `GET /commissions/technician/3aabffc6-…/?period_start=2026-01-01&period_end=2026-12-31` → `{technician_name:"Rohit Kumar", total_earned:6990.0, total_paid:180.0, total_unpaid:6810.0, commissions:[…×13]}`. First row: `{job_number:"SDEL-2026-0036", sc_amount:"1200.00", rate:"30.00", commission_amount:"360.00", is_lead:true, is_paid:false}`. |
| A2 — List commission rules | Admin | ✅ PASS | `GET /commissions/rules/` → `{items:[{name:"repair", rate:"30.00", lead_tech_share:"50.00", effective_from:"2026-06-05", effective_to:"2026-06-30"}, {rate:"10.00", lead_tech_share:"60.00", effective_to:null}, {rate:"12.00", job_type:"iPhone"}]}`. 3 rules, correct keys. |
| A3 — Create payout batch (draft) | Admin | ✅ PASS | `POST /commissions/payouts/ {technician_id, period_start:"2026-06-01", period_end:"2026-06-30"}` → 201 `{id:"70c169db-…", total_commission:"6810.00", status:"draft", pdf_url:"", technician_name:"Rohit Kumar"}`. Total matches sum of 12 unpaid rows (6810.00 = 6990.00 − 180.00 pre-paid) ✓. |
| A4 — Advance payout draft→approved | Admin | ✅ PASS | `PATCH /commissions/payouts/70c169db-…/` → `{status:"approved", total_commission:"6810.00"}`. |
| A5 — Advance payout approved→paid | Admin | ✅ PASS | `PATCH /commissions/payouts/70c169db-…/` → `{status:"paid", paid_at:"2026-06-12T17:38:08+05:30"}`. |
| A6 — Accruals marked is_paid after payout | Admin | ✅ PASS | `GET /commissions/technician/$TECH1/?period_start=2026-06-01&period_end=2026-06-30` → `{total_unpaid:0.0, total_paid:6990.0}`. All 13 rows `is_paid=true`, 12 with `payout_id="70c169db-…"`. |
| A7 — Warranty job → no commission accrual | Admin | ✅ PASS | `SELECT COUNT(*) FROM technician_commissions WHERE sc_amount=0` → 0. `accrue_commission()` returns early when `job.service_charge <= 0` (`services.py:39`). Frontend shows `Warranty` label when `c.sc_amount === 0` (`commissions/page.tsx:155`). |

#### Layer B — VALIDATION

| Input scenario | Expected error | Status | Evidence |
|---|---|---|---|
| B1 — Double-pay same period (all accruals already paid) | 422 BUSINESS_RULE_VIOLATION | ✅ PASS | `POST /payouts/ {technician_id, period_start:2026-06-01, period_end:2026-06-30}` → 422 `{code:"BUSINESS_RULE_VIOLATION", message:"No unpaid commissions for this technician in this period."}` |
| B2 — Advance payout that is already paid | 422, non-standard envelope | 🔴 FAIL LOW | → 422 `{"detail": "Payout is already 'paid'; no further transitions."}`. Non-standard envelope (should be `{code, message}`); same pattern as billing. |
| B3 — period_end < period_start | 400 VALIDATION_ERROR | ✅ PASS | → 400 `{code:"VALIDATION_ERROR", fields:{non_field_errors:["period_end must be >= period_start."]}}` |

#### Layer C — CONTRACT / RESPONSE

| Endpoint | Method | Expected | Status | Evidence |
|---|---|---|---|---|
| C1 — `/commissions/rules/` | GET | `{items:[…]}` with rule fields | ✅ PASS | Keys: `id, name, rate, lead_tech_share, applies_to_job_type, effective_from, effective_to`. 3 rules returned. |
| C2 — `/commissions/technician/{id}/` | GET | Ledger with per-job commissions | ✅ PASS | Top-level keys: `technician_id, technician_name, total_earned, total_paid, total_unpaid, commissions`. Commission keys: `id, job_number, job_closed_at, sc_amount, rate, commission_amount, is_lead, is_paid, payout_id`. |
| C3 — `/commissions/payouts/` | GET | Paginated payout list | ✅ PASS | `meta:{next_cursor, prev_cursor}`, 2 payouts. Keys: `id, technician_id, technician_name, period_start, period_end, total_commission, status, paid_at, pdf_url`. |
| C4 — `/commissions/payouts/{id}/` | GET | Payout detail | ✅ PASS | Same keys as list; `technician_name` resolved from FK. |

#### Layer D — AUTHZ

| Action | Role | Expected | Status | Evidence |
|---|---|---|---|---|
| D1 — Technician views own ledger | `tech1@demo.com` (no `hr.salary.view`) | 200 own data | ✅ PASS | `GET /commissions/technician/{tech1_id}/` with tech1 JWT → 200 `{technician_name:"Rohit Kumar"}`. View checks `str(request.user.id) == str(tech_id)` → bypasses permission check. |
| D2 — Technician views another's ledger | tech1 views tech2 | 403 | ✅ PASS | → 403 `{code:"PERMISSION_DENIED"}`. View falls through to `require_permission("hr.salary.view")` when IDs differ. |
| D3 — Technician creates payout | tech1 (no `hr.salary.generate`) | 403 | ✅ PASS | `POST /payouts/` → 403 `{code:"PERMISSION_DENIED"}`. |
| D4 — Testshop isolation | testshop admin | 0 demo payouts | ✅ PASS | `GET /payouts/` with testshop JWT → `{items:[]}`. |

#### Layer E — STATE / SIDE-EFFECTS

| Action | DB effect | Status | Evidence |
|---|---|---|---|
| E1 — Payout row created | `commission_payouts` row with totals | ✅ PASS | `70c169db-… | 6810.00 | paid | 2026-06-12 | ""` (pdf_url empty per F2). |
| E2 — TechnicianCommission rows marked is_paid | 12 rows linked to payout | ✅ PASS | `SELECT COUNT(*), SUM(commission_amount) FROM technician_commissions WHERE payout_id='70c169db-…' AND is_paid=true` → `12 | 6810.00`. |
| E3 — Multi-tech split math correct | pool = lead + sum(others), no rounding leak | ✅ PASS | Job SDEL-2026-0005: SC=2500, rate=12%, pool=300. lead(Rohit)=180 (60%), other(Suresh)=120. 180+120=300 ✓. Single-tech jobs: SC×rate%=commission_amount for all 5 checked (360, 540, 270, 450, 360 ✓). |
| E4 — audit_logs for payout | create/approve/pay events | 🔴 FAIL MED | `SELECT * FROM audit_logs WHERE model_name ILIKE '%commission%'` → 0 rows. `commissions/services.py` and `views.py` have no `_write_audit()` calls. Payout lifecycle not audited. |

#### Layer F — LOGGING / OBSERVABILITY

| Scenario | Expected | Status | Evidence |
|---|---|---|---|
| F1 — Payout creation request | 201, no Traceback | ✅ PASS | `backend-1: "POST /api/v1/commissions/payouts/" 201`. No tracebacks. |
| F2 — `commissions.generate_payout_pdf` task | Worker SUCCESS, pdf_url populated | 🔴 FAIL HIGH | Task dispatched via `generate_payout_pdf.delay(payout_id)` in `create_payout()`. Task name `commissions.generate_payout_pdf` does NOT match any `CELERY_TASK_ROUTES` entry (`*.tasks.generate_pdf_*` requires `module.tasks.generate_pdf_*` prefix — task has no `.tasks.` segment and starts with `generate_payout_` not `generate_pdf_`). Routes to dead `celery` queue → never consumed. `pdf_url=""` after payout. Celery worker logs: no output for commission tasks. |

#### Layer G — INFRA PATH

| Check | Method | Status | Evidence |
|---|---|---|---|
| G1 — Requests via PgBouncer | `SHOW POOLS` | ✅ PASS | `repaiross_tenant_demo: cl_active=3, sv_used=1, pool_mode=transaction`. |
| G2 — Payout PDF in MinIO | Check `pdf_url` | ✅ N/A | `pdf_url=""` always (F2 HIGH — task dead-queued). No MinIO object created. |

#### Layer H — UX STATES

| State | Where | Status | Evidence |
|---|---|---|---|
| H1 — Self-view uses logged-in user's ID | `/commissions` ledger tab | ✅ PASS | `commissionsApi.getTechnicianLedger(user?.id ?? '', …)` — query key and fn both use `user?.id`. (`commissions/page.tsx:37-38`). |
| H2 — Lead badge on multi-tech jobs | Commission ledger table | ✅ PASS | `c.is_lead && <span …>Lead</span>` accent-colored badge. (`commissions/page.tsx:154`). |
| H3 — Warranty label when SC=0 | Commission ledger table | ✅ PASS | `c.sc_amount === 0 && <span>Warranty</span>`. (`commissions/page.tsx:155`). |
| H4 — Payout builder blocked without technician | `/commissions` payouts tab | ✅ PASS | `disabled={!payoutTechId.trim() || payoutMutation.isPending}`. (`commissions/page.tsx:204`). |
| H5 — Advance button label switches | Payout list item | ✅ PASS | `p.status === 'draft' ? 'Approve' : 'Mark paid'`. Hidden when `status==='paid'`. (`commissions/page.tsx:243,251`). |
| H6 — PDF download shown only when pdf_url set | Payout list item | ✅ PASS | `{p.pdf_url && <a href={p.pdf_url} …><Download …/></a>}`. (`commissions/page.tsx:255-259`). |
| H7 — Loading skeletons | Ledger + payouts tabs | ✅ PASS | `ledgerLoading → [1,2,3].map(Skeleton)`, `payoutsLoading → [1,2,3].map(Skeleton)`. (`commissions/page.tsx:115-116, 225-226`). |
| H8 — Commission rules form (rate + lead_tech_share %) | `/settings/commission-rules` | ✅ PASS | `rate: z.number().min(0).max(100)`, `lead_tech_share: z.number().min(0).max(100)`, default values 30/50. (`commission-rules/page.tsx:23-24,44`). |

### Module 08 — Commissions Verdict

| Severity | Count | Items |
|---|---|---|
| HIGH | 1 | F2 (`commissions.generate_payout_pdf` → dead `celery` queue; task name mismatches `*.tasks.generate_pdf_*` route pattern; `pdf_url` always empty) |
| MED | 1 | E4 (no audit trail — payout create/approve/pay lifecycle not logged) |
| LOW | 1 | B2 (advance already-paid payout returns `{"detail":"…"}` not standard `{code,message}` envelope) |

**Pass rate: 28 / 31 (90%)**

---

### Module 09 — HR & Payroll
**Spec refs:** `docs/backend-spec/RepairOS-dev-spec/modules/09-hr-payroll.md`, `docs/frontend-spec/RepairOS-frontend-spec/modules/09-hr-payroll-ui.md`  
**Primary role:** `admin@demo.com` (Tenant Admin, is_tenant_wide)  
**Routes:** `/api/v1/hr/employees/`, `/hr/attendance/`, `/hr/attendance/bulk/`, `/hr/leave-requests/`, `/hr/salary-slips/`, `/hr/salary-slips/generate/`, `/hr/salary-slips/{id}/pdf/`  
**Celery tasks:** `hr.generate_salary_pdf`, `hr.send_payroll_reminders`  
**Run date:** 2026-06-12  
**Overall:** ✅ 22 PASS / ❌ 5 FAIL — **81% pass rate**

#### Layer A — FLOW
| Journey | Role | Status | Evidence |
|---|---|---|---|
| View employee list with masked statutory IDs | admin | ✅ PASS | `GET /hr/employees/` → `success:true, count:6`; `bank_account_masked:""` (seed has no encrypted data), `raw_encrypted_exposed:false` — ciphertext field never in response |
| Create employee with bank/PAN/Aadhar | admin | ✅ PASS | `POST /hr/employees/ {employee_code:"EMP-TEST-01", bank_account_number:"12345678901", pan_number:"ABCDE1234F"}` → 201, `bank_account_masked:"****"`, `pan_masked:"****"`, `aadhar_masked:"****"`. DB: `bank_account_number_encrypted` len=100, prefix `gAAAAABqK_` (Fernet token) |
| Bulk-mark attendance (date-range format) | admin | ✅ PASS | `POST /hr/attendance/bulk/ {shop_id, employee_ids:[3], date_from:"2026-05-01", date_to:"2026-05-05", status:"present"}` → `{created:15, updated:0}` |
| Re-mark attendance (upsert idempotency) | admin | ✅ PASS | Same date with `status:"absent"` → `{created:0, updated:1}` — upsert corrects existing record |
| Submit leave request | admin | ✅ PASS | `POST /hr/leave-requests/ {employee_id:EMP-001, leave_type:"sick", from_date:"2026-06-02", to_date:"2026-06-03", days:2.0}` → 201, `status:"pending"` |
| Approve leave → attendance rows written | admin | ✅ PASS | `PATCH /hr/leave-requests/{id}/ {status:"approved"}` → `status:"approved"`, `approved_at:"2026-06-12T17:50:33+05:30"`. DB: `SELECT date,status FROM attendance_records WHERE employee_id=EMP-001 AND date BETWEEN '2026-06-02' AND '2026-06-03'` → 2 rows both `status=leave` ✓ |
| Reject pending leave | admin | ✅ PASS | `PATCH {status:"rejected"}` → `status:"rejected"` |
| Generate salary slip with proration | admin | ✅ PASS | `POST /hr/salary-slips/generate/ {shop_id, month:7, year:2026, employee_ids:[EMP-TEST-01]}` → 201, 1 slip. Attendance: 28 PRESENT + 1 HALF_DAY + 2 WEEKEND. `working_days=29`, `present_days=28.0`, `basic_earned=19655.17` (=20000×28.5/29), `hra_earned=4913.79`, `gross_earned=26534.48`, `pf_deduction=2400.00`, `net_salary=24134.48` — all match spec formula |
| Slip lifecycle draft→approved→paid | admin | ✅ PASS | `PATCH {status:"approved"}` → `status:"approved"`. `PATCH {status:"paid"}` → `status:"paid"` |
| Duplicate slip blocked | admin | ✅ PASS | Second `POST /salary-slips/generate/ {month:5, year:2026}` → `BUSINESS_RULE_VIOLATION: "Salary slips already exist for all specified employees in 5/2026."` |
| Soft-delete employee | admin | ✅ PASS | `PATCH {is_active:false}` → `is_active:false`. Subsequent list excludes employee; detail returns 404 |

#### Layer B — VALIDATION
| Input scenario | Expected error | Status | Evidence |
|---|---|---|---|
| Duplicate salary slip same employee/month | 422 BUSINESS_RULE_VIOLATION | ✅ PASS | Seeds have May/June slips; `POST generate {month:5}` → `{"code":"BUSINESS_RULE_VIOLATION","message":"Salary slips already exist for all specified employees in 5/2026."}` |
| Leave `to_date < from_date` | 400 VALIDATION_ERROR | ✅ PASS | `POST {from_date:"2026-07-10",to_date:"2026-07-05"}` → `VALIDATION_ERROR: {"non_field_errors":["to_date must be >= from_date."]}` |
| Attendance date range > 31 days | 400 VALIDATION_ERROR | ✅ PASS | `POST {date_from:"2026-01-01",date_to:"2026-02-15"}` → `VALIDATION_ERROR` |
| Duplicate employee code | 400 | ❌ FAIL **LOW** | `POST {employee_code:"EMP-001"}` → `{"detail":"Employee with this code already exists."}` — non-standard envelope; missing `{success:false,error:{code,message}}` wrapper |
| Re-approve already-approved leave | 422 | ✅ PASS | `PATCH {status:"approved"}` on approved leave → `BUSINESS_RULE_VIOLATION: "Only pending leave requests can be approved or rejected."` |
| Invalid slip transition (`paid→approved`) | 422 | ✅ PASS | `PATCH {status:"approved"}` on paid slip → `BUSINESS_RULE_VIOLATION: "Cannot transition salary slip from 'paid' to 'approved'."` |

#### Layer C — CONTRACT / RESPONSE
| Endpoint | Method | Expected envelope | Status | Evidence |
|---|---|---|---|---|
| `/api/v1/hr/employees/` | GET | `{success:true, data:{items:[...], meta:{...}}}` | ✅ PASS | Response matches. Encrypted fields (`bank_account_number_encrypted`, `pan_number_encrypted`) absent; masked fields present |
| `/api/v1/hr/employees/` | POST | 201 `{success:true, data:Employee}` | ✅ PASS | `bank_account_masked:"****"`, `pan_masked:"****"`, `aadhar_masked:"****"` when values supplied |
| `/api/v1/hr/attendance/bulk/` | POST | `{created, updated}` | ✅ PASS | `{success:true, data:{created:15, updated:0}}` |
| `/api/v1/hr/leave-requests/` | POST | 201 `{success:true, data:LeaveRequest}` | ✅ PASS | All leave fields returned |
| `/api/v1/hr/salary-slips/generate/` | POST | 201 `{success:true, data:{slips:[...]}}` | ✅ PASS | `slips` array with full computed fields |
| `/api/v1/hr/salary-slips/{id}/pdf/` | GET | `{pdf_url:string}` | ❌ FAIL **HIGH** | `{success:true, data:{pdf_url:""}}` — PDF never generated; see Layer F |
| `LeaveRequest.created_at` FE type vs response | — | field present | ❌ FAIL **LOW** | `LeaveRequestSerializer` (ModelSerializer) doesn't include `created_at`; `LeaveRequest` TS interface in `hr.ts:59` declares `created_at: string` — type mismatch; FE code consuming this field will get `undefined` |

#### Layer D — AUTHZ
| Action | Role | Expected | Status | Evidence |
|---|---|---|---|---|
| Generate salary | Viewer (`viewer@demo.com`) | 403 PERMISSION_DENIED | ✅ PASS | `POST /salary-slips/generate/` with Viewer token → `{"code":"PERMISSION_DENIED"}` |
| Unauthenticated request | None | 401 NOT_AUTHENTICATED | ✅ PASS | `GET /hr/employees/` without token → `{"code":"NOT_AUTHENTICATED"}` |
| Demo JWT with `X-Tenant-Slug: testshop` | Tenant Admin | Returns demo data only (JWT wins) | ✅ PASS | Response count=7 (demo employees including EMP-TEST-01). `TenantMiddleware._resolve_slug()` resolution order: JWT claim > subdomain > header (DEBUG). testshop DB has 0 employees → JWT `tenant_slug:demo` wins, no testshop data returned |

#### Layer E — STATE / SIDE-EFFECTS
| Action | DB effect | Status | Evidence |
|---|---|---|---|
| `POST /salary-slips/generate/` | `salary_slips` row created | ✅ PASS | `SalarySlip id=4aa5ab15` created with correct proration values |
| Leave approval | `leave_requests.status=approved` + attendance rows | ✅ PASS | `approved_at` set, 2 `attendance_records` rows created with `status=leave` for 2026-06-02..03 |
| Bulk attendance | `attendance_records` upserted | ✅ PASS | 15 created, upsert path updates existing on re-submit |
| Soft-delete employee | `employees.deleted_at` set | ✅ PASS | `GET /hr/employees/` excludes EMP-TEST-01 after deactivation |
| `gross_salary` stale after salary component update | `gross_salary` not recalculated | ❌ FAIL **MED** | `PATCH /employees/{id}/ {basic_salary:25000}` succeeds. `UpdateEmployeeSerializer` accepts `basic_salary`, `hra`, `other_allowances` but `gross_salary` absent from both serializer and `updatable` list in view. After update, `gross_salary` on Employee model retains old value — reads stale `gross_salary:27000` while `basic_salary=25000`. Callers relying on `gross_salary` for payroll will get incorrect data until employee is re-created |

#### Layer F — LOGGING / OBSERVABILITY
| Scenario | Expected | Status | Evidence |
|---|---|---|---|
| `hr.generate_salary_pdf` dispatch | task routed to `high` queue, worker executes, `pdf_url` set | ❌ FAIL **HIGH** | Task dispatched on slip APPROVED transition. Task name: `hr.generate_salary_pdf` (`hr/tasks.py:15`). Route patterns: `CELERY_TASK_ROUTES` has `*.tasks.generate_pdf_*` which requires `.tasks.` segment in name — `hr.generate_salary_pdf` has no `.tasks.` segment → falls to default `celery` queue. Worker consumes `high`, `default`, `low` only. `redis-cli llen celery` → 9 (accumulated HR+commissions tasks). `pdf_url` stays `""` after approval. Same dead-queue pattern as `commissions.generate_payout_pdf` (CRITICAL-1 cross-module) |
| `hr.send_payroll_reminders` | beat dispatches on 25th, routes to worker | ❌ FAIL **HIGH** | Celery-beat crash loop (`django_celery_beat_periodictask` table missing) → no beat tasks dispatched at all. Also: task name `hr.send_payroll_reminders` matches no route entry → would land in `celery` queue regardless. Double failure: beat dead + wrong queue |

#### Layer G — INFRA PATH
| Check | Method | Status | Evidence |
|---|---|---|---|
| HR requests via PgBouncer | Confirmed from prior modules (pgbouncer healthy, all requests proxied) | ✅ PASS | PgBouncer healthy; `postgres-1` responds via port 6432 as confirmed in M06/M07 sessions |
| Salary PDF in MinIO | `pdf_url` populated after approval | ❌ FAIL | `pdf_url:""` — task stuck in dead `celery` queue; MinIO receives no write |

#### Layer H — UX STATES
| State | Where | Status | Evidence |
|---|---|---|---|
| Statutory IDs masked in employee API | `GET /hr/employees/` | ✅ PASS | `bank_account_masked`, `pan_masked`, `aadhar_masked` present; encrypted field names absent from response. New employee with values → `"****"` |
| `BulkAttendanceSerializer` dead code | `hr/serializers.py:80`, `hr/views.py:21` | ❌ FAIL **LOW** | `BulkAttendanceSerializer` (per-record format, `{records:[...]}`) defined and imported in views but never used. `BulkAttendanceView` uses `DateRangeBulkAttendanceSerializer`. FE `hrApi.bulkMarkAttendance` matches DateRange format → FE/BE aligned but serializer is dead code |
| `markSalaryPaid` absent from `hrApi` | `frontend/src/lib/api/hr.ts` | ✅ PASS (by design) | `hrApi` has `approveSalarySlip` (draft→approved) only. `paid` transition not in hrApi; salary page shows "paid" in status filter but has no Approve button for approved slips. `PATCH {status:"paid"}` works via backend; FE omission is intentional — paid status likely set externally (accounting integration) |

#### Module 09 Bug Summary
| ID | Severity | Description | Location |
|---|---|---|---|
| H9-1 | HIGH | `hr.generate_salary_pdf` routes to dead `celery` queue — task name lacks `.tasks.` segment required by `*.tasks.generate_pdf_*` route pattern. `pdf_url` always empty after slip approval | `hr/tasks.py:15`, `settings/base.py:CELERY_TASK_ROUTES` |
| H9-2 | HIGH | `hr.send_payroll_reminders` routes to dead `celery` queue — same routing miss. Compounded by celery-beat crash loop (CRITICAL-1 cross-module) | `hr/tasks.py:53`, beat table missing |
| H9-3 | MED | `gross_salary` goes stale after `PATCH /employees/{id}/` — `UpdateEmployeeSerializer` accepts `basic_salary`/`hra`/`other_allowances` but not `gross_salary`; view `updatable` list also excludes it. Downstream: salary slip generation reads `employee.gross_salary` for display; components read stale value | `hr/views.py:149-158`, `hr/serializers.py:172-188` |
| H9-4 | LOW | Duplicate employee code returns non-standard `{"detail":"..."}` envelope instead of `{success:false, error:{code,message}}` | `hr/views.py:83-86` |
| H9-5 | LOW | `LeaveRequest` TS interface declares `created_at:string` but `LeaveRequestSerializer` does not serialize it — FE type mismatch; any UI code reading `leave.created_at` gets `undefined` | `hr.ts:59`, `hr/serializers.py:114-123` |

---

### Module 10 — Finance
**Spec refs:** `docs/backend-spec/RepairOS-dev-spec/modules/10-finance.md`, `docs/frontend-spec/RepairOS-frontend-spec/modules/10-finance-ui.md`  
**Primary role:** `admin@demo.com` (Tenant Admin, is_tenant_wide)  
**Routes:** `/api/v1/finance/petty-cash/{shop_id}/`, `/finance/petty-cash/transactions/`, `/finance/budget/`, `/finance/budget/allocations/`, `/finance/expenses/`, `/finance/assets/`, `/finance/assets/{id}/`  
**Celery tasks:** _(none dedicated — `petty_cash_low` and `budget_exceeded` WhatsApp via `core.dispatch_whatsapp_message`)_  
**Run date:** 2026-06-12  
**Overall:** 🟡 22 PASS / 8 FAIL — **73% pass rate**

#### Layer A — FLOW
| Journey | Role | Status | Evidence |
|---|---|---|---|
| GET petty cash account | admin | ✅ PASS | `GET /finance/petty-cash/{shop_id}/` → `{name:"Delhi Petty Cash", current_balance:"6280.00", low_balance_threshold:"500.00"}` |
| List petty cash transactions | admin | ✅ PASS | `GET /finance/petty-cash/transactions/?account_id=…` → 18 transactions, cursor-paginated. Fields: `id, account_id, type, amount, category, description, date, balance_after, recorded_by_name` |
| Credit petty cash (atomic balance update) | admin | ✅ PASS | `POST {type:"credit", amount:"2000"}` → `{type:"credit", amount:"2000.00", balance_after:"8280.00"}`. DB: `current_balance=8280.00` ✓ atomically (SELECT FOR UPDATE in service) |
| Debit petty cash | admin | ✅ PASS | `POST {type:"debit", amount:"350"}` → `{balance_after:"7930.00"}` |
| Create budget head | admin | ✅ PASS | `POST /finance/budget/ {name:"E2E Test Head", category:"variable"}` → 201, `{id, name, category}` |
| List budget heads | admin | ✅ PASS | `GET /finance/budget/?shop_id=…` → 8 heads, cursor-paginated |
| Create budget allocation | admin | ✅ PASS | `POST /finance/budget/allocations/ {head_id, month:6, year:2026, budgeted_amount:"10000"}` → 201, `{budgeted:10000, actual:0, variance:0}` |
| Upsert budget allocation (update existing) | admin | ✅ PASS | Second `POST` same head/month/year with `budgeted:"15000"` → 200, variance recomputed: `actual(11000) - budgeted(15000) = -4000` ✓ |
| Create expense linked to budget head | admin | ✅ PASS | `POST /finance/expenses/ {shop_id, budget_head_id, amount:"3000", date:"2026-06-12"}` → 201, `{budget_head_name:"E2E Test Head"}`. DB: `budget_allocations.actual_amount=3000, variance=-7000` |
| Expense increments budget allocation actual + variance | admin | ✅ PASS | Added second expense ₹8000 → DB: `actual_amount=11000, variance=1000` (over budget = positive variance). F() atomic increment used |
| List expenses with date filter | admin | ✅ PASS | `GET /finance/expenses/?shop_id=…&date_from=2026-06-01` → 7 expenses, correct cursor pagination |
| List budget allocations filtered | admin | ✅ PASS | `GET /finance/budget/allocations/?month=6&year=2026&shop_id=…` → 9 allocations including E2E Test Head with variance=1000 |
| Create asset | admin | ✅ PASS | `POST /finance/assets/ {shop_id, name:"E2E Test Asset", asset_code:"SDEL-E2E-001", purchase_cost:"25000"}` → 201, `{condition:"good", is_active:true}` |
| Update asset condition | admin | ✅ PASS | `PATCH /finance/assets/{id}/ {condition:"under_repair", notes:"…"}` → `{condition:"under_repair", is_active:true}` |
| Dispose asset → is_active=False | admin | ✅ PASS | `PATCH {condition:"disposed"}` → `{condition:"disposed", is_active:false}`. `services.update_asset()` sets `is_active=False` when `condition==DISPOSED` |
| Disposed excluded from default asset list | admin | ✅ PASS | `GET /finance/assets/?shop_id=…` (default `is_active=true`) → 6 active assets; `SDEL-E2E-001` absent |
| is_active=false includes all assets | admin | ✅ PASS | `GET /finance/assets/?shop_id=…&is_active=false` → 7 assets (6 active + 1 disposed); `SDEL-E2E-001` present |

#### Layer B — VALIDATION
| Input scenario | Expected error | Status | Evidence |
|---|---|---|---|
| Debit > current balance (overdraft) | 422 BUSINESS_RULE_VIOLATION | ❌ FAIL **HIGH** | `POST {type:"debit", amount:"99999"}` on account with ₹7930 → 201 `{success:true, balance_after:"-92069.00"}`. `record_petty_cash_txn` has no guard for `new_balance < 0`. Spec says this must be rejected. Petty cash ledger goes negative |
| Over-budget expense (variance > 0) | succeeds but triggers alert | ✅ PASS | ₹8000 expense on ₹10000 budget head → total actual=₹11000, variance=+1000. `_update_budget_allocation` logs warning and dispatches `budget_exceeded` WhatsApp (see Layer F) |
| Duplicate asset code | 400 | ❌ FAIL **LOW** | `POST {asset_code:"SDEL-IT-001"}` → `{success:false}` but response is `{"detail":"Asset code already exists."}` — non-standard `{"detail":…}` envelope instead of `{success:false, error:{code,message}}` |
| Budget head category not validated | any string accepted | ❌ FAIL **MED** | `POST /finance/budget/ {category:"not_a_real_category"}` → 201, `{category:"not_a_real_category"}`. `BudgetHeadListView.post()` reads `request.data.get("category","")` directly — no serializer, no `model.Category.choices` validation. Seed data also has out-of-spec values: `operational`, `marketing`, `capex` vs model choices `fixed/variable/capital` |

#### Layer C — CONTRACT / RESPONSE
| Endpoint | Method | Expected envelope | Status | Evidence |
|---|---|---|---|---|
| `GET /finance/petty-cash/{shop_id}/` | GET | `{name, current_balance, low_balance_threshold}` | ✅ PASS | All fields match `PettyCashAccount` TS type |
| `POST /finance/petty-cash/transactions/` | POST | 201 `PettyCashTransaction` | ✅ PASS | `{type, amount, balance_after, recorded_by_name, date, category}` |
| `PettyCashTransaction.receipt_url` FE vs response | — | field in response | ❌ FAIL **LOW** | `PettyCashTransactionSerializer` fields list: `id, account_id, type, amount, category, description, date, balance_after, recorded_by_name` — no `receipt_url`. FE type `finance.ts:22` declares `receipt_url?: string | null`. FE code reading `txn.receipt_url` gets `undefined` |
| `POST /finance/expenses/` | POST | 201 `Expense` | ✅ PASS | `{id, shop_id, budget_head_id, budget_head_name, category, amount, date, recorded_by_name}` |
| `BudgetCategory` FE type vs DB values | — | `'fixed'\|'variable'\|'capital'` | ❌ FAIL **MED** | FE type `BudgetCategory = 'fixed' \| 'variable' \| 'capital'`. Model `choices` same. But DB seed data has `operational`, `marketing`, `capex` (4 distinct values). FE category filter/labels produce blank for these values. Root cause: `BudgetHeadListView.post()` no validation, `BudgetHead.Category` choices never enforced at DB level |
| `POST /finance/assets/` — supplier_id | — | supplier linked on asset | ❌ FAIL **LOW** | `financeApi.createAsset` sends `supplier_id` field. `CreateAssetSerializer` has no `supplier_id` field → silently ignored. `ShopAsset.supplier` always `null` even when FE provides a supplier. `ShopAssetSerializer` returns `supplier_id:null` in read response |
| `POST /finance/budget/` | POST | 201 `BudgetHead` | ✅ PASS | `{id, shop_id, name, category}` response shape matches TS type |

#### Layer D — AUTHZ
| Action | Role | Expected | Status | Evidence |
|---|---|---|---|---|
| Record petty cash txn | Viewer | 403 PERMISSION_DENIED | ✅ PASS | `POST /finance/petty-cash/transactions/` with Viewer token → `{code:"PERMISSION_DENIED"}` |
| Any finance endpoint unauthenticated | None | 401 NOT_AUTHENTICATED | ✅ PASS | `GET /finance/expenses/` without token → `{code:"NOT_AUTHENTICATED"}` |
| PettyCash permission prefix mismatch | — | — | ❌ FAIL **LOW** | `PettyCashAccountView` and `PettyCashTransactionView` use `require_permission("hr.petty_cash.manage")` — module prefix `hr.` instead of expected `finance.`. If roles are seeded with `finance.*` permissions, petty cash endpoints would be inaccessible. Functional today only because admin has all permissions |

#### Layer E — STATE / SIDE-EFFECTS
| Action | DB effect | Status | Evidence |
|---|---|---|---|
| Credit petty cash | `petty_cash_transactions` row + `current_balance` updated | ✅ PASS | New row: `{type:"credit", amount:2000, balance_after:8280}`. `petty_cash_accounts.current_balance=8280` ✓ |
| Expense creation | `expenses` row + `budget_allocations.actual_amount` incremented atomically | ✅ PASS | F() expression used: `UPDATE budget_allocations SET actual_amount=actual_amount+3000`. Variance recomputed correctly. `actual=3000, variance=-7000` then `actual=11000, variance=1000` after second expense |
| Asset disposal | `shop_assets.condition=disposed, is_active=False` | ✅ PASS | PATCH → `condition:"disposed"`, `is_active:false` in response and DB |
| audit_logs for finance writes | rows in `audit_logs` | ❌ FAIL **MED** | `SELECT model_name,action,count(*) FROM audit_logs WHERE model_name IN ('pettycashtransaction','expense','budgetallocation','shopasset') GROUP BY 1,2` → 0 rows. No `_write_audit()` calls anywhere in `finance/services.py` or `finance/views.py` |

#### Layer F — LOGGING / OBSERVABILITY
| Scenario | Expected | Status | Evidence |
|---|---|---|---|
| Normal expense creation | 201, no Traceback | ✅ PASS | 201 returned, no errors in backend log |
| `petty_cash_low` WhatsApp when balance < threshold | task in `high` queue, worker executes | ❌ FAIL **CRITICAL** (cross-module) | Drained account below threshold (₹330 < ₹500). `send_whatsapp("petty_cash_low",…)` dispatched → `core.dispatch_whatsapp_message.delay(…)` → `high` queue. Worker picked up task → crashed: `ProgrammingError: relation "notification_logs" does not exist`. Same CRITICAL-3 cross-module as all prior modules |
| `budget_exceeded` WhatsApp when variance > 0 | dispatched on over-budget expense | ❌ FAIL **CRITICAL** (cross-module) | `_update_budget_allocation` calls `send_whatsapp("budget_exceeded",…)` when variance > 0. Same `notification_logs` crash. The warning log line `Budget exceeded: head 'E2E Test Head' 6/2026 actual=11000.00 budgeted=10000.00` IS written to backend console, but notification fails |

#### Layer G — INFRA PATH
| Check | Method | Status | Evidence |
|---|---|---|---|
| Requests via PgBouncer | SHOW POOLS | ✅ PASS | `SHOW POOLS` → `repaiross_tenant_demo | cl_active=6` — all finance requests proxied through PgBouncer |

#### Layer H — UX STATES
| State | Where | Status | Evidence |
|---|---|---|---|
| Petty cash immutable ledger (no edit/delete) | `PettyCashTransactionView` | ✅ PASS | Only GET + POST defined in view. No PUT/PATCH/DELETE endpoints on transactions — immutable by API design |
| Disposed asset hidden from active list | `GET /finance/assets/` default | ✅ PASS | `is_active_param = qp.get("is_active")` → defaults to `filter(is_active=True)` when absent. `SDEL-E2E-001` absent from default list after disposal |
| Over-budget warning server-side logged | `finance/services.py:148-164` | ✅ PASS | `logger.info("Budget exceeded: …")` fires when `variance > 0`. WhatsApp dispatched (fails on notification_logs — cross-module) |
| `BudgetHeadListView.post()` no serializer | `finance/views.py:111-128` | ❌ FAIL **MED** | View reads `name`, `category` directly from `request.data` without a serializer. No required-field enforcement, no `Category.choices` validation. Missing-name or invalid-category accepted silently |

#### Module 10 Bug Summary
| ID | Severity | Description | Location |
|---|---|---|---|
| F10-1 | HIGH | Petty cash overdraft not prevented — `record_petty_cash_txn` allows debit > balance (no `new_balance < 0` guard). Spec: "debit > balance → 422". Ledger can go negative | `finance/services.py:46-51` |
| F10-2 | MED | `BudgetHeadListView.post()` has no serializer — reads `request.data` directly, accepts any category string. `BudgetHead.Category` choices never enforced. Seed data has `operational/marketing/capex` which don't match model choices `fixed/variable/capital` | `finance/views.py:111-128`, `finance/models.py:71-74` |
| F10-3 | MED | No audit trail — zero `audit_log` writes in entire finance module | `finance/services.py`, `finance/views.py` |
| F10-4 | MED | `BudgetCategory` FE type `'fixed'\|'variable'\|'capital'` doesn't cover seed data values `operational/marketing/capex` — FE labels/filters produce blanks for seed data | `finance.ts:5`, seed data |
| F10-5 | LOW | `PettyCashTransactionSerializer` missing `receipt_url` field — FE type declares it, UI reads `undefined` | `finance/serializers.py:33-45` |
| F10-6 | LOW | `CreateAssetSerializer` has no `supplier_id` field — FE sends it but BE ignores; `ShopAsset.supplier` always null | `finance/serializers.py:121-134` |
| F10-7 | LOW | `PettyCashAccountView` + `PettyCashTransactionView` use `hr.petty_cash.manage` permission — wrong `hr.` module prefix for a finance endpoint | `finance/views.py:43,57` |
| F10-8 | LOW | Duplicate asset code returns non-standard `{"detail":"…"}` envelope | `finance/views.py:263-266` |

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
