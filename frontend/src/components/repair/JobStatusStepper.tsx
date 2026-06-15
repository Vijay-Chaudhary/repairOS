'use client';

import { cn } from '@/lib/utils';
import { Check } from 'lucide-react';
import type { JobStatus } from '@/lib/api/repair';

const MILESTONES: Array<{ status: JobStatus; label: string; order: number }> = [
  { status: 'open',             label: 'Open',    order: 1 },
  { status: 'in_progress',      label: 'Working', order: 2 },
  { status: 'ready_for_qc',     label: 'QC',      order: 3 },
  { status: 'ready_for_pickup', label: 'Ready for Pickup', order: 4 },
  { status: 'delivered',        label: 'Done',    order: 5 },
];

const STATUS_ORDER: Record<string, number> = {
  draft: 0, open: 1,
  in_progress: 2, estimated: 2, estimate_sent: 2, estimate_approved: 2,
  estimate_rejected: 2, on_hold: 2,
  ready_for_qc: 3, qc_failed: 3,
  ready_for_pickup: 4,
  delivered: 5, closed: 5,
  cancelled: -1,
};

interface JobStatusStepperProps {
  status: JobStatus;
  className?: string;
}

export function JobStatusStepper({ status, className }: JobStatusStepperProps) {
  const isCancelled = status === 'cancelled';
  const currentOrder = STATUS_ORDER[status] ?? 0;

  return (
    <div className={cn('flex items-start', className)}>
      {MILESTONES.map((milestone, index) => {
        const isCompleted = !isCancelled && currentOrder > milestone.order;
        const isCurrent   = !isCancelled && currentOrder === milestone.order;

        return (
          <div key={milestone.status} className="flex flex-1 items-center min-w-0">
            <div className="flex flex-col items-center shrink-0">
              <div className={cn(
                'w-7 h-7 rounded-full border-2 flex items-center justify-center text-xs font-semibold transition-colors',
                isCompleted && 'bg-[var(--accent)] border-[var(--accent)] text-white',
                isCurrent  && 'bg-[var(--surface)] border-[var(--accent)] text-[var(--accent)]',
                !isCompleted && !isCurrent && !isCancelled && 'bg-[var(--surface-2)] border-[var(--border)] text-[var(--text-muted)]',
                isCancelled && 'bg-[var(--danger)]/10 border-[var(--danger)] text-[var(--danger)]',
              )}>
                {isCompleted ? <Check className="h-3.5 w-3.5" /> : <span>{index + 1}</span>}
              </div>
              <span className={cn(
                'mt-1 text-[10px] font-medium leading-none',
                isCurrent ? 'text-[var(--accent)]' : 'text-[var(--text-muted)]',
              )}>
                {milestone.label}
              </span>
            </div>
            {index < MILESTONES.length - 1 && (
              <div className={cn(
                'flex-1 h-px mb-4 mx-1 transition-colors',
                isCompleted ? 'bg-[var(--accent)]' : 'bg-[var(--border)]',
              )} />
            )}
          </div>
        );
      })}
    </div>
  );
}
