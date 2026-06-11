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
