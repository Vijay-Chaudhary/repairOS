# CRM Overhaul — Phase 4: Segments → CRM + builder + bulk-WhatsApp — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:test-driven-development. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Relocate Segments from `/settings/segments` to `/crm/segments` (with a redirect stub), round out the rule builder (`tags`, `min_total_billed`, `customer_type`, `city`), and show the bulk-WhatsApp recipient count **with opt-out excluded before send**.

**Architecture:** Mostly frontend. The backend `evaluate_segment` (`backend/apps/crm/services.py`) already honors all four spec keys plus `min_total_jobs`/`max_total_billed`/`whatsapp_optout` — **no filter change needed**. The one backend addition is a read-only **recipient-count** action so the UI can preview "N recipients · M excluded (opted out)" before queueing. Frontend: move the existing page file to the CRM route, leave a redirect stub (mirroring the Fault-Templates relocation), point the (already CRM-grouped) nav leaf at the new href, render the two missing builder fields, and fetch the count in the bulk dialog.

**Tech Stack:** Django 5 + DRF (pytest); Next.js 14 + TS + React Query (Vitest).

**Source spec:** `docs/superpowers/specs/2026-06-24-crm-overhaul-design.md` (Phase 4).

---

## Key facts (verified against the codebase)

- `services.evaluate_segment` already filters on `tags`, `min_total_billed`, `max_total_billed`, `customer_type`, `city`, `whatsapp_optout`, `min_total_jobs`. **`city` and `customer_type` need no backend work** — only the form must emit them.
- `bulk_whatsapp` (`views.py:450`) already excludes opt-out and returns `{queued, excluded_optout}`, but only **after** queueing. There is **no pre-send count endpoint** — that's the only backend gap.
- The Segments nav leaf is **already in the CRM group** (`AppShell.tsx:67`), pointing at `/settings/segments`. "Remove the Settings nav entry" is already effectively done — just **re-point the href**. `navItems.test.ts:68` asserts `href === '/settings/segments'` and must be updated.
- Redirect-stub pattern to mirror: `frontend/src/app/(app)/settings/fault-templates/page.tsx` (one `redirect('/repair/fault-templates')` call).
- The page already has a working `SegmentFormDialog` (builder) and `BulkWhatsappDialog`, plus `buildFilterRules`/`parseFilterRules`. The form **renders** `tags`, `min_total_billed`, `min_total_jobs` — but **not** `customer_type` (it's in the schema/helpers but has no control) or `city` (absent entirely).
- API client: `crmApi.bulkWhatsapp` exists; add `crmApi.getSegmentRecipientCount`. All segment endpoints are under `/crm/segments/…`.
- `BulkWhatsappDialog` already surfaces `excluded_optout` in its success toast; Phase 4 adds the **pre-send** preview.

## File structure

| File | Responsibility | Change |
|---|---|---|
| `backend/apps/crm/services.py` | `segment_recipient_ids(segment)` helper | Modify |
| `backend/apps/crm/views.py` | `recipient_count` action; refactor `bulk_whatsapp` to use helper | Modify |
| `backend/apps/crm/tests/test_customers.py` | recipient-count tests | Modify |
| `frontend/src/app/(app)/crm/segments/page.tsx` | moved page + `city`/`customer_type` controls + pre-send count | Create (move) |
| `frontend/src/app/(app)/settings/segments/page.tsx` | redirect stub | Replace |
| `frontend/src/app/(app)/crm/segments/__tests__/filterRules.test.ts` | `build`/`parseFilterRules` round-trip incl. `city` | Create |
| `frontend/src/components/shared/AppShell.tsx` | nav href → `/crm/segments` | Modify |
| `frontend/src/components/shared/__tests__/navItems.test.ts` | href assertion | Modify |
| `frontend/src/lib/api/crm.ts` | `getSegmentRecipientCount` | Modify |

---

## Task 1: Backend recipient-count endpoint (TDD)

- [x] **Step 1: Write failing tests**

Append to `TestSegments` in `backend/apps/crm/tests/test_customers.py` (reuse `admin_client`, `shop`):
```python
    def test_recipient_count_excludes_optout(self, admin_client, shop):
        from crm.models import Customer, CustomerSegment
        Customer.objects.create(shop=shop, name="In", phone="+919000223001", total_billed="20000")
        Customer.objects.create(shop=shop, name="Out", phone="+919000223002", total_billed="20000", whatsapp_optout=True)
        seg = CustomerSegment.objects.create(
            name="HV", filter_rules={"min_total_billed": 10000}, is_dynamic=True,
        )
        res = admin_client.get(f"{self.url}{seg.id}/recipient-count/")
        assert res.status_code == status.HTTP_200_OK
        assert res.data == {"total": 2, "recipients": 1, "excluded_optout": 1}
```
Run: `cd backend && python -m pytest apps/crm/tests/test_customers.py::TestSegments::test_recipient_count_excludes_optout --no-cov -q` → FAIL (404 / no route).

- [x] **Step 2: Add the services helper**

In `backend/apps/crm/services.py`, add (near `evaluate_segment`):
```python
def segment_recipient_ids(segment):
    """Return (total_members, opted_in_customer_ids) for a segment."""
    from .models import CustomerSegmentMember
    if segment.is_dynamic:
        qs = evaluate_segment(segment)
        total = qs.count()
        ids = list(qs.filter(whatsapp_optout=False).values_list("id", flat=True))
    else:
        members = CustomerSegmentMember.objects.filter(segment=segment)
        total = members.count()
        ids = list(
            members.filter(customer__whatsapp_optout=False).values_list("customer_id", flat=True)
        )
    return total, ids
```

- [x] **Step 3: Add the action + refactor `bulk_whatsapp`**

In `backend/apps/crm/views.py` `CustomerSegmentViewSet`, add:
```python
    @action(detail=True, methods=["get"], url_path="recipient-count")
    def recipient_count(self, request, pk=None):
        segment = self.get_object()
        total, ids = services.segment_recipient_ids(segment)
        return Response({"total": total, "recipients": len(ids), "excluded_optout": total - len(ids)})
```
Then refactor `bulk_whatsapp` to call `total, customer_ids = services.segment_recipient_ids(segment)` (replacing its inline dynamic/static branching), keeping the `.delay(...)` and the `{queued, excluded_optout}` response identical.

- [x] **Step 4: Run tests green + regression**

Run: `cd backend && python -m pytest apps/crm/tests/test_customers.py::TestSegments --no-cov -q` → PASS.
Run: `cd backend && python -m pytest apps/crm/tests/ --no-cov -q 2>&1 | tail -3` → **0 failed**.

- [x] **Step 5: Commit**

```bash
git add backend/apps/crm/services.py backend/apps/crm/views.py backend/apps/crm/tests/test_customers.py
git commit -m "feat(crm): segment recipient-count endpoint (opt-out excluded, pre-send)"
```

---

## Task 2: Frontend route move + redirect + nav + API (TDD on nav)

- [x] **Step 1: Add the API method**

In `frontend/src/lib/api/crm.ts`, next to `bulkWhatsapp`:
```typescript
  getSegmentRecipientCount: (id: string) =>
    apiGet<{ total: number; recipients: number; excluded_optout: number }>(
      `/crm/segments/${id}/recipient-count/`,
    ),
```

- [x] **Step 2: Move the page**

`git mv "frontend/src/app/(app)/settings/segments/page.tsx" "frontend/src/app/(app)/crm/segments/page.tsx"` (create the `crm/segments` dir). No content change in this step.

- [x] **Step 3: Redirect stub at the old path**

Recreate `frontend/src/app/(app)/settings/segments/page.tsx`:
```tsx
import { redirect } from 'next/navigation';

// Segments moved into the CRM area (Phase 4). Keep this route as a redirect
// so existing links/bookmarks to /settings/segments still resolve.
export default function SegmentsSettingsRedirect() {
  redirect('/crm/segments');
}
```

- [x] **Step 4: Update nav href + its test**

`AppShell.tsx:67` — change the Segments leaf `href` from `/settings/segments` to `/crm/segments`.
`navItems.test.ts:68` — change `.find((c) => c.href === '/settings/segments')` to `'/crm/segments'`. Run:
`cd frontend && npx vitest run src/components/shared/__tests__/navItems.test.ts 2>&1 | tail -5` → PASS.

---

## Task 3: Builder `city` + `customer_type` + pre-send recipient count

All edits in the moved `frontend/src/app/(app)/crm/segments/page.tsx`.

- [x] **Step 1: Failing unit test for filter-rule round-trip**

Export `buildFilterRules` and `parseFilterRules` from the page module (add `export` to both). Create `frontend/src/app/(app)/crm/segments/__tests__/filterRules.test.ts`:
```typescript
import { describe, it, expect } from 'vitest';
import { buildFilterRules, parseFilterRules } from '../page';

describe('segment filter rules', () => {
  it('emits city + customer_type when set', () => {
    const rules = buildFilterRules({
      name: 'x', description: '', is_dynamic: true,
      tags: ['vip'], min_total_billed: 5000, min_total_jobs: 0,
      customer_type: 'business', city: 'Delhi',
    });
    expect(rules).toEqual({ tags: ['vip'], min_total_billed: 5000, customer_type: 'business', city: 'Delhi' });
  });

  it('round-trips city back through parseFilterRules', () => {
    expect(parseFilterRules({ city: 'Mumbai' }).city).toBe('Mumbai');
  });
});
```
Run → FAIL (`city` not on the schema/helpers yet).

- [x] **Step 2: Extend schema + helpers**

In `page.tsx`:
- Add `city: z.string()` to `segmentSchema`.
- `buildFilterRules`: add `if (values.city.trim()) rules.city = values.city.trim();` and keep the existing `customer_type !== 'all'` emit.
- `parseFilterRules`: add `city: typeof rules.city === 'string' ? rules.city : ''`.
- Add `city: ''` to the form `defaultValues` (and use `parsed.city ?? ''`).

- [x] **Step 3: Render the two controls**

In `SegmentFormDialog`, inside the "Filter rules" box, add a `customer_type` `<Select>` (options: All / Individual / Business → values `all`/`individual`/`business`) and a `city` `<Input>` (placeholder "Delhi…"), each as a `FormField`. Mirror the existing field markup.

- [x] **Step 4: Pre-send recipient count in `BulkWhatsappDialog`**

Add a query (enabled while the dialog is open):
```typescript
  const { data: count, isLoading: countLoading } = useQuery({
    queryKey: ['segment-recipient-count', segment.id],
    queryFn: () => crmApi.getSegmentRecipientCount(segment.id),
    enabled: open,
    staleTime: 30_000,
  });
```
Render, above the template input:
```tsx
{countLoading ? (
  <p className="text-body-sm text-[var(--text-muted)]">Counting recipients…</p>
) : count ? (
  <p className="text-body-sm text-[var(--text)]">
    <span className="font-semibold">{count.recipients}</span> recipient{count.recipients !== 1 ? 's' : ''}
    {count.excluded_optout > 0 && (
      <span className="text-[var(--text-muted)]"> · {count.excluded_optout} excluded (opted out)</span>
    )}
  </p>
) : null}
```
Disable Send when `count?.recipients === 0`.

- [x] **Step 5: Run tests + type-check**

Run: `cd frontend && npx vitest run "src/app/(app)/crm/segments/__tests__/filterRules.test.ts" src/components/shared/__tests__/navItems.test.ts 2>&1 | tail -6` → PASS.
Run: `cd frontend && npx tsc --noEmit 2>&1 | grep "error TS" | grep -v "Can.test.tsx" || echo "OK"` → `OK`.

- [x] **Step 6: Commit**

```bash
git add "frontend/src/app/(app)/crm/segments" "frontend/src/app/(app)/settings/segments/page.tsx" \
  frontend/src/components/shared/AppShell.tsx frontend/src/components/shared/__tests__/navItems.test.ts \
  frontend/src/lib/api/crm.ts
git commit -m "feat(crm): move Segments to /crm, add city/customer_type rules + pre-send recipient count"
```

---

## Final verification

- [x] **Backend** — `cd backend && python -m pytest apps/crm/tests/ --no-cov -q 2>&1 | tail -3` → 0 failed; `python manage.py makemigrations crm --check --dry-run` → `No changes detected`.
- [x] **Frontend** — `cd frontend && npx vitest run "src/app/(app)/crm/segments/__tests__/filterRules.test.ts" src/components/shared/__tests__/navItems.test.ts src/lib/api/__tests__/crm.test.ts 2>&1 | tail -6` → all pass; `npx tsc --noEmit … || echo OK` → `OK`.
- [ ] **Manual smoke — live UI** (recommended; needs Docker): nav **CRM → Segments** lands on `/crm/segments`; visiting `/settings/segments` redirects there; create a dynamic segment filtered by `city`; open **WhatsApp** → recipient count (opt-out excluded) shows before send.

---

## Notes / risks

- **No migration** — backend filter logic + model unchanged; only a new read-only action.
- **`git mv`** preserves history for the page; the redirect stub is a fresh file at the old path.
- **`export` on `buildFilterRules`/`parseFilterRules`** is required for the unit test; harmless to the page.
- Keep `min_total_jobs` (already wired) even though the spec lists only four keys — removing a working filter would be a regression; it's additive.
