'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { differenceInCalendarDays } from 'date-fns';
import { Clock, User, Wrench, AlertTriangle, Star, CalendarClock, MoreVertical, ArrowRight, RotateCcw, Eye, ChevronRight, CheckCircle2, IndianRupee } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Money } from '@/components/shared/Money';
import { Can } from '@/components/shared/Can';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { formatDate } from '@/lib/format/date';
import { sumMoney } from '@/lib/format/money';
import { cn } from '@/lib/utils';
import type { JobListItem, JobPriority, JobStatus } from '@/lib/api/repair';
import { STATUS_TRANSITIONS } from '@/lib/api/repair';

const PRIORITY_STYLE: Record<JobPriority, string> = {
  normal: '',
  urgent: 'border-l-4 border-l-[var(--warning)] bg-[var(--warning)]/5',
  vip:    'border-l-4 border-l-[var(--accent)] bg-[var(--accent)]/5',
};

const PRIORITY_ICON = {
  normal: null,
  urgent: <AlertTriangle className="h-3 w-3 text-[var(--warning)]" />,
  vip:    <Star className="h-3 w-3 text-[var(--accent)]" />,
};

const TERMINAL_STATUSES = new Set<JobStatus>(['delivered', 'closed', 'cancelled']);

// Primary CTA for each kanban status — the main forward step, no reason required
const PRIMARY_TARGET: Partial<Record<JobStatus, JobStatus>> = {
  open:             'in_progress',
  in_progress:      'ready_for_qc',
  on_hold:          'in_progress',
  ready_for_qc:     'ready_for_pickup',
  ready_for_pickup: 'delivered',
  delivered:        'closed',
  cancelled:        'open',
};

// Secondary CTA shown alongside primary when two paths are common
const SECONDARY_TARGET: Partial<Record<JobStatus, JobStatus>> = {
  in_progress: 'ready_for_pickup',
};

const CONFIRM_CONFIG: Partial<Record<JobStatus, { title: string; description: string; confirmLabel: string }>> = {
  delivered: {
    title: 'Mark as delivered?',
    description: 'This marks the job as delivered to the customer.',
    confirmLabel: 'Mark delivered',
  },
  closed: {
    title: 'Close this job?',
    description: 'Closing marks the job complete. It can no longer be moved.',
    confirmLabel: 'Close job',
  },
};

export interface JobCardKanbanProps {
  validTargets: string[];
  onMoveTo: (toStatus: JobStatus, fields?: Record<string, string>) => void;
  isAdmin?: boolean;
}

interface JobCardProps {
  job: JobListItem;
  compact?: boolean;
  kanban?: JobCardKanbanProps;
}

export function JobCard({ job, compact, kanban }: JobCardProps) {
  const router = useRouter();
  const [confirmTarget, setConfirmTarget] = useState<JobStatus | null>(null);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const deliveryDate = job.expected_delivery_date ? new Date(job.expected_delivery_date) : null;
  const isOverdue =
    deliveryDate !== null &&
    deliveryDate < today &&
    !TERMINAL_STATUSES.has(job.status);
  const overdueDays = isOverdue && deliveryDate ? differenceInCalendarDays(today, deliveryDate) : 0;

  const balance = sumMoney(job.service_charge) - sumMoney(job.advance_paid);
  const hasCharge = sumMoney(job.service_charge) > 0;
  const isPaid = hasCharge && balance <= 0;
  const isDue = balance > 0;

  const handleCardClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    if (target.closest('[data-kanban-menu]')) return;
    if (target.closest('[data-job-actions]')) return;
    router.push(`/jobs/${job.id}`);
  };

  function handleQuickMove(to: JobStatus, e: React.MouseEvent) {
    e.stopPropagation();
    if (!kanban) return;
    if (CONFIRM_CONFIG[to]) {
      setConfirmTarget(to);
      return;
    }
    kanban.onMoveTo(to);
  }

  function handleConfirmedMove() {
    if (!kanban || !confirmTarget) return;
    const target = confirmTarget;
    setConfirmTarget(null);
    kanban.onMoveTo(target);
  }

  const primaryTo = kanban ? PRIMARY_TARGET[job.status] : undefined;
  const primaryLabel = primaryTo
    ? STATUS_TRANSITIONS[job.status]?.find((t) => t.to === primaryTo)?.label
    : undefined;
  const showPrimary = !!(primaryTo && primaryLabel && kanban?.validTargets.includes(primaryTo));

  const secondaryTo = kanban ? SECONDARY_TARGET[job.status] : undefined;
  const secondaryLabel = secondaryTo
    ? STATUS_TRANSITIONS[job.status]?.find((t) => t.to === secondaryTo)?.label
    : undefined;
  const showSecondary = !!(secondaryTo && secondaryLabel && kanban?.validTargets.includes(secondaryTo));

  // Derive menu items from STATUS_TRANSITIONS filtered to kanban.validTargets
  const menuTransitions = kanban
    ? STATUS_TRANSITIONS[job.status]?.filter((t) => kanban.validTargets.includes(t.to)) ?? []
    : [];

  const isCancelled = job.status === 'cancelled';

  return (
    <div
      onClick={handleCardClick}
      className={cn(
        'bg-[var(--surface)] rounded-md border border-[var(--border)] pt-0.5 p-3 cursor-pointer hover:shadow-md transition-shadow select-none relative',
        PRIORITY_STYLE[job.priority],
      )}
    >
      {/* Top row: job number + status + menu */}
      <div className="flex items-center justify-between gap-2 mb-1.5">
        <div className="flex items-center gap-1 min-w-0">
          {PRIORITY_ICON[job.priority]}
          <span className="font-mono text-[11px] text-[var(--text-muted)] truncate">
            {job.job_number}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <StatusBadge status={job.status} className="text-[10px]" />

          {kanban && (
            <Can permission="repair.jobs.change_status">
              <div data-kanban-menu>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-6 w-6 p-0 text-[var(--text-muted)] hover:text-[var(--text)]"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <MoreVertical className="h-3.5 w-3.5" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="min-w-[180px]">
                    {menuTransitions
                      .filter((t) => t.to !== 'cancelled')
                      .map((t) => (
                        <DropdownMenuItem
                          key={t.to}
                          onClick={(e) => {
                            e.stopPropagation();
                            kanban.onMoveTo(t.to);
                          }}
                        >
                          <ArrowRight className="h-3.5 w-3.5 mr-2 text-[var(--text-muted)]" />
                          {t.label}
                        </DropdownMenuItem>
                      ))}

                    {menuTransitions.some((t) => t.to !== 'cancelled') &&
                      menuTransitions.some((t) => t.to === 'cancelled') && (
                        <DropdownMenuSeparator />
                      )}

                    {menuTransitions.some((t) => t.to === 'cancelled') && (
                      <DropdownMenuItem
                        className="text-[var(--danger)]"
                        onClick={(e) => {
                          e.stopPropagation();
                          kanban.onMoveTo('cancelled');
                        }}
                      >
                        Cancel job
                      </DropdownMenuItem>
                    )}

                    {isCancelled && kanban.isAdmin && (
                      <DropdownMenuItem
                        onClick={(e) => {
                          e.stopPropagation();
                          kanban.onMoveTo('open');
                        }}
                      >
                        <RotateCcw className="h-3.5 w-3.5 mr-2" />
                        Re-open
                      </DropdownMenuItem>
                    )}

                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={(e) => {
                        e.stopPropagation();
                        router.push(`/jobs/${job.id}`);
                      }}
                    >
                      <Eye className="h-3.5 w-3.5 mr-2 text-[var(--text-muted)]" />
                      View details
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            </Can>
          )}
        </div>
      </div>

      {/* Customer name — primary identifier */}
      <p className="text-body font-semibold text-[var(--text)] truncate leading-snug">{job.customer_name}</p>

      <div className="flex items-center gap-1 mt-0.5 text-xs text-[var(--text-muted)]">
        <Wrench className="h-3 w-3 shrink-0" />
        <span className="truncate">{job.device_brand ? `${job.device_brand} ` : ''}{job.device_type}</span>
      </div>

      {!compact && (
        <div className="mt-2 space-y-1">
          {job.assigned_technician_name && (
            <div className="flex items-center gap-1 text-xs text-[var(--text-muted)]">
              <User className="h-3 w-3 shrink-0" />
              <span className="truncate">{job.assigned_technician_name}</span>
            </div>
          )}
          {job.expected_delivery_date && (
            <div className={cn(
              'flex items-center gap-1 text-xs',
              isOverdue ? 'text-[var(--danger)] font-medium' : 'text-[var(--text-muted)]',
            )}>
              <CalendarClock className="h-3 w-3 shrink-0" />
              <span>
                {isOverdue
                  ? `${overdueDays}d overdue`
                  : `Due ${formatDate(job.expected_delivery_date)}`}
              </span>
            </div>
          )}
          <div className="flex items-center justify-between mt-1">
            <div className="flex items-center gap-1 text-xs text-[var(--text-muted)]">
              <Clock className="h-3 w-3 shrink-0" />
              <span>{formatDate(job.intake_date)}</span>
            </div>
            {isDue ? (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--warning)]">
                <IndianRupee className="h-3 w-3 shrink-0" />
                Due <Money amount={balance} className="text-xs" />
              </span>
            ) : isPaid ? (
              <span className="inline-flex items-center gap-1 text-xs font-medium text-[var(--success)]">
                <CheckCircle2 className="h-3 w-3 shrink-0" />
                Paid
              </span>
            ) : (
              <Money amount={job.service_charge} className="text-xs text-[var(--text-muted)]" />
            )}
          </div>
        </div>
      )}

      {/* Quick-move action buttons */}
      {showPrimary && (
        <Can permission="repair.jobs.change_status">
          <div className="mt-2" data-job-actions>
            {showSecondary ? (
              <div className="flex gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 h-7 text-xs"
                  onClick={(e) => handleQuickMove(primaryTo!, e)}
                >
                  {primaryLabel}
                  <ChevronRight className="h-3 w-3 ml-1" />
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="flex-1 h-7 text-xs"
                  onClick={(e) => handleQuickMove(secondaryTo!, e)}
                >
                  {secondaryLabel}
                  <ChevronRight className="h-3 w-3 ml-1" />
                </Button>
              </div>
            ) : (
              <Button
                size="sm"
                variant="outline"
                className="w-full h-7 text-xs"
                onClick={(e) => handleQuickMove(primaryTo!, e)}
              >
                {primaryLabel}
                <ChevronRight className="h-3 w-3 ml-1" />
              </Button>
            )}
          </div>
        </Can>
      )}

      {/* Confirm dialog for irreversible transitions */}
      {confirmTarget && CONFIRM_CONFIG[confirmTarget] && (
        <ConfirmDialog
          open={!!confirmTarget}
          onOpenChange={(open) => { if (!open) setConfirmTarget(null); }}
          title={CONFIRM_CONFIG[confirmTarget]!.title}
          description={CONFIRM_CONFIG[confirmTarget]!.description}
          confirmLabel={CONFIRM_CONFIG[confirmTarget]!.confirmLabel}
          onConfirm={handleConfirmedMove}
        />
      )}
    </div>
  );
}
