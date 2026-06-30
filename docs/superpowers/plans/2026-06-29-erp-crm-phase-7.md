# ERP/CRM Phase 7 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Promote HR from an orphaned single nav leaf into a full **HR nav group** (Overview / Employees / Attendance / Leave / Payroll / Departments), build the **HR Overview hub**, and add a net-new **structured `Department`** feature (model + backfill + CRUD). The Employees/Attendance/Leave/Payroll backends and pages already exist — this is integration + one new feature, not a rebuild.

**Architecture:** New `hr.Department` model (tenant-scoped via `shop` FK) + `Employee.department_ref` FK (keep the legacy free-text `department` column, deprecated). New `APIView` endpoints under `/api/v1/hr/departments/` (mirroring the existing HR view style: `_shop_ids_for_request` scoping, `RepairOSPageNumberPagination`, `require_permission`). Frontend: `Department` API in `hr.ts`, a `/hr/departments` CRUD page (mirror `crm/segments`), an HR Overview hub replacing the `/hr` redirect, and an AppShell leaf→group conversion.

**Tech Stack:** Django 4.2 + DRF, pytest; Next.js 14 App Router + TS strict, React Query v5, Tailwind, Vitest.

**Spec:** `docs/superpowers/specs/2026-06-29-erp-crm-phase-7-design.md`

---

## Reference patterns (read before starting)

- HR models + `Employee` (free-text `department` at `models.py:57`): `apps/hr/models.py` (`Employee` `SoftDeleteModel`, `BaseModel` for the rest).
- HR view style — `APIView` + `get_permissions()`/`permission_classes`, `_shop_ids_for_request(token)` scoping, `RepairOSPageNumberPagination`, `require_permission("hr.*")`: `apps/hr/views.py` (`EmployeeListCreateView`, `EmployeeDetailView`). Routes: `apps/hr/urls.py`.
- Serializer style — `ModelSerializer` for output + plain `Serializer` for create/update: `apps/hr/serializers.py` (`EmployeeSerializer`, `CreateEmployeeSerializer`).
- Existing HR tests + fixtures (shop, JWT client, perms): `apps/hr/tests/test_hr.py`.
- Permission slug already seeded: `hr.departments.manage` (read uses `hr.employees.view`).
- Frontend CRUD page to mirror (table + create/edit dialog + tokens + empty state + `Can`): `frontend/src/app/(app)/crm/segments/page.tsx`.
- Overview hub to mirror (KPI cards + React Query + skeletons): `frontend/src/app/(app)/crm/page.tsx`.
- HR API client + Employee types: `frontend/src/lib/api/hr.ts`. Query keys are flat (`qk.employees`, `qk.leaves`): `frontend/src/lib/query/keys.ts` — add `qk.departments`.
- Nav (leaf→group; Repair/CRM groups are the template) + its test: `frontend/src/components/shared/AppShell.tsx`, `frontend/src/components/shared/__tests__/navItems.test.ts`.
- Response envelope `{success, data}`; backend tests read `.json()["data"]`.

**Build order:** Task 1 (backend Departments) → Task 2 (frontend Departments) → Task 3 (Overview hub) → Task 4 (nav group + wire) → Task 5 (verify). Each task ends in a commit.

---

## Task 1: Backend — `Department` model + backfill + endpoints

**Files:** `apps/hr/models.py`, `apps/hr/serializers.py`, `apps/hr/views.py`, `apps/hr/urls.py`; migrations (schema + data); `apps/hr/tests/test_departments.py`.

- [x] **Step 1: Failing test** — `apps/hr/tests/test_departments.py` (reuse the shop + JWT `client_with_perms` fixtures from `apps/hr/tests/test_hr.py`):
  - `test_create_department_requires_manage_perm` — POST `/api/v1/hr/departments/` without `hr.departments.manage` → 403.
  - `test_create_and_list_department` — with `["hr.departments.manage"]`, POST `{name, code}` → 201; GET list (read perm `hr.employees.view`) returns it; `.json()["data"]`.
  - `test_department_code_unique_per_shop` — duplicate `code` in same shop → 400.
  - `test_deactivate_department` — PATCH `is_active=false` → 200; stays listable with `is_active=false`.
  - `test_employee_assign_department_fk` — create employee with `department_id` → `department_ref` set.

- [x] **Step 2: Run → FAIL** (404/no route). From `backend/`:
  `python -m pytest apps/hr/tests/test_departments.py -p no:cacheprovider -o addopts="" --create-db -q`

- [x] **Step 3: Model** — `apps/hr/models.py`, add `Department(BaseModel)`:
  - `shop` FK → `core.Shop` (PROTECT, `related_name="departments"`); `name` (CharField 100); `code` (CharField 30); `head` FK → `Employee` (null, blank, SET_NULL, `related_name="headed_departments"`); `is_active` (bool default True).
  - `Meta`: `unique_together = (("shop", "code"),)`, `indexes = [Index(fields=["shop"])]`, `ordering = ["name"]`.
  - Add `Employee.department_ref = FK("Department", null=True, blank=True, SET_NULL, related_name="employees")`. **Keep** the legacy `department` CharField (deprecated — do not drop).

- [x] **Step 4: Migrations** — `python manage.py makemigrations hr` (schema), then a **data migration** (`RunPython`) backfilling: per shop, create a `Department` for each distinct non-empty `Employee.department`, set `employee.department_ref`. Reverse: null `department_ref` (and delete the auto-created rows). Confirm both directions run.

- [x] **Step 5: Serializers** — in `apps/hr/serializers.py`:
  - `DepartmentSerializer(ModelSerializer)` — `id, name, code, head, head_name, is_active, employee_count` (annotate count in the view; `head_name` via `source`).
  - `CreateDepartmentSerializer` / `UpdateDepartmentSerializer` (`Serializer`) — `name`, `code`, `head_id` (optional), `is_active`.
  - Add `department_id` (optional UUID) to `CreateEmployeeSerializer` + `UpdateEmployeeSerializer`; wire it in `EmployeeListCreateView.post` / `EmployeeDetailView.patch` (set `department_ref`).

- [x] **Step 6: Views + routes** — `apps/hr/views.py`:
  - `DepartmentListCreateView(APIView)` — `get_permissions`: POST → `hr.departments.manage`, GET → `hr.employees.view`. GET: `Department.objects.filter` scoped via `_shop_ids_for_request`, `select_related("head")`, `annotate(employee_count=Count("employees"))`, paginated. POST: resolve `shop`, enforce per-shop unique `code` → 400 on dup.
  - `DepartmentDetailView(APIView)` — `hr.departments.manage` for PATCH/DELETE, `hr.employees.view` for GET. DELETE → **deactivate** (`is_active=False`), never hard-delete when employees reference it.
  - `apps/hr/urls.py`: `path("departments/", ...)`, `path("departments/<uuid:department_id>/", ...)`.

- [x] **Step 7: Run → PASS** + `python -m pytest apps/hr -p no:cacheprovider -o addopts="" --create-db -q` (no regressions).

- [x] **Step 8: Commit**
```bash
git add backend/apps/hr/models.py backend/apps/hr/serializers.py backend/apps/hr/views.py backend/apps/hr/urls.py backend/apps/hr/migrations/ backend/apps/hr/tests/test_departments.py
git commit -m "feat(hr): structured Department model + endpoints + Employee FK backfill"
```

---

## Task 2: Frontend — Departments API + page + employee Select

**Files:** `frontend/src/lib/api/hr.ts`, `frontend/src/lib/query/keys.ts`; create `frontend/src/app/(app)/hr/departments/page.tsx`; modify `frontend/src/app/(app)/hr/employees/[id]/page.tsx`; test `frontend/src/app/(app)/hr/departments/__tests__/departments.test.tsx`.

- [ ] **Step 1: API + keys** — in `hr.ts` add `Department` type (`id, name, code, head, head_name, is_active, employee_count`) and `listDepartments()`, `createDepartment(body)`, `updateDepartment(id, body)`, `deactivateDepartment(id)`. Add `department_id?: string` to the employee create/update payload types. In `keys.ts` add `departments: (f?) => ['departments', f] as const`.

- [ ] **Step 2: Departments page** — `/hr/departments/page.tsx`, mirror `crm/segments/page.tsx`: table (name, code, head, employee_count, active) + create/edit dialog (name, code, head `Select` over employees, active toggle). React Query (`qk.departments`), tokens, skeletons, `EmptyState`, `Can permission="hr.departments.manage"` on write controls. Default-export only.

- [ ] **Step 3: Employee form Select** — in `hr/employees/[id]/page.tsx`, replace the free-text *Department* `Input` (~line 175) with a `Select` over active departments writing `department_id`; fall back to showing the legacy `department` text when no FK is set.

- [ ] **Step 4: Test** — `departments.test.tsx`: mock `hr` api; assert the table renders a department row and the create dialog opens. Mock any heavy child as needed (mirror existing HR page tests).

- [ ] **Step 5: Verify** — from `frontend/`: `npx tsc --noEmit` (0); `npx vitest run` (pass).

- [ ] **Step 6: Commit**
```bash
git add frontend/src/lib/api/hr.ts frontend/src/lib/query/keys.ts "frontend/src/app/(app)/hr/departments" "frontend/src/app/(app)/hr/employees/[id]/page.tsx"
git commit -m "feat(hr): Departments CRUD page + employee department Select"
```

---

## Task 3: Frontend — HR Overview hub

**Files:** `frontend/src/app/(app)/hr/page.tsx` (replace redirect); test alongside.

- [ ] **Step 1: Hub** — replace `redirect('/hr/employees')` with a KPI hub mirroring `crm/page.tsx`: cards for **Headcount** (active employees), **Present today** (today's attendance), **Pending leave** (open `LeaveRequest`s), **Last payroll run** (latest `SalarySlip` period) — all from existing endpoints, no new backend. Quick links to each sub-page. Tokens, skeletons, empty states; gate on `hr.employees.view`, degrade per-card when a permission is absent.

- [ ] **Step 2: Verify** — `npx tsc --noEmit` (0); `npx vitest run` (pass).

- [ ] **Step 3: Commit**
```bash
git add "frontend/src/app/(app)/hr/page.tsx"
git commit -m "feat(hr): HR Overview hub (replaces /hr redirect stub)"
```

---

## Task 4: Frontend — HR nav group + wire orphaned pages

**Files:** `frontend/src/components/shared/AppShell.tsx`, `frontend/src/components/shared/__tests__/navItems.test.ts`.

- [ ] **Step 1: Leaf→group** — replace the Management leaf `{ label: 'HR', href: '/hr', permission: 'hr.employees.view' }` with a `group` (label `HR`, icon `Users`) whose children are: Overview `/hr` (`hr.employees.view`), Employees `/hr/employees` (`hr.employees.view`), Attendance `/hr/attendance` (`hr.attendance.view`), Leave `/hr/leave` (`hr.leaves.manage`), Payroll `/hr/salary` (`hr.salary.view`), Departments `/hr/departments` (`hr.departments.manage`). Keep it in the **Management** section; pick per-leaf icons consistent with existing imports.

- [ ] **Step 2: Update nav test** — `navItems.test.ts`: assert the HR group, its six children, hrefs, and per-leaf permissions; remove the old single-leaf assertion.

- [ ] **Step 3: Verify** — `npx tsc --noEmit` (0); `npx vitest run` (pass); `npm run lint -- --no-cache` (clean). Manually confirm the HR group expands and active-route highlighting works (mirror Repair/CRM groups).

- [ ] **Step 4: Commit**
```bash
git add frontend/src/components/shared/AppShell.tsx frontend/src/components/shared/__tests__/navItems.test.ts
git commit -m "feat(hr): HR nav group (Overview/Employees/Attendance/Leave/Payroll/Departments)"
```

---

## Task 5: Final verification

- [ ] **Step 1: Backend** — from `backend/`:
`python -m pytest apps/hr apps/authentication -p no:cacheprovider -o addopts="" --create-db -q` → PASS.

- [ ] **Step 2: Migration reversibility** — schema + backfill migrations apply forward cleanly (covered by `--create-db`); migrate the `hr` app down past the data migration and back up, confirming backfill + reverse run cleanly (container/CI if no local DB).

- [ ] **Step 3: Frontend** — from `frontend/`: `npx tsc --noEmit`; `npx vitest run`; `npm run lint -- --no-cache` → all clean.

- [ ] **Step 4: Production build** — `docker compose exec -e NODE_ENV=production frontend sh -c "npm run build"` → exit 0; `/hr/*` build (container/CI).

- [ ] **Step 5: CI deny-list** — from `backend/`: `grep -vc '^#\|^$' ci-known-failures.txt` → `0`.

---

## Notes for the implementer
- **Backend already exists** for Employees/Attendance/Leave/Payroll — only `Department` is net-new. Do not rebuild the others.
- **Deprecate, don't drop** the legacy free-text `Employee.department`; the data migration backfills it into `department_ref`.
- **Deactivate over hard-delete** for Departments referenced by employees.
- Mirror established patterns: HR views = existing `apps/hr/views.py`; Departments page = `crm/segments`; Overview hub = `crm/page.tsx`; nav group = Repair/CRM groups.
- **No `any`, no `console.log`.** App Router pages export only the default component. React Query v5.
- Local backend test runs may need `--create-db` (new migrations vs. cached test DB); CI runs fresh.
