# Module 02 — Repair (Frontend)

> Pairs with backend `modules/02-repair.md`. The daily-driver: intake, the job board, the job detail with its stage workflow, estimates, and warranty.

## 1. Screens & routes
| Screen | Route | Reach |
|---|---|---|
| Job board / list | `/jobs` | repair.jobs.view (tech: own) |
| New job (wizard) | `/jobs/new` | repair.jobs.create |
| Job detail | `/jobs/[id]` | repair.jobs.view |
| Fault templates | `/settings/fault-templates` | repair.templates.manage |

## 2. Navigation & layout
- **Job board**: default a Kanban grouped by status (open · in_progress · on_hold · ready_for_qc · ready_for_pickup · delivered), with a list/table toggle for power users. Filters: shop, technician, priority, date, search (job#, customer, phone, IMEI). VIP/urgent rows visually flagged.
- **Job detail**: header (job#, status badge, priority, customer, device) + sticky bottom action bar (primary next-status action) + tabbed body: Overview · Check-in · Estimate · Stages · Parts · Invoice (link) · Timeline.

## 3. Components
`JobBoard` (Kanban, drag = status change with guard), `DataTable` (list mode), `JobStatusStepper`, `StageWorkflow` (ordered stages, one in-progress), `CheckinForm` (+ `PhotoUploader` + `SignaturePad`), `EstimateBuilder`, `StatusBadge`, `EntityTimeline`, `SparePartRequestSheet`. Shared from foundation.

## 4. Forms & validation
- **New-job wizard** (Stepper): (1) customer — pick existing (`CustomerSearch`) or quick-create; (2) device + problem (`problem_description` ≥10 chars; optional template pre-fills problem/SC/parts); (3) field job? → require map location; (4) check-in form (mandatory) with condition, accessories, photos, signature; (5) review → create. Cannot reach `open` without check-in (mirror backend §4.2).
- **Estimate**: labor_charge, parts_cost (auto from added parts), total auto = sum; send via WhatsApp/in-person.
- **Spare-part request**: catalogued variant search OR free-text part, qty>0, urgent toggle.

## 5. States
Board empty → "No jobs yet — create your first." Each column shows count + skeleton cards while loading. Job not found → 404 empty state. Status-change race (`INVALID_STATUS_TRANSITION`) → toast "this job changed elsewhere" + auto-refresh. Offline → board renders from cache (banner); creating a job is blocked offline (has photos/financial implications) — show "needs connection".

## 6. API wiring
`GET /jobs/` (infinite, key `['jobs',{shopId,filters}]`) · `POST /jobs/` · `GET /jobs/{id}` (`['job',id]`) · `PATCH /jobs/{id}` · `POST /jobs/{id}/checkin/` · `POST /jobs/{id}/status/` (invalidate job + jobs) · `POST /jobs/{id}/stages/` · `POST /jobs/{id}/estimate/` · `POST /jobs/{id}/estimate/respond/` · `POST /jobs/{id}/spare-parts/` · `POST /jobs/{id}/warranty-claim/` · `POST /jobs/{id}/attachments/` · fault-template CRUD.

## 7. Real-time
Subscribe `shop.{id}`: `job.created` → prepend to board; `job.status_changed` → move card + toast; `stage.handoff` → if assigned to me, toast "Job {n} handed to you" + invalidate my jobs.

## 8. Permissions in UI
Create/edit/assign/estimate gated by their codenames (foundation/04). Technician view: board filtered to own jobs, can change own job status + complete own stages + request parts; cannot assign techs, send estimates, or see others' jobs.

## 9. Mobile notes
Kanban scrolls horizontally with snap; on phones default to "my open jobs" list. Check-in photo capture uses device camera; signature full-width. Sticky single primary action ("Start", "Mark ready", "Collect payment") at thumb height.

## 10. Acceptance criteria
- [ ] Cannot create/open a job without a completed check-in (or admin override).
- [ ] Status actions reflect the backend state machine; invalid ones never offered.
- [ ] Stage workflow enforces one in-progress; completing advances + notifies.
- [ ] Estimate total auto-computes; approval reflected on job (SC).
- [ ] Warranty claim disabled past expiry; creates linked SC=0 job.
- [ ] Technician sees only own jobs everywhere.
