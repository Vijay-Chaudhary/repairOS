'use client';

import React, { useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { differenceInCalendarDays } from 'date-fns';
import { Plus, Search, LayoutGrid, List, WifiOff, Phone, AlertTriangle, Star, CalendarClock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Money } from '@/components/shared/Money';
import { Can } from '@/components/shared/Can';
import { JobBoard, type KanbanColumnData } from '@/components/repair/JobBoard';
import { JobFilterBar } from '@/components/repair/JobFilterBar';
import { JobQuickFilters } from '@/components/repair/JobQuickFilters';
import {
  EMPTY_JOB_FILTERS,
  toBaseApiFilters,
  type JobFilterState,
  type JobFilterCtx,
} from '@/lib/repair/jobFilters';
import { repairApi, KANBAN_COLUMNS, type JobListItem, type JobStatus, type JobPriority } from '@/lib/api/repair';
import { settingsApi } from '@/lib/api/settings';
import { qk } from '@/lib/query/keys';
import { useActiveShopStore } from '@/lib/stores/activeShopStore';
import { useAuthStore } from '@/lib/stores/authStore';
import { useOfflineQueueStore } from '@/lib/stores/offlineQueueStore';
import { useDebounce } from '@/lib/hooks/useDebounce';
import { formatDate } from '@/lib/format/date';
import { formatPhone } from '@/lib/format/phone';
import { ApiError } from '@/lib/api/client';
import { cn } from '@/lib/utils';

type ViewMode = 'kanban' | 'list';

const TERMINAL_STATUSES_SET = new Set<JobStatus>(['delivered', 'closed', 'cancelled']);

const PRIORITY_ICON: Record<JobPriority, React.ReactNode> = {
  normal:  <span className="w-3.5 h-3.5 shrink-0 inline-block" />,
  urgent:  <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-[var(--warning)]" />,
  vip:     <Star className="h-3.5 w-3.5 shrink-0 text-[var(--accent)]" />,
};

const LIST_COLUMNS: Column<JobListItem>[] = [
  {
    key: 'job_number',
    header: 'Job #',
    headerClassName: 'w-[130px]',
    cell: (r) => (
      <div className="flex items-center gap-1.5">
        {PRIORITY_ICON[r.priority]}
        <span className="font-mono text-xs text-[var(--text-muted)]">{r.job_number}</span>
      </div>
    ),
  },
  {
    key: 'customer',
    header: 'Customer',
    cell: (r) => (
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-body-sm font-medium text-[var(--text)] truncate">{r.customer_name}</span>
        {r.customer_phone && (
          <a
            href={`tel:${r.customer_phone}`}
            className="flex items-center gap-0.5 text-xs text-[var(--accent)] hover:underline shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            <Phone className="h-2.5 w-2.5" />
            {formatPhone(r.customer_phone)}
          </a>
        )}
      </div>
    ),
  },
  {
    key: 'device',
    header: 'Device',
    cell: (r) => {
      const model = [r.device_brand, r.device_model].filter(Boolean).join(' ');
      const label = model ? `${model} · ${r.device_type}` : r.device_type;
      return (
        <span className="text-body-sm text-[var(--text)] truncate max-w-[180px] block">{label}</span>
      );
    },
  },
  {
    key: 'status',
    header: 'Status',
    headerClassName: 'w-[140px]',
    cell: (r) => <StatusBadge status={r.status} />,
  },
  {
    key: 'due',
    header: 'Due Date',
    headerClassName: 'w-[120px]',
    cell: (r) => {
      if (!r.expected_delivery_date) return <span className="text-xs text-[var(--text-muted)]">—</span>;
      const today = new Date(); today.setHours(0, 0, 0, 0);
      const due = new Date(r.expected_delivery_date);
      const overdue = due < today && !TERMINAL_STATUSES_SET.has(r.status);
      const days = overdue ? differenceInCalendarDays(today, due) : 0;
      return (
        <div className={cn('flex items-center gap-1 text-xs', overdue ? 'text-[var(--danger)] font-medium' : 'text-[var(--text-muted)]')}>
          {overdue && <CalendarClock className="h-3 w-3 shrink-0" />}
          <span className="tabular-nums">{overdue ? `${days}d overdue` : formatDate(r.expected_delivery_date)}</span>
        </div>
      );
    },
  },
  {
    key: 'technician',
    header: 'Technician',
    cell: (r) => (
      <span className="text-body-sm text-[var(--text-muted)]">{r.assigned_technician_name ?? '—'}</span>
    ),
  },
  {
    key: 'charge',
    header: 'Charge',
    headerClassName: 'text-right w-[90px]',
    className: 'text-right',
    cell: (r) => <Money amount={r.service_charge} className="text-body-sm tabular-nums" />,
  },
  {
    key: 'balance',
    header: 'Balance',
    headerClassName: 'text-right w-[90px]',
    className: 'text-right',
    cell: (r) => {
      const balance = r.service_charge - r.advance_paid;
      if (balance <= 0) {
        return <span className="text-xs font-medium text-[var(--success)]">Paid</span>;
      }
      return <Money amount={balance} className="text-body-sm tabular-nums text-[var(--warning)]" />;
    },
  },
  {
    key: 'intake',
    header: 'Intake',
    headerClassName: 'w-[100px]',
    cell: (r) => (
      <span className="text-body-sm text-[var(--text-muted)] tabular-nums">{formatDate(r.intake_date)}</span>
    ),
  },
];

export default function JobsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { activeShopId, isAllShops } = useActiveShopStore();
  const { isOnline } = useOfflineQueueStore();

  const [view, setView] = useState<ViewMode>('kanban');
  const [filters, setFilters] = useState<JobFilterState>(EMPTY_JOB_FILTERS);
  const [listPage, setListPage] = useState(1);

  const { user } = useAuthStore();
  const debouncedSearch = useDebounce(filters.search, 350);

  // Reset to page 1 whenever any filter changes (search is debounced separately)
  const filterSignature = JSON.stringify({ ...filters, search: debouncedSearch });
  React.useEffect(() => { setListPage(1); }, [filterSignature]);

  const { data: usersData } = useQuery({
    queryKey: ['settings', 'users', activeShopId],
    queryFn: () => settingsApi.listUsers({ is_active: true }),
    staleTime: 300_000,
  });

  const filterCtx: JobFilterCtx = useMemo(() => ({
    todayIso: new Date().toISOString().slice(0, 10),
    currentUserId: user?.id ?? '',
    technicianName: (id) => usersData?.items.find((u) => u.id === id)?.full_name ?? id,
  }), [user?.id, usersData]);

  // Shared filters for every view (status excluded — applied per column / per list).
  const baseFilters = useMemo(() => ({
    shop_id: isAllShops ? undefined : activeShopId ?? undefined,
    search: debouncedSearch || undefined,
    ...toBaseApiFilters({ ...filters, search: debouncedSearch }, filterCtx),
  }), [isAllShops, activeShopId, debouncedSearch, filters, filterCtx]);

  // Kanban: one query per column
  const columnQueries = useQueries({
    queries: KANBAN_COLUMNS.map(({ status }) => ({
      queryKey: qk.jobs({ ...baseFilters, status }),
      queryFn: () => repairApi.listJobs({ ...baseFilters, status }),
      staleTime: 30_000,
      enabled: view === 'kanban',
    })),
  });

  const kanbanColumns: KanbanColumnData[] = KANBAN_COLUMNS.map(({ status }, i) => ({
    status,
    jobs: columnQueries[i]?.data?.items ?? [],
    isLoading: columnQueries[i]?.isLoading ?? false,
    count: columnQueries[i]?.data?.meta?.count ?? (columnQueries[i]?.data?.items?.length ?? 0),
  }));

  // List view: page-number paginated (status applied here; kanban applies it per column)
  const listFilters = useMemo(
    () => ({ ...baseFilters, status: filters.status === 'all' ? undefined : filters.status, page: listPage }),
    [baseFilters, filters.status, listPage],
  );
  const listQuery = useQuery({
    queryKey: qk.jobs(listFilters),
    queryFn: () => repairApi.listJobs(listFilters),
    staleTime: 30_000,
    enabled: view === 'list',
  });

  const handleRowClick = useCallback((job: JobListItem) => {
    router.push(`/jobs/${job.id}`);
  }, [router]);

  const handleCardMove = useCallback(async (
    jobId: string,
    fromStatus: JobStatus,
    toStatus: JobStatus,
    fields?: Record<string, string>,
  ) => {
    await repairApi.changeStatus(jobId, {
      to_status: toStatus,
      reason: fields?.reason,
    });
    // Invalidate both columns so counts stay accurate
    queryClient.invalidateQueries({ queryKey: qk.jobs({ ...baseFilters, status: fromStatus }) });
    queryClient.invalidateQueries({ queryKey: qk.jobs({ ...baseFilters, status: toStatus }) });
  }, [queryClient, baseFilters]);

  return (
    <div className="flex flex-col h-full">
      {/* Offline banner */}
      {!isOnline && (
        <div className="flex items-center gap-2 px-4 py-2 bg-[var(--warning)]/10 border-b border-[var(--warning)]/30 text-[var(--warning)] text-body-sm">
          <WifiOff className="h-4 w-4 shrink-0" />
          Offline — showing saved data
        </div>
      )}

      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border)] bg-[var(--surface)] flex-wrap gap-y-2">
        <h1 className="text-h1 text-[var(--text)] mr-2">Jobs</h1>

        {/* Search */}
        <div className="relative flex-1 min-w-[160px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-muted)]" />
          <Input
            placeholder="Search job #, customer, IMEI…"
            className="pl-9 h-9"
            value={filters.search}
            onChange={(e) => setFilters((f) => ({ ...f, search: e.target.value }))}
          />
        </div>

        {/* Unified filter panel + active chips (applies to both views) */}
        <JobFilterBar
          filters={filters}
          onChange={setFilters}
          technicians={(usersData?.items ?? []).map((u) => ({ id: u.id, name: u.full_name }))}
          ctx={filterCtx}
        />

        <div className="flex items-center gap-1 ml-auto">
          {/* View toggle */}
          <div className="flex rounded-md border border-[var(--border)] overflow-hidden">
            <button
              onClick={() => setView('kanban')}
              className={cn(
                'h-9 w-9 flex items-center justify-center transition-colors',
                view === 'kanban'
                  ? 'bg-[var(--accent)] text-white'
                  : 'bg-[var(--surface)] text-[var(--text-muted)] hover:bg-[var(--surface-2)]',
              )}
              title="Kanban view"
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
            <button
              onClick={() => setView('list')}
              className={cn(
                'h-9 w-9 flex items-center justify-center transition-colors',
                view === 'list'
                  ? 'bg-[var(--accent)] text-white'
                  : 'bg-[var(--surface)] text-[var(--text-muted)] hover:bg-[var(--surface-2)]',
              )}
              title="List view"
            >
              <List className="h-4 w-4" />
            </button>
          </div>

          <Can permission="repair.jobs.create">
            <Button
              size="sm"
              className="h-9 ml-1"
              onClick={() => {
                if (!isOnline) return;
                router.push('/jobs/new');
              }}
              disabled={!isOnline}
              title={!isOnline ? 'Creating a job needs a connection' : undefined}
            >
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">New Job</span>
            </Button>
          </Can>
        </div>
      </div>

      {/* Quick filters */}
      <div className="px-4 py-2 border-b border-[var(--border)] bg-[var(--surface)]">
        <JobQuickFilters filters={filters} onChange={setFilters} ctx={filterCtx} />
      </div>

      {/* Board / List */}
      <div className="flex-1 overflow-auto p-4 md:p-6">
        {view === 'kanban' ? (
          <JobBoard columns={kanbanColumns} onCardMove={handleCardMove} />
        ) : (
          <DataTable
            columns={LIST_COLUMNS}
            data={listQuery.data?.items}
            loading={listQuery.isLoading}
            error={listQuery.error as Error | null}
            keyExtractor={(r) => r.id}
            onRowClick={handleRowClick}
            emptyTitle="No jobs yet"
            emptyDescription="Create your first job to get started."
            emptyAction={{
              label: 'New Job',
              onClick: () => router.push('/jobs/new'),
            }}
            page={listPage}
            totalPages={listQuery.data?.meta?.total_pages}
            onPageChange={setListPage}
            totalCount={listQuery.data?.meta?.count}
          />
        )}
      </div>
    </div>
  );
}
