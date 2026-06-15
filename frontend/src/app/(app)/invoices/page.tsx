'use client';

import { useState, useCallback, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Search, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Money } from '@/components/shared/Money';
import { Can } from '@/components/shared/Can';
import { AgedOutstandingTable } from '@/components/billing/AgedOutstandingTable';
import { TallyExportPanel } from '@/components/billing/TallyExportPanel';
import { billingApi, type Invoice, type InvoiceStatus } from '@/lib/api/billing';
import { qk } from '@/lib/query/keys';
import { useActiveShopStore } from '@/lib/stores/activeShopStore';
import { useDebounce } from '@/lib/hooks/useDebounce';
import { formatDate } from '@/lib/format/date';
import { formatPhone } from '@/lib/format/phone';

const LIST_COLUMNS: Column<Invoice>[] = [
  {
    key: 'number',
    header: 'Invoice #',
    cell: (r) => (
      <span className="font-mono text-xs font-medium text-[var(--text)]">
        {r.invoice_number}{r.job_number ? <span className="text-[var(--text-muted)] font-normal"> · {r.job_number}</span> : null}
      </span>
    ),
  },
  {
    key: 'customer',
    header: 'Customer',
    cell: (r) => (
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-body-sm font-medium text-[var(--text)] truncate">{r.customer_name}</span>
        {r.customer_phone && (
          <span className="text-xs text-[var(--text-muted)] shrink-0">{formatPhone(r.customer_phone)}</span>
        )}
      </div>
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
    cell: (r) => <Money amount={r.amount_paid} className="text-body-sm text-[var(--success)] tabular-nums" />,
  },
  {
    key: 'outstanding',
    header: 'Outstanding',
    cell: (r) => (
      <Money
        amount={r.amount_outstanding}
        className={r.amount_outstanding > 0 ? 'text-body-sm text-[var(--danger)] tabular-nums' : 'text-body-sm tabular-nums'}
      />
    ),
  },
  {
    key: 'date',
    header: 'Date',
    cell: (r) => (
      <span className="text-body-sm text-[var(--text-muted)]">{formatDate(r.created_at)}</span>
    ),
  },
];

export default function InvoicesPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { activeShopId, isAllShops } = useActiveShopStore();

  const defaultTab = searchParams.get('tab') === 'outstanding' ? 'outstanding' : 'all';

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<InvoiceStatus | 'all'>('all');
  const [listPage, setListPage] = useState(1);

  const debouncedSearch = useDebounce(search, 350);
  useEffect(() => { setListPage(1); }, [debouncedSearch, statusFilter]);

  const allFilters = {
    shop_id: isAllShops ? undefined : activeShopId ?? undefined,
    search: debouncedSearch || undefined,
    status: statusFilter === 'all' ? undefined : statusFilter,
    page: listPage,
  };

  const outstandingFilters = {
    shop_id: isAllShops ? undefined : activeShopId ?? undefined,
    outstanding_only: true as const,
  };

  const allQuery = useQuery({
    queryKey: qk.invoices(allFilters),
    queryFn: () => billingApi.listInvoices(allFilters),
    staleTime: 30_000,
  });

  const outstandingQuery = useQuery({
    queryKey: qk.invoices({ ...outstandingFilters }),
    queryFn: () => billingApi.listInvoices(outstandingFilters),
    staleTime: 30_000,
  });

  const handleRowClick = useCallback((inv: Invoice) => {
    router.push(`/invoices/${inv.id}`);
  }, [router]);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--surface)] flex items-center justify-between gap-3">
        <h1 className="text-h1 text-[var(--text)]">Invoices</h1>
        <Can permission="billing.tally_export">
          <TallyExportPanel />
        </Can>
      </div>

      <div className="flex-1 overflow-auto">
        <Tabs defaultValue={defaultTab} className="h-full flex flex-col">
          <div className="border-b border-[var(--border)] bg-[var(--surface)] px-4">
            <TabsList className="h-10 bg-transparent gap-0 -mb-px">
              <TabsTrigger
                value="all"
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-[var(--accent)] data-[state=active]:text-[var(--accent)] px-4 py-2 text-body-sm"
              >
                All invoices
              </TabsTrigger>
              <TabsTrigger
                value="outstanding"
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-[var(--accent)] data-[state=active]:text-[var(--accent)] px-4 py-2 text-body-sm"
              >
                Outstanding
                {(outstandingQuery.data?.items?.length ?? 0) > 0 && (
                  <span className="ml-1.5 inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-[var(--danger)] text-white text-[10px] font-semibold px-1">
                    {outstandingQuery.data?.items?.length}
                  </span>
                )}
              </TabsTrigger>
            </TabsList>
          </div>

          {/* All invoices */}
          <TabsContent value="all" className="flex-1 p-4 md:p-6 mt-0 space-y-4">
            {/* Filters */}
            <div className="flex flex-wrap gap-3">
              <div className="relative flex-1 min-w-[200px] max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-muted)]" />
                <Input
                  placeholder="Invoice #, customer…"
                  className="pl-9 h-9"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>
              <Select
                value={statusFilter}
                onValueChange={(v) => setStatusFilter(v as InvoiceStatus | 'all')}
              >
                <SelectTrigger className="h-9 w-[160px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="draft">Draft</SelectItem>
                  <SelectItem value="issued">Issued</SelectItem>
                  <SelectItem value="partially_paid">Partially paid</SelectItem>
                  <SelectItem value="paid">Paid</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <DataTable
              columns={LIST_COLUMNS}
              data={allQuery.data?.items}
              loading={allQuery.isLoading}
              error={allQuery.error as Error | null}
              keyExtractor={(r) => r.id}
              onRowClick={handleRowClick}
              emptyTitle="No invoices yet"
              emptyDescription="Invoices are generated from completed repair jobs."
              page={listPage}
              totalPages={allQuery.data?.meta?.total_pages}
              onPageChange={setListPage}
              totalCount={allQuery.data?.meta?.count}
            />
          </TabsContent>

          {/* Outstanding */}
          <TabsContent value="outstanding" className="flex-1 p-4 md:p-6 mt-0">
            {outstandingQuery.isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-16 rounded-lg bg-[var(--surface-2)] animate-pulse" />
                ))}
              </div>
            ) : (
              <AgedOutstandingTable invoices={outstandingQuery.data?.items ?? []} />
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
