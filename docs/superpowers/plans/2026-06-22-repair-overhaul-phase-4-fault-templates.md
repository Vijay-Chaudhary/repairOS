# Repair Overhaul — Phase 4: Fault Templates under Repair (relocate + fill gaps) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface Fault Templates as a first-class **Repair** page at `/repair/fault-templates` (the overhaul's nav goal), and close the genuine gaps vs. the design spec: **search by name**, a real **soft-delete with confirmation** (distinct from the active toggle), and an **N+1 fix** on the list. The old `/settings/fault-templates` route redirects to the new home.

**Architecture / key finding:** A fully-working Fault Templates CRUD page **already exists** at `frontend/src/app/(app)/settings/fault-templates/page.tsx` (DataTable + `TemplateDialog` with `useFieldArray` parts editing, zod validation, `repair.templates.manage` gating, active toggle, skeleton/empty/error states). The backend `FaultTemplateViewSet` (`backend/apps/repair/views.py:463`) already does full CRUD + nested parts, with `test_fault_templates.py` (11 tests) covering nested create/update + job auto-populate. **Phase 4 does not rebuild any of this** — it relocates the page into the Repair area, adds the Repair nav leaf, redirects the old URL, and adds the three spec gaps. This avoids duplicating working code.

**Tech Stack:** Django 4.2 / DRF, pytest-django (backend); Next.js 14 App Router, TypeScript strict, Tailwind, React Query, react-hook-form + zod, Vitest + RTL (frontend).

**Spec:** `docs/superpowers/specs/2026-06-17-repair-module-overhaul-design.md` (Phase 4).

---

## Scope & decisions

- **Chosen scope (per user):** *Relocate to Repair + fill gaps.* Move the page to `app/(app)/repair/fault-templates/`, add the Repair-group nav leaf, redirect the old Settings route, remove the Settings nav entry, and add: search-by-name, soft-delete-with-confirm, and the list N+1 fix.
- **Permission (real string):** `repair.templates.manage` gates the page, the nav leaf, and every mutation. **There is no `repair.fault_templates.*` permission** — the spec's Phase-1 nav assumption was wrong; the real, seeded string is `repair.templates.manage` (`backend/apps/master/services.py:358`, granted to the admin/manager role at line 415). All gating uses `repair.templates.manage`.
- **Delete vs. Active toggle (the spec's "soft-delete with confirmation"):** today both the active toggle and `DELETE` set `is_active=False` — identical and not a real delete. Phase 4 splits them:
  - **Active toggle** → keeps editing `is_active` (controls visibility in the job-intake template picker). Unchanged.
  - **Delete** → `DELETE /fault-templates/{id}/` becomes a **true soft-delete** via `template.soft_delete(user_id=request.user.id)` (`SoftDeleteModel`, `backend/apps/core/models.py:59`). Soft-deleted rows leave the default manager's queryset, so they vanish from the list. The UI Delete action requires a confirm dialog.
- **N+1 fix:** the list serializes full nested `parts` per row (the edit dialog reads `editing.parts` from row data, so we keep nested parts rather than swapping to a bare count). Fix the N+1 by adding `.prefetch_related("parts")` to the list queryset. The "Parts" column keeps deriving its count from `parts.length`.
- **Search:** server-side `?search=` (case-insensitive `name` / `device_type` / `device_brand`), applied in `FaultTemplateViewSet.list`. A debounced search input is added to the page header.
- **Query key:** reuse the existing `qk.repairTemplates` (`frontend/src/lib/query/keys.ts:24`), extended to take a filters arg so search invalidation stays correct.
- **No pagination change:** templates are low-cardinality; the existing un-paginated list behavior is preserved (cursor pagination on the viewset is untouched and the client keeps reading `{ items }`).
- **Branch:** `feat/repair-overhaul-phase-4` off `master` (which now contains merged Phases 1–3).

## Cross-cutting UX acceptance criteria

- Page lives at `/repair/fault-templates`; the Repair sidebar group shows **Fault Templates** (gated on `repair.templates.manage`); visiting `/settings/fault-templates` redirects there.
- Search narrows the list by name/brand/device; filter-aware empty state ("No templates match" with a clear-search action) vs. the zero-templates empty state.
- Delete uses a confirmation dialog, danger styling, and is visually separated from Edit/toggle; on confirm the row disappears and a toast confirms.
- Visible labels, inline validation, ≥44px targets, no `any`, no `console.log`. Skeleton on load; error with retry via `DataTable`.

---

## File Map

| File | Change |
|---|---|
| `backend/apps/repair/views.py` | `FaultTemplateViewSet`: add `search` filter + `.prefetch_related("parts")` in `list`; make `destroy` a real soft-delete |
| `backend/apps/repair/tests/test_fault_templates.py` | Append: search filter, soft-delete-removes-from-list, prefetch/no-N+1 (query-count), permission on delete |
| `frontend/src/lib/query/keys.ts` | `repairTemplates` takes a filters arg |
| `frontend/src/lib/api/repair.ts` | `listTemplates(shopId, params?)` adds optional `search` |
| `frontend/src/app/(app)/repair/fault-templates/page.tsx` | New home (moved from settings) + search input + Delete-with-confirm |
| `frontend/src/app/(app)/repair/fault-templates/__tests__/page.test.tsx` | Move/extend existing tests; add search + delete-confirm cases |
| `frontend/src/app/(app)/settings/fault-templates/page.tsx` | Replace with a server component that `redirect('/repair/fault-templates')` |
| `frontend/src/app/(app)/settings/layout.tsx` | Remove the Fault Templates settings-nav entry (line ~20) |
| `frontend/src/app/(app)/settings/page.tsx` | Remove the Fault Templates settings card entry (line ~13) |
| `frontend/src/components/shared/AppShell.tsx` | Add Fault Templates leaf to the Repair group (gated `repair.templates.manage`) |
| `frontend/src/components/shared/__tests__/navItems.test.ts` | Add a case for the new leaf |

---

## Task 1: Backend — search filter + N+1 fix + real soft-delete

**Files:**
- Modify: `backend/apps/repair/views.py`
- Test: `backend/apps/repair/tests/test_fault_templates.py` (append)

Context: `FaultTemplateViewSet` (`views.py:463`) is `ShopScopedMixin, GenericViewSet`, perms `repair.templates.manage`, `get_queryset` = `FaultTemplate.objects.filter(self._shop_filter())`, `list` supports only `is_active`, `destroy` sets `is_active=False`. `SoftDeleteModel.soft_delete(user_id)` (`core/models.py:59`) sets `deleted_at`+`deleted_by`; the default `objects` manager filters `deleted_at__isnull=True`.

- [x] **Step 1: Write the failing tests**

Append to `backend/apps/repair/tests/test_fault_templates.py` (reuses existing `admin_client`, `shop`, `template` fixtures; add an `_make_template` helper if not present, or use the existing `template` fixture + extra creates via the API):

```python
@pytest.mark.django_db
class TestFaultTemplateSearchAndDelete:
    def _create(self, admin_client, shop, name, device_type="Smartphone", brand=""):
        res = admin_client.post("/api/v1/repair/fault-templates/", {
            "shop_id": str(shop.id), "name": name, "device_type": device_type,
            "device_brand": brand, "problem_description": "x" * 12, "default_sc": "500",
        }, format="json")
        assert res.status_code == 201
        return res.data["id"]

    def test_search_filters_by_name(self, admin_client, shop):
        self._create(admin_client, shop, "iPhone screen swap")
        self._create(admin_client, shop, "Samsung battery")
        res = admin_client.get("/api/v1/repair/fault-templates/", {"search": "iphone"})
        names = [t["name"] for t in res.data["items"]]
        assert names == ["iPhone screen swap"]

    def test_search_matches_brand_and_device(self, admin_client, shop):
        self._create(admin_client, shop, "Generic", device_type="Laptop", brand="Dell")
        res = admin_client.get("/api/v1/repair/fault-templates/", {"search": "dell"})
        assert len(res.data["items"]) == 1

    def test_delete_soft_deletes_and_removes_from_list(self, admin_client, shop):
        tid = self._create(admin_client, shop, "To Delete")
        d = admin_client.delete(f"/api/v1/repair/fault-templates/{tid}/")
        assert d.status_code == 204
        res = admin_client.get("/api/v1/repair/fault-templates/")
        assert tid not in [t["id"] for t in res.data["items"]]
        from repair.models import FaultTemplate
        assert FaultTemplate.all_objects.get(pk=tid).deleted_at is not None

    def test_delete_requires_manage_permission(self, api_client, shop, admin_client):
        tid = self._create(admin_client, shop, "Guarded")
        # a user lacking repair.templates.manage — reuse the file's no-perm helper/fixture
        # (mirror the permission-denied pattern already used in this test module)
        ...  # build a client without repair.templates.manage and assert 403
```

> Use whatever no-permission client pattern this test module already establishes (see the existing classes / conftest). If none exists, build one the way `test_spare_parts.py` does (`_user_with_perms` + token). The query-count/no-N+1 assertion is optional but recommended: wrap the `list` GET in `django_assert_max_num_queries` (pytest-django) and assert it does not scale with template count after adding `prefetch_related`.

- [x] **Step 2: Run, confirm fail**

```bash
cd /home/appuser/workspace/projects/repairOS/backend
python -m pytest apps/repair/tests/test_fault_templates.py::TestFaultTemplateSearchAndDelete -v --no-cov 2>&1 | tail -25
```
Expected: failures (no `search`; delete sets `is_active` not `deleted_at` so row still in list).

- [x] **Step 3: Implement**

In `backend/apps/repair/views.py`, update `list` and `destroy`:

```python
    def get_queryset(self):
        return FaultTemplate.objects.filter(self._shop_filter())

    def list(self, request, *args, **kwargs):
        qs = self.get_queryset().prefetch_related("parts")
        if active := request.query_params.get("is_active"):
            qs = qs.filter(is_active=active.lower() == "true")
        if search := request.query_params.get("search"):
            qs = qs.filter(
                Q(name__icontains=search)
                | Q(device_type__icontains=search)
                | Q(device_brand__icontains=search)
            )
        page = self.paginate_queryset(qs)
        data = FaultTemplateSerializer(page if page is not None else qs, many=True).data
        if page is not None:
            return self.get_paginated_response(data)
        return Response(data)

    def destroy(self, request, pk=None):
        try:
            template = self.get_queryset().get(pk=pk)
        except FaultTemplate.DoesNotExist:
            from rest_framework.exceptions import NotFound
            raise NotFound("Fault template not found.")
        template.soft_delete(user_id=request.user.id)
        return Response(status=status.HTTP_204_NO_CONTENT)
```

Ensure `from django.db.models import Q` is imported in `views.py` (it almost certainly is — `JobTicketViewSet` search uses it; verify).

- [x] **Step 4: Run, confirm pass**

```bash
python -m pytest apps/repair/tests/test_fault_templates.py -v --no-cov 2>&1 | tail -25
```
Expected: all (existing 11 + new) PASS.

- [x] **Step 5: Regression + commit**

```bash
python -m pytest apps/repair/tests/ --no-cov 2>&1 | tail -8
```
```bash
cd /home/appuser/workspace/projects/repairOS
git add backend/apps/repair/views.py backend/apps/repair/tests/test_fault_templates.py
git commit -m "feat(repair): fault-template search, prefetch parts (no N+1), real soft-delete

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 2: Frontend — query key + API client search param

**Files:**
- Modify: `frontend/src/lib/query/keys.ts`
- Modify: `frontend/src/lib/api/repair.ts`

- [x] **Step 1: Extend the query key**

In `keys.ts`, change `repairTemplates` (line 24) to accept filters so search results cache/invalidate distinctly:
```typescript
  repairTemplates: (filters?: { search?: string }) => ['repair-templates', filters ?? {}] as const,
```
`qk.repairTemplates()` (no arg) still works for blanket invalidation (it produces `['repair-templates', {}]`; mutations should invalidate with the `['repair-templates']` prefix — use `queryClient.invalidateQueries({ queryKey: ['repair-templates'] })` or `qk.repairTemplates()` consistently; pick prefix-invalidation so it catches all search variants).

- [x] **Step 2: Add `search` to the client**

In `repair.ts`, update `listTemplates`:
```typescript
  listTemplates: (shopId: string, params?: { search?: string }) =>
    apiGet<{ items: FaultTemplate[] }>('/repair/fault-templates/', { shop_id: shopId, ...params }),
```

- [x] **Step 3: Typecheck + commit**

```bash
cd /home/appuser/workspace/projects/repairOS/frontend
npx tsc --noEmit 2>&1 | grep "error TS" | grep -v "Can.test.tsx" || echo "OK no errors"
```
```bash
cd /home/appuser/workspace/projects/repairOS
git add frontend/src/lib/query/keys.ts frontend/src/lib/api/repair.ts
git commit -m "feat(repair): fault-template list search param + filter-aware query key

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 3: Frontend — relocate the page to Repair + search + delete-with-confirm

**Files:**
- Create: `frontend/src/app/(app)/repair/fault-templates/page.tsx` (moved from settings, then extended)
- Create: `frontend/src/app/(app)/repair/fault-templates/__tests__/page.test.tsx`

- [x] **Step 1: Move the existing page**

```bash
cd /home/appuser/workspace/projects/repairOS
mkdir -p "frontend/src/app/(app)/repair/fault-templates"
git mv "frontend/src/app/(app)/settings/fault-templates/page.tsx" "frontend/src/app/(app)/repair/fault-templates/page.tsx"
```
(The component is self-contained — `TemplateDialog` lives in the same file. No import path changes needed; all imports are `@/`-absolute.)

- [x] **Step 2: Add search input + wire the query**

In the moved `page.tsx`:
- Add `const [search, setSearch] = useState('')` and `const debouncedSearch = useDebounce(search, 300)` (`@/lib/hooks/useDebounce`).
- Change the query to:
  ```typescript
  queryKey: qk.repairTemplates({ search: debouncedSearch || undefined }),
  queryFn: () => repairApi.listTemplates(activeShopId ?? '', { search: debouncedSearch || undefined }),
  ```
- Add a search `Input` (with a `Search` lucide icon) in the header, left of the New button. Reserve layout space; keep ≥44px.
- Empty state: when `search` is non-empty and zero results, show "No templates match" + a "Clear search" action (`onClick={() => setSearch('')}`); otherwise keep the existing "No templates yet" + "New template" empty state. Pass the conditional strings to `DataTable`'s `emptyTitle`/`emptyDescription`/`emptyAction`.

- [x] **Step 3: Add Delete-with-confirm**

- Import an `AlertDialog` (confirm) — use the repo's existing confirm primitive (`@/components/ui/alert-dialog` if present; otherwise reuse the same confirm pattern Spare Parts/Jobs use for destructive actions — check `components/ui` before introducing anything).
- Add a `Trash2` ghost button in the row actions (inside the existing `<Can permission="repair.templates.manage">`), separated from Edit/toggle, danger-colored.
- On confirm: `deleteMutation.mutate(t.id)` →
  ```typescript
  const deleteMutation = useMutation({
    mutationFn: (id: string) => repairApi.deleteTemplate(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: qk.repairTemplates() }); toast.success('Template deleted'); },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Delete failed'),
  });
  ```
- Keep the existing active/inactive `toggleMutation` as-is (separate control, separate meaning).

- [x] **Step 4: Write/port the page test**

Create `frontend/src/app/(app)/repair/fault-templates/__tests__/page.test.tsx`. Port any existing settings test for this page (if one exists, `git mv` it) and add:
- renders rows from a mocked `listTemplates` (name, parts count);
- typing in search calls `listTemplates` with `{ search: ... }` (allow for debounce — use `findBy`/`waitFor`);
- clicking Delete opens a confirm and, on confirm, calls `deleteTemplate(id)`;
- empty state shows "No templates match" when searching with no results.

Mock pattern: mirror `spare-parts/__tests__/page.test.tsx` (mock `@/lib/api/repair`, `activeShopStore`, `authStore`, `next/navigation`).

- [x] **Step 5: Run + typecheck**

```bash
cd /home/appuser/workspace/projects/repairOS/frontend
npx vitest run "src/app/(app)/repair/fault-templates/__tests__/page.test.tsx" 2>&1 | tail -20
npx tsc --noEmit 2>&1 | grep "error TS" | grep -v "Can.test.tsx" || echo "OK no errors"
```

- [x] **Step 6: Commit**

```bash
cd /home/appuser/workspace/projects/repairOS
git add "frontend/src/app/(app)/repair/fault-templates"
git commit -m "feat(repair): move Fault Templates to /repair, add search + delete-with-confirm

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 4: Frontend — redirect old route + remove Settings nav entries

**Files:**
- Create: `frontend/src/app/(app)/settings/fault-templates/page.tsx` (redirect stub)
- Modify: `frontend/src/app/(app)/settings/layout.tsx`
- Modify: `frontend/src/app/(app)/settings/page.tsx`

- [x] **Step 1: Redirect stub at the old URL**

Recreate `frontend/src/app/(app)/settings/fault-templates/page.tsx` as a server redirect (mirrors `app/(app)/hr/page.tsx`):
```tsx
import { redirect } from 'next/navigation';

export default function FaultTemplatesSettingsRedirect() {
  redirect('/repair/fault-templates');
}
```

- [x] **Step 2: Remove the Settings nav entries**

- `settings/layout.tsx` line ~20 — remove the `{ label: 'Fault Templates', href: '/settings/fault-templates', ... }` item.
- `settings/page.tsx` line ~13 — remove the `{ href: '/settings/fault-templates', ... }` card entry.

- [x] **Step 3: Typecheck + commit**

```bash
cd /home/appuser/workspace/projects/repairOS/frontend
npx tsc --noEmit 2>&1 | grep "error TS" | grep -v "Can.test.tsx" || echo "OK no errors"
```
```bash
cd /home/appuser/workspace/projects/repairOS
git add "frontend/src/app/(app)/settings/fault-templates/page.tsx" "frontend/src/app/(app)/settings/layout.tsx" "frontend/src/app/(app)/settings/page.tsx"
git commit -m "feat(settings): redirect old fault-templates route to /repair; drop settings nav entry

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 5: Frontend — Fault Templates nav leaf in the Repair group

**Files:**
- Modify: `frontend/src/components/shared/AppShell.tsx`
- Test: `frontend/src/components/shared/__tests__/navItems.test.ts`

Context: the Repair group (`AppShell.tsx:56`) currently has Overview / Jobs / Spare Parts. Add Fault Templates as the 4th leaf. Pick a lucide icon distinct from `Wrench`/`Package`/`LayoutDashboard` — `ClipboardList` fits; add it to the lucide import if not present.

- [x] **Step 1: Add the leaf**

In the Repair group's `children`, after the Spare Parts leaf:
```typescript
    { type: 'leaf', label: 'Fault Templates', href: '/repair/fault-templates', icon: ClipboardList, permission: 'repair.templates.manage' },
```

- [x] **Step 2: Extend the nav test**

In `navItems.test.ts`, add to the Repair-group describe:
```ts
  it('includes the Fault Templates leaf gated on repair.templates.manage', () => {
    const ft = repair!.children.find((c) => c.href === '/repair/fault-templates');
    expect(ft).toBeDefined();
    expect(ft!.permission).toBe('repair.templates.manage');
  });
```

- [x] **Step 3: Run + typecheck + commit**

```bash
cd /home/appuser/workspace/projects/repairOS/frontend
npx vitest run src/components/shared/__tests__/navItems.test.ts 2>&1 | tail -12
npx tsc --noEmit 2>&1 | grep "error TS" | grep -v "Can.test.tsx" || echo "OK no errors"
```
```bash
cd /home/appuser/workspace/projects/repairOS
git add frontend/src/components/shared/AppShell.tsx frontend/src/components/shared/__tests__/navItems.test.ts
git commit -m "feat(nav): add Fault Templates leaf to the Repair group

Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>"
```

---

## Task 6: Verification

- [x] **Step 1: Backend**

```bash
cd /home/appuser/workspace/projects/repairOS/backend
python -m pytest apps/repair/tests/ --no-cov 2>&1 | tail -8
```
Expected: all PASS (existing + new fault-template tests).

- [x] **Step 2: Frontend**

```bash
cd /home/appuser/workspace/projects/repairOS/frontend
npx vitest run 2>&1 | tail -15
npx tsc --noEmit 2>&1 | grep "error TS" | grep -v "Can.test.tsx" || echo "OK no errors"
```
Expected: Phase 4 tests pass; `tsc` clean. (Any pre-existing unrelated failure noted in earlier phases may remain — don't fix here.)

- [x] **Step 3: Manual smoke** (demo tenant; see Phase 3 log for env setup — `docker compose up -d`, pgbouncer/backend healthy, `admin@demo.com` / `Demo@1234!`, `X-Tenant-Slug: demo`)

1. Sidebar → Repair → **Fault Templates** (visible only with `repair.templates.manage`). Lands on `/repair/fault-templates`.
2. List shows seeded templates with parts count; **search** by name/brand narrows; clearing search restores; no-match shows "No templates match" + Clear search.
3. **New template** → fill fields + add parts → Create → row appears. **Edit** → change + save. **Active toggle** flips status.
4. **Delete** → confirm dialog → on confirm the row disappears; reload confirms it's gone (soft-deleted, not in list).
5. Visit `/settings/fault-templates` → redirects to `/repair/fault-templates`. Settings nav no longer lists Fault Templates.
6. A user without `repair.templates.manage` sees no Repair→Fault Templates leaf and no create/edit/delete actions.

- [x] **Step 4: Push + PR**

```bash
cd /home/appuser/workspace/projects/repairOS
git push -u origin feat/repair-overhaul-phase-4
gh pr create --base master --title "Repair overhaul — Phase 4: Fault Templates under Repair (relocate + search + delete)" --body "..."
```

---

## Self-Review Notes

- **Spec coverage (Phase 4):** full CRUD page → already existed; this phase **relocates** it under Repair (the overhaul's nav intent), adds **search by name** (Task 1/3), a real **soft-delete with confirmation** (Task 1 backend + Task 3 confirm dialog), and fixes the list **N+1** (Task 1 `prefetch_related`). Check-in form continues to consume templates unchanged (no serializer field removed; `is_active` semantics preserved).
- **No duplication:** the existing `TemplateDialog` + `useFieldArray` parts editor is reused verbatim via `git mv`; no second form is created.
- **Permission correctness:** everything gates on the real, seeded `repair.templates.manage` — not the spec's non-existent `repair.fault_templates.*`.
- **Delete vs. toggle:** intentionally distinct — toggle controls intake-picker visibility (`is_active`); Delete soft-deletes (`deleted_at`) and removes from the page. Both gated and confirmed where destructive.
- **Risk — route move:** the only externally-referenced URL is `/settings/fault-templates`, handled by the redirect stub (Task 4). Grep for any hardcoded link to it before finalizing (`rg "settings/fault-templates"`); update or rely on the redirect.
- **Out of scope:** pagination redesign (templates are low-cardinality); variant-linked parts in the template form (the editor uses `custom_part_name` only today — unchanged); restoring soft-deleted templates (no restore UI this phase).
