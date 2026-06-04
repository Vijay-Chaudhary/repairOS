'use client';

import { Skeleton } from '@/components/ui/skeleton';
import { JobCard } from './JobCard';
import { KANBAN_COLUMNS } from '@/lib/api/repair';
import type { JobListItem, JobStatus } from '@/lib/api/repair';
import { cn } from '@/lib/utils';

export interface KanbanColumnData {
  status: JobStatus;
  jobs: JobListItem[];
  isLoading: boolean;
  count: number;
}

interface JobBoardProps {
  columns: KanbanColumnData[];
}

function ColumnSkeleton() {
  return (
    <div className="space-y-2">
      {[1, 2, 3].map((i) => <Skeleton key={i} className="h-24 w-full rounded-md" />)}
    </div>
  );
}

export function JobBoard({ columns }: JobBoardProps) {
  const colMap = new Map(columns.map((c) => [c.status, c]));

  return (
    <div className="flex gap-3 overflow-x-auto snap-x snap-mandatory pb-4 -mx-4 px-4 md:mx-0 md:px-0">
      {KANBAN_COLUMNS.map(({ status, label }) => {
        const col = colMap.get(status) ?? { status, jobs: [], isLoading: false, count: 0 };

        return (
          <div key={status} className="flex-none w-[272px] snap-center">
            {/* Column header */}
            <div className="flex items-center justify-between mb-2 px-0.5">
              <h3 className="text-body-sm font-semibold text-[var(--text)]">{label}</h3>
              <span className={cn(
                'min-w-[20px] h-5 rounded-full text-[10px] font-semibold px-1.5 flex items-center justify-center',
                col.count > 0
                  ? 'bg-[var(--accent)]/15 text-[var(--accent)]'
                  : 'bg-[var(--surface-2)] text-[var(--text-muted)]',
              )}>
                {col.isLoading ? '…' : col.count}
              </span>
            </div>

            {/* Column body */}
            <div className="bg-[var(--surface-2)] rounded-lg p-2 min-h-[120px] space-y-2">
              {col.isLoading ? (
                <ColumnSkeleton />
              ) : col.jobs.length === 0 ? (
                <div className="flex items-center justify-center h-20">
                  <p className="text-xs text-[var(--text-muted)]">No jobs</p>
                </div>
              ) : (
                col.jobs.map((job) => <JobCard key={job.id} job={job} />)
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
