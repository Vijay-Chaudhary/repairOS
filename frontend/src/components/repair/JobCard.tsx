'use client';

import { useRouter } from 'next/navigation';
import { Clock, User, Wrench, AlertTriangle, Star } from 'lucide-react';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Money } from '@/components/shared/Money';
import { formatDate } from '@/lib/format/date';
import { cn } from '@/lib/utils';
import type { JobListItem, JobPriority } from '@/lib/api/repair';

const PRIORITY_STYLE: Record<JobPriority, string> = {
  normal: '',
  urgent: 'border-l-4 border-l-[var(--warning)]',
  vip:    'border-l-4 border-l-[var(--accent)]',
};

const PRIORITY_ICON = {
  normal: null,
  urgent: <AlertTriangle className="h-3 w-3 text-[var(--warning)]" />,
  vip:    <Star className="h-3 w-3 text-[var(--accent)]" />,
};

interface JobCardProps {
  job: JobListItem;
  compact?: boolean;
}

export function JobCard({ job, compact }: JobCardProps) {
  const router = useRouter();

  return (
    <div
      onClick={() => router.push(`/jobs/${job.id}`)}
      className={cn(
        'bg-[var(--surface)] rounded-md border border-[var(--border)] p-3 cursor-pointer hover:shadow-md transition-shadow select-none',
        PRIORITY_STYLE[job.priority]
      )}
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex items-center gap-1 min-w-0">
          {PRIORITY_ICON[job.priority]}
          <span className="font-mono text-xs text-[var(--text-muted)] font-medium truncate">
            {job.job_number}
          </span>
        </div>
        <StatusBadge status={job.status} className="shrink-0 text-[10px]" />
      </div>

      <p className="text-body-sm font-medium text-[var(--text)] truncate">{job.customer_name}</p>

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
          <div className="flex items-center justify-between mt-1">
            <div className="flex items-center gap-1 text-xs text-[var(--text-muted)]">
              <Clock className="h-3 w-3 shrink-0" />
              <span>{formatDate(job.intake_date)}</span>
            </div>
            <Money amount={job.service_charge} className="text-xs" />
          </div>
        </div>
      )}
    </div>
  );
}
