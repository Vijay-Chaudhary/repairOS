'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Search, Phone } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { Money } from '@/components/shared/Money';
import { Can } from '@/components/shared/Can';
import { CustomerFormDialog } from '@/components/crm/CustomerFormDialog';
import { crmApi, type Customer, type CustomerType } from '@/lib/api/crm';
import { qk } from '@/lib/query/keys';
import { useActiveShopStore } from '@/lib/stores/activeShopStore';
import { useDebounce } from '@/lib/hooks/useDebounce';
import { formatDate } from '@/lib/format/date';
import { formatPhone } from '@/lib/format/phone';
import { cn } from '@/lib/utils';

const TYPE_BADGE: Record<CustomerType, string> = {
  individual: 'bg-[var(--info)]/10 text-[var(--info)]',
  business:   'bg-[var(--accent)]/10 text-[var(--accent)]',
};
const TYPE_LABEL: Record<CustomerType, string> = {
  individual: 'Individual',
  business:   'Business',
};

const LIST_COLUMNS: Column<Customer>[] = [
  {
    key: 'name',
    header: 'Name',
    cell: (r) => (
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-body-sm font-medium text-[var(--text)] truncate">{r.name}</span>
        <a
        href={`tel:${r.phone}`}
        className="flex items-center gap-0.5 text-xs text-[var(--accent)] hover:underline shrink-0"
        onClick={(e) => e.stopPropagation()}
      >
        <Phone className="h-2.5 w-2.5" />
        {formatPhone(r.phone)}
      </a>
      </div>
    ),
  },
  {
    key: 'type',
    header: 'Type',
    headerClassName: 'w-[110px]',
    cell: (r) => (
      <span className={cn('text-[11px] font-medium rounded-full px-2 py-0.5 whitespace-nowrap', TYPE_BADGE[r.customer_type])}>
        {TYPE_LABEL[r.customer_type]}
      </span>
    ),
  },
  {
    key: 'city',
    header: 'City',
    cell: (r) => (
      <span className="text-body-sm text-[var(--text-muted)]">{r.city ?? '—'}</span>
    ),
  },
  {
    key: 'jobs',
    header: 'Jobs',
    headerClassName: 'w-[60px] text-right',
    className: 'text-right',
    cell: (r) => r.total_jobs > 0
      ? <span className="inline-flex items-center justify-center min-w-[20px] h-5 rounded-full bg-[var(--accent)]/10 text-[var(--accent)] text-[11px] font-medium px-1.5 tabular-nums">{r.total_jobs}</span>
      : <span className="text-xs text-[var(--text-muted)]">—</span>,
  },
  {
    key: 'billed',
    header: 'Total billed',
    headerClassName: 'text-right w-[120px]',
    className: 'text-right',
    cell: (r) => r.total_billed > 0
      ? <Money amount={r.total_billed} className="text-body-sm tabular-nums" />
      : <span className="text-xs text-[var(--text-muted)]">—</span>,
  },
  {
    key: 'outstanding',
    header: 'Outstanding',
    headerClassName: 'text-right w-[120px]',
    className: 'text-right',
    cell: (r) => r.total_outstanding > 0
      ? <Money amount={r.total_outstanding} className="text-body-sm tabular-nums text-[var(--danger)] font-medium" />
      : <span className="text-xs text-[var(--text-muted)]">—</span>,
  },
  {
    key: 'since',
    header: 'Since',
    headerClassName: 'w-[100px]',
    cell: (r) => (
      <span className="text-body-sm text-[var(--text-muted)] tabular-nums">{formatDate(r.created_at)}</span>
    ),
  },
];

export default function CustomersPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { activeShopId, isAllShops } = useActiveShopStore();

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<CustomerType | 'all'>('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [cursor, setCursor] = useState<string | undefined>(undefined);

  const debouncedSearch = useDebounce(search, 350);

  const filters = {
    shop_id: isAllShops ? undefined : activeShopId ?? undefined,
    search: debouncedSearch || undefined,
    customer_type: typeFilter === 'all' ? undefined : typeFilter,
    cursor,
  };

  const { data, isLoading, error } = useQuery({
    queryKey: qk.customers(filters),
    queryFn: () => crmApi.listCustomers(filters),
    staleTime: 30_000,
  });

  return (
    <div className="flex flex-col h-full">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border)] bg-[var(--surface)] flex-wrap gap-y-2">
        <h1 className="text-h1 text-[var(--text)] mr-2">Customers</h1>

        <div className="relative flex-1 min-w-[160px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-muted)]" />
          <Input
            placeholder="Search name, phone…"
            className="pl-9 h-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as CustomerType | 'all')}>
          <SelectTrigger className="h-9 w-[130px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            <SelectItem value="individual">Individual</SelectItem>
            <SelectItem value="business">Business</SelectItem>
          </SelectContent>
        </Select>

        <Can permission="crm.customers.create">
          <Button size="sm" className="h-9 ml-auto" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">New Customer</span>
          </Button>
        </Can>
      </div>

      {/* List */}
      <div className="flex-1 overflow-auto p-4 md:p-6">
        <DataTable
          columns={LIST_COLUMNS}
          data={data?.items}
          loading={isLoading}
          error={error as Error | null}
          keyExtractor={(r) => r.id}
          onRowClick={(r) => router.push(`/customers/${r.id}`)}
          emptyTitle="No customers yet"
          emptyDescription="Create your first customer or convert a lead."
          emptyAction={{ label: 'New Customer', onClick: () => setCreateOpen(true) }}
          hasNextPage={!!data?.meta?.next_cursor}
          hasPrevPage={!!cursor}
          onNextPage={() => setCursor(data?.meta?.next_cursor ?? undefined)}
          onPrevPage={() => setCursor(undefined)}
        />
      </div>

      <CustomerFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        shopId={activeShopId ?? ''}
        onSuccess={(customer) => {
          queryClient.invalidateQueries({ queryKey: qk.customers() });
          setCreateOpen(false);
          router.push(`/customers/${customer.id}`);
        }}
      />
    </div>
  );
}
