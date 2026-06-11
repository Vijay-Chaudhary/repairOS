# StaffPicker — Shared Typeahead Component Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every raw "type a UUID" staff input with a single reusable typeahead combobox that queries `/users/` or `/hr/employees/`, shows full name + role/email, and returns just the selected id.

**Architecture:** `StaffPicker.tsx` is a controlled Popover+Input combobox — no new dependencies (Popover already exists). A `source` prop switches between the `/users/` and `/hr/employees/` data sources. The backend gains a `?role=` filter on `/users/`. Five call sites are updated: three user pickers (DefineStagesDialog, commissions payout, CRM TaskComposer), one employee picker (HR leave), and one new optional quick-assign field in the new-job wizard.

**Tech Stack:** React 18, Next.js 14 App Router, TanStack Query v5, Radix Popover (already in project), Tailwind CSS + CSS token variables, `useDebounce` hook (already at `src/lib/hooks/useDebounce.ts`), Django/DRF backend.

---

## Endpoint Shape Confirmed

**`GET /users/?search=&is_active=`**  
Response: `{ items: TenantUser[], meta: PageMeta }`  
`TenantUser`: `{ id, full_name, email, phone, is_active, avatar_url, role_names: string[], role_ids: string[], last_login, created_at }`  
Search scope: full_name, email, phone.  
**Note: `?role=` filter does NOT yet exist** — Task 1 adds it.

**`GET /hr/employees/?search=`**  
Response: `{ items: Employee[], meta: PageMeta }`  
`Employee`: `{ id, employee_code, full_name, designation, department, shop_id, user_id, ... }`  
Search scope: full_name, employee_code.

---

## File Map

| Action | Path | Purpose |
|--------|------|---------|
| **Modify** | `backend/apps/authentication/settings_views.py` | Add `?role=` query-param filter |
| **Modify** | `frontend/src/lib/api/settings.ts` | Add `role?` to `listUsers` filter type |
| **Create** | `frontend/src/components/shared/StaffPicker.tsx` | The reusable typeahead combobox |
| **Modify** | `frontend/src/app/(app)/jobs/[id]/page.tsx` | Wire into `DefineStagesDialog` (line 662) |
| **Modify** | `frontend/src/app/(app)/commissions/page.tsx` | Replace `payoutTechId` Input (line 183) |
| **Modify** | `frontend/src/app/(app)/hr/leave/page.tsx` | Replace `empId` Input (line 160) |
| **Modify** | `frontend/src/components/crm/TaskComposer.tsx` | Replace `assigned_to` Input (line 140) |
| **Modify** | `frontend/src/app/(app)/jobs/new/page.tsx` | Add optional quick-assign tech to ReviewStep |
| **Modify** | `docs/ALIGNMENT_AUDIT.md` | Mark all 5 wire-ups DONE |

---

## Task 1: Backend — add `?role=` filter to `/users/`

**Files:**
- Modify: `backend/apps/authentication/settings_views.py`

The `UserListCreateView.get()` method currently filters by `search` and `is_active` only.  
Add a `?role=` param that filters by role name (case-insensitive).

- [ ] **Step 1: Add the role filter**

In `settings_views.py`, inside `UserListCreateView.get()`, after the `is_active_param` block, add:

```python
if role := request.query_params.get("role"):
    qs = qs.filter(
        user_roles__role__name__iexact=role,
        user_roles__role__deleted_at__isnull=True,
    ).distinct()
```

The full `get` method becomes:

```python
def get(self, request):
    qs = User.objects.filter(is_active__in=[True, False], deleted_at__isnull=True).order_by("-created_at")

    if q := request.query_params.get("search"):
        from django.db.models import Q
        qs = qs.filter(Q(full_name__icontains=q) | Q(email__icontains=q) | Q(phone__icontains=q))

    is_active_param = request.query_params.get("is_active")
    if is_active_param is not None:
        qs = qs.filter(is_active=is_active_param.lower() in ("true", "1", "yes"))

    if role := request.query_params.get("role"):
        qs = qs.filter(
            user_roles__role__name__iexact=role,
            user_roles__role__deleted_at__isnull=True,
        ).distinct()

    paginator = self.pagination_class()
    page = paginator.paginate_queryset(qs, request)
    data = TenantUserSerializer(page if page is not None else qs, many=True).data
    if page is not None:
        return paginator.get_paginated_response(data)
    return Response({"items": data, "meta": {}})
```

- [ ] **Step 2: Verify with existing tests**

```bash
cd /home/appuser/workspace/projects/repairOS
docker compose exec api python -m pytest backend/apps/authentication/tests/ -v -x 2>&1 | tail -20
```

Expected: all existing tests pass.

- [ ] **Step 3: Commit**

```bash
git add backend/apps/authentication/settings_views.py
git commit -m "feat(api): add ?role= filter to GET /users/"
```

---

## Task 2: Frontend API — add `role?` to `settingsApi.listUsers`

**Files:**
- Modify: `frontend/src/lib/api/settings.ts` (line 101)

- [ ] **Step 1: Update the type signature**

Change line 101:

```typescript
// Before
listUsers: (filters: { search?: string; is_active?: boolean; cursor?: string } = {}) =>

// After
listUsers: (filters: { search?: string; is_active?: boolean; role?: string; cursor?: string } = {}) =>
```

The full updated method (lines 101-105):

```typescript
  listUsers: (filters: { search?: string; is_active?: boolean; role?: string; cursor?: string } = {}) =>
    apiGet<{ items: TenantUser[]; meta: PageMeta }>(
      '/users/',
      filters as Record<string, string | boolean | undefined>,
    ),
```

- [ ] **Step 2: Commit**

```bash
git add frontend/src/lib/api/settings.ts
git commit -m "feat(api): add role filter param to settingsApi.listUsers"
```

---

## Task 3: Build `StaffPicker.tsx`

**Files:**
- Create: `frontend/src/components/shared/StaffPicker.tsx`

A controlled Popover combobox. The trigger is a full-width button showing the selected name (or placeholder). On open, a search input appears inside the Popover; typing debounces 350ms and fires the appropriate API call. Results render as a scrollable list. Selecting closes the Popover and calls `onChange(id)`.

State held internally:
- `open: boolean` — Popover open state
- `query: string` — live search input value
- `selectedLabel: string` — display name of currently selected item

When `value` is empty string, `selectedLabel` is also empty.

- [ ] **Step 1: Create the component**

```tsx
'use client';

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronsUpDown, Loader2 } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { settingsApi } from '@/lib/api/settings';
import { hrApi } from '@/lib/api/hr';
import { useDebounce } from '@/lib/hooks/useDebounce';
import { cn } from '@/lib/utils';

export interface StaffPickerProps {
  value: string;
  onChange: (id: string) => void;
  source?: 'users' | 'employees';
  role?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export function StaffPicker({
  value,
  onChange,
  source = 'users',
  role,
  placeholder = 'Search staff…',
  disabled = false,
  className,
}: StaffPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedLabel, setSelectedLabel] = useState('');

  const debouncedQuery = useDebounce(query, 350);

  const usersQuery = useQuery({
    queryKey: ['staff-picker', 'users', debouncedQuery, role],
    queryFn: () => settingsApi.listUsers({ search: debouncedQuery || undefined, is_active: true, role }),
    enabled: open && source === 'users',
    staleTime: 30_000,
  });

  const employeesQuery = useQuery({
    queryKey: ['staff-picker', 'employees', debouncedQuery],
    queryFn: () => hrApi.listEmployees({ search: debouncedQuery || undefined }),
    enabled: open && source === 'employees',
    staleTime: 30_000,
  });

  const isLoading = source === 'users' ? usersQuery.isLoading : employeesQuery.isLoading;

  const items: Array<{ id: string; primaryLabel: string; secondaryLabel: string }> =
    source === 'users'
      ? (usersQuery.data?.items ?? []).map((u) => ({
          id: u.id,
          primaryLabel: u.full_name,
          secondaryLabel: u.role_names.length > 0 ? u.role_names.join(', ') : u.email,
        }))
      : (employeesQuery.data?.items ?? []).map((e) => ({
          id: e.id,
          primaryLabel: e.full_name,
          secondaryLabel: e.designation ?? e.employee_code,
        }));

  function handleSelect(id: string, label: string) {
    setSelectedLabel(label);
    onChange(id);
    setOpen(false);
    setQuery('');
  }

  // Clear label when value is cleared externally
  useEffect(() => {
    if (!value) setSelectedLabel('');
  }, [value]);

  return (
    <Popover open={open} onOpenChange={(v) => { setOpen(v); if (!v) setQuery(''); }}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            'w-full justify-between min-h-[44px] font-normal text-left',
            !selectedLabel && 'text-[var(--text-muted)]',
            className,
          )}
        >
          <span className="truncate">{selectedLabel || placeholder}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <div className="p-2 border-b border-[var(--border)]">
          <Input
            placeholder="Search by name…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
            className="h-8"
          />
        </div>
        <div className="max-h-60 overflow-y-auto">
          {isLoading && (
            <div className="flex items-center justify-center py-6 gap-2 text-[var(--text-muted)]">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-body-sm">Searching…</span>
            </div>
          )}
          {!isLoading && items.length === 0 && (
            <p className="py-6 text-center text-body-sm text-[var(--text-muted)]">
              {debouncedQuery ? 'No results found.' : 'Type to search.'}
            </p>
          )}
          {!isLoading && items.map((item) => (
            <button
              key={item.id}
              className={cn(
                'w-full flex items-center gap-3 px-3 py-2.5 text-left min-h-[44px]',
                'hover:bg-[var(--surface-muted)] transition-colors',
                value === item.id && 'bg-[var(--accent)]/10',
              )}
              onClick={() => handleSelect(item.id, item.primaryLabel)}
            >
              <Check
                className={cn('h-4 w-4 shrink-0 text-[var(--accent)]', value !== item.id && 'invisible')}
              />
              <div className="min-w-0">
                <p className="text-body-sm font-medium text-[var(--text)] truncate">{item.primaryLabel}</p>
                <p className="text-xs text-[var(--text-muted)] truncate">{item.secondaryLabel}</p>
              </div>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd /home/appuser/workspace/projects/repairOS/frontend
npx tsc --noEmit 2>&1 | grep "StaffPicker" | head -20
```

Expected: no errors mentioning StaffPicker.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/shared/StaffPicker.tsx
git commit -m "feat(ui): add StaffPicker typeahead combobox component"
```

---

## Task 4: Wire — DefineStagesDialog (`jobs/[id]/page.tsx`)

**Files:**
- Modify: `frontend/src/app/(app)/jobs/[id]/page.tsx`

The `DefineStagesDialog` at line 613 contains a per-row `Input placeholder="Technician ID"` (lines 662–667). Replace it with `StaffPicker`.

The `StageRow` interface uses `assigned_technician_id: string` — that stays. The `StaffPicker` returns a plain string id so `updateRow(i, 'assigned_technician_id', id)` still works.

- [ ] **Step 1: Add import**

Add to the imports block at the top of the file (after the existing shared component imports):

```typescript
import { StaffPicker } from '@/components/shared/StaffPicker';
```

- [ ] **Step 2: Replace the Input in DefineStagesDialog**

Find this block (lines 662–667):

```tsx
              <Input
                className="flex-1"
                placeholder="Technician ID"
                value={row.assigned_technician_id}
                onChange={(e) => updateRow(i, 'assigned_technician_id', e.target.value)}
              />
```

Replace with:

```tsx
              <StaffPicker
                className="flex-1"
                placeholder="Assign technician…"
                value={row.assigned_technician_id}
                onChange={(id) => updateRow(i, 'assigned_technician_id', id)}
              />
```

- [ ] **Step 3: Remove now-unused `Input` import if nothing else uses it**

Check: `grep -n "Input" frontend/src/app/\(app\)/jobs/\[id\]/page.tsx`  
If `<Input` appears 0 times, remove `import { Input } from '@/components/ui/input';`.  
(It's likely still used elsewhere on the page — do nothing in that case.)

- [ ] **Step 4: Verify TypeScript**

```bash
cd /home/appuser/workspace/projects/repairOS/frontend
npx tsc --noEmit 2>&1 | grep "jobs/\[id\]" | head -10
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/app/\(app\)/jobs/\[id\]/page.tsx
git commit -m "feat(ui): wire StaffPicker into DefineStagesDialog technician field"
```

---

## Task 5: Wire — Commissions "Generate payout" (`commissions/page.tsx`)

**Files:**
- Modify: `frontend/src/app/(app)/commissions/page.tsx`

Line 183–187: `Input placeholder="Technician user ID"` bound to `payoutTechId` state.

- [ ] **Step 1: Add import**

```typescript
import { StaffPicker } from '@/components/shared/StaffPicker';
```

- [ ] **Step 2: Replace the Input**

Find (lines 182–188):

```tsx
                  <Input
                    placeholder="Technician user ID"
                    className="flex-1 min-w-[200px]"
                    value={payoutTechId}
                    onChange={(e) => setPayoutTechId(e.target.value)}
                  />
```

Replace with:

```tsx
                  <StaffPicker
                    placeholder="Select technician…"
                    className="flex-1 min-w-[200px]"
                    value={payoutTechId}
                    onChange={setPayoutTechId}
                  />
```

- [ ] **Step 3: Verify TypeScript**

```bash
cd /home/appuser/workspace/projects/repairOS/frontend
npx tsc --noEmit 2>&1 | grep "commissions" | head -10
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/\(app\)/commissions/page.tsx
git commit -m "feat(ui): wire StaffPicker into commissions payout tech field"
```

---

## Task 6: Wire — HR leave dialog (`hr/leave/page.tsx`)

**Files:**
- Modify: `frontend/src/app/(app)/hr/leave/page.tsx`

Line 160: `Input placeholder="Employee ID"` bound to `empId`. This picker uses `/hr/employees/` so `source="employees"`.

- [ ] **Step 1: Add import**

```typescript
import { StaffPicker } from '@/components/shared/StaffPicker';
```

- [ ] **Step 2: Replace the Input**

Find (line 159–160):

```tsx
              <label className="text-body-sm font-medium text-[var(--text)] block mb-1">Employee ID *</label>
              <Input placeholder="Employee ID" value={empId} onChange={(e) => setEmpId(e.target.value)} />
```

Replace with:

```tsx
              <label className="text-body-sm font-medium text-[var(--text)] block mb-1">Employee *</label>
              <StaffPicker
                source="employees"
                placeholder="Select employee…"
                value={empId}
                onChange={setEmpId}
              />
```

- [ ] **Step 3: Verify TypeScript**

```bash
cd /home/appuser/workspace/projects/repairOS/frontend
npx tsc --noEmit 2>&1 | grep "hr/leave" | head -10
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/app/\(app\)/hr/leave/page.tsx
git commit -m "feat(ui): wire StaffPicker (employees) into HR leave dialog"
```

---

## Task 7: Wire — CRM TaskComposer assignee (`TaskComposer.tsx`)

**Files:**
- Modify: `frontend/src/components/crm/TaskComposer.tsx`

Lines 137–143: `FormField` for `assigned_to` using a raw `Input`. Replace with `StaffPicker` inside `FormControl`.

The form field uses `react-hook-form`'s `field.value` / `field.onChange`. `StaffPicker.onChange` receives a string id, which is compatible with RHF's `onChange`.

- [ ] **Step 1: Add import**

```typescript
import { StaffPicker } from '@/components/shared/StaffPicker';
```

- [ ] **Step 2: Replace the FormField body**

Find (lines 137–143):

```tsx
            <FormField control={form.control} name="assigned_to" render={({ field }) => (
              <FormItem>
                <FormLabel>Assigned to (user ID) *</FormLabel>
                <FormControl><Input placeholder={user?.id ?? 'User ID…'} {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
```

Replace with:

```tsx
            <FormField control={form.control} name="assigned_to" render={({ field }) => (
              <FormItem>
                <FormLabel>Assigned to *</FormLabel>
                <FormControl>
                  <StaffPicker
                    placeholder="Select assignee…"
                    value={field.value}
                    onChange={field.onChange}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />
```

- [ ] **Step 3: Remove unused `Input` import if not needed elsewhere**

Check: `grep -n "<Input" frontend/src/components/crm/TaskComposer.tsx`  
If 0 results, remove `import { Input } from '@/components/ui/input';`.

- [ ] **Step 4: Verify TypeScript**

```bash
cd /home/appuser/workspace/projects/repairOS/frontend
npx tsc --noEmit 2>&1 | grep "TaskComposer" | head -10
```

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/components/crm/TaskComposer.tsx
git commit -m "feat(ui): wire StaffPicker into CRM TaskComposer assignee field"
```

---

## Task 8: Wire — New-job wizard quick-assign tech (`jobs/new/page.tsx`)

**Files:**
- Modify: `frontend/src/app/(app)/jobs/new/page.tsx`

The current wizard has no technician-assignment step. This task adds an optional "Assign technician" picker at the bottom of the Review step. If filled, the submit mutation auto-creates a single diagnosis stage via `repairApi.setStages()`.

**Why optional:** Many jobs are created before a technician is decided; the DefineStagesDialog exists for post-creation assignment. This new field is a convenience shortcut — the submit still works if it's blank.

Changes needed:
1. Add `quick_technician_id: string` to `WizardData`
2. Initialize it to `''`
3. Thread it through `ReviewStep` props so the ReviewStep can render a `StaffPicker` and update it
4. In the submit mutation, if `wizardData.quick_technician_id` is truthy, call `repairApi.setStages()` after check-in
5. Import `StaffPicker` in the page file

- [ ] **Step 1: Extend `WizardData`**

Add `quick_technician_id: string` to the `WizardData` interface (after `checkin: CheckinPayload | null;`):

```typescript
interface WizardData {
  customer: CustomerOption | null;
  device_type: string;
  device_brand: string;
  device_model: string;
  serial_number: string;
  imei: string;
  problem_description: string;
  priority: JobPriority;
  service_charge: number;
  advance_paid: number;
  expected_delivery_date: string;
  notes: string;
  template_id: string | null;
  is_field_job: boolean;
  location_lat: number | null;
  location_lng: number | null;
  location_address: string;
  checkin: CheckinPayload | null;
  quick_technician_id: string;
}
```

- [ ] **Step 2: Initialize to empty string**

In `useState<WizardData>({ ... })` (line ~122), add `quick_technician_id: ''` after `checkin: null,`:

```typescript
  const [wizardData, setWizardData] = useState<WizardData>({
    customer: null,
    device_type: '', device_brand: '', device_model: '',
    serial_number: '', imei: '',
    problem_description: '', priority: 'normal',
    service_charge: 0, advance_paid: 0,
    expected_delivery_date: '', notes: '',
    template_id: null,
    is_field_job: false, location_lat: null, location_lng: null, location_address: '',
    checkin: null,
    quick_technician_id: '',
  });
```

- [ ] **Step 3: Thread through submit mutation**

In `submitMutation.mutationFn`, after `return { job, checkinFailed: false };` and the catch block, extend the mutation to call `setStages` if applicable:

Replace the current mutationFn body:

```typescript
  const submitMutation = useMutation({
    mutationFn: async () => {
      if (!wizardData.customer || !activeShopId || !wizardData.checkin) throw new Error('Missing data');
      const job = await repairApi.createJob({
        shop_id: activeShopId,
        customer_id: wizardData.customer.id,
        device_type: wizardData.device_type,
        device_brand: wizardData.device_brand || undefined,
        device_model: wizardData.device_model || undefined,
        serial_number: wizardData.serial_number || undefined,
        imei: wizardData.imei || undefined,
        problem_description: wizardData.problem_description,
        priority: wizardData.priority,
        service_charge: wizardData.service_charge || undefined,
        advance_paid: wizardData.advance_paid || undefined,
        expected_delivery_date: wizardData.expected_delivery_date || undefined,
        notes: wizardData.notes || undefined,
        template_id: wizardData.template_id ?? undefined,
        is_field_job: wizardData.is_field_job || undefined,
        location_lat: wizardData.location_lat ?? undefined,
        location_lng: wizardData.location_lng ?? undefined,
        location_address: wizardData.location_address || undefined,
      });
      let checkinFailed = false;
      try {
        await repairApi.submitCheckin(job.id, {
          physical_condition: wizardData.checkin.physical_condition,
          has_scratches: wizardData.checkin.has_scratches,
          has_cracks: wizardData.checkin.has_cracks,
          has_liquid_damage: wizardData.checkin.has_liquid_damage,
          has_missing_parts: wizardData.checkin.has_missing_parts,
          accessory_received: wizardData.checkin.accessory_received,
          customer_description: wizardData.checkin.customer_description,
          technician_notes: wizardData.checkin.technician_notes,
          photos: wizardData.checkin.photos,
          customer_signature_url: wizardData.checkin.customer_signature_url,
        });
      } catch {
        checkinFailed = true;
      }
      if (wizardData.quick_technician_id) {
        try {
          await repairApi.setStages(job.id, {
            stages: [{ stage_order: 1, stage_type: 'diagnosis', assigned_technician_id: wizardData.quick_technician_id }],
          });
        } catch {
          // Non-fatal — tech can be assigned from the job detail page
        }
      }
      return { job, checkinFailed };
    },
```

- [ ] **Step 4: Update `ReviewStep` to accept and render `StaffPicker`**

Update the `ReviewStep` props interface and implementation:

```typescript
function ReviewStep({
  data, onBack, onSubmit, isSubmitting,
  quickTechId, onQuickTechIdChange,
}: {
  data: WizardData;
  onBack: () => void;
  onSubmit: () => void;
  isSubmitting: boolean;
  quickTechId: string;
  onQuickTechIdChange: (id: string) => void;
}) {
```

Add a `StaffPicker` field below the check-in confirmation block, before the button row:

```tsx
      <div className="space-y-1.5">
        <label className="text-body-sm font-medium text-[var(--text)] block">
          Assign technician <span className="text-[var(--text-muted)] font-normal">(optional)</span>
        </label>
        <StaffPicker
          placeholder="Pick technician now, or assign after…"
          value={quickTechId}
          onChange={onQuickTechIdChange}
        />
      </div>
```

- [ ] **Step 5: Pass props from the wizard's step renderer**

Find where `<ReviewStep` is rendered (it will be inside a step switch or conditional). Pass the new props:

```tsx
<ReviewStep
  data={wizardData}
  onBack={handleBack}
  onSubmit={() => submitMutation.mutate()}
  isSubmitting={submitMutation.isPending}
  quickTechId={wizardData.quick_technician_id}
  onQuickTechIdChange={(id) => setWizardData((prev) => ({ ...prev, quick_technician_id: id }))}
/>
```

- [ ] **Step 6: Add import at top of the file**

```typescript
import { StaffPicker } from '@/components/shared/StaffPicker';
```

- [ ] **Step 7: Verify TypeScript**

```bash
cd /home/appuser/workspace/projects/repairOS/frontend
npx tsc --noEmit 2>&1 | grep "jobs/new" | head -10
```

Expected: no errors.

- [ ] **Step 8: Commit**

```bash
git add frontend/src/app/\(app\)/jobs/new/page.tsx
git commit -m "feat(ui): add optional quick-assign tech StaffPicker to new-job wizard"
```

---

## Task 9: Mark ALIGNMENT_AUDIT.md

**Files:**
- Modify: `docs/ALIGNMENT_AUDIT.md`

Add a new section after the existing pattern entries (or append inline notes). The five wire-ups do not correspond to a numbered pattern in the audit — add a standalone "UI Improvements" section at the end of the recommended-fix table, or append to the bottom of the document.

- [ ] **Step 1: Append the section**

At the bottom of `docs/ALIGNMENT_AUDIT.md`, after the priority table, add:

```markdown
### UI: Raw UUID inputs replaced with StaffPicker typeahead — **DONE <commit-hash>**

Five locations that required users to type a raw UUID now use the shared `StaffPicker` combobox from `components/shared/StaffPicker.tsx`. Each queries a live endpoint, debounces at 350ms, and shows full name + role/email. Backend gained `?role=` filter on `/users/`.

| Location | File | Source |
|---|---|---|
| DefineStagesDialog technician | `app/(app)/jobs/[id]/page.tsx:662` | `/users/` |
| New-job quick-assign tech | `app/(app)/jobs/new/page.tsx` | `/users/` |
| Commissions generate-payout technician | `app/(app)/commissions/page.tsx:183` | `/users/` |
| HR leave dialog employee | `app/(app)/hr/leave/page.tsx:160` | `/hr/employees/` |
| CRM TaskComposer assignee | `components/crm/TaskComposer.tsx:140` | `/users/` |
```

Replace `<commit-hash>` with the actual hash after committing.

- [ ] **Step 2: Commit**

```bash
git add docs/ALIGNMENT_AUDIT.md
git commit -m "docs: mark StaffPicker wire-ups DONE in ALIGNMENT_AUDIT"
```

---

## Task 10: Full build verification

- [ ] **Step 1: Run `next build`**

```bash
cd /home/appuser/workspace/projects/repairOS/frontend
npm run build 2>&1 | tail -30
```

Expected: `✓ Compiled successfully` with no TypeScript errors and no "Module not found" errors.  
If there are errors, fix them and re-run before proceeding.

- [ ] **Step 2: Squash commits into final feat commit**

The earlier per-task commits can stay as-is, OR squash into one:

```bash
git log --oneline -10
# Count the commits added during this feature (Tasks 1-9 = up to 9 commits)
git rebase -i HEAD~9
# In the editor: keep the first as "pick", change the rest to "squash"
# Write the final message:
```

Final commit message:

```
feat(ui): shared StaffPicker + wire into 5 forms

- New StaffPicker typeahead (Popover+Input, no extra deps) at
  components/shared/StaffPicker.tsx. source='users'|'employees',
  role filter, debounced 350ms, 44px touch targets, token colors.
- Backend: GET /users/ gains ?role= filter.
- Wired into: DefineStagesDialog (jobs/[id]), commissions payout,
  HR leave dialog (employees source), CRM TaskComposer assignee,
  new-job wizard quick-assign (optional, auto-creates diagnosis stage).
- ALIGNMENT_AUDIT.md updated.
```

---

## Self-Review Checklist

- [x] **Spec coverage:** Backend role filter ✓, StaffPicker component ✓, DefineStagesDialog ✓, commissions ✓, HR leave ✓, TaskComposer ✓, new-job ✓, mobile 44px targets ✓, token colors ✓, loading/empty/no-results ✓, ALIGNMENT_AUDIT ✓
- [x] **Note on `?role=` in backend:** The spec says the endpoint "supports ?search= and role filter" — confirmed search is already there; role filter is added in Task 1.
- [x] **Note on new-job:** The spec says "Replace the raw UUID inputs at: Repair new-job tech assign" — but `jobs/new/page.tsx` has no UUID input today. Task 8 adds the field (new capability, never raw UUID). This is documented in ALIGNMENT_AUDIT.
- [x] **No placeholders:** All code blocks are complete.
- [x] **Type consistency:** `StaffPickerProps.onChange: (id: string) => void` — used as `onChange={setPayoutTechId}` (setState) ✓, `onChange={field.onChange}` (RHF string field) ✓, `onChange={(id) => updateRow(i, 'assigned_technician_id', id)}` ✓.
- [x] **`Employee.designation`** — used in secondaryLabel as `e.designation ?? e.employee_code`. The `Employee` interface has `designation: string` (not optional). Using it directly is fine; `?? e.employee_code` is defensive but harmless.
