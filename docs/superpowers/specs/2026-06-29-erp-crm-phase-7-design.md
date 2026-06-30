# ERP/CRM Blueprint — Phase 7 Design (HR module integration + Departments)

**Parent spec:** `docs/superpowers/specs/2026-06-29-erp-crm-navigation-design.md` (§2 Management group, §5 roadmap Phase 7 — HR expansion)

**Status:** Design / scoping. Spec → plan → build.

---

## 1. Scope

### Reality check (why this is smaller than the roadmap's "L")

The roadmap rated HR as "L — largest expansion" assuming a from-scratch build. It is not. The HR
**backend is already fully built** (`apps/hr`): `Employee` (+ detail), `AttendanceRecord` (+ bulk),
`LeaveRequest`, `SalarySlip` (+ generate + PDF), with endpoints in `apps/hr/urls.py` and permissions
already seeded (`hr.employees.view/manage`, `hr.attendance.view/mark`, `hr.leaves.manage`,
`hr.salary.view/generate`, `hr.departments.manage`, `hr.petty_cash.manage`). The frontend **pages also
exist and are built** (`/hr/employees`, `/hr/employees/[id]`, `/hr/attendance`, `/hr/leave`,
`/hr/salary`) — but they are **orphaned from navigation**: HR appears as a single nav *leaf*
(`/hr`, which is only a `redirect('/hr/employees')`).

So Phase 7 is **integration + one net-new feature**, not a from-scratch HR build.

### In scope
- **A. HR nav group + Overview hub** — promote the HR leaf to a nav *group* with children
  (Overview / Employees / Attendance / Leave / Payroll / Departments); build the HR Overview hub to
  replace the `/hr` redirect stub (mirrors `/crm`, `/repair` overview hubs).
- **B. Departments (net-new)** — structured `Department` model + migration + backfill from the existing
  free-text field + Employee FK + CRUD page + employee-form Select. Honours the existing
  `hr.departments.manage` permission.
- **C. Wire orphaned pages** — surface the existing Employees/Attendance/Leave/Payroll pages under the
  HR group (no rebuild).

### Out of scope (decided: "integration only")
- **No redesign** of the existing employee/attendance/leave/payroll pages. They render as-is under the
  new nav. Visual-parity polish is deferred (can be a later sweep).
- HR analytics/dashboards beyond the lightweight Overview KPIs.
- Payroll engine changes, statutory-return exports — unchanged.

### Decisions locked (product owner, 2026-06-30)
1. **Departments = structured model** (new `Department` model + FK on `Employee`), not free-text.
2. **Scope = integration only** (existing HR pages untouched).

---

## 2. Feature A — HR nav group + Overview hub

### Frontend — nav
- In `frontend/src/components/shared/AppShell.tsx`, replace the single Management leaf
  `{ label: 'HR', href: '/hr', permission: 'hr.employees.view' }` with a **group**:
  ```
  { type: 'group', label: 'HR', icon: Users, children: [
    { label: 'Overview',    href: '/hr',             permission: 'hr.employees.view' },
    { label: 'Employees',   href: '/hr/employees',   permission: 'hr.employees.view' },
    { label: 'Attendance',  href: '/hr/attendance',  permission: 'hr.attendance.view' },
    { label: 'Leave',       href: '/hr/leave',       permission: 'hr.leaves.manage' },
    { label: 'Payroll',     href: '/hr/salary',      permission: 'hr.salary.view' },
    { label: 'Departments', href: '/hr/departments', permission: 'hr.departments.manage' },
  ]}
  ```
  Keep it in the **Management** section. Pick per-leaf icons consistent with existing usage
  (Users / CalendarCheck / CalendarDays / Receipt / Building, etc.).
- Update `frontend/src/components/shared/__tests__/navItems.test.ts` for the new group + children
  (count, hrefs, per-leaf permissions).

### Frontend — Overview hub (`/hr/page.tsx`, replace the redirect)
- KPI cards (read existing endpoints; no new backend): **Headcount** (active employees),
  **Present today** (today's attendance), **Pending leave** (open `LeaveRequest`s), **Last payroll
  run** (latest `SalarySlip` period). Quick links into each sub-page. Mirror the `/crm` Overview hub's
  card + React-Query layout, design tokens, skeletons, and empty states.
- Gate the hub on `hr.employees.view`; degrade gracefully when a card's permission is absent.

---

## 3. Feature B — Departments (structured)

### Backend
- **New model** `apps/hr/models.py` `Department(BaseModel)` (tenant-scoped like the rest of HR):
  - `shop` FK → `core.Shop` (PROTECT).
  - `name` (CharField), `code` (CharField, unique per shop), `head` (FK → `Employee`, null, SET_NULL),
    `is_active` (bool, default True). `Meta`: `unique_together = (shop, code)`, index on `shop`.
- **Employee FK**: add `Employee.department_ref = FK(Department, null=True, blank=True, SET_NULL,
  related_name="employees")`. **Keep** the existing free-text `Employee.department` column —
  **deprecate, do not drop** (per project rule). Serializer continues to read the old field during
  transition; new writes set `department_ref`.
- **Migration**: schema migration for `Department` + `Employee.department_ref`, then a **data migration**
  to backfill: for each shop, create a `Department` per distinct non-empty `Employee.department` and
  point `department_ref` at it. Reversible (reverse nulls `department_ref`; document the reverse for the
  auto-created rows in the plan).
- **Endpoints** (follow the existing HR class-based view style in `apps/hr/views.py`/`urls.py`):
  - `GET/POST /api/v1/hr/departments/` — list (read: `hr.employees.view`) / create (`hr.departments.manage`).
  - `GET/PATCH/DELETE /api/v1/hr/departments/<uuid:department_id>/` — detail / update / soft-deactivate
    (write gated `hr.departments.manage`). Deleting a department with employees → 409 or reassign;
    default to **deactivate** (`is_active=False`) rather than hard delete.
  - Serializer + `permission_classes` + tests for each (project rule).

### Frontend
- `frontend/src/lib/api/hr.ts`: add `Department` type and `listDepartments` /
  `createDepartment(...)` / `updateDepartment(id, ...)` / `deactivateDepartment(id)`; add
  `department_id?: string` to the Employee create/update payloads.
- **Departments page** `/hr/departments/page.tsx`: table (name, code, head, headcount, active) with a
  create/edit dialog (name, code, head Select over employees, active toggle). React Query + tokens +
  empty state + `Can permission="hr.departments.manage"` on write actions. Add `qk.hr.departments` to
  `frontend/src/lib/query/keys.ts`.
- **Employee form** (`/hr/employees/[id]/page.tsx`): swap the free-text *Department* input for a
  `Select` of active departments, writing `department_id`. Keep showing the legacy text if an employee
  has no FK yet (transition safety).

---

## 4. Feature C — wire orphaned pages

No rebuild — Feature A's nav group makes `/hr/employees`, `/hr/attendance`, `/hr/leave`, `/hr/salary`
reachable from the sidebar. Verify each still renders under the group and its per-leaf permission
gating matches the page's own guards. Confirm the HR group collapses/expands and active-route
highlighting works (same as Repair/CRM groups).

---

## 5. Cross-cutting requirements
- **Permissions** already exist — no new slugs. Use `hr.departments.manage` for Departments writes.
- **Tenant scoping**: `Department.shop` FK; all queries `select_related`/filtered by shop; no N+1 on the
  Departments table (annotate headcount).
- **No `any`, no `console.log`; App Router default-export only; React Query v5; TS strict.**
- **Migrations reversible**; never drop the legacy `department` column.
- **Tests**: backend — `Department` model + API (perms, isolation, deactivate-with-employees) + the
  backfill data migration; frontend — nav group (`navItems.test.ts`), Departments page (CRUD smoke),
  Overview hub (KPI render). Every new endpoint needs serializer + `permission_classes` + tests.

---

## 6. Build order (each task = its own commit, TDD)
1. **Backend Departments** — model + schema migration + backfill data migration + endpoints +
   serializers + tests. (Feature B backend.)
2. **Frontend Departments** — `hr.ts` API + `qk.hr.departments` + `/hr/departments` page +
   employee-form Select. (Feature B frontend.)
3. **HR Overview hub** — replace `/hr` redirect with the KPI hub. (Feature A hub.)
4. **HR nav group** — AppShell leaf→group + wire orphaned pages + `navItems.test.ts`. (Features A+C.)
5. **Verification** (§7).

---

## 7. Verification (Phase-7 exit criteria)
- Backend: `pytest apps/hr apps/authentication --create-db` → PASS (incl. new Department + backfill tests).
- Migration: `Department` + `department_ref` apply forward cleanly; backfill maps existing free-text;
  migration reverses cleanly (container or CI).
- Frontend: `tsc --noEmit` (0); `vitest run` (all pass); `npm run lint` (clean).
- Nav: HR renders as a group with all six leaves, each gated by its permission; orphaned pages reachable.
- Prod build: containerised `npm run build` exit 0 (CI post-merge job).
- CI deny-list `ci-known-failures.txt` → 0.

---

## Notes for the planner
- **The backend already exists for everything except Departments** — do not rebuild Employees/
  Attendance/Leave/Payroll. The only new model is `Department`.
- **Deprecate, don't drop** the free-text `Employee.department`; backfill into the FK.
- Mirror the established patterns: nav group = Repair/CRM groups; Overview hub = `/crm` hub;
  Departments page = any existing CRUD list (e.g. CRM Segments) for tokens/dialog/empty-state.
- Deactivate over hard-delete for Departments referenced by employees.
