# Module 04 — AMC (Frontend)

> Pairs with backend `modules/04-amc.md`. Contracts, scheduled visits, renewals.

## 1. Screens & routes
| Screen | Route | Reach |
|---|---|---|
| Contracts list | `/amc` | amc.contracts.view |
| Contract detail | `/amc/[id]` | amc.contracts.view |
| Visit calendar | `/amc?view=calendar` | amc.visits.schedule |
| Complete visit | `/amc/[id]` (visit action) | amc.visits.complete |

## 2. Navigation & layout
Contracts list with status filter (active/pending_renewal/expired) + expiring-this-month highlight. Contract detail: terms, value, visit schedule (timeline of scheduled/completed/missed), renewal panel. Calendar view of upcoming visits across contracts.

## 3. Components
`ContractCard`, `VisitTimeline`, `VisitCompletionForm` (+ PhotoUploader + SignaturePad), `RenewalPanel`, `MapPicker` (field location).

## 4. Forms & validation
- Contract create: customer, title, value, start/end, visits_per_year (auto interval preview), payment_terms, auto_renew, reminder days.
- Visit completion: work_done (required), issues_found, photos, signature, optional "needs repair → create job" (links job_id).
- Renew: confirm new period + value → triggers renewal invoice.

## 5. States
Empty → CTA. Visit timeline shows missed visits in danger. Renewal due banner within window. Loading skeletons per list.

## 6. API wiring
`/amc/contracts/` · `/amc/contracts/{id}/` · `/amc/contracts/{id}/visits/` · `/amc/visits/{id}/complete/` · `/amc/contracts/{id}/renew/`. Keys `['amc',f]`, `['amc',id]`.

## 7. Real-time
`amc.visit_due` → toast to assigned tech/manager + calendar badge.

## 8. Permissions in UI
Technician: complete assigned visits only (calendar filtered to own). Manager/Admin: all + renewals.

## 9. Mobile notes
Field-technician flow front-and-center: open visit → navigate (map link) → complete with camera + signature on phone, works with queued photo upload if briefly offline.

## 10. Acceptance criteria
- [ ] Visit schedule reflects frequency; missed visits flagged.
- [ ] Completing a visit captures proof and (optionally) spawns a job.
- [ ] Renewal reminder surfaced; renew creates invoice + rolls dates.
