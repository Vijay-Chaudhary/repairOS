'use client';

import { SlidersHorizontal, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  activeChips,
  activeFilterCount,
  clearAll,
  clearChip,
  type JobFilterState,
  type JobFilterCtx,
  type PaymentStatusFilter,
} from '@/lib/repair/jobFilters';
import type { JobPriority, JobStatus } from '@/lib/api/repair';
import { cn } from '@/lib/utils';

interface Technician { id: string; name: string }

interface JobFilterBarProps {
  filters: JobFilterState;
  onChange: (next: JobFilterState) => void;
  technicians: Technician[];
  ctx: JobFilterCtx;
}

const STATUS_OPTIONS: Array<{ value: JobStatus | 'all'; label: string }> = [
  { value: 'all', label: 'All statuses' },
  { value: 'open', label: 'Open' },
  { value: 'in_progress', label: 'In progress' },
  { value: 'on_hold', label: 'On hold' },
  { value: 'ready_for_qc', label: 'Ready for QC' },
  { value: 'ready_for_pickup', label: 'Ready for pickup' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'closed', label: 'Closed' },
  { value: 'cancelled', label: 'Cancelled' },
];
const PRIORITY_OPTIONS: Array<{ value: JobPriority | 'all'; label: string }> = [
  { value: 'all', label: 'All priorities' },
  { value: 'normal', label: 'Normal' },
  { value: 'urgent', label: 'Urgent' },
  { value: 'vip', label: 'VIP' },
];
const PAYMENT_OPTIONS: Array<{ value: PaymentStatusFilter | 'all'; label: string }> = [
  { value: 'all', label: 'All payments' },
  { value: 'paid', label: 'Paid' },
  { value: 'partial', label: 'Partial' },
  { value: 'unpaid', label: 'Unpaid' },
];

const selectClass =
  'h-9 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-body-sm text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--accent)]';
const fieldLabel = 'text-xs font-medium text-[var(--text-muted)] mb-1 block';

export function JobFilterBar({ filters, onChange, technicians, ctx }: JobFilterBarProps) {
  const count = activeFilterCount(filters);
  const chips = activeChips(filters, ctx);
  const set = <K extends keyof JobFilterState>(key: K, value: JobFilterState[K]) =>
    onChange({ ...filters, [key]: value });

  return (
    <div className="flex flex-col gap-2">
      <Popover>
        <PopoverTrigger asChild>
          <button
            className={cn(
              'h-9 px-3 inline-flex items-center gap-1.5 rounded-md border text-body-sm transition-colors min-h-[44px] sm:min-h-0',
              count > 0
                ? 'border-[var(--accent)] text-[var(--accent)] bg-[var(--accent)]/5'
                : 'border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-2)]',
            )}
          >
            <SlidersHorizontal className="h-4 w-4" />
            <span>Filters</span>
            {count > 0 && (
              <span className="ml-0.5 h-5 min-w-[20px] px-1 rounded-full bg-[var(--accent)] text-white text-xs inline-flex items-center justify-center tabular-nums">
                {count}
              </span>
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-[320px] space-y-3">
          <div>
            <label className={fieldLabel} htmlFor="jf-status">Status</label>
            <select
              id="jf-status"
              aria-label="Status"
              className={selectClass}
              value={filters.status}
              onChange={(e) => set('status', e.target.value as JobStatus | 'all')}
            >
              {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          <div>
            <label className={fieldLabel} htmlFor="jf-tech">Technician</label>
            <select
              id="jf-tech"
              aria-label="Technician"
              className={selectClass}
              value={filters.technicianId}
              onChange={(e) => set('technicianId', e.target.value)}
            >
              <option value="all">All technicians</option>
              {technicians.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>

          <div>
            <label className={fieldLabel} htmlFor="jf-priority">Priority</label>
            <select
              id="jf-priority"
              aria-label="Priority"
              className={selectClass}
              value={filters.priority}
              onChange={(e) => set('priority', e.target.value as JobPriority | 'all')}
            >
              {PRIORITY_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          <div>
            <label className={fieldLabel} htmlFor="jf-device">Device type</label>
            <Input
              id="jf-device"
              className="h-9"
              placeholder="e.g. Laptop"
              value={filters.deviceType}
              onChange={(e) => set('deviceType', e.target.value)}
            />
          </div>

          <div>
            <label className={fieldLabel} htmlFor="jf-payment">Payment</label>
            <select
              id="jf-payment"
              aria-label="Payment"
              className={selectClass}
              value={filters.paymentStatus}
              onChange={(e) => set('paymentStatus', e.target.value as PaymentStatusFilter | 'all')}
            >
              {PAYMENT_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className={fieldLabel} htmlFor="jf-from">Intake from</label>
              <input id="jf-from" type="date" className={selectClass} value={filters.dateFrom}
                onChange={(e) => set('dateFrom', e.target.value)} />
            </div>
            <div className="flex-1">
              <label className={fieldLabel} htmlFor="jf-to">Intake to</label>
              <input id="jf-to" type="date" className={selectClass} value={filters.dateTo}
                onChange={(e) => set('dateTo', e.target.value)} />
            </div>
          </div>
        </PopoverContent>
      </Popover>

      {chips.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap">
          {chips.map((chip) => (
            <span
              key={chip.key}
              className="inline-flex items-center gap-1 h-7 pl-2.5 pr-1 rounded-full border border-[var(--accent)]/40 bg-[var(--accent)]/5 text-[var(--accent)] text-xs"
            >
              {chip.label}
              <button
                aria-label={`Remove ${chip.label}`}
                className="h-5 w-5 inline-flex items-center justify-center rounded-full hover:bg-[var(--accent)]/15"
                onClick={() => onChange(clearChip(filters, chip.key))}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
          <button
            className="h-7 px-2 text-xs text-[var(--danger)] hover:bg-[var(--danger)]/10 rounded-md transition-colors"
            onClick={() => onChange(clearAll(filters))}
          >
            Clear all
          </button>
        </div>
      )}
    </div>
  );
}
