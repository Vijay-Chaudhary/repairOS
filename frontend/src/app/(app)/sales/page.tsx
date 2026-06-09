'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Money } from '@/components/shared/Money';
import { posApi, type Sale, type SaleType, type SaleStatus } from '@/lib/api/pos';
import { qk } from '@/lib/query/keys';
import { useActiveShopStore } from '@/lib/stores/activeShopStore';
import { useDebounce } from '@/lib/hooks/useDebounce';
import { formatDate } from '@/lib/format/date';

const SALE_TYPE_LABELS: Record<SaleType, string> = {
  counter: 'Counter',
  wholesale: 'Wholesale',
  job_linked: 'Job-linked',
};

const COLUMNS: Column<Sale>[] = [
  {
    key: 'number',
    header: 'Sale #',
    cell: (r) => (
      <div>
        <p className="font-mono text-xs font-medium text-[var(--text)]">{r.sale_number}</p>
        <p className="text-xs text-[var(--text-muted)]">{SALE_TYPE_LABELS[r.sale_type]}</p>
      </div>
    ),
  },
  {
    key: 'customer',
    header: 'Customer',
    cell: (r) => (
      <span className="text-body-sm text-[var(--text)]">
        {r.customer_name ?? <span className="text-[var(--text-muted)]">Walk-in</span>}
      </span>
    ),
  },
  {
    key: 'status',
    header: 'Status',
    cell: (r) => <StatusBadge status={r.status} />,
  },
  {
    key: 'total',
    header: 'Total',
    cell: (r) => <Money amount={r.grand_total} className="text-body-sm tabular-nums" />,
  },
  {
    key: 'paid',
    header: 'Paid',
    cell: (r) => (
      <Money amount={r.amount_paid} className="text-body-sm text-[var(--success)] tabular-nums" />
    ),
  },
  {
    key: 'outstanding',
    header: 'Outstanding',
    cell: (r) => (
      <Money
        amount={r.amount_outstanding}
        className={
          r.amount_outstanding > 0
            ? 'text-body-sm text-[var(--danger)] tabular-nums'
            : 'text-body-sm tabular-nums'
        }
      />
    ),
  },
  {
    key: 'date',
    header: 'Date',
    cell: (r) => (
      <span className="text-body-sm text-[var(--text-muted)]">{formatDate(r.sale_date)}</span>
    ),
  },
];

export default function SalesListPage() {
  const router = useRouter();
  const { activeShopId, isAllShops } = useActiveShopStore();

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<SaleType | 'all'>('all');
  const [statusFilter, setStatusFilter] = useState<SaleStatus | 'all'>('all');
  const [cursor, setCursor] = useState<string | undefined>(undefined);

  const debouncedSearch = useDebounce(search, 350);

  const filters = {
    shop_id: isAllShops ? undefined : activeShopId ?? undefined,
    sale_type: typeFilter === 'all' ? undefined : typeFilter,
    status: statusFilter === 'all' ? undefined : statusFilter,
    search: debouncedSearch || undefined,
    cursor,
  };

  const { data, isLoading, error } = useQuery({
    queryKey: qk.posSales(filters),
    queryFn: () => posApi.listSales(filters),
    staleTime: 30_000,
  });

  const handleRowClick = useCallback((sale: Sale) => {
    router.push(`/sales/${sale.id}`);
  }, [router]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--surface)]">
        <h1 className="text-h1 text-[var(--text)]">Sales</h1>
      </div>

      <div className="flex-1 overflow-auto p-4 md:p-6 space-y-4">
        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <div className="relative flex-1 min-w-[200px] max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-muted)]" />
            <Input
              placeholder="Sale #, customer…"
              className="pl-9 h-9"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as SaleType | 'all')}>
            <SelectTrigger className="h-9 w-[150px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              <SelectItem value="counter">Counter</SelectItem>
              <SelectItem value="wholesale">Wholesale</SelectItem>
              <SelectItem value="job_linked">Job-linked</SelectItem>
            </SelectContent>
          </Select>

          <Select
            value={statusFilter}
            onValueChange={(v) => setStatusFilter(v as SaleStatus | 'all')}
          >
            <SelectTrigger className="h-9 w-[160px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="partially_paid">Partially paid</SelectItem>
              <SelectItem value="draft">Draft</SelectItem>
              <SelectItem value="cancelled">Cancelled</SelectItem>
              <SelectItem value="returned">Returned</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <DataTable
          columns={COLUMNS}
          data={data?.items}
          loading={isLoading}
          error={error as Error | null}
          keyExtractor={(r) => r.id}
          onRowClick={handleRowClick}
          emptyTitle="No sales yet"
          emptyDescription="Sales made from the POS terminal will appear here."
          hasNextPage={!!data?.meta?.next_cursor}
          hasPrevPage={!!cursor}
          onNextPage={() => setCursor(data?.meta?.next_cursor ?? undefined)}
          onPrevPage={() => setCursor(undefined)}
        />
      </div>
    </div>
  );
}
