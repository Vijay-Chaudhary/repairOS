# Module 09 — HR & Payroll (Frontend)

> Pairs with backend `modules/09-hr-payroll.md`. Employees, attendance, leave, salary slips.

## 1. Screens & routes
| Screen | Route | Reach |
|---|---|---|
| Employees | `/hr/employees` | hr.employees.view |
| Employee detail | `/hr/employees/[id]` | hr.employees.view |
| Attendance | `/hr/attendance` | hr.attendance.view/mark |
| Leave requests | `/hr/leave` | hr.leaves.manage |
| Salary slips | `/hr/salary` | hr.salary.view/generate |

## 2. Navigation & layout
Attendance = month grid (employee × day) with quick mark (present/absent/half/leave); bulk mark. Salary = generate-by-month panel + slip list. Employee detail with masked statutory IDs.

## 3. Components
`AttendanceGrid`, `BulkAttendanceDialog`, `LeaveRequestList` + approve/reject, `SalaryGenerator`, `SalarySlipView` (PDF), `EmployeeForm` (masked PAN/Aadhar/bank), `LeaveBalanceCard` (🔧 if balance tracked).

## 4. Forms & validation
- Employee: code unique, salary components, statutory IDs (masked input, encrypted server-side).
- Attendance bulk: select employees + status + date range.
- Leave: type, dates, days (0.5 half), reason → approve/reject.
- Salary generate: month/year/shop/employees → preview computed net (show proration breakdown) → approve → paid.

## 5. States
Masked IDs reveal on permission. Slip statuses draft/approved/paid. One slip per emp/month enforced (UI prevents duplicate generate). Offline: salary generation blocked.

## 6. API wiring
`/employees/` · `/attendance/bulk/` · `/leave-requests/` · `/leave-requests/{id}/` · `/salary-slips/generate/` · `/salary-slips/{id}/pdf/`. Keys `['employees',f]`, `['attendance',month,shop]`, `['salary',month,year]`.

## 7. Real-time
(none distinct.)

## 8. Permissions in UI
HR Manager tenant-wide; no jobs/sales nav. Salary view vs generate separated.

## 9. Mobile notes
Daily attendance markable on phone; leave approve from notification.

## 10. Acceptance criteria
- [ ] Statutory IDs masked; never shown in list responses.
- [ ] Salary preview matches backend proration formulas.
- [ ] One slip per employee/month enforced in UI.
- [ ] Leave approval reflected in attendance/balance.
