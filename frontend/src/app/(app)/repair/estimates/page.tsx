'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Can } from '@/components/shared/Can';
import { repairApi, type EstimateWorklistRow, type EstimateStatus } from '@/lib/api/repair';
import { qk } from '@/lib/query/keys';
import { money } from '@/lib/format/money';
import { formatDatetime } from '@/lib/format/date';

const STATUS_OPTIONS: Array<{ value: EstimateStatus; label: string }> = [
  { value: 'draft', label: 'Draft' },
  { value: 'sent', label: 'Sent' },
  { value: 'approved', label: 'Approved' },
  { value: 'rejected', label: 'Rejected' },
  { value: 'expired', label: 'Expired' },
];

export default function EstimatesWorklistPage() {
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState<EstimateStatus | 'all'>('all');
  const [page, setPage] = useState(1);

  const filters = { status: statusFilter === 'all' ? undefined : statusFilter, page };

  const { data, isLoading, error } = useQuery({
    queryKey: qk.estimates(filters),
    queryFn: () => repairApi.listEstimates(filters),
    staleTime: 30_000,
  });

  const columns: Column<EstimateWorklistRow>[] = useMemo(() => [
    {
      key: 'estimate_number',
      header: 'Estimate',
      cell: (e) => <span className="font-medium text-[var(--text)]">{e.estimate_number}</span>,
    },
    { key: 'job_number', header: 'Job', cell: (e) => e.job_number },
    { key: 'customer_name', header: 'Customer', cell: (e) => e.customer_name },
    {
      key: 'total_estimate',
      header: 'Total',
      className: 'text-right tabular-nums',
      headerClassName: 'text-right',
      cell: (e) => money(e.total_estimate),
    },
    { key: 'status', header: 'Status', cell: (e) => <StatusBadge status={e.status} /> },
    {
      key: 'created_at',
      header: 'Created',
      cell: (e) => <span className="text-[var(--text-muted)]">{formatDatetime(e.created_at)}</span>,
    },
  ], []);

  return (
    <Can permission="repair.estimates.view">
      <div className="flex flex-col h-full">
        <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--surface)]">
          <h1 className="text-h1 text-[var(--text)]">Estimates</h1>
          <p className="text-body-sm text-[var(--text-muted)] mt-0.5">Estimates across all repair jobs.</p>
        </div>

        <div className="flex-1 p-4 md:p-6 flex flex-col gap-4 min-h-0">
          <div className="flex flex-wrap items-center gap-2">
            <select
              aria-label="Estimate status"
              className="h-9 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-body-sm text-[var(--text)]"
              value={statusFilter}
              onChange={(e) => { setStatusFilter(e.target.value as EstimateStatus | 'all'); setPage(1); }}
            >
              <option value="all">All statuses</option>
              {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>

          <DataTable
            columns={columns}
            data={data?.items}
            loading={isLoading}
            error={error as Error | null}
            keyExtractor={(e) => e.id}
            onRowClick={(e) => router.push(`/jobs/${e.job_id}`)}
            emptyTitle="No estimates yet"
            emptyDescription="Estimates raised on jobs will appear here."
            page={page}
            totalPages={data?.meta?.total_pages}
            onPageChange={setPage}
            totalCount={data?.meta?.count}
          />
        </div>
      </div>
    </Can>
  );
}
