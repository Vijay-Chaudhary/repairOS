'use client';

import { useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Search, LayoutGrid, List, WifiOff, Filter } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Money } from '@/components/shared/Money';
import { Can } from '@/components/shared/Can';
import { JobBoard, type KanbanColumnData } from '@/components/repair/JobBoard';
import { repairApi, KANBAN_COLUMNS, type JobListItem, type JobStatus, type JobPriority } from '@/lib/api/repair';
import { qk } from '@/lib/query/keys';
import { useActiveShopStore } from '@/lib/stores/activeShopStore';
import { useOfflineQueueStore } from '@/lib/stores/offlineQueueStore';
import { useDebounce } from '@/lib/hooks/useDebounce';
import { formatDate } from '@/lib/format/date';
import { ApiError } from '@/lib/api/client';
import { cn } from '@/lib/utils';

type ViewMode = 'kanban' | 'list';

const PRIORITY_OPTIONS: Array<{ label: string; value: JobPriority | 'all' }> = [
  { label: 'All priorities', value: 'all' },
  { label: 'Normal', value: 'normal' },
  { label: 'Urgent', value: 'urgent' },
  { label: 'VIP', value: 'vip' },
];

const LIST_COLUMNS: Column<JobListItem>[] = [
  { key: 'job_number', header: 'Job #', cell: (r) => <span className="font-mono text-xs">{r.job_number}</span> },
  { key: 'customer', header: 'Customer', cell: (r) => (
    <div>
      <p className="text-body-sm font-medium text-[var(--text)]">{r.customer_name}</p>
      {r.customer_phone && <p className="text-xs text-[var(--text-muted)]">{r.customer_phone}</p>}
    </div>
  )},
  { key: 'device', header: 'Device', cell: (r) => (
    <span className="text-body-sm text-[var(--text)]">
      {[r.device_brand, r.device_type, r.device_model].filter(Boolean).join(' ')}
    </span>
  )},
  { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
  { key: 'technician', header: 'Technician', cell: (r) => (
    <span className="text-body-sm text-[var(--text-muted)]">{r.assigned_technician_name ?? '—'}</span>
  )},
  { key: 'sc', header: 'S/C', cell: (r) => <Money amount={r.service_charge} className="text-body-sm" /> },
  { key: 'date', header: 'Intake', cell: (r) => (
    <span className="text-body-sm text-[var(--text-muted)]">{formatDate(r.intake_date)}</span>
  )},
];

export default function JobsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { activeShopId, isAllShops } = useActiveShopStore();
  const { isOnline } = useOfflineQueueStore();

  const [view, setView] = useState<ViewMode>('kanban');
  const [search, setSearch] = useState('');
  const [priority, setPriority] = useState<JobPriority | 'all'>('all');
  const [listCursor, setListCursor] = useState<string | undefined>(undefined);

  const debouncedSearch = useDebounce(search, 350);

  const baseFilters = useMemo(() => ({
    shop_id: isAllShops ? undefined : activeShopId ?? undefined,
    search: debouncedSearch || undefined,
    priority: priority === 'all' ? undefined : priority,
  }), [isAllShops, activeShopId, debouncedSearch, priority]);

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

  // List view: cursor-paginated
  const listQuery = useQuery({
    queryKey: qk.jobs({ ...baseFilters, cursor: listCursor }),
    queryFn: () => repairApi.listJobs({ ...baseFilters, cursor: listCursor }),
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
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* Priority filter */}
        <Select value={priority} onValueChange={(v) => setPriority(v as JobPriority | 'all')}>
          <SelectTrigger className="h-9 w-[140px]">
            <Filter className="h-3.5 w-3.5 text-[var(--text-muted)]" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PRIORITY_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <div className="flex items-center gap-1 ml-auto">
          {/* View toggle */}
          <div className="flex rounded-md border border-[var(--border)] overflow-hidden">
            <button
              onClick={() => setView('kanban')}
              className={cn(
                'p-2 transition-colors',
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
                'p-2 transition-colors',
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
            hasNextPage={!!listQuery.data?.meta?.next_cursor}
            hasPrevPage={!!listCursor}
            onNextPage={() => setListCursor(listQuery.data?.meta?.next_cursor ?? undefined)}
            onPrevPage={() => setListCursor(undefined)}
          />
        )}
      </div>
    </div>
  );
}
