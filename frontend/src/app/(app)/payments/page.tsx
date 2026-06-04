'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { CreditCard } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { Money } from '@/components/shared/Money';
import { billingApi, PAYMENT_METHOD_LABELS, PAYMENT_METHOD_COLORS, type Payment, type PaymentMethod } from '@/lib/api/billing';
import { qk } from '@/lib/query/keys';
import { useActiveShopStore } from '@/lib/stores/activeShopStore';
import { formatDatetime } from '@/lib/format/date';
import { cn } from '@/lib/utils';

const LIST_COLUMNS: Column<Payment>[] = [
  {
    key: 'date',
    header: 'Date',
    cell: (r) => (
      <span className="text-body-sm text-[var(--text-muted)]">{formatDatetime(r.paid_at)}</span>
    ),
  },
  {
    key: 'method',
    header: 'Method',
    cell: (r) => (
      <span className={cn('text-xs font-semibold rounded px-1.5 py-0.5', PAYMENT_METHOD_COLORS[r.method])}>
        {PAYMENT_METHOD_LABELS[r.method]}
      </span>
    ),
  },
  {
    key: 'amount',
    header: 'Amount',
    cell: (r) => (
      <Money amount={r.amount} className="text-body-sm font-semibold tabular-nums text-[var(--success)]" />
    ),
  },
  {
    key: 'invoice',
    header: 'Invoice',
    cell: (r) => (
      <span className="font-mono text-xs text-[var(--accent)] hover:underline cursor-pointer">
        {r.invoice_id.slice(0, 8)}…
      </span>
    ),
  },
  {
    key: 'reference',
    header: 'Reference',
    cell: (r) => (
      <span className="font-mono text-xs text-[var(--text-muted)]">{r.reference_id ?? '—'}</span>
    ),
  },
  {
    key: 'recorded_by',
    header: 'Recorded by',
    cell: (r) => (
      <span className="text-body-sm text-[var(--text-muted)]">{r.recorded_by_name ?? '—'}</span>
    ),
  },
];

export default function PaymentsPage() {
  const router = useRouter();
  const { activeShopId, isAllShops } = useActiveShopStore();

  const [methodFilter, setMethodFilter] = useState<PaymentMethod | 'all'>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [cursor, setCursor] = useState<string | undefined>(undefined);

  const filters = {
    method: methodFilter === 'all' ? undefined : methodFilter,
    date_from: dateFrom || undefined,
    date_to: dateTo || undefined,
    cursor,
  };

  const { data, isLoading, error } = useQuery({
    queryKey: qk.payments(filters),
    queryFn: () => billingApi.listPayments(filters),
    staleTime: 30_000,
  });

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--surface)]">
        <h1 className="text-h1 text-[var(--text)]">Payments</h1>
      </div>

      <div className="flex-1 overflow-auto p-4 md:p-6 space-y-4">
        {/* Filters */}
        <div className="flex flex-wrap gap-3">
          <Select
            value={methodFilter}
            onValueChange={(v) => setMethodFilter(v as PaymentMethod | 'all')}
          >
            <SelectTrigger className="h-9 w-[140px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All methods</SelectItem>
              {(Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).map((m) => (
                <SelectItem key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <div className="flex items-center gap-2">
            <Input
              type="date"
              className="h-9 w-[140px]"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              placeholder="From"
            />
            <span className="text-[var(--text-muted)] text-body-sm">–</span>
            <Input
              type="date"
              className="h-9 w-[140px]"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              placeholder="To"
            />
          </div>
        </div>

        <DataTable
          columns={LIST_COLUMNS}
          data={data?.items}
          loading={isLoading}
          error={error as Error | null}
          keyExtractor={(r) => r.id}
          onRowClick={(r) => router.push(`/invoices/${r.invoice_id}`)}
          emptyTitle="No payments recorded"
          emptyDescription="Payments recorded against invoices will appear here."
          hasNextPage={!!data?.meta?.next_cursor}
          hasPrevPage={!!cursor}
          onNextPage={() => setCursor(data?.meta?.next_cursor ?? undefined)}
          onPrevPage={() => setCursor(undefined)}
        />
      </div>
    </div>
  );
}
