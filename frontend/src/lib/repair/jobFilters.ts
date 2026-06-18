import type { JobFilters, JobStatus, JobPriority } from '@/lib/api/repair';

export type PaymentStatusFilter = 'paid' | 'partial' | 'unpaid';
export type QuickPreset = 'overdue' | 'unpaid' | 'due_today' | 'my_jobs';

export interface JobFilterState {
  search: string;
  status: JobStatus | 'all';
  technicianId: string | 'all';
  priority: JobPriority | 'all';
  deviceType: string;                       // free text; '' = any
  paymentStatus: PaymentStatusFilter | 'all';
  dateFrom: string;                         // 'YYYY-MM-DD' | ''  (intake date)
  dateTo: string;
  overdue: boolean;                         // expected_delivery_date < today, non-terminal
  dueToday: boolean;                        // expected_delivery_date == today
}

export const EMPTY_JOB_FILTERS: JobFilterState = {
  search: '',
  status: 'all',
  technicianId: 'all',
  priority: 'all',
  deviceType: '',
  paymentStatus: 'all',
  dateFrom: '',
  dateTo: '',
  overdue: false,
  dueToday: false,
};

export interface JobFilterCtx {
  todayIso: string;                         // 'YYYY-MM-DD' for due_today
  currentUserId: string;
  technicianName: (id: string) => string;   // resolve a tech id to a display name
}

/**
 * API params shared by every view. Excludes `status` because the kanban applies a
 * status per column and the list applies the chosen status filter separately.
 */
export function toBaseApiFilters(s: JobFilterState, ctx: JobFilterCtx): JobFilters {
  const f: JobFilters = {};
  if (s.technicianId !== 'all') f.technician_id = s.technicianId;
  if (s.priority !== 'all') f.priority = s.priority;
  const device = s.deviceType.trim();
  if (device) f.device_type = device;
  if (s.paymentStatus !== 'all') f.payment_status = s.paymentStatus;
  if (s.dateFrom) f.date_from = s.dateFrom;
  if (s.dateTo) f.date_to = s.dateTo;
  if (s.overdue) f.overdue = true;
  if (s.dueToday) f.due_on = ctx.todayIso;
  return f;
}

const STATUS_LABELS: Record<string, string> = {
  draft: 'Draft', open: 'Open', estimated: 'Estimated', estimate_sent: 'Estimate sent',
  estimate_approved: 'Estimate approved', estimate_rejected: 'Estimate rejected',
  in_progress: 'In progress', on_hold: 'On hold', ready_for_qc: 'Ready for QC',
  qc_failed: 'QC failed', ready_for_pickup: 'Ready for pickup', delivered: 'Delivered',
  closed: 'Closed', cancelled: 'Cancelled',
};
const PRIORITY_LABELS: Record<string, string> = { normal: 'Normal', urgent: 'Urgent', vip: 'VIP' };
const PAYMENT_LABELS: Record<string, string> = { paid: 'Paid', partial: 'Partial', unpaid: 'Unpaid' };

export interface FilterChip {
  key: keyof JobFilterState;
  label: string;
}

/** Every active filter (search excluded — it lives in its own input). */
export function activeChips(s: JobFilterState, ctx: JobFilterCtx): FilterChip[] {
  const chips: FilterChip[] = [];
  if (s.status !== 'all') chips.push({ key: 'status', label: STATUS_LABELS[s.status] ?? s.status });
  if (s.technicianId !== 'all') chips.push({ key: 'technicianId', label: `Tech: ${ctx.technicianName(s.technicianId)}` });
  if (s.priority !== 'all') chips.push({ key: 'priority', label: PRIORITY_LABELS[s.priority] ?? s.priority });
  if (s.deviceType.trim()) chips.push({ key: 'deviceType', label: `Device: ${s.deviceType.trim()}` });
  if (s.paymentStatus !== 'all') chips.push({ key: 'paymentStatus', label: PAYMENT_LABELS[s.paymentStatus] });
  if (s.dateFrom) chips.push({ key: 'dateFrom', label: `From ${s.dateFrom}` });
  if (s.dateTo) chips.push({ key: 'dateTo', label: `To ${s.dateTo}` });
  if (s.overdue) chips.push({ key: 'overdue', label: 'Overdue' });
  if (s.dueToday) chips.push({ key: 'dueToday', label: 'Due today' });
  return chips;
}

export function activeFilterCount(s: JobFilterState): number {
  let n = 0;
  if (s.status !== 'all') n++;
  if (s.technicianId !== 'all') n++;
  if (s.priority !== 'all') n++;
  if (s.deviceType.trim()) n++;
  if (s.paymentStatus !== 'all') n++;
  if (s.dateFrom) n++;
  if (s.dateTo) n++;
  if (s.overdue) n++;
  if (s.dueToday) n++;
  return n;
}

export function clearChip(s: JobFilterState, key: keyof JobFilterState): JobFilterState {
  return { ...s, [key]: EMPTY_JOB_FILTERS[key] };
}

/** Reset every filter but keep the search text. */
export function clearAll(s: JobFilterState): JobFilterState {
  return { ...EMPTY_JOB_FILTERS, search: s.search };
}

/** Toggle a quick preset on/off, returning new state. */
export function applyPreset(s: JobFilterState, preset: QuickPreset, ctx: JobFilterCtx): JobFilterState {
  const active = isPresetActive(s, preset, ctx);
  switch (preset) {
    case 'overdue':   return { ...s, overdue: !active };
    case 'due_today': return { ...s, dueToday: !active };
    case 'unpaid':    return { ...s, paymentStatus: active ? 'all' : 'unpaid' };
    case 'my_jobs':   return { ...s, technicianId: active ? 'all' : ctx.currentUserId };
  }
}

export function isPresetActive(s: JobFilterState, preset: QuickPreset, ctx: JobFilterCtx): boolean {
  switch (preset) {
    case 'overdue':   return s.overdue;
    case 'due_today': return s.dueToday;
    case 'unpaid':    return s.paymentStatus === 'unpaid';
    case 'my_jobs':   return s.technicianId === ctx.currentUserId;
  }
}

/** True when search text or any panel/preset filter is active. */
export function hasActiveFilters(s: JobFilterState): boolean {
  return s.search.trim().length > 0 || activeFilterCount(s) > 0;
}

export interface JobsEmptyCopy {
  title: string;
  description: string;
  kanbanLabel: string;
}

/** Empty-state copy that adapts to whether filters/search are narrowing the view. */
export function jobsEmptyCopy(filtersActive: boolean): JobsEmptyCopy {
  if (filtersActive) {
    return {
      title: 'No matching jobs',
      description: 'No jobs match the current search and filters. Try clearing them.',
      kanbanLabel: 'No matches',
    };
  }
  return {
    title: 'No jobs yet',
    description: 'Create your first job to get started.',
    kanbanLabel: 'No jobs in this stage',
  };
}

export const QUICK_PRESETS: Array<{ id: QuickPreset; label: string }> = [
  { id: 'overdue',   label: 'Overdue' },
  { id: 'unpaid',    label: 'Unpaid' },
  { id: 'due_today', label: 'Due today' },
  { id: 'my_jobs',   label: 'My jobs' },
];
