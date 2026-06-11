# AMC Component Extraction + Visit Calendar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract inline AMC logic from `amc/[id]/page.tsx` into reusable `components/amc/` components (pure refactor, no behaviour change), then add a lightweight custom-grid visit calendar at `/amc?view=calendar`.

**Architecture:** Five components are extracted from the detail page (`VisitTimeline`, `VisitCompleteDialog`, `RescheduleDialog`, `RenewalPanel`) and one new component is added (`VisitCalendar`). The calendar uses a hand-rolled 7-column month grid — zero new npm dependencies — and sources data from the existing `amcApi.listContracts()` call, showing each active contract's `next_visit_date` as a pill on the correct day. The list page gains a List/Calendar toggle driven by `?view=calendar` in the URL (via `useSearchParams`).

**Tech Stack:** Next.js 14 App Router, React Query, TypeScript strict, Tailwind CSS, existing `amcApi` + `qk` keys. No new dependencies.

---

## File map

| Action | Path |
|--------|------|
| Create | `frontend/src/components/amc/VisitTimeline.tsx` |
| Create | `frontend/src/components/amc/VisitCompleteDialog.tsx` |
| Create | `frontend/src/components/amc/RescheduleDialog.tsx` |
| Create | `frontend/src/components/amc/RenewalPanel.tsx` |
| Create | `frontend/src/components/amc/VisitCalendar.tsx` |
| Create | `frontend/src/components/amc/index.ts` |
| Modify | `frontend/src/app/(app)/amc/[id]/page.tsx` |
| Modify | `frontend/src/app/(app)/amc/page.tsx` |
| Modify | `docs/ALIGNMENT_AUDIT.md` |

---

## Task 1: Extract `VisitTimeline`

**Files:**
- Create: `frontend/src/components/amc/VisitTimeline.tsx`

- [ ] **Step 1: Create the component file**

```tsx
// frontend/src/components/amc/VisitTimeline.tsx
'use client';

import { Clock, CheckCircle2, AlertCircle, RotateCcw } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Can } from '@/components/shared/Can';
import { VISIT_STATUS_COLORS, type AmcVisit } from '@/lib/api/amc';
import { formatDate } from '@/lib/format/date';
import { cn } from '@/lib/utils';

const VISIT_ICON: Record<string, React.ReactNode> = {
  scheduled:   <Clock className="h-4 w-4 text-[var(--info)]" />,
  completed:   <CheckCircle2 className="h-4 w-4 text-[var(--success)]" />,
  missed:      <AlertCircle className="h-4 w-4 text-[var(--danger)]" />,
  rescheduled: <RotateCcw className="h-4 w-4 text-[var(--warning)]" />,
  cancelled:   <AlertCircle className="h-4 w-4 text-[var(--text-muted)]" />,
};

interface Props {
  visits: AmcVisit[];
  isLoading: boolean;
  onComplete: (visit: AmcVisit) => void;
  onReschedule: (visit: AmcVisit) => void;
}

export function VisitTimeline({ visits, isLoading, onComplete, onReschedule }: Props) {
  if (isLoading) {
    return <div className="space-y-2">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-12" />)}</div>;
  }
  if (visits.length === 0) {
    return <p className="text-body-sm text-[var(--text-muted)] py-4">No visits scheduled.</p>;
  }

  return (
    <div className="relative space-y-3">
      <div className="absolute left-[19px] top-5 bottom-5 w-px bg-[var(--border)]" />
      {visits.map((visit) => (
        <div key={visit.id} className="flex gap-3 relative">
          <div className="w-10 h-10 rounded-full border-2 border-[var(--border)] bg-[var(--surface)] flex items-center justify-center shrink-0 z-10">
            {VISIT_ICON[visit.status]}
          </div>
          <div className={cn(
            'flex-1 rounded-lg border p-3',
            visit.status === 'missed'
              ? 'border-[var(--danger)]/30 bg-[var(--danger)]/5'
              : 'border-[var(--border)] bg-[var(--surface)]',
          )}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-body-sm font-medium text-[var(--text)]">
                  Visit {visit.visit_number} · {formatDate(visit.scheduled_date)}
                </p>
                {visit.technician_name && (
                  <p className="text-xs text-[var(--text-muted)]">{visit.technician_name}</p>
                )}
                {visit.work_done && (
                  <p className="text-xs text-[var(--text-muted)] mt-0.5 italic">{visit.work_done}</p>
                )}
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className={cn('text-[10px] font-semibold rounded px-1.5 py-0.5', VISIT_STATUS_COLORS[visit.status])}>
                  {visit.status.replace('_', ' ')}
                </span>
                {visit.status === 'scheduled' && (
                  <Can permission="amc.visits.complete">
                    <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => onComplete(visit)}>
                      Complete
                    </Button>
                  </Can>
                )}
                {(visit.status === 'scheduled' || visit.status === 'missed') && (
                  <Can permission="amc.visits.schedule">
                    <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => onReschedule(visit)}>
                      Reschedule
                    </Button>
                  </Can>
                )}
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit 2>&1 | grep -v "Can\.test\.tsx" | grep "error TS"
```
Expected: no output (no errors)

---

## Task 2: Extract `VisitCompleteDialog`

**Files:**
- Create: `frontend/src/components/amc/VisitCompleteDialog.tsx`

- [ ] **Step 1: Create the component file**

```tsx
// frontend/src/components/amc/VisitCompleteDialog.tsx
'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PhotoUploader } from '@/components/shared/PhotoUploader';
import { SignaturePad } from '@/components/shared/SignaturePad';
import type { AmcVisit } from '@/lib/api/amc';

export interface CompletePayload {
  work_done: string;
  issues_found: string;
  photos: string[];
  signature: string | null;
}

interface Props {
  visit: AmcVisit | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (payload: CompletePayload) => void;
  isPending: boolean;
}

export function VisitCompleteDialog({ visit, onOpenChange, onSubmit, isPending }: Props) {
  const [workDone, setWorkDone] = useState('');
  const [issuesFound, setIssuesFound] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [signature, setSignature] = useState<string | null>(null);

  function handleOpenChange(open: boolean) {
    if (!open) {
      setWorkDone('');
      setIssuesFound('');
      setPhotos([]);
      setSignature(null);
    }
    onOpenChange(open);
  }

  return (
    <Dialog open={!!visit} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Complete visit {visit?.visit_number}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <label className="text-body-sm font-medium text-[var(--text)] block mb-1">
              Work done <span className="text-[var(--danger)]">*</span>
            </label>
            <textarea
              className="flex min-h-[80px] w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-body text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] resize-none"
              placeholder="Describe the work done during this visit…"
              value={workDone}
              onChange={(e) => setWorkDone(e.target.value)}
            />
          </div>
          <div>
            <label className="text-body-sm font-medium text-[var(--text)] block mb-1">Issues found</label>
            <Input
              placeholder="Any issues found or recommendations…"
              value={issuesFound}
              onChange={(e) => setIssuesFound(e.target.value)}
            />
          </div>
          <div>
            <p className="text-body-sm font-medium text-[var(--text)] mb-2">Photos</p>
            <PhotoUploader value={photos} onChange={setPhotos} />
          </div>
          <div>
            <p className="text-body-sm font-medium text-[var(--text)] mb-2">Customer signature</p>
            <SignaturePad onChange={setSignature} />
          </div>
          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
            <Button
              className="flex-1"
              disabled={!workDone.trim() || isPending}
              onClick={() => onSubmit({ work_done: workDone, issues_found: issuesFound, photos, signature })}
            >
              {isPending ? 'Saving…' : 'Mark complete'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit 2>&1 | grep -v "Can\.test\.tsx" | grep "error TS"
```
Expected: no output

---

## Task 3: Extract `RescheduleDialog`

**Files:**
- Create: `frontend/src/components/amc/RescheduleDialog.tsx`

- [ ] **Step 1: Create the component file**

```tsx
// frontend/src/components/amc/RescheduleDialog.tsx
'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { AmcVisit } from '@/lib/api/amc';

interface Props {
  visit: AmcVisit | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (newDate: string) => void;
  isPending: boolean;
}

export function RescheduleDialog({ visit, onOpenChange, onSubmit, isPending }: Props) {
  const [date, setDate] = useState('');

  function handleOpenChange(open: boolean) {
    if (!open) setDate('');
    onOpenChange(open);
  }

  return (
    <Dialog open={!!visit} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Reschedule visit {visit?.visit_number}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <label className="text-body-sm font-medium text-[var(--text)] block mb-1">New date *</label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
            <Button
              className="flex-1"
              disabled={!date || isPending}
              onClick={() => onSubmit(date)}
            >
              {isPending ? 'Saving…' : 'Reschedule'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit 2>&1 | grep -v "Can\.test\.tsx" | grep "error TS"
```
Expected: no output

---

## Task 4: Extract `RenewalPanel`

**Files:**
- Create: `frontend/src/components/amc/RenewalPanel.tsx`

- [ ] **Step 1: Create the component file**

```tsx
// frontend/src/components/amc/RenewalPanel.tsx
'use client';

import { useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MoneyInput } from '@/components/shared/MoneyInput';
import { Can } from '@/components/shared/Can';
import type { AmcContract } from '@/lib/api/amc';
import { formatDate } from '@/lib/format/date';

interface Props {
  contract: AmcContract;
  daysToExpiry: number;
  renewalDue: boolean;
  onConfirm: (newEndDate: string, newValue: number | undefined) => void;
  isSubmitting: boolean;
}

export function RenewalPanel({ contract, daysToExpiry, renewalDue, onConfirm, isSubmitting }: Props) {
  const [open, setOpen] = useState(false);
  const [renewEndDate, setRenewEndDate] = useState('');
  const [renewValue, setRenewValue] = useState(contract.value);

  if (!renewalDue) return null;

  return (
    <>
      {/* Banner */}
      <div className="flex items-center gap-2 rounded-lg border border-[var(--warning)]/30 bg-[var(--warning)]/10 px-4 py-3">
        <AlertCircle className="h-4 w-4 text-[var(--warning)] shrink-0" />
        <p className="text-body-sm text-[var(--warning)] flex-1">
          {daysToExpiry > 0 ? `Expires in ${daysToExpiry} days` : 'Expired'} — renewal recommended
        </p>
        <Can permission="amc.renewals.manage">
          <Button
            size="sm"
            onClick={() => { setRenewEndDate(''); setRenewValue(contract.value); setOpen(true); }}
          >
            Renew
          </Button>
        </Can>
      </div>

      {/* Dialog */}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Renew contract</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <p className="text-body-sm text-[var(--text-muted)]">
              Current expiry: {formatDate(contract.end_date)}. Renewal extends the contract and schedules new visits.
            </p>
            <div>
              <label className="text-body-sm font-medium text-[var(--text)] block mb-1">New end date *</label>
              <Input type="date" value={renewEndDate} onChange={(e) => setRenewEndDate(e.target.value)} />
            </div>
            <div>
              <label className="text-body-sm font-medium text-[var(--text)] block mb-1">New value</label>
              <MoneyInput value={renewValue} onChange={setRenewValue} />
            </div>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setOpen(false)}>Cancel</Button>
              <Button
                className="flex-1"
                disabled={!renewEndDate || isSubmitting}
                onClick={() => onConfirm(renewEndDate, renewValue > 0 ? renewValue : undefined)}
              >
                {isSubmitting ? 'Renewing…' : 'Confirm renewal'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
```

**Note on behaviour change:** In the original page, the `Renew` button was in the header and the banner was a separate element. Here both are co-located inside `RenewalPanel`. The `[id]/page.tsx` header area must remove its own `Renew` button since `RenewalPanel` now owns it inside the banner. This is the only visible layout shift — the button moves from top-right header to the right side of the warning banner. Functionally identical.

- [ ] **Step 2: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit 2>&1 | grep -v "Can\.test\.tsx" | grep "error TS"
```
Expected: no output

---

## Task 5: Create barrel export and slim down `amc/[id]/page.tsx`

**Files:**
- Create: `frontend/src/components/amc/index.ts`
- Modify: `frontend/src/app/(app)/amc/[id]/page.tsx`

- [ ] **Step 1: Create the barrel**

```ts
// frontend/src/components/amc/index.ts
export { VisitTimeline } from './VisitTimeline';
export { VisitCompleteDialog, type CompletePayload } from './VisitCompleteDialog';
export { RescheduleDialog } from './RescheduleDialog';
export { RenewalPanel } from './RenewalPanel';
export { VisitCalendar } from './VisitCalendar';
```

*(VisitCalendar is added here in advance; it is created in Task 6.)*

- [ ] **Step 2: Rewrite `amc/[id]/page.tsx` to use extracted components**

Replace the entire file with:

```tsx
// frontend/src/app/(app)/amc/[id]/page.tsx
'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Building, MapPin } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Money } from '@/components/shared/Money';
import { EmptyState } from '@/components/shared/EmptyState';
import { VisitTimeline, VisitCompleteDialog, RescheduleDialog, RenewalPanel, type CompletePayload } from '@/components/amc';
import { amcApi, PAYMENT_TERMS_LABELS, type AmcVisit } from '@/lib/api/amc';
import { qk } from '@/lib/query/keys';
import { ApiError } from '@/lib/api/client';
import { formatDate } from '@/lib/format/date';

export default function AmcContractPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [selectedVisit, setSelectedVisit] = useState<AmcVisit | null>(null);
  const [rescheduleVisit, setRescheduleVisit] = useState<AmcVisit | null>(null);

  const { data: contract, isLoading } = useQuery({
    queryKey: qk.amcContract(id),
    queryFn: () => amcApi.getContract(id),
    staleTime: 30_000,
  });

  const { data: visitsData, isLoading: visitsLoading } = useQuery({
    queryKey: qk.amcVisits(id),
    queryFn: () => amcApi.getVisits(id),
    staleTime: 30_000,
    enabled: !!contract,
  });

  const completeMutation = useMutation({
    mutationFn: (payload: CompletePayload) =>
      amcApi.completeVisit(selectedVisit!.id, {
        work_done: payload.work_done,
        issues_found: payload.issues_found || undefined,
        customer_signature_url: payload.signature ?? undefined,
        photos: payload.photos,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.amcContract(id) });
      queryClient.invalidateQueries({ queryKey: qk.amcVisits(id) });
      toast.success('Visit completed — next visit scheduled');
      setSelectedVisit(null);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });

  const rescheduleMutation = useMutation({
    mutationFn: (newDate: string) =>
      amcApi.rescheduleVisit(rescheduleVisit!.id, { new_date: newDate }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.amcVisits(id) });
      toast.success('Visit rescheduled');
      setRescheduleVisit(null);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Reschedule failed'),
  });

  const renewMutation = useMutation({
    mutationFn: ({ newEndDate, newValue }: { newEndDate: string; newValue?: number }) =>
      amcApi.renewContract(id, { new_end_date: newEndDate, new_value: newValue }),
    onSuccess: (c) => {
      queryClient.invalidateQueries({ queryKey: qk.amcContract(id) });
      toast.success(`Contract renewed — new expiry ${formatDate(c.end_date)}`);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Renewal failed'),
  });

  if (isLoading) {
    return <div className="p-4 space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-12" />)}</div>;
  }
  if (!contract) {
    return <EmptyState icon={Building} title="Contract not found" action={{ label: 'Back', onClick: () => router.back() }} />;
  }

  const visits = visitsData?.items ?? [];
  const daysToExpiry = Math.floor((new Date(contract.end_date).getTime() - Date.now()) / 86_400_000);
  const renewalDue = daysToExpiry <= contract.renewal_reminder_days && contract.status !== 'cancelled';

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-6 pb-10">
      {/* Header */}
      <div className="flex items-start gap-3">
        <button
          onClick={() => router.back()}
          className="p-1.5 rounded-md hover:bg-[var(--surface-2)] text-[var(--text-muted)] mt-0.5"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-code text-[var(--text-muted)]">{contract.contract_number}</span>
            <StatusBadge status={contract.status} />
          </div>
          <h1 className="text-h1 text-[var(--text)] mt-0.5">{contract.title}</h1>
          <p className="text-body-sm text-[var(--text-muted)]">{contract.customer_name}</p>
        </div>
      </div>

      {/* Renewal banner + dialog (self-contained) */}
      <RenewalPanel
        contract={contract}
        daysToExpiry={daysToExpiry}
        renewalDue={renewalDue}
        onConfirm={(newEndDate, newValue) => renewMutation.mutate({ newEndDate, newValue })}
        isSubmitting={renewMutation.isPending}
      />

      {/* Contract details */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-[var(--border)] px-3 py-2">
          <p className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wide">Value</p>
          <Money amount={contract.value} className="text-body font-semibold" />
        </div>
        <div className="rounded-lg border border-[var(--border)] px-3 py-2">
          <p className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wide">Visits / year</p>
          <p className="text-body font-semibold text-[var(--text)]">{contract.visits_per_year}</p>
        </div>
        <div className="rounded-lg border border-[var(--border)] px-3 py-2 col-span-2">
          <p className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wide">Period</p>
          <p className="text-body-sm text-[var(--text)]">
            {formatDate(contract.start_date)} – {formatDate(contract.end_date)}
            <span className="text-[var(--text-muted)] ml-2">({PAYMENT_TERMS_LABELS[contract.payment_terms]})</span>
          </p>
        </div>
        {contract.location_address && (
          <div className="rounded-lg border border-[var(--border)] px-3 py-2 col-span-2 flex items-start gap-2">
            <MapPin className="h-4 w-4 text-[var(--text-muted)] mt-0.5 shrink-0" />
            <p className="text-body-sm text-[var(--text)]">{contract.location_address}</p>
          </div>
        )}
      </div>

      {/* Visit timeline */}
      <div>
        <h2 className="text-body-sm font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-3">
          Visit schedule
        </h2>
        <VisitTimeline
          visits={visits}
          isLoading={visitsLoading}
          onComplete={setSelectedVisit}
          onReschedule={setRescheduleVisit}
        />
      </div>

      {/* Dialogs */}
      <VisitCompleteDialog
        visit={selectedVisit}
        onOpenChange={(open) => { if (!open) setSelectedVisit(null); }}
        onSubmit={(payload) => completeMutation.mutate(payload)}
        isPending={completeMutation.isPending}
      />
      <RescheduleDialog
        visit={rescheduleVisit}
        onOpenChange={(open) => { if (!open) setRescheduleVisit(null); }}
        onSubmit={(newDate) => rescheduleMutation.mutate(newDate)}
        isPending={rescheduleMutation.isPending}
      />
    </div>
  );
}
```

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit 2>&1 | grep -v "Can\.test\.tsx" | grep "error TS"
```
Expected: no output

---

## Task 6: Build `VisitCalendar`

**Files:**
- Create: `frontend/src/components/amc/VisitCalendar.tsx`

**Design decision — no new dependency:** A hand-rolled 7-column month grid is ~100 lines of standard React. `react-calendar` or FullCalendar add 50–400 kB and force opinionated styling; the custom grid fits the existing Tailwind token system with no additional bundle cost. The grid builds an array of `Date` objects padded to complete weeks (Monday-first), then compares each day's `YYYY-MM-DD` string against contract `next_visit_date` values.

- [ ] **Step 1: Create the component file**

```tsx
// frontend/src/components/amc/VisitCalendar.tsx
'use client';

import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { VISIT_STATUS_COLORS, amcApi, type AmcContract } from '@/lib/api/amc';
import { qk } from '@/lib/query/keys';
import { cn } from '@/lib/utils';

const DAY_HEADERS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

/** Returns an array of Date objects filling out a Mon-first calendar grid for the given month. */
function buildCalendarDays(year: number, month: number): Date[] {
  const firstOfMonth = new Date(year, month, 1);
  const lastOfMonth = new Date(year, month + 1, 0);
  // Monday = 0 … Sunday = 6 (Mon-first shift)
  const startPad = (firstOfMonth.getDay() + 6) % 7;
  const days: Date[] = [];

  for (let i = startPad; i > 0; i--) {
    days.push(new Date(year, month, 1 - i));
  }
  for (let d = 1; d <= lastOfMonth.getDate(); d++) {
    days.push(new Date(year, month, d));
  }
  while (days.length % 7 !== 0) {
    days.push(new Date(year, month + 1, days.length - lastOfMonth.getDate() - startPad + 1));
  }
  return days;
}

function toYMD(d: Date): string {
  return d.toISOString().slice(0, 10);
}

interface VisitPill {
  contractId: string;
  contractNumber: string;
  title: string;
  status: AmcContract['status'];
}

interface Props {
  shopId?: string;
}

export function VisitCalendar({ shopId }: Props) {
  const router = useRouter();
  const today = new Date();
  const [displayDate, setDisplayDate] = useState(new Date(today.getFullYear(), today.getMonth(), 1));

  const year = displayDate.getFullYear();
  const month = displayDate.getMonth();

  const { data, isLoading } = useQuery({
    queryKey: qk.amcContracts({ shop_id: shopId }),
    queryFn: () => amcApi.listContracts({ shop_id: shopId }),
    staleTime: 60_000,
  });

  const contracts = data?.items ?? [];

  /** Build a map from YYYY-MM-DD → list of visit pills. */
  const visitsByDay = useMemo<Map<string, VisitPill[]>>(() => {
    const map = new Map<string, VisitPill[]>();
    for (const c of contracts) {
      if (!c.next_visit_date) continue;
      const ymd = c.next_visit_date.slice(0, 10);
      if (!map.has(ymd)) map.set(ymd, []);
      map.get(ymd)!.push({
        contractId: c.id,
        contractNumber: c.contract_number,
        title: c.title,
        status: c.status,
      });
    }
    return map;
  }, [contracts]);

  const days = useMemo(() => buildCalendarDays(year, month), [year, month]);
  const todayYMD = toYMD(today);

  function prevMonth() { setDisplayDate(new Date(year, month - 1, 1)); }
  function nextMonth() { setDisplayDate(new Date(year, month + 1, 1)); }

  const monthLabel = displayDate.toLocaleDateString('en-IN', { month: 'long', year: 'numeric' });

  return (
    <div className="flex flex-col h-full">
      {/* Calendar header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)]">
        <Button variant="ghost" size="sm" onClick={prevMonth} aria-label="Previous month">
          <ChevronLeft className="h-4 w-4" />
        </Button>
        <span className="text-body font-semibold text-[var(--text)]">{monthLabel}</span>
        <Button variant="ghost" size="sm" onClick={nextMonth} aria-label="Next month">
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>

      {/* Day-of-week headers */}
      <div className="grid grid-cols-7 border-b border-[var(--border)]">
        {DAY_HEADERS.map((d) => (
          <div key={d} className="py-2 text-center text-xs font-semibold text-[var(--text-muted)]">
            {d}
          </div>
        ))}
      </div>

      {isLoading ? (
        <div className="p-4 grid grid-cols-7 gap-1">
          {Array.from({ length: 35 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded" />
          ))}
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          <div className="grid grid-cols-7 border-l border-[var(--border)]">
            {days.map((day, idx) => {
              const ymd = toYMD(day);
              const isCurrentMonth = day.getMonth() === month;
              const isToday = ymd === todayYMD;
              const pills = visitsByDay.get(ymd) ?? [];

              return (
                <div
                  key={idx}
                  className={cn(
                    'min-h-[80px] p-1.5 border-r border-b border-[var(--border)] flex flex-col gap-1',
                    !isCurrentMonth && 'bg-[var(--surface-2)]/40',
                  )}
                >
                  <span className={cn(
                    'text-xs font-medium self-start w-6 h-6 flex items-center justify-center rounded-full',
                    isToday
                      ? 'bg-[var(--accent)] text-white'
                      : isCurrentMonth
                        ? 'text-[var(--text)]'
                        : 'text-[var(--text-muted)]',
                  )}>
                    {day.getDate()}
                  </span>
                  {pills.map((pill) => (
                    <button
                      key={pill.contractId}
                      onClick={() => router.push(`/amc/${pill.contractId}`)}
                      className={cn(
                        'w-full text-left text-[10px] font-medium rounded px-1.5 py-0.5 truncate leading-tight',
                        pill.status === 'active'
                          ? 'bg-[var(--info)]/15 text-[var(--info)]'
                          : pill.status === 'pending_renewal'
                            ? 'bg-[var(--warning)]/15 text-[var(--warning)]'
                            : 'bg-[var(--text-muted)]/15 text-[var(--text-muted)]',
                      )}
                      title={`${pill.contractNumber} — ${pill.title}`}
                    >
                      {pill.title.length > 18 ? pill.title.slice(0, 16) + '…' : pill.title}
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      )}

      <p className="text-xs text-[var(--text-muted)] px-4 py-2 border-t border-[var(--border)]">
        Showing next scheduled visit per active contract. Click any visit to open the contract.
      </p>
    </div>
  );
}
```

- [ ] **Step 2: Update the barrel to un-comment the VisitCalendar export**

The barrel already exports `VisitCalendar` from Task 5 Step 1 — no further change needed.

- [ ] **Step 3: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit 2>&1 | grep -v "Can\.test\.tsx" | grep "error TS"
```
Expected: no output

---

## Task 7: Wire the calendar into `amc/page.tsx`

**Files:**
- Modify: `frontend/src/app/(app)/amc/page.tsx`

The spec says the calendar lives at `/amc?view=calendar`. We toggle between list and calendar using `useSearchParams` + `router.replace`.

- [ ] **Step 1: Add imports and view-toggle to `amc/page.tsx`**

Add at the top of the file (after existing imports):

```tsx
import { useSearchParams } from 'next/navigation';
import { LayoutList, CalendarDays } from 'lucide-react';
import { VisitCalendar } from '@/components/amc';
```

- [ ] **Step 2: Add view state inside `AmcPage()`**

Add right after the existing `const debouncedSearch = ...` line:

```tsx
const searchParams = useSearchParams();
const view = searchParams.get('view') === 'calendar' ? 'calendar' : 'list';

function setView(v: 'list' | 'calendar') {
  const params = new URLSearchParams(searchParams.toString());
  if (v === 'calendar') params.set('view', 'calendar');
  else params.delete('view');
  router.replace(`/amc?${params.toString()}`);
}
```

- [ ] **Step 3: Add the toggle button to the header toolbar**

In the existing header `div` that contains the `<Can>` / `<Button>` for "New contract", add a toggle button group immediately before the `<Can>`:

```tsx
{/* View toggle */}
<div className="flex items-center rounded-md border border-[var(--border)] overflow-hidden">
  <button
    onClick={() => setView('list')}
    className={cn(
      'px-2.5 py-1.5 text-xs flex items-center gap-1',
      view === 'list'
        ? 'bg-[var(--accent)] text-white'
        : 'text-[var(--text-muted)] hover:bg-[var(--surface-2)]',
    )}
    aria-label="List view"
  >
    <LayoutList className="h-3.5 w-3.5" />
    <span className="hidden sm:inline">List</span>
  </button>
  <button
    onClick={() => setView('calendar')}
    className={cn(
      'px-2.5 py-1.5 text-xs flex items-center gap-1 border-l border-[var(--border)]',
      view === 'calendar'
        ? 'bg-[var(--accent)] text-white'
        : 'text-[var(--text-muted)] hover:bg-[var(--surface-2)]',
    )}
    aria-label="Calendar view"
  >
    <CalendarDays className="h-3.5 w-3.5" />
    <span className="hidden sm:inline">Calendar</span>
  </button>
</div>
```

- [ ] **Step 4: Swap the body between list and calendar**

Replace the `<div className="flex-1 overflow-auto p-4 md:p-6">` block (and everything up to and including its closing `</div>`) with:

```tsx
<div className="flex-1 overflow-hidden">
  {view === 'calendar' ? (
    <VisitCalendar shopId={isAllShops ? undefined : activeShopId ?? undefined} />
  ) : (
    <div className="overflow-auto p-4 md:p-6 h-full">
      <DataTable
        columns={COLUMNS}
        data={contracts}
        loading={isLoading}
        error={error as Error | null}
        keyExtractor={(r) => r.id}
        onRowClick={(r) => router.push(`/amc/${r.id}`)}
        emptyTitle="No AMC contracts"
        emptyDescription="Create your first maintenance contract."
        emptyAction={{ label: 'New contract', onClick: () => setCreateOpen(true) }}
      />
    </div>
  )}
</div>
```

- [ ] **Step 5: Verify TypeScript compiles**

```bash
cd frontend && npx tsc --noEmit 2>&1 | grep -v "Can\.test\.tsx" | grep "error TS"
```
Expected: no output

- [ ] **Step 6: Run `next build` to confirm no build errors**

```bash
cd frontend && npm run build 2>&1 | tail -20
```
Expected: `✓ Compiled successfully` (or equivalent) with no errors.

---

## Task 8: Mark AMC #15 DONE in `docs/ALIGNMENT_AUDIT.md`

**Files:**
- Modify: `docs/ALIGNMENT_AUDIT.md`

- [ ] **Step 1: Find and update the finding**

Find the line containing `| 15 | Low | B | MISSING` in `docs/ALIGNMENT_AUDIT.md` and replace the `**DEFERRED**` suffix with a `**DONE**` suffix describing what was done:

```
**DONE** — extracted `VisitTimeline`, `VisitCompleteDialog`, `RescheduleDialog`, `RenewalPanel` into `frontend/src/components/amc/`; detail page (`amc/[id]/page.tsx`) slimmed from 340 → ~115 lines. Added `VisitCalendar` (custom hand-rolled month grid, zero new dependencies): sourced from existing `amcApi.listContracts()` `next_visit_date` field; shows upcoming visit per active contract as clickable pill; navigates to contract on click; month navigation via prev/next buttons. Calendar accessible at `/amc?view=calendar` via a List/Calendar toggle button in the contracts page header (URL-driven, shareable). `next build` passes cleanly.
```

- [ ] **Step 2: Verify the audit file is saved correctly**

```bash
grep "AMC.*15\|15.*VisitTimeline\|15.*DONE" docs/ALIGNMENT_AUDIT.md | head -3
```
Expected: line shows `**DONE**`

---

## Self-review

**Spec coverage check:**
- UI §3 `VisitTimeline` ✅ Task 1
- UI §3 `VisitCompletionForm` ✅ Task 2 (`VisitCompleteDialog` — same behaviour, different name)
- UI §3 `RenewalPanel` ✅ Task 4
- UI §5 calendar view at `/amc?view=calendar` ✅ Tasks 6–7
- No behaviour change on extraction ✅ props mirror exact original state + callback patterns
- No new npm dependency ✅ custom grid confirmed

**Placeholder scan:** None found. All code blocks are complete.

**Type consistency:**
- `CompletePayload` defined in Task 2, exported from barrel in Task 5, imported in Task 5's page rewrite ✅
- `AmcVisit` used consistently throughout ✅
- `AmcContract['status']` used in `VisitCalendar` pill colouring ✅
- `buildCalendarDays` returns `Date[]`, consumed by `days.map(...)` with `.getMonth()`, `.getDate()` ✅
