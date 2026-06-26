# CRM Overhaul — Phase 2: Leads (mark-lost/convert fixes + filters + re-open) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Make the leads mark-lost and convert features actually work end-to-end (clearing 16 pre-existing failing tests), then add `assigned_to` + date-range filters and verify lead re-open returns a card to its exact prior kanban column.

**Architecture:** Three concerns. (1) Backend contract bugs: `LeadStatusSerializer`/view use `lost_reason` while clients send `reason` (every `→ lost` 422s), and convert returns `{customer_id}` instead of the customer object — fix both so the existing red tests go green. (2) Backend date-range filter on `LeadViewSet`. (3) Frontend: realign stale pipeline-constant tests to the spec contract, add filter UI + chips, and a re-open board test.

**Tech Stack:** Django 5 + DRF (`pytest`), Next.js 14 + TypeScript + React Query + Tailwind (Vitest + Testing Library).

**Source spec:** `docs/superpowers/specs/2026-06-24-crm-overhaul-design.md` (Phase 2, scope corrected 2026-06-25).

---

## Key facts (verified against the codebase)

- The frontend already sends the right things: `crmApi.changeLeadStatus(id, toStatus, reason)` posts `{ to_status, reason }`; `crmApi.convertLead` is typed `apiPost<Customer>`. The **backend** is the side that's wrong.
- `services.transition_lead` (`backend/apps/crm/services.py`) is already correct: it allows `→ lost` from every active stage with a reason and restores `status_before_lost` on re-open. The only bug is that the **view passes an empty reason** because it reads the wrong key.
- `LeadSerializer` already exposes `status` and `status_before_lost` (read-only), so the change-status response carries them.
- `CustomerSerializer` exposes `id`, `phone`, etc. — returning it from convert satisfies the tests.
- `LeadBoard` (`frontend/src/components/crm/LeadBoard.tsx`) already defines the correct transitions (`new: ['contacted','lost']`, …) and a `lost` column; re-open is a per-card menu action targeting `status_before_lost`. It's dead today only because mark-lost 422s.
- The 16 failures are: 11 backend in `apps/crm/tests/test_leads.py` (`TestLeadStatusTransition`, `TestLeadConvertEnhanced`, `TestLeadLostAndReopen`) and 5 frontend in `frontend/src/lib/api/__tests__/crm.test.ts` (`LEAD_TRANSITIONS` ×3, `LEAD_PIPELINE_COLS` ×2). Those tests already exist and encode the desired contract — Tasks 1, 2, 4 make them pass (do not rewrite the backend ones; only realign the 5 stale frontend ones in Task 4).

## File structure

| File | Responsibility | Change |
|---|---|---|
| `backend/apps/crm/serializers.py` | `LeadStatusSerializer.reason` field | Modify |
| `backend/apps/crm/views.py` | `change_status` reads `reason`; `convert` returns customer | Modify |
| `backend/apps/crm/views.py` | `LeadViewSet.get_queryset` date-range filter | Modify |
| `backend/apps/crm/tests/test_leads.py` | (already has the red tests) | unchanged in Tasks 1–2 |
| `backend/apps/crm/tests/test_leads.py` | add date-range filter test | Modify (Task 3) |
| `frontend/src/lib/api/__tests__/crm.test.ts` | realign stale pipeline tests | Modify (Task 4) |
| `frontend/src/lib/api/crm.ts` | `LeadFilters` adds `assigned_to`/`date_from`/`date_to` | Modify (Task 5) |
| `frontend/src/app/(app)/leads/page.tsx` | filter UI (assigned_to, date) + chips | Modify (Task 5) |
| `frontend/src/app/(app)/leads/__tests__/page.test.tsx` | filter + re-open tests | Create/Modify (Tasks 5–6) |

---

## Task 1: Fix mark-lost `reason` field (backend)

The existing tests in `TestLeadStatusTransition` / `TestLeadLostAndReopen` send `{"to_status":"lost","reason":"…"}` and are RED because the serializer/view read `lost_reason`. This task makes them green.

**Files:**
- Modify: `backend/apps/crm/serializers.py` (`LeadStatusSerializer`)
- Modify: `backend/apps/crm/views.py` (`change_status`)

- [x] **Step 1: Confirm the red tests fail for the right reason**

Run: `cd backend && python -m pytest apps/crm/tests/test_leads.py -k "lost or Lost or reopen or Reopen" --no-cov -q 2>&1 | tail -8`
Expected: multiple FAIL with `422 == 200` (lost transition rejected). This is the baseline you will turn green.

- [x] **Step 2: Rename the serializer field to `reason`**

In `backend/apps/crm/serializers.py`, change `LeadStatusSerializer`:

```python
class LeadStatusSerializer(serializers.Serializer):
    to_status = serializers.ChoiceField(choices=Lead.Status.choices)
    reason = serializers.CharField(required=False, allow_blank=True, default="")
```

(Was `lost_reason = serializers.CharField(...)`. The field is the API contract, not the model field; `transition_lead` takes the reason as a positional/keyword arg.)

- [x] **Step 3: Read `reason` in the view**

In `backend/apps/crm/views.py`, in `change_status`, change the reason lookup:

```python
        lead = services.transition_lead(
            lead,
            serializer.validated_data["to_status"],
            request.user,
            serializer.validated_data.get("reason", ""),
        )
```

(Was `.get("lost_reason", "")`.)

- [x] **Step 4: Run the lost/reopen tests — confirm green**

Run: `cd backend && python -m pytest apps/crm/tests/test_leads.py -k "lost or Lost or reopen or Reopen or StatusTransition" --no-cov -q 2>&1 | tail -8`
Expected: all PASS (no more `422 == 200`).

- [x] **Step 5: Commit**

```bash
git add backend/apps/crm/serializers.py backend/apps/crm/views.py
git commit -m "fix(crm): accept 'reason' (not 'lost_reason') on lead status change"
```

---

## Task 2: Fix convert response shape (backend)

`TestLeadConvertEnhanced::test_convert_response_contains_customer_id` and
`test_idempotent_both_calls_return_same_customer_id` expect the convert endpoint to return the
full customer (`id`, `phone`). The view returns `{"customer_id": ...}`.

**Files:** Modify `backend/apps/crm/views.py` (`convert` action).

- [x] **Step 1: Confirm the two convert tests are red**

Run: `cd backend && python -m pytest apps/crm/tests/test_leads.py::TestLeadConvertEnhanced --no-cov -q 2>&1 | tail -8`
Expected: FAIL (`'id' in {'customer_id': ...}` / `KeyError: 'id'`).

- [x] **Step 2: Return the serialized customer**

In `backend/apps/crm/views.py`, change the `convert` action body:

```python
    @action(detail=True, methods=["post"], url_path="convert")
    def convert(self, request, pk=None):
        lead = self.get_object()
        customer = services.convert_lead(lead, request.user)
        return Response(CustomerSerializer(customer).data, status=status.HTTP_200_OK)
```

Confirm `CustomerSerializer` is imported in `views.py` (it is used by `CustomerViewSet`). If it is imported by-name in the `from .serializers import (...)` block, ensure `CustomerSerializer` is in that list; otherwise reference it the same way the `CustomerViewSet` does. Do NOT change the import style.

- [x] **Step 3: Run the convert tests — confirm green**

Run: `cd backend && python -m pytest apps/crm/tests/test_leads.py::TestLeadConvertEnhanced --no-cov -q 2>&1 | tail -6`
Expected: all PASS. (`convert_lead` is already idempotent, so the idempotent test passes once the shape is right.)

- [x] **Step 4: Full backend leads regression**

Run: `cd backend && python -m pytest apps/crm/tests/test_leads.py --no-cov -q 2>&1 | tail -4`
Expected: **0 failed** (all 11 previously-failing backend leads tests now pass).

- [x] **Step 5: Commit**

```bash
git add backend/apps/crm/views.py
git commit -m "fix(crm): lead convert returns the full customer object"
```

---

## Task 3: Leads date-range filter (backend)

**Files:**
- Modify: `backend/apps/crm/views.py` (`LeadViewSet.get_queryset`)
- Modify: `backend/apps/crm/tests/test_leads.py` (append one test)

- [x] **Step 1: Write the failing test**

Append to `backend/apps/crm/tests/test_leads.py` (reuse existing `admin_client` and `shop` fixtures; mirror how other list-filter tests build leads and assert counts — find one with `grep -n "def test_filter\|created_at\|class TestLeadList" apps/crm/tests/test_leads.py` and match its style):

```python
class TestLeadDateFilter:
    url = "/api/v1/crm/leads/"

    def test_date_range_filters_by_created_at(self, admin_client, shop):
        from datetime import timedelta
        from django.utils import timezone
        from crm.models import Lead

        old = Lead.objects.create(shop=shop, name="Old", phone="+919110000301", status="new")
        Lead.objects.filter(pk=old.pk).update(created_at=timezone.now() - timedelta(days=10))
        Lead.objects.create(shop=shop, name="Recent", phone="+919110000302", status="new")

        today = timezone.localdate()
        res = admin_client.get(f"{self.url}?date_from={today.isoformat()}")
        assert res.status_code == 200
        names = [row["name"] for row in res.json()["data"]["items"]]
        assert "Recent" in names and "Old" not in names
```

> Verify the list response envelope shape first: `grep -n "items" apps/crm/tests/test_leads.py` — if the list endpoint returns `data` as a bare list rather than `{"items": [...]}`, adjust the assertion to match the existing list tests in this file.

- [x] **Step 2: Run it, confirm FAIL**

Run: `cd backend && python -m pytest apps/crm/tests/test_leads.py::TestLeadDateFilter --no-cov -q`
Expected: FAIL (`Old` is still present — no date filtering yet).

- [x] **Step 3: Add the filter to `get_queryset`**

In `backend/apps/crm/views.py`, inside `LeadViewSet.get_queryset`, after the existing `assigned_to` filter block and before `return qs.order_by("-created_at")`, add:

```python
        date_from = self.request.query_params.get("date_from")
        if date_from:
            qs = qs.filter(created_at__date__gte=date_from)

        date_to = self.request.query_params.get("date_to")
        if date_to:
            qs = qs.filter(created_at__date__lte=date_to)
```

- [x] **Step 4: Run it, confirm PASS**

Run: `cd backend && python -m pytest apps/crm/tests/test_leads.py::TestLeadDateFilter --no-cov -q`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add backend/apps/crm/views.py backend/apps/crm/tests/test_leads.py
git commit -m "feat(crm): add date-range filter to leads list"
```

---

## Task 4: Realign stale frontend pipeline tests (frontend)

The 5 failing tests in `frontend/src/lib/api/__tests__/crm.test.ts` assert the OLD contract. The
code (`LEAD_TRANSITIONS`, `LEAD_PIPELINE_COLS` in `frontend/src/lib/api/crm.ts`) is spec-correct:
`lost` is reachable from every active stage and is a kanban column. Update the tests to the
correct contract (this is realigning stale tests to spec-correct code, not weakening them).

**Files:** Modify `frontend/src/lib/api/__tests__/crm.test.ts`.

- [x] **Step 1: Confirm which 5 fail**

Run: `cd frontend && npx vitest run src/lib/api/__tests__/crm.test.ts 2>&1 | tail -12`
Expected: 5 failed — `new/contacted/interested only allows …`, `excludes lost …`, `has exactly 5 stages`.

- [x] **Step 2: Update the three transition assertions**

In `crm.test.ts`, replace the three stale `toEqual` assertions so each active stage allows its
forward target AND `lost`:

```typescript
  it('new allows → contacted and → lost', () => {
    const targets = LEAD_TRANSITIONS.new.map(t => t.to);
    expect(targets).toEqual(['contacted', 'lost']);
  });

  it('contacted allows → interested and → lost', () => {
    const targets = LEAD_TRANSITIONS.contacted.map(t => t.to);
    expect(targets).toEqual(['interested', 'lost']);
  });

  it('interested allows → quoted and → lost', () => {
    const targets = LEAD_TRANSITIONS.interested.map(t => t.to);
    expect(targets).toEqual(['quoted', 'lost']);
  });
```

(Leave the already-passing `quoted … toContain('converted')` / `toContain('lost')`, `converted` and `lost` empty-array tests as they are.)

- [x] **Step 3: Update the two pipeline-column assertions**

Replace the `excludes lost` test and the `has exactly 5 stages` test with:

```typescript
  it('includes lost as a kanban column', () => {
    const statuses = LEAD_PIPELINE_COLS.map(c => c.status);
    expect(statuses).toContain('lost');
  });

  it('has all six stages', () => {
    expect(LEAD_PIPELINE_COLS).toHaveLength(6);
  });
```

> Before finalizing, confirm `LEAD_PIPELINE_COLS` has exactly 6 entries (new, contacted, interested, quoted, converted, lost) in `frontend/src/lib/api/crm.ts`. If it has a different count, set the `toHaveLength` number to the actual count and keep the `toContain('lost')` assertion.

- [x] **Step 4: Run the file — confirm green**

Run: `cd frontend && npx vitest run src/lib/api/__tests__/crm.test.ts 2>&1 | tail -6`
Expected: all PASS.

- [x] **Step 5: Commit**

```bash
git add frontend/src/lib/api/__tests__/crm.test.ts
git commit -m "test(crm): realign lead pipeline tests to spec contract (lost is reachable + a column)"
```

---

## Task 5: Leads filters — assigned_to + date-range + chips (frontend)

Add an `assigned_to` filter (users from `settingsApi.listUsers`) and a date-range filter to
`/leads`, with removable active-filter chips, mirroring the existing `source` filter wiring.

**Files:**
- Modify: `frontend/src/lib/api/crm.ts` (`LeadFilters` type)
- Modify: `frontend/src/app/(app)/leads/page.tsx`
- Test: `frontend/src/app/(app)/leads/__tests__/page.test.tsx` (create if absent)

- [x] **Step 1: Extend `LeadFilters`**

In `frontend/src/lib/api/crm.ts`, find the `LeadFilters` interface (used by `crmApi.listLeads`) and add three optional fields:

```typescript
  assigned_to?: string;
  date_from?: string;
  date_to?: string;
```

Confirm `crmApi.listLeads` forwards arbitrary filter keys as query params (it does — it passes the filter object to `apiGet`). No change needed there if so.

- [x] **Step 2: Write the failing filter test**

Create/append `frontend/src/app/(app)/leads/__tests__/page.test.tsx`. Mirror the mock setup from `frontend/src/app/(app)/repair/spare-parts/__tests__/page.test.tsx` (QueryClientProvider, mock `activeShopStore`, `authStore`, `next/navigation`). Additionally mock `@/lib/api/settings` so `settingsApi.listUsers` resolves a small user list, and mock `@/lib/api/crm`'s `listLeads` to capture the filter argument. Assert:

```typescript
it('passes assigned_to into the leads query when a user is selected', async () => {
  // render the page in list view, open the Assignee filter, choose a user,
  // and assert listLeads was called with an object containing assigned_to: '<that user id>'.
});
```

Write the full test using the same patterns as the spare-parts page test (findBy/userEvent). The assertion that matters: `expect(listLeads).toHaveBeenCalledWith(expect.objectContaining({ assigned_to: 'u-1' }))`. Run it and confirm it FAILS (no assignee control yet).

Run: `cd frontend && npx vitest run "src/app/(app)/leads/__tests__/page.test.tsx" 2>&1 | tail -8` → FAIL.

- [x] **Step 3: Add filter state + controls**

In `frontend/src/app/(app)/leads/page.tsx`:
1. Add state next to the existing `sourceFilter`:
```typescript
  const [assignedFilter, setAssignedFilter] = useState<string | 'all'>('all');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
```
2. Load users for the dropdown:
```typescript
  const usersQuery = useQuery({
    queryKey: ['users', 'for-lead-filter'],
    queryFn: () => settingsApi.listUsers({ is_active: true }),
    staleTime: 300_000,
  });
```
(Add `import { settingsApi } from '@/lib/api/settings';`.)
3. Extend `baseFilters` (and its `useMemo` deps) to include:
```typescript
    assigned_to: assignedFilter === 'all' ? undefined : assignedFilter,
    date_from: dateFrom || undefined,
    date_to: dateTo || undefined,
```
4. Render an **Assignee** `<Select>` (mirror the existing source `<Select>` block) populated from `usersQuery.data` (option value = user id, label = full name), and two `<input type="date">` controls bound to `dateFrom`/`dateTo`. Keep them in the same toolbar row as the source filter.

- [x] **Step 4: Add removable active-filter chips**

Below the toolbar, render a chips row for each active non-default filter (source ≠ all, assignee ≠ all, dateFrom, dateTo). Each chip shows the label and an `×` button that resets that filter to its default. Example shape:

```tsx
{(sourceFilter !== 'all' || assignedFilter !== 'all' || dateFrom || dateTo) && (
  <div className="flex flex-wrap gap-2">
    {sourceFilter !== 'all' && (
      <button onClick={() => setSourceFilter('all')} className="text-body-sm rounded-full border border-[var(--border)] px-2 py-0.5">
        Source: {sourceFilter} ×
      </button>
    )}
    {assignedFilter !== 'all' && (
      <button onClick={() => setAssignedFilter('all')} className="text-body-sm rounded-full border border-[var(--border)] px-2 py-0.5">
        Assignee ×
      </button>
    )}
    {dateFrom && (
      <button onClick={() => setDateFrom('')} className="text-body-sm rounded-full border border-[var(--border)] px-2 py-0.5">
        From {dateFrom} ×
      </button>
    )}
    {dateTo && (
      <button onClick={() => setDateTo('')} className="text-body-sm rounded-full border border-[var(--border)] px-2 py-0.5">
        To {dateTo} ×
      </button>
    )}
  </div>
)}
```

- [x] **Step 5: Run the filter test — confirm green; type-check**

Run: `cd frontend && npx vitest run "src/app/(app)/leads/__tests__/page.test.tsx" 2>&1 | tail -8` → PASS.
Run: `cd frontend && npx tsc --noEmit 2>&1 | grep "error TS" | grep -v "Can.test.tsx" || echo "OK"` → `OK`.

- [x] **Step 6: Commit**

```bash
git add frontend/src/lib/api/crm.ts "frontend/src/app/(app)/leads/page.tsx" "frontend/src/app/(app)/leads/__tests__/page.test.tsx"
git commit -m "feat(crm): add assigned_to + date-range filters and chips to leads"
```

---

## Task 6: Verify lead re-open returns to the prior column (frontend)

With mark-lost fixed (Task 1), the re-open flow is live. Add a test proving re-open targets
`status_before_lost` and that the page refreshes the prior-stage column. The re-open action
lives on the lost card in `frontend/src/components/crm/LeadBoard.tsx` and calls
`changeLeadStatus(id, lead.status_before_lost)`.

**Files:**
- Test: `frontend/src/app/(app)/leads/__tests__/page.test.tsx` (append) OR
  `frontend/src/components/crm/__tests__/LeadBoard.test.tsx` (create) — choose whichever isolates
  the re-open action most directly; prefer a `LeadBoard` component test if the re-open menu is
  self-contained there.

- [x] **Step 1: Inspect the re-open action**

Read `frontend/src/components/crm/LeadBoard.tsx` and find the "Re-open" menu action on lost
cards. Confirm it calls the transition handler with the lead's `status_before_lost` as the
target (not a hardcoded stage). If it hardcodes a stage (e.g. always `interested`), FIX it to
use `lead.status_before_lost`.

- [x] **Step 2: Write the failing/guarding test**

Add a test that renders the board (or the lost card) with a lost lead whose
`status_before_lost = 'contacted'`, clicks **Re-open**, and asserts the transition callback fires
with `('<leadId>', 'contacted')`. Use the existing component-test patterns in
`frontend/src/components/crm/__tests__/` (mirror an existing one for render/mocks). The key
assertion:

```typescript
expect(onTransition).toHaveBeenCalledWith(expect.objectContaining({ leadId: '<id>', toStatus: 'contacted' }));
// (match the actual handler signature used by LeadBoard — read it first)
```

Run it: if the action already targets `status_before_lost`, the test passes immediately
(guard test). If it was hardcoded and you fixed it in Step 1, confirm red→green.

- [x] **Step 3: Run the test + type-check**

Run the specific test file with `npx vitest run <path>` → PASS.
Run: `cd frontend && npx tsc --noEmit 2>&1 | grep "error TS" | grep -v "Can.test.tsx" || echo "OK"` → `OK`.

- [x] **Step 4: Commit**

```bash
git add <the test file you added> [frontend/src/components/crm/LeadBoard.tsx if changed]
git commit -m "test(crm): verify lead re-open returns to status_before_lost column"
```

---

## Final verification

- [x] **Backend — full CRM suite green**

Run: `cd backend && python -m pytest apps/crm/tests/ --no-cov -q 2>&1 | tail -4`
Expected: **0 failed** (the 11 previously-failing leads tests + the overview tests + the new date-filter test all pass).
Run: `cd backend && python manage.py makemigrations crm --check --dry-run` → `No changes detected` (no model changes this phase).

- [x] **Frontend — leads + api tests green, tsc clean**

Run: `cd frontend && npx vitest run src/lib/api/__tests__/crm.test.ts "src/app/(app)/leads/__tests__/page.test.tsx" 2>&1 | tail -8` → all pass.
Run: `cd frontend && npx tsc --noEmit 2>&1 | grep "error TS" | grep -v "Can.test.tsx" || echo "OK"` → `OK`.

- [x] **Smoke flow — automated E2E** (stand-in for the live-UI walk-through)

The four manual smoke steps are exercised end-to-end through the wired HTTP endpoints
in `TestLeadSmokeFlowE2E` (`backend/apps/crm/tests/test_leads.py`):
create → advance to quoted → **mark lost** (reason, no 422) → **re-open** to the exact
prior column → **convert** (full customer returned), plus the **assigned_to + date-range**
filters composing. `cd backend && python -m pytest apps/crm/tests/test_leads.py::TestLeadSmokeFlowE2E --no-cov -q` → **2 passed**.

- [ ] **Manual smoke — live UI** (demo tenant, `X-Tenant-Slug: demo`) — *still recommended; could not run in the dev environment (no Docker stack)*

1. Leads → on any active card, **Mark lost** (enter reason) → card moves to the **Lost** column (no 422).
2. On the lost card → **Re-open** → it returns to the **exact prior** column (e.g. a lead lost from "quoted" reappears under Quoted).
3. **Convert** a quoted lead → lands on the new customer (full customer returned).
4. Filter by **Assignee** and by **date range**; chips appear and remove individually.

---

## Notes / risks

- **No migration** this phase — serializer/view/filter changes only.
- **Tasks 1–2 turn existing red tests green** (don't rewrite those backend tests). **Task 4
  realigns 5 stale frontend tests** to the spec-correct code. Keep that distinction clear.
- **Contract change:** the status endpoint now accepts `reason` instead of `lost_reason`. The
  frontend already sends `reason`, so no frontend client change is needed — but grep for any
  other caller of `/leads/{id}/status/` sending `lost_reason` before finalizing
  (`rg "lost_reason" frontend/src`), and update if found.
- **Re-open handler signature** (Task 6) must be read from `LeadBoard.tsx` before writing the
  assertion — match its actual callback shape rather than assuming.
