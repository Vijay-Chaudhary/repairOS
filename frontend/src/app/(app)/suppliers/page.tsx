'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { Can } from '@/components/shared/Can';
import { SupplierForm } from '@/components/procurement/SupplierForm';
import { procurementApi, type Supplier } from '@/lib/api/procurement';
import { qk } from '@/lib/query/keys';
import { useDebounce } from '@/lib/hooks/useDebounce';
import { cn } from '@/lib/utils';

const COLUMNS: Column<Supplier>[] = [
  {
    key: 'name',
    header: 'Supplier',
    cell: (r) => (
      <div>
        <p className="text-body-sm font-medium text-[var(--text)]">{r.name}</p>
        {r.contact_person && <p className="text-xs text-[var(--text-muted)]">{r.contact_person}</p>}
      </div>
    ),
  },
  {
    key: 'contact',
    header: 'Contact',
    cell: (r) => (
      <div>
        <p className="text-body-sm text-[var(--text)]">{r.phone}</p>
        {r.email && <p className="text-xs text-[var(--text-muted)]">{r.email}</p>}
      </div>
    ),
  },
  {
    key: 'gstin',
    header: 'GSTIN',
    cell: (r) => <span className="font-mono text-xs text-[var(--text-muted)]">{r.gstin ?? '—'}</span>,
  },
  {
    key: 'terms',
    header: 'Terms',
    cell: (r) => <span className="text-body-sm text-[var(--text-muted)]">{r.payment_terms_days}d</span>,
  },
  {
    key: 'status',
    header: 'Status',
    cell: (r) => (
      <span className={cn('text-xs font-medium', r.is_active ? 'text-[var(--success)]' : 'text-[var(--text-muted)]')}>
        {r.is_active ? 'Active' : 'Inactive'}
      </span>
    ),
  },
];

export default function SuppliersPage() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [listPage, setListPage] = useState(1);
  const debouncedSearch = useDebounce(search, 350);

  useEffect(() => { setListPage(1); }, [debouncedSearch]);

  const { data, isLoading, error } = useQuery({
    queryKey: qk.suppliers({ search: debouncedSearch, page: listPage }),
    queryFn: () => procurementApi.listSuppliers({ search: debouncedSearch || undefined, page: listPage }),
    staleTime: 60_000,
  });

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--surface)] flex items-center justify-between gap-3">
        <h1 className="text-h1 text-[var(--text)]">Suppliers</h1>
        <Can permission="erp.suppliers.manage">
          <Button size="sm" onClick={() => setFormOpen(true)}>
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">New supplier</span>
          </Button>
        </Can>
      </div>

      <div className="px-4 py-2 border-b border-[var(--border)]">
        <div className="relative max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-muted)]" />
          <Input
            placeholder="Search name, GSTIN…"
            className="pl-9 h-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      <div className="flex-1 overflow-auto p-4 md:p-6">
        <DataTable
          columns={COLUMNS}
          data={data?.items}
          loading={isLoading}
          error={error as Error | null}
          keyExtractor={(r) => r.id}
          onRowClick={(r) => router.push(`/suppliers/${r.id}`)}
          emptyTitle="No suppliers"
          emptyDescription="Add your first supplier to start raising purchase orders."
          emptyAction={{ label: 'New supplier', onClick: () => setFormOpen(true) }}
          page={listPage}
          totalPages={data?.meta?.total_pages}
          onPageChange={setListPage}
          totalCount={data?.meta?.count}
        />
      </div>

      <SupplierForm open={formOpen} onOpenChange={setFormOpen} />
    </div>
  );
}
