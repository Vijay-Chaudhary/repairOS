# Module 09 — HR & Payroll

> Employees, attendance, leave, and salary slip generation with PF/ESIC and proration.

## 1. Purpose & scope
Maintain employee records (with encrypted statutory IDs), mark attendance, manage leave, and generate monthly salary slips. **Out of scope:** technician commission (`08-commissions`); petty cash/expenses (`10-finance`).

## 2. Dependencies
foundation 01/02/03; `08-commissions` (advance/commission context for payout). Consumed by Reports.

## 3. Data model (tenant DB; soft-delete on employees)

### 3.1 `employees`
| Column | Type | Notes |
|---|---|---|
| id | UUID | PK |
| shop_id | UUID | FK NOT NULL — primary shop |
| user_id | UUID | FK→users UNIQUE NULL — **single source of User↔Employee link** |
| employee_code | VARCHAR(30) | UNIQUE NOT NULL |
| full_name | VARCHAR(200) | NOT NULL |
| designation | VARCHAR(100) | NOT NULL |
| department | VARCHAR(100) | NULL |
| date_of_joining / date_of_leaving | DATE | |
| employment_type | VARCHAR(20) | full_time/part_time/contract/intern |
| basic_salary / hra / other_allowances / gross_salary | DECIMAL(10,2) | |
| pf_employee / pf_employer / esic_employee / esic_employer | DECIMAL(10,2) | DEFAULT 0 |
| bank_account_number | VARCHAR(30) | column-encrypted AES-256 |
| bank_ifsc | VARCHAR(11) | |
| pan_number | VARCHAR(10) | column-encrypted |
| aadhar_number | VARCHAR(12) | column-encrypted |

> 🔧 **PROPOSED:** `users.employee_id` removed; `employees.user_id` is the one-directional link (foundation/02 §2).

### 3.2 `attendance_records`
id, employee_id FK INDEXED, date, status (present/absent/half_day/leave/holiday/weekend), check_in, check_out, overtime_hours DEFAULT 0, notes, **UNIQUE(employee_id, date)**.

### 3.3 `leave_requests`
id, employee_id FK, leave_type (casual/sick/earned/unpaid/maternity/paternity), from_date, to_date, days (0.5 for half-day), reason, status (pending/approved/rejected), approved_by, approved_at.

### 3.4 `salary_slips`
id, employee_id FK, month (1-12), year, working_days, present_days, leave_days, absent_days, overtime_hours, basic_earned, hra_earned, allowances_earned, overtime_amount, gross_earned, pf_deduction, esic_deduction, advance_deduction, other_deductions, total_deductions, net_salary, status (draft/approved/paid), pdf_url, **UNIQUE(employee_id, month, year)**.

## 4. Business rules — salary calculation
```
basic_earned        = basic_salary × (present_days + leave_days) / working_days
hra_earned          = hra            × (present_days + leave_days) / working_days
allowances_earned   = other_allowances × (present_days + leave_days) / working_days
overtime_amount     = overtime_hours × (basic_salary / (working_days × 8))
gross_earned        = basic_earned + hra_earned + allowances_earned + overtime_amount
total_deductions    = pf_deduction + esic_deduction + advance_deduction + other_deductions
net_salary          = gross_earned − total_deductions
```
- Leave approval decrements balances (balance model per leave_type — 🔧 confirm leave-balance tracking; v3.1 lists types but no balance ledger).
- 🔧 PROPOSED (OQ-08): salary advance given to employee → `advance_deduction` on next slip. Confirm whether advances are tracked as a ledger.
- One slip per employee/month/year (UNIQUE). Generation: draft → approved → paid; PDF on generation.

## 5. Permissions
`hr.employees.view/manage`, `hr.attendance.view/mark`, `hr.leaves.manage`, `hr.salary.view/generate`. HR Manager: tenant-wide. No job/sales access.

## 6. API
| Endpoint | Method | Perm |
|---|---|---|
| `/employees/` | GET/POST | employees.view/manage |
| `/attendance/bulk/` | POST | attendance.mark |
| `/leave-requests/` | POST | leaves.manage |
| `/leave-requests/{id}/` | PATCH | leaves.manage (approve/reject) |
| `/salary-slips/generate/` | POST | salary.generate |
| `/salary-slips/{id}/pdf/` | GET | salary.view |

```jsonc
// POST /salary-slips/generate/  { "month":5,"year":2026,"shop_id":"…","employee_ids":["…"] }
// 201 → slips with computed net_salary
```

## 7. Real-time events
(none distinct.)

## 8. Notifications
| Template | Trigger | Recipient | Variables |
|---|---|---|---|
| leave_request_manager | leave submitted | manager | manager_name, employee_name, leave_type, from_date, to_date |
| leave_decision_employee | approved/rejected | employee | employee_name, leave_type, status, from_date, manager_note |
| salary_slip_ready | slip generated | employee | employee_name, month_year, net_salary, slip_link |

## 9. Reports
HR Attendance Summary, Salary Register. Full: `11-reports`.

## 10. Acceptance criteria
- [ ] Salary proration matches the formulas exactly.
- [ ] One slip per employee/month/year enforced.
- [ ] Statutory IDs encrypted at rest; never returned in plain list responses.
- [ ] Leave approval reflects in attendance + (if tracked) balance.
- [ ] Slip status draft → approved → paid; PDF generated.

## 11. Tests
Payroll cycle E2E: mark attendance (month) → generate slips → approve → paid → PDF. Proration edge cases (half-days, overtime). Encryption at rest. Isolation.

## 12. Open questions
OQ-07 (biometric attendance v3.1/v4.0), OQ-08 (advance tracking), 🔧 leave-balance ledger.
