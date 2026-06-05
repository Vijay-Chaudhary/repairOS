# Module 01 — CRM

> Customer lifecycle from prospect to loyal customer: leads, customer profiles, the communication timeline, follow-up tasks, and segmentation.

---

## 1. Purpose & scope
Manage leads through to conversion, maintain the rich customer profile (the 360° view consumed by every other module), log all communication, drive follow-up tasks, and group customers into segments for bulk WhatsApp.
**Out of scope:** the actual jobs/sales/contracts shown on the profile (owned by Repair/POS/AMC); the customer's financial totals are denormalized counters maintained by Billing.

## 2. Dependencies
| Depends on | For |
|---|---|
| foundation 01/02/03 | shops, users, conventions |
| 02-repair, 03-pos, 04-amc | history shown on customer profile |
| 07-billing | maintains `total_billed`/`total_outstanding` counters |
| 08-notifications infra | bulk + triggered WhatsApp |

## 3. Data model (tenant DB; soft-delete on all)

### 3.1 `leads`
| Column | Type | Notes |
|---|---|---|
| id | UUID | PK |
| shop_id | UUID | FK NOT NULL INDEXED |
| name | VARCHAR(200) | NOT NULL |
| phone | VARCHAR(20) | NOT NULL — E.164 |
| email | VARCHAR(200) | NULL |
| source | VARCHAR(50) | walk_in/whatsapp/referral/google/facebook/other |
| status | VARCHAR(30) | new/contacted/interested/quoted/converted/lost INDEXED |
| lost_reason | TEXT | required if status=lost |
| status_before_lost | VARCHAR(30) | NULL — set to the status at the moment of going to lost; cleared on re-open |
| device_type | VARCHAR(100) | NULL |
| notes | TEXT | NULL |
| assigned_to | UUID | FK→users NULL |
| converted_customer_id | UUID | FK→customers NULL |
| converted_at | TIMESTAMP | NULL |
| created_at | TIMESTAMP | DEFAULT NOW() |

### 3.2 `customers`
| Column | Type | Notes |
|---|---|---|
| id | UUID | PK |
| shop_id | UUID | FK NOT NULL INDEXED |
| name | VARCHAR(200) | NOT NULL |
| phone | VARCHAR(20) | NOT NULL UNIQUE per tenant (normalized) |
| alternate_phone | VARCHAR(20) | NULL |
| email | VARCHAR(200) | NULL |
| address / city | TEXT / VARCHAR(100) | NULL |
| gstin | VARCHAR(15) | NULL — B2B wholesale |
| customer_type | VARCHAR(20) | individual/business DEFAULT individual |
| credit_limit | DECIMAL(12,2) | DEFAULT 0 |
| tags | TEXT[] | e.g. `{vip,cctv,laptop}` |
| total_jobs | INTEGER | DEFAULT 0 — denormalized |
| total_billed | DECIMAL(14,2) | DEFAULT 0 — denormalized (Billing) |
| total_outstanding | DECIMAL(14,2) | DEFAULT 0 — denormalized (Billing) |
| whatsapp_optout | BOOLEAN | DEFAULT FALSE |
| source_lead_id | UUID | FK→leads NULL |
| created_at | TIMESTAMP | DEFAULT NOW() |

### 3.3 `communication_logs`
| Column | Type | Notes |
|---|---|---|
| id | UUID | PK |
| customer_id | UUID | FK NULL |
| lead_id | UUID | FK NULL — **CHECK: one of customer_id/lead_id** |
| type | VARCHAR(30) | call/whatsapp/visit/email/sms/note |
| direction | VARCHAR(10) | inbound/outbound (NULL for notes/visits) |
| summary | TEXT | NOT NULL |
| duration_minutes | INTEGER | NULL (calls) |
| logged_by | UUID | FK→users NOT NULL |
| logged_at | TIMESTAMP | NOT NULL |

### 3.4 `follow_up_tasks`
| Column | Type | Notes |
|---|---|---|
| id | UUID | PK |
| customer_id / lead_id / job_id | UUID | FK NULL (link to any) |
| title | VARCHAR(200) | NOT NULL |
| description | TEXT | NULL |
| due_date | DATE | NOT NULL |
| due_time | TIME | NULL |
| status | VARCHAR(20) | pending/completed/cancelled/overdue INDEXED |
| priority | VARCHAR(10) | low/normal/high |
| assigned_to | UUID | FK→users NOT NULL |
| completed_at / completed_by | TIMESTAMP / UUID | NULL |

### 3.5 `customer_segments` + `customer_segment_members`
`segments`: id, name, description, `filter_rules` JSONB (e.g. `{"tags":["cctv"],"min_total_billed":10000}`), `is_dynamic` DEFAULT TRUE.
`members` (composite PK): segment_id, customer_id, added_at. Dynamic segments recompute membership on read; static are explicit lists.

## 4. Business rules

### 4.1 Lead lifecycle
| Status | → next | WhatsApp |
|---|---|---|
| new | contacted (assign + log first contact) / **lost** | — |
| contacted | interested / **lost** | — |
| interested | quoted (create task / send estimate) / **lost** | — |
| quoted | converted / **lost** | estimate if job created |
| converted | (auto-creates customer) — **terminal** | welcome on first job |
| lost | **re-open** → restores exact prior stage | — |

**Lost rules:**
- `lost_reason` is required on every `→ lost` transition.
- `status_before_lost` is set to the current status before the transition fires.
- Re-open (`→ status_before_lost`): `status` is restored, `status_before_lost` and `lost_reason` are cleared.
- If `status_before_lost` is null (legacy rows), re-open returns 422 `BUSINESS_RULE_VIOLATION`.
- Passing `to_status` ≠ `status_before_lost` when re-opening returns 400 `INVALID_STATUS_TRANSITION`.

**Convert:** creates a `customers` row, sets `converted_customer_id`, `converted_at`, copies `source_lead_id`. Idempotent — re-convert returns existing customer.

### 4.2 Customer profile sections (the 360° view)
Header (name, phone, tags, credit limit, total billed/outstanding, last visit) · Repair History (jobs) · Sales History (POS/wholesale) · AMC Contracts · Communication Timeline (all comms, chronological, filterable) · Follow-up Tasks · Financial Summary (repair+sales+AMC billed, total outstanding).

### 4.3 Merge
`POST /customers/merge/` combines two records: keeps target, repoints all FKs (jobs, sales, contracts, comms, tasks) from source to target, sums denormalized counters, soft-deletes source. Phone uniqueness re-validated.

## 5. Permissions
`crm.leads.view/create/edit/convert`, `crm.customers.view/create/edit/merge`, `crm.communications.log`, `crm.tasks.manage`, `crm.segments.manage`. Receptionist: create customers/leads + log comms. Technician: none (CRM not in scope). Manager/Admin: all.

## 6. API
| Endpoint | Method | Perm | Notes |
|---|---|---|---|
| `/leads/` | GET/POST | leads.view/create | filter status, assigned_to |
| `/leads/{id}/` | PATCH | leads.edit | |
| `/leads/{id}/convert/` | POST | leads.convert | → customer |
| `/customers/` | GET/POST | customers.view/create | search, filter |
| `/customers/{id}/` | PATCH | customers.edit | |
| `/customers/merge/` | POST | customers.merge | `{source_id,target_id}` |
| `/customers/{id}/timeline/` | GET | customers.view | comms timeline |
| `/communications/` | POST | communications.log | |
| `/tasks/` | GET/POST | tasks.manage | filter status/due/assigned |
| `/tasks/{id}/` | PATCH | tasks.manage | update/complete |
| `/segments/` | GET/POST | segments.manage | |
| `/segments/{id}/members/` | GET | segments.manage | |
| `/segments/{id}/bulk-whatsapp/` | POST | segments.manage | bulk send |

```jsonc
// POST /customers/  request
{ "shop_id":"…","name":"Ravi Kumar","phone":"+919812345678","customer_type":"individual","tags":["laptop"] }
// 201 { "success":true,"data":{ "id":"…","name":"Ravi Kumar" } }
// 400 DUPLICATE_PHONE if phone already in tenant
```

## 7. Real-time events
`task.due_soon { task_id, task_title, due_date, customer_name }` → assigned staff.

## 8. Notifications
| Template | Trigger | Recipient | Variables |
|---|---|---|---|
| lead_assigned | lead assigned | staff | lead_name, source, assigned_by |
| task_daily_digest | 8AM Celery | each staff w/ tasks due today | staff_name, task_count, task_list |
| task_overdue | midnight Celery | assignee | task_title, due_date, customer_name |
| (bulk) | segment bulk send | segment members | per-template variables |

## 9. Reports
Lead Conversion (date_range, source, assigned_to), Customer Acquisition, Customer Lifetime Value (as_of, segment). Full: `11-reports`.

## 10. Acceptance criteria
- [ ] Lead convert is idempotent and creates linked customer.
- [ ] Phone unique per tenant; duplicate → 400 DUPLICATE_PHONE.
- [ ] Timeline returns all comm types chronologically, filterable.
- [ ] Merge repoints all FKs, sums counters, soft-deletes source.
- [ ] Dynamic segment membership reflects current `filter_rules`.
- [ ] `whatsapp_optout` respected on bulk send.

## 11. Tests
Unit: lead state machine, merge FK repointing, segment filter eval. Integration: every endpoint happy+error. E2E: lead → comms → convert → customer → job (cross-module). Isolation: Tenant A `GET /customers/` → only A.

## 12. Open questions
OQ-09 (GSTIN hard block vs soft warning) affects B2B customer creation.
