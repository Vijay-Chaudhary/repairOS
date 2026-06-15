'use client';

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DataTable, type Column } from '@/components/shared/DataTable';
import {
  inventoryApi, TX_TYPE_LABELS, TX_TYPE_COLORS,
  type InventoryTransaction, type TxType,
} from '@/lib/api/inventory';
import { qk } from '@/lib/query/keys';
import { useActiveShopStore } from '@/lib/stores/activeShopStore';
import { formatDatetime } from '@/lib/format/date';
import { cn } from '@/lib/utils';

const COLUMNS: Column<InventoryTransaction>[] = [
  {
    key: 'date',
    header: 'Date',
    cell: (r) => <span className="text-body-sm text-[var(--text-muted)]">{formatDatetime(r.created_at)}</span>,
  },
  {
    key: 'type',
    header: 'Type',
    cell: (r) => (
      <span className={cn('text-xs font-semibold', TX_TYPE_COLORS[r.type])}>
        {TX_TYPE_LABELS[r.type]}
      </span>
    ),
  },
  {
    key: 'product',
    header: 'Product / Variant',
    cell: (r) => (
      <div>
        <p className="text-body-sm font-medium text-[var(--text)]">{r.product_name}</p>
        <p className="text-xs text-[var(--text-muted)]">{r.variant_name}</p>
      </div>
    ),
  },
  {
    key: 'qty',
    header: 'Qty',
    cell: (r) => (
      <span className={cn(
        'font-mono font-semibold tabular-nums',
        r.quantity > 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]',
      )}>
        {r.quantity > 0 ? `+${r.quantity}` : r.quantity}
      </span>
    ),
  },
  {
    key: 'note',
    header: 'Note / Reference',
    cell: (r) => (
      <span className="text-body-sm text-[var(--text-muted)]">
        {r.note ?? r.reference_type ?? '—'}
      </span>
    ),
  },
  {
    key: 'by',
    header: 'By',
    cell: (r) => <span className="text-body-sm text-[var(--text-muted)]">{r.created_by_name ?? '—'}</span>,
  },
];

export default function LedgerPage() {
  const { activeShopId, isAllShops } = useActiveShopStore();
  const [typeFilter, setTypeFilter] = useState<TxType | 'all'>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [listPage, setListPage] = useState(1);
  useEffect(() => { setListPage(1); }, [typeFilter, dateFrom, dateTo]);

  const filters = {
    shop_id: isAllShops ? undefined : activeShopId ?? undefined,
    type: typeFilter === 'all' ? undefined : typeFilter,
    date_from: dateFrom || undefined,
    date_to: dateTo || undefined,
    page: listPage,
  };

  const { data, isLoading, error } = useQuery({
    queryKey: qk.stockMovements(filters),
    queryFn: () => inventoryApi.listTransactions(filters),
    staleTime: 30_000,
  });

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--surface)]">
        <h1 className="text-h1 text-[var(--text)]">Stock ledger</h1>
        <p className="text-body-sm text-[var(--text-muted)] mt-0.5">Immutable record of every stock movement</p>
      </div>

      <div className="flex flex-wrap gap-3 px-4 py-3 border-b border-[var(--border)]">
        <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as TxType | 'all')}>
          <SelectTrigger className="h-9 w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {(Object.keys(TX_TYPE_LABELS) as TxType[]).map((t) => (
              <SelectItem key={t} value={t}>{TX_TYPE_LABELS[t]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex items-center gap-2">
          <Input type="date" className="h-9 w-[140px]" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          <span className="text-[var(--text-muted)] text-body-sm">–</span>
          <Input type="date" className="h-9 w-[140px]" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4 md:p-6">
        <DataTable
          columns={COLUMNS}
          data={data?.items}
          loading={isLoading}
          error={error as Error | null}
          keyExtractor={(r) => r.id}
          emptyTitle="No transactions"
          emptyDescription="Stock movements will appear here once items are bought, sold, or adjusted."
          page={listPage}
          totalPages={data?.meta?.total_pages}
          onPageChange={setListPage}
          totalCount={data?.meta?.count}
        />
      </div>
    </div>
  );
}
