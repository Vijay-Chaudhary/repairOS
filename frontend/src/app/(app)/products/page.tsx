'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Plus, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { Can } from '@/components/shared/Can';
import { inventoryApi, type Product } from '@/lib/api/inventory';
import { qk } from '@/lib/query/keys';
import { useDebounce } from '@/lib/hooks/useDebounce';
import { cn } from '@/lib/utils';

const COLUMNS: Column<Product>[] = [
  {
    key: 'name',
    header: 'Product',
    cell: (r) => (
      <div>
        <p className="text-body-sm font-medium text-[var(--text)]">{r.name}</p>
        <p className="text-xs text-[var(--text-muted)] font-mono">{r.sku}{r.brand ? ` · ${r.brand}` : ''}</p>
      </div>
    ),
  },
  {
    key: 'category',
    header: 'Category',
    cell: (r) => <span className="text-body-sm text-[var(--text-muted)]">{r.category_name ?? '—'}</span>,
  },
  {
    key: 'variants',
    header: 'Variants',
    cell: (r) => <span className="font-mono text-body-sm text-[var(--text)]">{r.variant_count ?? 0}</span>,
  },
  {
    key: 'tax',
    header: 'GST',
    cell: (r) => <span className="text-body-sm text-[var(--text-muted)]">{r.default_tax_rate}%</span>,
  },
  {
    key: 'use',
    header: 'Used for',
    cell: (r) => (
      <div className="flex gap-1 flex-wrap">
        {r.is_for_sale && <span className="text-[10px] font-medium bg-[var(--info)]/15 text-[var(--info)] rounded px-1.5 py-0.5">Sale</span>}
        {r.is_for_repair_use && <span className="text-[10px] font-medium bg-[var(--success)]/15 text-[var(--success)] rounded px-1.5 py-0.5">Repair</span>}
      </div>
    ),
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

export default function ProductsPage() {
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [listPage, setListPage] = useState(1);
  const debouncedSearch = useDebounce(search, 350);
  useEffect(() => { setListPage(1); }, [debouncedSearch, showInactive]);

  const filters = {
    search: debouncedSearch || undefined,
    is_active: showInactive ? undefined : true,
    page: listPage,
  };

  const { data, isLoading, error } = useQuery({
    queryKey: qk.products(filters),
    queryFn: () => inventoryApi.listProducts(filters),
    staleTime: 60_000,
  });

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--surface)] flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-h1 text-[var(--text)]">Products</h1>
        <Can permission="erp.inventory.adjust">
          <Button size="sm" onClick={() => router.push('/products/new')}>
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">New product</span>
          </Button>
        </Can>
      </div>

      <div className="flex items-center gap-3 px-4 py-2 border-b border-[var(--border)] flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-muted)]" />
          <Input
            placeholder="Search name, SKU, brand…"
            className="pl-9 h-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <label className="flex items-center gap-2 text-body-sm text-[var(--text)] cursor-pointer">
          <Switch checked={showInactive} onCheckedChange={setShowInactive} />
          Show inactive
        </label>
      </div>

      <div className="flex-1 overflow-auto p-4 md:p-6">
        <DataTable
          columns={COLUMNS}
          data={data?.items}
          loading={isLoading}
          error={error as Error | null}
          keyExtractor={(r) => r.id}
          onRowClick={(r) => router.push(`/products/${r.id}`)}
          emptyTitle="No products"
          emptyDescription="Add products to your catalogue to sell or use in repairs."
          emptyAction={{ label: 'New product', onClick: () => router.push('/products/new') }}
          page={listPage}
          totalPages={data?.meta?.total_pages}
          onPageChange={setListPage}
          totalCount={data?.meta?.count}
        />
      </div>
    </div>
  );
}
