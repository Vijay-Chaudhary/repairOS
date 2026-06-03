# Module 11 — Reports & Analytics

> The real-time dashboard plus the full report catalogue (28 reports), cross-cutting all modules.

## 1. Purpose & scope
Provide the live dashboard widgets and on-demand reports (JSON for screen, async PDF/CSV for export). This module reads across all others; it owns no business tables of its own — only report definitions and export jobs.

## 2. Dependencies
Reads from every module's tables (scoped to the tenant DB connection, shop-filtered by the user's access). Async exports run on Celery medium-priority workers.

## 3. Data model
No persistent business tables. 🔧 PROPOSED — an `export_jobs` table to track async exports:
| Column | Type | Notes |
|---|---|---|
| id | UUID | PK |
| report_type | VARCHAR(100) | |
| filters | JSONB | |
| format | VARCHAR(10) | pdf/csv |
| status | VARCHAR(20) | queued/processing/ready/failed |
| file_url | VARCHAR(500) | S3 signed |
| requested_by | UUID | FK |
| created_at / completed_at | TIMESTAMP | |

## 4. Dashboard widgets
| Widget | Source | Refresh |
|---|---|---|
| Jobs today by status | job_tickets WHERE DATE(created_at)=TODAY | WS job.status_changed |
| Revenue today | payments WHERE DATE(paid_at)=TODAY | WS payment.received |
| Outstanding dues (all) | repair_invoices + sales WHERE outstanding>0 | every 5 min |
| My tasks today | follow_up_tasks WHERE assigned_to=me AND due=TODAY | WS task update |
| AMC visits this week | amc_visits in this week | daily Celery |
| Low stock alerts | inventory_stock WHERE qty<reorder | WS stock.low_alert |
| Contracts expiring this month | amc_contracts end_date in month | daily Celery |
| Budget heads over limit | budget_allocations WHERE actual>budgeted | expense-save signal |

## 5. Report catalogue (28)
| Report | Module | Filters | Export |
|---|---|---|---|
| Revenue Summary | Billing | date_range, shop, invoice_type | PDF, CSV |
| Outstanding Dues (Repair) | Billing | overdue_days, customer, shop | PDF, CSV |
| Outstanding Dues (Wholesale) | POS | overdue_days, customer, shop | PDF, CSV |
| Payment Collection Log | Billing | date_range, method, shop | CSV |
| P&L Summary | Billing+ERP | month, year, shop | PDF |
| Expense by Category | ERP | date_range, shop, category | PDF, CSV |
| Budget vs Actual | ERP | month, year, shop | PDF, CSV |
| Job Status Summary | Repair | date_range, shop, status, tech | PDF, CSV |
| Job Turnaround Time | Repair | date_range, shop, device_type | CSV |
| Warranty Claims | Repair | date_range, shop | CSV |
| Fault Template Usage | Repair | date_range, template | CSV |
| Technician Performance | Repair | month, shop, technician | PDF, CSV |
| Commission Ledger | Repair/HR | month, technician | PDF |
| Lead Conversion | CRM | date_range, source, assigned_to | CSV |
| Customer Acquisition | CRM | date_range, source, shop | CSV |
| Customer Lifetime Value | CRM | as_of_date, segment | CSV |
| AMC Contract Summary | AMC | status, expiry_month, shop | PDF, CSV |
| AMC Visit Compliance | AMC | date_range, contract, tech | CSV |
| AMC Revenue | AMC | date_range, shop | PDF, CSV |
| Inventory Valuation | ERP | as_of_date, shop, category | CSV |
| Stock Movement Ledger | ERP | date_range, variant, shop | CSV |
| Supplier Payable (Aged) | ERP | overdue_days, supplier | PDF, CSV |
| Purchase Summary | ERP | date_range, supplier, shop | PDF, CSV |
| HR Attendance Summary | HR | month, year, shop, employee | PDF, CSV |
| Salary Register | HR | month, year, shop | PDF, CSV |
| Petty Cash Summary | HR | month, shop | PDF, CSV |
| GSTR-1 (Outward) | Billing+POS | month, year, shop | CSV (Tally) |
| GSTR-2 Proxy (Inward) | ERP | month, year, shop | CSV (Tally) |

## 6. API
| Endpoint | Method | Perm |
|---|---|---|
| `/reports/{type}/` | GET | `reports.{module}.view` | fetch JSON |
| `/reports/{type}/export/` | GET | `reports.{module}.view` | async PDF/CSV → export_jobs |

```jsonc
// GET /reports/revenue-summary/?date_from=2026-05-01&date_to=2026-05-31&shop_id=…
// 200 { "success":true,"data":{ "total_revenue":482000,"by_type":{…},"by_day":[…] } }
// GET /reports/revenue-summary/export/?...&format=pdf  → 202 { "export_job_id":"…","status":"queued" }
```

## 7. Real-time events
Consumes all module events to refresh widgets; emits none.

## 8. Notifications
(none.)

## 9. Reports
(this module *is* the reports.)

## 10. Acceptance criteria
- [ ] Every widget refreshes by its specified mechanism (WS / interval / signal).
- [ ] Each report respects the user's shop access (no cross-shop leakage within a tenant).
- [ ] Exports run async; large exports don't block the request.
- [ ] GSTR-1/GSTR-2 CSV import cleanly into Tally.

## 11. Tests
Report figures reconcile against source tables. Shop-access filtering. Export job lifecycle. Tally CSV snapshot. Isolation.

## 12. Open questions
Cross-tenant analytics is platform-level only (master DB aggregates) — out of scope here.
