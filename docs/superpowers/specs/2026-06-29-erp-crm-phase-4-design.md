# ERP/CRM Blueprint — Phase 4 Design (Repair Depth)

**Date:** 2026-06-29
**Status:** Approved design — ready for implementation planning
**Parent spec:** `docs/superpowers/specs/2026-06-29-erp-crm-navigation-design.md` (§2 Repair group, §5 roadmap Phase 4)
**Predecessors:** Phase 0 (PR #22), Phase 1 (PR #23), Phase 2 (PR #24), Phase 3 (PR #25).

---

## 1. Scope

Four "repair depth" features in the `repair` app. The repair backend is already rich
(`JobEstimate` model + create/respond flow; warranty-claim action; `serial_number`/`imei` on
`JobTicket`), so two of these surface **existing** data through the Phase-0 nav stubs; one is a
read/search enhancement; one is net-new.

| Feature | Nav / placement | Net-new model | Footprint |
|---|---|---|---|
| A. Estimates worklist | Repair › Estimates (`/repair/estimates`) | no | list endpoint + worklist page |
| B. Warranty worklist | Repair › Warranty (`/repair/warranty`) | no | list endpoint + page |
| C. Serial/IMEI device history | job detail + ⌘K search | no | device-history endpoint + search extension + job-detail section |
| D. Job attachments | job detail | **yes (`repair.JobAttachment`)** | model + persist/list endpoints + job-detail UI |

**Locked decisions (from brainstorming):** all four features in scope; Warranty page shows
**active warranties + warranty claims**; device history lives on the **job detail page** (no new
nav); attachments reuse the existing **`PhotoUploader`** to capture an object key/URL (no new
presigned-URL backend — none exists today).

Permission slugs already seeded (Phase 0): `repair.estimates.view`, `repair.warranty.view`.
`repair.jobs.view/edit`, `repair.estimates.send/approve` already exist and are untouched.

**Out of scope:** changing the per-job estimate create/respond flow; real S3 presigned uploads
(reuse existing client-upload pattern); a separate device-history nav item; estimate/warranty
notification producers; estimate PDF.

---

## 2. Feature A — Estimates worklist (`/repair/estimates`)

Cross-job worklist of estimates (the per-job create lives at `/jobs/{id}/estimate/`, untouched).

### Backend
- New `JobEstimateViewSet(ListModelMixin, GenericViewSet)` registered `router.register("estimates", …)`
  on the repair router — **mirrors `crm.LeadQuoteViewSet`** (read-only worklist).
- Permission: `repair.estimates.view` (list).
- `get_queryset`: `JobEstimate.objects.select_related("job", "job__customer")`, **shop-scoped via
  `job__shop`** (resolve `shop_ids`/`is_tenant_wide` from the JWT — `ShopScopedMixin._shop_filter()`
  returns `shop_id__in`, which does **not** apply to `JobEstimate`; filter on `job__shop_id__in`
  instead). Filters: `?status` (draft/sent/approved/rejected/expired), `?date_from/to` on `created_at`.
  Order newest first.
- New `JobEstimateListSerializer` (extends the existing estimate fields) adding `job_id`,
  `job_number`, `customer_name`.

### Frontend
- Replace the `/repair/estimates` stub with a worklist (estimate #, job #, customer, total, status
  badge, sent/valid dates) linking to `/jobs/{job_id}` — mirrors the CRM `/crm/quotes` worklist page.
- `repairApi.listEstimates({ status?, date_from?, date_to?, page? })`; new `qk.estimates(...)` key.

---

## 3. Feature B — Warranty worklist (`/repair/warranty`)

### Backend
- New `GET /repair/warranty/` (`APIView`, like `RepairOverviewView`), gated `repair.warranty.view`,
  shop-scoped via the job's shop. Returns two groups:
  - **active**: jobs with `warranty_expires_at >= today` — `{job_id, job_number, customer_name,
    device, warranty_expires_at, days_remaining}`.
  - **claims**: jobs where `warranty_of_job` is set — `{job_id, job_number, customer_name, device,
    original_job_id, original_job_number, status, created_at}`.
- Logic in `repair/services.py` (`build_warranty_lists(shop_filter)`), `select_related` on
  customer + `warranty_of_job`.

### Frontend
- Replace the `/repair/warranty` stub with a page that toggles **Active** / **Claims** (two
  sections or a tab), rows linking to `/jobs/{job_id}`. `repairApi.getWarranty()`; `qk.warranty()`.

---

## 4. Feature C — Serial/IMEI device history

### Backend
- New `GET /repair/device-history/?serial=&imei=` (`APIView`), gated `repair.jobs.view`, shop-scoped.
  Returns jobs whose `serial_number` or `imei` matches (exact or `icontains` on the provided value),
  newest first: `{job_id, job_number, status, device, created_at}`. Requires at least one of
  `serial`/`imei` (else empty).
- Extend the Phase-2 global ⌘K **job search** (`core/services.global_search`) so the `job` block
  also matches `Q(serial_number__icontains)` / `Q(imei__icontains)` — one-line `Q` addition.

### Frontend
- Add a **Device history** section to the job detail page: when the job has a `serial_number`/`imei`,
  query `device-history` and list other jobs for the same device (excluding the current job), each
  linking to its job. `repairApi.getDeviceHistory({ serial?, imei? })`; `qk.deviceHistory(...)`.

---

## 5. Feature D — Job attachments (net-new)

The `POST /jobs/{id}/attachments/` action is currently a **no-op** ("for now, return 200"). Make it
persist, and add listing.

### Backend
- New model `repair.JobAttachment` (`BaseModel`, reversible migration): `job` FK
  (`related_name="attachments"`), `url` (CharField — object key/URL), `filename` (CharField, blank),
  `content_type` (CharField, blank), `kind` (`TextChoices`: `before`, `after`, `document`; default
  `document`), `uploaded_by` (User, SET_NULL). Meta index `(job, created_at)`.
- Rework the existing `attachments` action on `JobTicketViewSet`:
  - `POST /jobs/{id}/attachments/` `{url, filename?, content_type?, kind?}` → create a
    `JobAttachment` (gated `repair.jobs.edit`), return it.
  - `GET /jobs/{id}/attachments/` → list the job's attachments (gated `repair.jobs.view`).
- New `JobAttachmentSerializer` (`id, url, filename, content_type, kind, uploaded_by_name, created_at`).

### Frontend
- Add an **Attachments** section to the job detail page: list existing attachments (thumbnail/link +
  kind) and add new ones via the existing `PhotoUploader` (collects object URLs), POSTing each as an
  attachment. `repairApi.listAttachments(jobId)` / `repairApi.addAttachment(jobId, body)`;
  `qk.jobAttachments(jobId)`.

---

## 6. Cross-Cutting Requirements

- Per project rules: serializer + `permission_classes` + tests per endpoint; logic in `services.py`;
  `select_related` — no N+1; TS strict, no `any`; Tailwind; React Query; reversible migration.
- **Multi-tenant:** all endpoints shop-scoped via the job's shop / JWT. No hardcoded ids.
- **Tests (before merge):**
  - Estimates list: shape (job_number/customer_name), `?status` filter, shop scoping, permission gate.
  - Warranty list: active vs claims grouping, `days_remaining`, permission gate.
  - Device history: matches by serial and by imei; requires a query; shop scoping. Search extension:
    a job is found by serial/imei via `global_search`.
  - Attachments: POST persists + GET lists; permission gates (view vs edit).
- **Migration** (`JobAttachment`) reversible. **Production build** must pass with `NODE_ENV=production`.

---

## 7. Build Order (independent task-groups)

1. Estimates worklist — backend (viewset + serializer + URL + tests).
2. Estimates worklist — frontend (page + `repairApi`/`qk`).
3. Warranty worklist — backend (endpoint + service + tests).
4. Warranty worklist — frontend (page).
5. Serial/IMEI — device-history endpoint + `global_search` extension + tests.
6. Serial/IMEI — frontend (job-detail Device history section).
7. Job attachments — model + endpoints + serializer + tests.
8. Job attachments — frontend (job-detail Attachments section).
9. Final verification.

---

## 8. Verification (Phase-4 exit criteria)

- `tsc --noEmit` clean · lint clean · all Vitest pass (incl. new tests).
- Backend `pytest apps/repair apps/core apps/authentication` passes (plus new estimate/warranty/
  device-history/attachment tests).
- `JobAttachment` migration applies and reverses cleanly.
- Production build (`NODE_ENV=production`) succeeds; `/repair/estimates` and `/repair/warranty`
  render live data (no ComingSoon); job detail shows Device history + Attachments.
- CI deny-list unchanged (comments-only).
