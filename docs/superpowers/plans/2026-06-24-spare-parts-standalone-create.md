# Plan — Standalone (job-less) Spare-Part Requests

**Date:** 2026-06-24
**Status:** Merged (PR #6 squashed to master as `ca5db34`; all tasks complete & verified)
**Origin:** Deferred follow-up from Repair Overhaul Phase 3
(`2026-06-18-repair-overhaul-phase-3-spare-parts.md`), which scoped create to job-linked only
because `JobSparePartRequest.job` is a non-nullable FK.

## Goal

Allow creating a spare-part request that is **not bound to a job** (e.g. shop stock
replenishment / anticipatory ordering), surfaced from the existing Spare Parts worklist. The
request still belongs to a **shop** for scoping and the same status workflow
(requested → approved → ordered → received) applies unchanged.

## Approved decision

**Add a `shop` FK and make `job` nullable** (chosen 2026-06-24). Scoping/filters key off
`shop_id` directly instead of `job__shop_id`. Matches the `JobTicket`/`FaultTemplate` shop-FK
pattern. Reversible migration with backfill.

## Progress

- [x] Task 1 — Model + reversible migration (`0002_spare_part_shop_and_optional_job`)
- [x] Task 2 — Service `request_spare_part` shop-first (+ callers: views, seed_demo, test_jobs)
- [x] Task 3 — Serializers (create job_id/shop_id optional; list nullable job + shop fields)
- [x] Task 4 — ViewSet scope/filter/create on `shop_id` (+ `_resolve_shop`)
- [x] Task 5 — Backend tests (standalone create, out-of-scope 404, missing-both 400, job-less review workflow); full `apps/repair` suite green (87 passed)
- [x] Task 6 — Frontend types, create-sheet request-type toggle, job-less worklist rendering
- [x] Task 7 — Frontend tests (stock-mode create, all-shops gating, job-less row) + `tsc` clean

## Non-Goals

- No change to the status workflow, review transitions, or permissions model.
- No new notification templates. Job-less requests reuse the existing urgent-request
  notification with the job number omitted.
- No bulk/standalone PO linkage changes (`po_id` stays a plain UUID).

---

## Backend (`apps/repair`)

### Task 1 — Model + migration
- `JobSparePartRequest`:
  - Add `shop = models.ForeignKey("core.Shop", on_delete=models.PROTECT, related_name="spare_part_requests")`.
  - Change `job` to `null=True, blank=True` (keep `on_delete=CASCADE`).
  - Add `models.Index(fields=["shop", "status"])`.
  - Existing check constraints (`spare_part_needs_variant_or_name`,
    `spare_part_quantity_positive`) are unaffected and stay.
- **Migration (reversible, 3 ops in order):**
  1. Add `shop` as **nullable** FK.
  2. Data migration: `shop_id = job.shop_id` for every existing row (forward); reverse is a
     no-op. Use `apps.get_model`, iterate in batches.
  3. `AlterField` `shop` → non-nullable; `AlterField` `job` → nullable; `AddIndex`.
- Reverse path: drop index, make `job` non-null again, make `shop` nullable, remove `shop`.
  (Reverse is safe only while no job-less rows exist — document this in the migration.)

### Task 2 — Service (`services.py`)
- Refactor `request_spare_part` to be shop-first:
  - New signature `request_spare_part(shop, data, user, job=None)`.
  - Stock check uses `shop.id` (was `job.shop_id`).
  - Create with `shop=shop, job=job, requested_by=user, **data`.
  - Urgent notification: `job_number = job.job_number if job else "—"` (or a "(stock request)"
    label); `shop_id=shop.id`.
- `review_spare_part`: the `received` WhatsApp uses `req.job.job_number` — guard for `job=None`
  (omit/placeholder job number when job-less).
- Update the one existing caller in the job-checkin/job-detail flow to pass `job.shop` + `job`.
  (Grep `request_spare_part(` — there is the viewset caller and any job-scoped view.)

### Task 3 — Serializers (`serializers.py`)
- `SparePartCreateSerializer`:
  - `job_id` → `required=False, allow_null=True`.
  - Add `shop_id = serializers.UUIDField(required=False)`.
  - `validate`: exactly one source of shop — if `job_id` present, shop is derived from the job
    (shop_id optional/ignored); if no `job_id`, `shop_id` is **required**. Keep the existing
    "variant_id or custom_part_name" rule.
- `SparePartRequestListSerializer`:
  - `job_id`, `job_number`, `customer_name`, `device_type` → `allow_null=True` /
    return `None`/`""` when `job` is null (use `default`/`SerializerMethodField` so a missing
    `job` relation doesn't raise).
  - Add `shop_id = serializers.UUIDField(source="shop.id", read_only=True)` and
    `shop_name = serializers.CharField(source="shop.name", read_only=True)`.

### Task 4 — ViewSet (`views.py`)
- `_scoped_qs`: `select_related("shop", "job", "job__customer", "requested_by")`; filter on
  `shop_id__in=shop_ids` (was `job__shop_id__in`).
- `list`: `shop_id` filter → `qs.filter(shop_id=shop_id)` (was `job__shop_id`).
- `create`:
  - If `job_id` provided: look up job in shop scope (unchanged), call
    `services.request_spare_part(job.shop, vd, user, job=job)`.
  - Else: resolve `shop_id` against the caller's allowed shops (404/403 if not in scope), call
    `services.request_spare_part(shop, vd, user)`.

### Task 5 — Tests (`tests/test_spare_parts.py`)
- Standalone create happy path (shop_id, custom_part_name) → 201, `job_id` null.
- Standalone create with `shop_id` outside caller's shops → 403/404.
- Create with neither `job_id` nor `shop_id` → 400.
- Worklist scoping: job-less rows visible only to users in that shop; `shop_id` filter works.
- Review workflow on a job-less request (requested→approved→ordered→received) → OK, no crash
  on the received notification.
- Migration sanity: existing job-linked rows keep their shop after backfill (covered via a
  fixture row created pre-change is N/A in unit tests; assert service sets shop from job).
- Regression: full `apps/repair` suite green.

---

## Frontend

### Task 6 — API types (`lib/api/repair.ts`)
- `SparePartListItem`: `job_id`, `job_number`, `customer_name`, `device_type` →
  `string | null`; add `shop_id: string; shop_name?: string`.
- `createSparePart` body: `job_id?` optional; add `shop_id?: string`.

### Task 7 — Create sheet (`components/repair/SparePartFormSheet.tsx`)
- Add a request-type toggle at the top (create mode only): **For a job** | **Stock (no job)**.
  - "For a job": existing job picker (unchanged); submits `job_id`.
  - "Stock (no job)": no job picker; submits `shop_id` = current `activeShopId`. If
    "All shops" is active, require choosing a shop (small select sourced from the shops the
    user can see) before submit; show inline error otherwise.
- Validation: job-mode requires a job; stock-mode requires a shop. Reuse the existing
  part-name/quantity/urgent fields untouched.

### Task 8 — Worklist rendering (`app/(app)/repair/spare-parts/page.tsx`)
- Render job-less rows gracefully: where a job link/number is shown, show a "Stock request"
  tag (and `shop_name`) instead of a job link; customer/device columns show "—".
- Keep the row clickable for edit; edit of a job-less request keeps it job-less (no job picker).

### Task 9 — Frontend tests
- `SparePartFormSheet.test.tsx`: stock-mode create calls `createSparePart` with `shop_id` and
  no `job_id`; job-mode unchanged; all-shops stock-mode blocks submit until a shop is chosen.
- `spare-parts/page.test.tsx`: a job-less item renders the "Stock request" tag and "—" for
  customer/device, with no broken job link.

---

## Verification

```bash
# Backend
cd /home/appuser/workspace/projects/repairOS/backend
python manage.py makemigrations repair --check --dry-run   # confirm migration captured
python -m pytest apps/repair/tests/ --no-cov 2>&1 | tail -12

# Frontend
cd /home/appuser/workspace/projects/repairOS/frontend
npx vitest run src/components/repair/__tests__/SparePartFormSheet.test.tsx \
  src/app/\(app\)/repair/spare-parts/__tests__/page.test.tsx 2>&1 | tail -15
npx tsc --noEmit 2>&1 | grep "error TS" || echo "OK no errors"
```

Manual smoke (demo tenant, `admin@demo.com` / `Demo@1234!`, `X-Tenant-Slug: demo`):
1. Worklist → New request → **Stock (no job)** → part + qty → Create → row appears tagged
   "Stock request", no job link.
2. Advance it requested→approved→ordered→received; no errors.
3. **For a job** create still works exactly as before.
4. `shop_id` filter narrows to the right shop; job-less rows respect shop scoping.

## Risks / Notes
- **Migration backfill** is the only data-touching step; reverse is documented as safe only
  with no job-less rows present.
- **`request_spare_part` signature change** has callers beyond the viewset — grep and update
  all before running tests.
- Keep `db_table = "job_spare_part_requests"` and the model class name unchanged to avoid a
  rename churn; only the FK nullability + new `shop` column change.
