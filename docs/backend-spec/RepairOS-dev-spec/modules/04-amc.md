# Module 04 — AMC (Annual Maintenance Contracts)

> Turn one-time installations into recurring revenue: service contracts, auto-scheduled visits, renewal reminders, and renewal invoicing.

## 1. Purpose & scope
Manage recurring service agreements: create a contract, auto-schedule visits, complete visits (with signature/photos), remind before expiry, and renew (manual or auto). **Out of scope:** the renewal invoice itself reuses `repair_invoices` (`07-billing`, AD-12); any repair needed during a visit creates a normal job (`02-repair`).

## 2. Dependencies
foundation 01/02/03; `01-crm` (customer); `02-repair` (job_id if a visit needs repair); `07-billing` (renewal invoice). Consumed by CRM profile, Reports.

## 3. Data model (tenant DB; soft-delete on contracts)

### 3.1 `amc_contracts`
| Column | Type | Notes |
|---|---|---|
| id | UUID | PK |
| shop_id | UUID | FK NOT NULL INDEXED |
| customer_id | UUID | FK NOT NULL |
| contract_number | VARCHAR(30) | UNIQUE `{SHOP_CODE}-AMC-{YYYY}-{NNNN}` |
| title | VARCHAR(200) | NOT NULL |
| description | TEXT | NULL |
| status | VARCHAR(20) | active/expired/cancelled/pending_renewal |
| start_date / end_date | DATE | NOT NULL |
| value | DECIMAL(12,2) | NOT NULL |
| payment_terms | VARCHAR(50) | upfront/quarterly/monthly |
| visits_per_year | INTEGER | DEFAULT 0 |
| visit_interval_days | INTEGER | computed `floor(365/visits_per_year)` |
| auto_renew | BOOLEAN | DEFAULT FALSE |
| renewal_reminder_days | INTEGER | DEFAULT 30 |
| next_renewal_notified_at | TIMESTAMP | NULL |
| location_address / lat / lng | | NULL |
| assigned_technician_id | UUID | FK NULL |
| notes | TEXT | NULL |
| created_by | UUID | FK NOT NULL |

### 3.2 `amc_visits`
id, contract_id FK INDEXED, visit_number (seq per contract), scheduled_date, actual_date, status (scheduled/completed/missed/rescheduled/cancelled), technician_id FK, work_done, issues_found, next_visit_date, customer_signature_url, photos TEXT[] (`/{slug}/amc/{contract_id}/visit_{n}/...`), job_id FK NULL (if repair needed).

### 3.3 `amc_renewal_invoices`
id, contract_id FK, invoice_id FK→repair_invoices, renewal_period_start, renewal_period_end, sent_at.

## 4. Business rules
- Contract created → visits auto-scheduled from `visits_per_year` + `start_date` (intervals of `visit_interval_days`).
- Visit completed → next visit auto-created at interval; customer WhatsApp `amc_visit_completed`.
- **Missed visit:** Celery nightly — `scheduled_date < TODAY AND status=scheduled` → `missed` → alert manager.
- **Renewal reminder:** Celery nightly — `end_date − TODAY ≤ renewal_reminder_days` → WhatsApp customer; set `next_renewal_notified_at`.
- **Auto-renewal** (`auto_renew=TRUE`): Celery creates renewal invoice (reuses `repair_invoices`, SAC code, AMC PDF variant) and rolls contract dates forward.

## 5. Permissions
`amc.contracts.view/create/edit`, `amc.visits.schedule/complete`, `amc.renewals.manage`. Technician: complete assigned visits. Manager/Admin: all.

## 6. API
| Endpoint | Method | Perm |
|---|---|---|
| `/amc/contracts/` | GET/POST | contracts.view/create |
| `/amc/contracts/{id}/` | PATCH | contracts.edit |
| `/amc/contracts/{id}/visits/` | GET | visits.schedule |
| `/amc/visits/{id}/complete/` | POST | visits.complete |
| `/amc/contracts/{id}/renew/` | POST | renewals.manage |

```jsonc
// POST /amc/contracts/  request
{ "shop_id":"…","customer_id":"…","title":"CCTV AMC - 4 cameras","value":12000,
  "start_date":"2026-06-01","end_date":"2027-05-31","visits_per_year":4,
  "payment_terms":"upfront","auto_renew":true,"renewal_reminder_days":30 }
// 201 → contract + 4 auto-scheduled visits
// POST /amc/visits/{id}/complete/  { "work_done":"Cleaned + tested all 4","customer_signature_url":"…","photos":["…"] }
```

## 7. Real-time events
`amc.visit_due { contract_id, title, customer_name, scheduled_date }` → technician, manager.

## 8. Notifications
| Template | Trigger | Recipient | Variables |
|---|---|---|---|
| amc_visit_reminder | 2 days before visit | customer | customer_name, contract_title, visit_date, tech_name |
| amc_visit_completed | visit completed | customer | customer_name, contract_title, work_done_summary, report_link |
| amc_visit_missed_alert | visit missed (Celery) | manager | manager_name, contract_title, customer_name, scheduled_date |
| amc_renewal_reminder | within renewal_reminder_days | customer | customer_name, contract_title, expiry_date, renewal_value |
| amc_renewal_invoice | renewed | customer | customer_name, contract_title, invoice_number, new_expiry_date |

## 9. Reports
AMC Contract Summary, AMC Visit Compliance, AMC Revenue. Full: `11-reports`.

## 10. Acceptance criteria
- [ ] Visits auto-scheduled correctly from frequency + start.
- [ ] Completing a visit creates the next and notifies customer.
- [ ] Missed-visit nightly task flips status + alerts.
- [ ] Renewal reminder fires once within window.
- [ ] Auto-renew creates a `repair_invoice` (AMC variant) and rolls dates.

## 11. Tests
E2E: contract → visits → completion w/ signature → renewal reminder → renew → invoice. Celery task tests (missed, reminder, auto-renew). Isolation.

## 12. Open questions
None blocking; renewal billing depends on OQ-01 (Razorpay account model).
