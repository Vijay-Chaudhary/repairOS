import { formatDatetime } from '@/lib/format/date';
import { cn } from '@/lib/utils';

export interface TimelineEvent {
  id: string;
  type: string;
  actor?: string;
  description: string;
  created_at: string;
  metadata?: Record<string, unknown>;
}

interface EntityTimelineProps {
  events: TimelineEvent[];
  loading?: boolean;
  className?: string;
}

const TYPE_COLORS: Record<string, string> = {
  created: 'bg-[var(--info)]',
  status_changed: 'bg-[var(--warning)]',
  payment: 'bg-[var(--success)]',
  note: 'bg-[var(--text-muted)]',
  communication: 'bg-[var(--accent)]',
  default: 'bg-[var(--border)]',
};

export function EntityTimeline({ events, loading, className }: EntityTimelineProps) {
  if (loading) {
    return (
      <div className={cn('space-y-4', className)}>
        {[1, 2, 3].map((i) => (
          <div key={i} className="flex gap-3">
            <div className="w-2 h-2 rounded-full mt-1.5 animate-pulse bg-[var(--surface-2)] shrink-0" />
            <div className="flex-1 space-y-1">
              <div className="h-4 w-3/4 animate-pulse bg-[var(--surface-2)] rounded" />
              <div className="h-3 w-1/3 animate-pulse bg-[var(--surface-2)] rounded" />
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (events.length === 0) {
    return <p className="text-body-sm text-[var(--text-muted)] py-4">No activity yet.</p>;
  }

  return (
    <div className={cn('relative space-y-4', className)}>
      {/* Vertical line */}
      <div className="absolute left-[3px] top-2 bottom-2 w-px bg-[var(--border)]" />

      {events.map((event) => (
        <div key={event.id} className="flex gap-3 relative">
          <div
            className={cn(
              'w-2 h-2 rounded-full mt-1.5 shrink-0 z-10',
              TYPE_COLORS[event.type] ?? TYPE_COLORS.default
            )}
          />
          <div className="flex-1 min-w-0">
            <p className="text-body-sm text-[var(--text)]">{event.description}</p>
            <p className="text-xs text-[var(--text-muted)] mt-0.5">
              {event.actor && <span className="font-medium">{event.actor} · </span>}
              {formatDatetime(event.created_at)}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}
