# Module 08 — Commissions (Frontend)

> Pairs with backend `modules/08-commissions.md`. Rules, technician ledger, payout batches.

## 1. Screens & routes
| Screen | Route | Reach |
|---|---|---|
| Commission rules | `/settings/commission-rules` | settings.commission_rules.manage |
| My commission | `/commissions` | hr.salary.view (technician: own) |
| Technician ledger | `/commissions/[techId]` | hr.salary.view |
| Payout batch | `/commissions?tab=payouts` | hr.salary.generate |

## 2. Navigation & layout
Technician self-view: earned this period, per-job breakdown (job#, SC, rate, amount, paid/unpaid). Manager: pick technician + period → generate payout (draft→approved→paid) with PDF.

## 3. Components
`CommissionRuleForm` (rate, lead_tech_share, effective dates, job type), `CommissionLedgerTable`, `PayoutBuilder`, `PayoutPdf`.

## 4. Forms & validation
- Rule: rate %, lead_tech_share %, effective_from/to (no overlap warning), applies_to_job_type.
- Payout: technician + period → preview unpaid accruals → confirm → marks paid + PDF. Guard against double-pay (already-paid rows excluded).

## 5. States
Technician with no commission → friendly empty. Multi-tech jobs show lead/split. Warranty jobs show ₹0 with note.

## 6. API wiring
`/commissions/rules/` · `/commissions/technician/{id}/` · `/commissions/payouts/`. Keys `['commission',techId,period]`, `['commissionRules']`.

## 7. Real-time
(none.)

## 8. Permissions in UI
Technician sees only own ledger. Rules manage + payout generate gated to manager/admin/HR.

## 9. Mobile notes
Technician commission view is a key motivator — make it a clean mobile card with month switcher.

## 10. Acceptance criteria
- [ ] Self-view shows only own accruals; split shown for multi-tech jobs.
- [ ] Payout preview matches accruals; can't double-pay.
- [ ] Warranty jobs show zero commission.
