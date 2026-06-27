'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Can } from '@/components/shared/Can';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { crmApi, type LeadQuote, type LeadStatus } from '@/lib/api/crm';
import { qk } from '@/lib/query/keys';
import { money } from '@/lib/format/money';
import { formatDatetime } from '@/lib/format/date';

const STATUS_OPTIONS: { value: LeadStatus; label: string }[] = [
  { value: 'new', label: 'New' },
  { value: 'contacted', label: 'Contacted' },
  { value: 'interested', label: 'Interested' },
  { value: 'quoted', label: 'Quoted' },
  { value: 'converted', label: 'Converted' },
  { value: 'lost', label: 'Lost' },
];

export default function QuotesWorklistPage() {
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState<LeadStatus | 'all'>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);

  const filters = {
    lead_status: statusFilter === 'all' ? undefined : statusFilter,
    date_from: dateFrom || undefined,
    date_to: dateTo || undefined,
    page,
  };

  const { data, isLoading, error } = useQuery({
    queryKey: qk.quotes(filters),
    queryFn: () => crmApi.listQuotes(filters),
    staleTime: 30_000,
  });

  const columns: Column<LeadQuote>[] = useMemo(() => [
    {
      key: 'lead',
      header: 'Lead',
      cell: (q) => <span className="font-medium text-[var(--text)]">{q.lead_name ?? '—'}</span>,
    },
    {
      key: 'amount',
      header: 'Amount',
      className: 'text-right tabular-nums',
      headerClassName: 'text-right',
      cell: (q) => money(q.total_amount),
    },
    {
      key: 'sent_at',
      header: 'Sent',
      cell: (q) => <span className="text-[var(--text-muted)]">{formatDatetime(q.created_at)}</span>,
    },
    {
      key: 'sent_by',
      header: 'Sent by',
      cell: (q) => <span className="text-[var(--text-muted)]">{q.sent_by_name ?? '—'}</span>,
    },
    {
      key: 'lead_status',
      header: 'Lead status',
      cell: (q) => (q.lead_status ? <StatusBadge status={q.lead_status} /> : '—'),
    },
  ], []);

  return (
    <Can permission="crm.leads.view">
      <div className="flex flex-col h-full">
        <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--surface)]">
          <h1 className="text-h1 text-[var(--text)]">Quotes</h1>
          <p className="text-body-sm text-[var(--text-muted)] mt-0.5">
            Quotes sent to prospects across all leads.
          </p>
        </div>

        <div className="flex-1 p-4 md:p-6 flex flex-col gap-4 min-h-0">
          {/* Filters */}
          <div className="flex flex-wrap items-center gap-2">
            <Select
              value={statusFilter}
              onValueChange={(v) => { setStatusFilter(v as LeadStatus | 'all'); setPage(1); }}
            >
              <SelectTrigger className="h-9 w-[170px]" aria-label="Lead status">
                <SelectValue placeholder="All lead statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All lead statuses</SelectItem>
                {STATUS_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <input
              type="date"
              aria-label="Sent from"
              className="h-9 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-body-sm text-[var(--text)]"
              value={dateFrom}
              max={dateTo || undefined}
              onChange={(e) => { setDateFrom(e.target.value); setPage(1); }}
            />
            <input
              type="date"
              aria-label="Sent to"
              className="h-9 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-body-sm text-[var(--text)]"
              value={dateTo}
              min={dateFrom || undefined}
              onChange={(e) => { setDateTo(e.target.value); setPage(1); }}
            />
          </div>

          <DataTable
            columns={columns}
            data={data?.items}
            loading={isLoading}
            error={error as Error | null}
            keyExtractor={(q) => q.id}
            onRowClick={(q) => { if (q.lead_id) router.push(`/leads/${q.lead_id}`); }}
            emptyTitle="No quotes yet"
            emptyDescription="Quotes sent to leads will appear here."
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
