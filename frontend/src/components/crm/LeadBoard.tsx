'use client';

import { Skeleton } from '@/components/ui/skeleton';
import { LeadCard } from './LeadCard';
import { LEAD_PIPELINE_COLS } from '@/lib/api/crm';
import type { Lead, LeadStatus } from '@/lib/api/crm';
import { cn } from '@/lib/utils';

export interface LeadColumnData {
  status: LeadStatus;
  leads: Lead[];
  isLoading: boolean;
  count: number;
}

interface LeadBoardProps {
  columns: LeadColumnData[];
}

function ColumnSkeleton() {
  return (
    <div className="space-y-2">
      {[1, 2].map((i) => <Skeleton key={i} className="h-20 w-full rounded-md" />)}
    </div>
  );
}

export function LeadBoard({ columns }: LeadBoardProps) {
  const colMap = new Map(columns.map((c) => [c.status, c]));

  return (
    <div className="flex gap-3 overflow-x-auto snap-x snap-mandatory pb-4 -mx-4 px-4 md:mx-0 md:px-0">
      {LEAD_PIPELINE_COLS.map(({ status, label }) => {
        const col = colMap.get(status) ?? { status, leads: [], isLoading: false, count: 0 };

        return (
          <div key={status} className="flex-none w-[256px] snap-center">
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

            <div className="bg-[var(--surface-2)] rounded-lg p-2 min-h-[120px] space-y-2">
              {col.isLoading ? (
                <ColumnSkeleton />
              ) : col.leads.length === 0 ? (
                <div className="flex items-center justify-center h-16">
                  <p className="text-xs text-[var(--text-muted)]">No leads</p>
                </div>
              ) : (
                col.leads.map((lead) => <LeadCard key={lead.id} lead={lead} />)
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
