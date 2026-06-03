# Module 08 — Commissions

> Technician commission on repair labor (service charge), accrued per job and paid in batches.

## 1. Purpose & scope
Define commission rules, accrue commission per technician per job (on the service charge), and generate payout batches with PDFs. **Out of scope:** product-sale margins (AD-10: commission is repair labor only); salary (`09-hr-payroll`).

## 2. Dependencies
foundation 01/02/03; `02-repair` (job, `service_charge`, `job_stages`, technicians); `09-hr-payroll` (payout can feed salary advance/deduction context). Consumed by Reports, HR.

## 3. Data model (tenant DB)

### 3.1 `commission_rules`
| Column | Type | Notes |
|---|---|---|
| id | UUID | PK |
| name | VARCHAR(100) | NOT NULL |
| rate | DECIMAL(5,2) | NOT NULL — e.g. 30.00 = 30% |
| lead_tech_share | DECIMAL(5,2) | DEFAULT 50.00 — % of pool to lead tech if 2+ techs |
| applies_to_job_type | VARCHAR(100) | NULL = all |
| effective_from | DATE | NOT NULL |
| effective_to | DATE | NULL = active |

> 🔧 **PROPOSED:** dropped the single-value `base` enum (`sc`). AD-10 fixes the base as service charge, so the column carried no information.

### 3.2 `technician_commissions`
id, job_id FK, technician_id FK, stage_id FK NULL, is_lead BOOLEAN, sc_amount (SC at calc time), rate, commission_amount, is_paid BOOLEAN DEFAULT FALSE, payout_id FK NULL.

### 3.3 `commission_payouts`
id, technician_id FK, period_start, period_end, total_commission, status (draft/approved/paid), paid_at, paid_by FK, pdf_url (S3).

## 4. Business rules
- **Base = service charge only** (AD-10). Commission accrues at job closure on final `job.service_charge`.
- **Single technician:** `commission_amount = service_charge × rate%`.
- **Multiple technicians** (multi-stage): pool = `service_charge × rate%`; lead tech gets `lead_tech_share%` of pool, remainder split equally among the other contributing techs (those with a `job_stages` assignment). `is_lead` marks the lead.
- **Warranty jobs:** SC=0 → commission=0.
- Rule resolution: pick the rule where `effective_from ≤ closed_date < COALESCE(effective_to, ∞)` and `applies_to_job_type` matches (NULL = all).
- **Payout batch:** sums unpaid `technician_commissions` for a technician in a period → `commission_payouts` (draft → approved → paid), marks rows `is_paid`, generates PDF.

## 5. Permissions
`settings.commission_rules.manage` (rules), `hr.salary.view` (technician ledger), `hr.salary.generate` (payout batch). Technician: view own ledger.

## 6. API
| Endpoint | Method | Perm |
|---|---|---|
| `/commissions/rules/` | GET/POST | commission_rules.manage |
| `/commissions/technician/{id}/` | GET | hr.salary.view (own for technician) |
| `/commissions/payouts/` | POST | hr.salary.generate |

```jsonc
// POST /commissions/payouts/  { "technician_id":"…","period_start":"2026-05-01","period_end":"2026-05-31" }
// 201 { "id":"…","total_commission":8400,"status":"draft","pdf_url":"…" }
```

## 7. Real-time events
(none distinct.)

## 8. Notifications
(none distinct; payout PDF delivered in-app/email.)

## 9. Reports
Commission Ledger (month, technician). Technician Performance (shared w/ Repair). Full: `11-reports`.

## 10. Acceptance criteria
- [ ] Commission accrues only on closure, on final SC.
- [ ] Multi-tech split: lead share + equal remainder; sums to pool exactly (no rounding leak).
- [ ] Warranty job → 0 commission.
- [ ] Correct rule selected by date + job type.
- [ ] Payout marks rows paid; cannot double-pay an accrual.

## 11. Tests
Single vs multi-tech split math (incl. rounding to 2 dp). Rule effective-window selection. Double-payout guard. Isolation.

## 12. Open questions
🔧 Confirm multi-tech split formula (lead_tech_share + equal remainder) — derived, not explicit in v3.1.
