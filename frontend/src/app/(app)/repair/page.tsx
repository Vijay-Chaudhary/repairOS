'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Wrench, AlertTriangle, PackageSearch, CheckCircle2 } from 'lucide-react';
import { repairApi, KANBAN_COLUMNS, type RepairOverview } from '@/lib/api/repair';
import { qk } from '@/lib/query/keys';
import { useActiveShopStore } from '@/lib/stores/activeShopStore';
import { Money } from '@/components/shared/Money';
import { Button } from '@/components/ui/button';
import { Can } from '@/components/shared/Can';
import { cn } from '@/lib/utils';

const KPI_DEFS: Array<{
  key: keyof RepairOverview['kpis'];
  label: string;
  icon: React.ElementType;
  tone: string;
}> = [
  { key: 'open_jobs',        label: 'Open jobs',        icon: Wrench,        tone: 'text-[var(--text)]' },
  { key: 'overdue',          label: 'Overdue',          icon: AlertTriangle, tone: 'text-[var(--danger)]' },
  { key: 'awaiting_parts',   label: 'Awaiting parts',   icon: PackageSearch, tone: 'text-[var(--warning)]' },
  { key: 'ready_for_pickup', label: 'Ready for pickup', icon: CheckCircle2,  tone: 'text-[var(--success)]' },
];

const STATUS_LABEL: Record<string, string> = Object.fromEntries(
  KANBAN_COLUMNS.map((c) => [c.status, c.label]),
);

export default function RepairOverviewPage() {
  const { activeShopId, isAllShops } = useActiveShopStore();
  const shopId = isAllShops ? undefined : activeShopId ?? undefined;

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: qk.repairOverview(shopId ?? null),
    queryFn: () => repairApi.getOverview(shopId),
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <div data-testid="overview-loading" className="p-4 md:p-6 space-y-4">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 rounded-lg bg-[var(--surface-2)] animate-pulse" />
          ))}
        </div>
        <div className="grid lg:grid-cols-2 gap-3">
          <div className="h-56 rounded-lg bg-[var(--surface-2)] animate-pulse" />
          <div className="h-56 rounded-lg bg-[var(--surface-2)] animate-pulse" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-6 flex flex-col items-center justify-center gap-3 text-center">
        <p className="text-body text-[var(--text-muted)]">Couldn&rsquo;t load the repair overview.</p>
        <Button size="sm" onClick={() => refetch()}>Retry</Button>
      </div>
    );
  }

  if (!data) return null;

  // NOTE: by_status only includes active + delivered statuses (not closed/cancelled),
  // so a shop whose jobs are ALL closed/cancelled will show the "No jobs yet" state.
  // Acceptable for Phase 1; revisit with a total-jobs count if it becomes a problem.
  const isEmpty =
    data.by_status.every((r) => r.count === 0) &&
    data.needs_attention.length === 0 &&
    data.kpis.open_jobs === 0;

  if (isEmpty) {
    return (
      <div className="p-6 flex flex-col items-center justify-center gap-3 text-center min-h-[50vh]">
        <Wrench className="h-10 w-10 text-[var(--text-muted)]" />
        <h2 className="text-h2 text-[var(--text)]">No jobs yet</h2>
        <p className="text-body-sm text-[var(--text-muted)]">Create your first job to get started.</p>
        <Can permission="repair.jobs.create">
          <Button asChild size="sm"><Link href="/jobs/new">New Job</Link></Button>
        </Can>
      </div>
    );
  }

  const maxStatus = Math.max(1, ...data.by_status.map((r) => r.count));

  return (
    <div className="p-4 md:p-6 space-y-4">
      <h1 className="text-h1 text-[var(--text)]">Repair Overview</h1>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {KPI_DEFS.map((kpi) => (
          <Link
            key={kpi.key}
            href="/jobs"
            className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 hover:bg-[var(--surface-2)] transition-colors min-h-[44px]"
          >
            <div className="flex items-center gap-2 text-[var(--text-muted)]">
              <kpi.icon className="h-4 w-4 shrink-0" />
              <span className="text-body-sm">{kpi.label}</span>
            </div>
            <div className={cn('mt-1 text-2xl font-semibold tabular-nums', kpi.tone)}>
              {data.kpis[kpi.key]}
            </div>
          </Link>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-3">
        {/* Jobs by status */}
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
          <h2 className="text-h2 text-[var(--text)] mb-3">Jobs by status</h2>
          <div className="space-y-2">
            {data.by_status.map((row) => (
              <Link key={row.status} href="/jobs" className="flex items-center gap-3 min-h-[44px] py-1 -mx-2 px-2 rounded-md hover:bg-[var(--surface-2)] transition-colors">
                <span className="w-32 shrink-0 text-body-sm text-[var(--text-muted)] truncate">
                  {STATUS_LABEL[row.status] ?? row.status}
                </span>
                <span className="flex-1 h-2 rounded-full bg-[var(--surface-2)] overflow-hidden">
                  <span
                    className="block h-full bg-[var(--accent)]"
                    style={{ width: `${(row.count / maxStatus) * 100}%` }}
                  />
                </span>
                <span className="w-8 text-right text-body-sm tabular-nums text-[var(--text)]">{row.count}</span>
              </Link>
            ))}
          </div>
        </div>

        {/* Needs attention */}
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
          <h2 className="text-h2 text-[var(--text)] mb-3">Needs attention</h2>
          {data.needs_attention.length === 0 ? (
            <p className="text-body-sm text-[var(--text-muted)]">Nothing needs attention right now.</p>
          ) : (
            <ul className="divide-y divide-[var(--border)]">
              {data.needs_attention.map((j) => {
                const unpaid = j.service_charge - j.advance_paid > 0;
                return (
                  <li key={j.id}>
                    <Link
                      href={`/jobs/${j.id}`}
                      className="flex items-center justify-between gap-2 py-2.5 hover:bg-[var(--surface-2)] -mx-2 px-2 rounded-md transition-colors min-h-[44px]"
                    >
                      <span className="min-w-0">
                        <span className="block text-body-sm font-medium text-[var(--text)] truncate">
                          {j.customer_name}
                        </span>
                        <span className="block text-xs font-mono text-[var(--text-muted)]">
                          <span>{j.job_number}</span>
                          <span> &middot; {j.device_type}</span>
                        </span>
                      </span>
                      <span className="shrink-0 flex items-center gap-2">
                        {unpaid && (
                          <span className="text-xs font-medium text-[var(--warning)]">
                            <Money amount={j.service_charge - j.advance_paid} />
                          </span>
                        )}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
