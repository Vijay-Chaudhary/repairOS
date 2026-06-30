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
import { Money } from '@/components/shared/Money';
import { hrApi, EMPLOYMENT_TYPE_LABELS, type Employee } from '@/lib/api/hr';
import { qk } from '@/lib/query/keys';
import { useActiveShopStore } from '@/lib/stores/activeShopStore';
import { useDebounce } from '@/lib/hooks/useDebounce';
import { formatDate } from '@/lib/format/date';
import { cn } from '@/lib/utils';

const COLUMNS: Column<Employee>[] = [
  {
    key: 'name',
    header: 'Employee',
    cell: (r) => (
      <div>
        <p className="text-body-sm font-medium text-[var(--text)]">{r.full_name}</p>
        <p className="text-xs text-[var(--text-muted)] font-mono">{r.employee_code}</p>
      </div>
    ),
  },
  { key: 'role', header: 'Role', cell: (r) => (
    <div>
      <p className="text-body-sm text-[var(--text)]">{r.designation}</p>
      {(r.department_name ?? r.department) && (
        <p className="text-xs text-[var(--text-muted)]">{r.department_name ?? r.department}</p>
      )}
    </div>
  )},
  { key: 'type', header: 'Type', cell: (r) => (
    <span className="text-body-sm text-[var(--text-muted)]">{EMPLOYMENT_TYPE_LABELS[r.employment_type]}</span>
  )},
  { key: 'joined', header: 'Joined', cell: (r) => (
    <span className="text-body-sm text-[var(--text-muted)]">{formatDate(r.date_of_joining)}</span>
  )},
  { key: 'gross', header: 'Gross salary', cell: (r) => (
    <Money amount={r.gross_salary} className="text-body-sm tabular-nums" />
  )},
  { key: 'status', header: 'Status', cell: (r) => (
    <span className={cn('text-xs font-medium', r.is_active ? 'text-[var(--success)]' : 'text-[var(--text-muted)]')}>
      {r.is_active ? 'Active' : 'Inactive'}
    </span>
  )},
];

export default function EmployeesPage() {
  const router = useRouter();
  const { activeShopId, isAllShops } = useActiveShopStore();
  const [search, setSearch] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [listPage, setListPage] = useState(1);
  const debouncedSearch = useDebounce(search, 350);
  useEffect(() => { setListPage(1); }, [debouncedSearch, showInactive]);

  const filters = {
    shop_id: isAllShops ? undefined : activeShopId ?? undefined,
    search: debouncedSearch || undefined,
    is_active: showInactive ? undefined : true,
    page: listPage,
  };

  const { data, isLoading, error } = useQuery({
    queryKey: qk.employees(filters),
    queryFn: () => hrApi.listEmployees(filters),
    staleTime: 60_000,
  });

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--surface)] flex items-center justify-between gap-3">
        <h1 className="text-h1 text-[var(--text)]">Employees</h1>
        <Can permission="hr.employees.manage">
          <Button size="sm" onClick={() => router.push('/hr/employees/new')}>
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">New employee</span>
          </Button>
        </Can>
      </div>
      <div className="flex items-center gap-3 px-4 py-2 border-b border-[var(--border)] flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-muted)]" />
          <Input placeholder="Search name, code…" className="pl-9 h-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <label className="flex items-center gap-2 text-body-sm cursor-pointer">
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
          onRowClick={(r) => router.push(`/hr/employees/${r.id}`)}
          emptyTitle="No employees"
          emptyDescription="Add your first employee record."
          emptyAction={{ label: 'New employee', onClick: () => router.push('/hr/employees/new') }}
          page={listPage}
          totalPages={data?.meta?.total_pages}
          onPageChange={setListPage}
          totalCount={data?.meta?.count}
        />
      </div>
    </div>
  );
}
