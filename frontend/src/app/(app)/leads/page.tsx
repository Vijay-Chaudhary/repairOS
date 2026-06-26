'use client';

import React, { useState, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useQueries, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Plus, Search, LayoutGrid, List, Filter, Phone, WifiOff } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Can } from '@/components/shared/Can';
import { LeadBoard, type LeadColumnData } from '@/components/crm/LeadBoard';
import {
  crmApi, LEAD_PIPELINE_COLS, SOURCE_LABELS,
  type Lead, type LeadSource, type LeadStatus,
} from '@/lib/api/crm';
import { settingsApi } from '@/lib/api/settings';
import { qk } from '@/lib/query/keys';
import { useActiveShopStore } from '@/lib/stores/activeShopStore';
import { useOfflineQueueStore } from '@/lib/stores/offlineQueueStore';
import { useDebounce } from '@/lib/hooks/useDebounce';
import { ApiError } from '@/lib/api/client';
import { formatDate } from '@/lib/format/date';
import { formatPhone, normalizePhone } from '@/lib/format/phone';
import { cn } from '@/lib/utils';

type ViewMode = 'kanban' | 'list';

const leadSchema = z.object({
  name: z.string().min(2, 'Name required'),
  phone: z.string().min(10, 'Valid phone required'),
  email: z.string().email().optional().or(z.literal('')),
  source: z.enum(['walk_in', 'whatsapp', 'referral', 'google', 'facebook', 'other']),
  device_type: z.string().optional(),
  notes: z.string().optional(),
});

type LeadFormValues = z.infer<typeof leadSchema>;

const SOURCE_BADGE_STYLE: Record<LeadSource, string> = {
  walk_in:  'bg-[var(--accent)]/10 text-[var(--accent)]',
  whatsapp: 'bg-[var(--success)]/10 text-[var(--success)]',
  referral: 'bg-[var(--info)]/10 text-[var(--info)]',
  google:   'bg-[var(--warning)]/10 text-[var(--warning)]',
  facebook: 'bg-[var(--accent)]/10 text-[var(--accent)]',
  other:    'bg-[var(--surface-2)] text-[var(--text-muted)]',
};

const LIST_COLUMNS: Column<Lead>[] = [
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
    key: 'source',
    header: 'Source',
    headerClassName: 'w-[110px]',
    cell: (r) => (
      <span className={cn('text-[11px] font-medium rounded-full px-2 py-0.5 whitespace-nowrap', SOURCE_BADGE_STYLE[r.source])}>
        {SOURCE_LABELS[r.source]}
      </span>
    ),
  },
  {
    key: 'status',
    header: 'Status',
    headerClassName: 'w-[120px]',
    cell: (r) => <StatusBadge status={r.status} />,
  },
  {
    key: 'device',
    header: 'Device',
    headerClassName: 'w-[130px]',
    cell: (r) => (
      <span className="text-body-sm text-[var(--text-muted)]">{r.device_type ?? '—'}</span>
    ),
  },
  {
    key: 'notes',
    header: 'Notes',
    cell: (r) => r.notes
      ? <span className="block text-xs text-[var(--text-muted)] italic truncate max-w-[220px]">{r.notes}</span>
      : <span className="text-xs text-[var(--text-muted)]">—</span>,
  },
  {
    key: 'assigned',
    header: 'Assigned to',
    headerClassName: 'w-[130px]',
    cell: (r) => (
      <span className="text-body-sm text-[var(--text-muted)]">{r.assigned_to_name ?? '—'}</span>
    ),
  },
  {
    key: 'date',
    header: 'Created',
    headerClassName: 'w-[100px]',
    cell: (r) => (
      <span className="text-body-sm text-[var(--text-muted)] tabular-nums">{formatDate(r.created_at)}</span>
    ),
  },
];

export default function LeadsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { activeShopId, isAllShops } = useActiveShopStore();
  const { isOnline } = useOfflineQueueStore();

  const [view, setView] = useState<ViewMode>('kanban');
  const [search, setSearch] = useState('');
  const [sourceFilter, setSourceFilter] = useState<LeadSource | 'all'>('all');
  const [assignedFilter, setAssignedFilter] = useState<string | 'all'>('all');
  const [dateFrom, setDateFrom] = useState<string>('');
  const [dateTo, setDateTo] = useState<string>('');
  const [createOpen, setCreateOpen] = useState(false);
  const [listPage, setListPage] = useState(1);

  const debouncedSearch = useDebounce(search, 350);
  React.useEffect(() => { setListPage(1); }, [debouncedSearch]);

  const usersQuery = useQuery({
    queryKey: ['users', 'for-lead-filter'],
    queryFn: () => settingsApi.listUsers({ is_active: true }),
    staleTime: 300_000,
  });
  const users = usersQuery.data?.items ?? [];
  const assignedName = users.find((u) => u.id === assignedFilter)?.full_name;

  const baseFilters = useMemo(() => ({
    shop_id: isAllShops ? undefined : activeShopId ?? undefined,
    search: debouncedSearch || undefined,
    source: sourceFilter === 'all' ? undefined : sourceFilter,
    assigned_to: assignedFilter === 'all' ? undefined : assignedFilter,
    date_from: dateFrom || undefined,
    date_to: dateTo || undefined,
  }), [isAllShops, activeShopId, debouncedSearch, sourceFilter, assignedFilter, dateFrom, dateTo]);

  // Kanban: per-column queries
  const columnQueries = useQueries({
    queries: LEAD_PIPELINE_COLS.map(({ status }) => ({
      queryKey: qk.leads({ ...baseFilters, status }),
      queryFn: () => crmApi.listLeads({ ...baseFilters, status }),
      staleTime: 30_000,
      enabled: view === 'kanban',
    })),
  });

  const kanbanColumns: LeadColumnData[] = LEAD_PIPELINE_COLS.map(({ status }, i) => ({
    status,
    leads: columnQueries[i]?.data?.items ?? [],
    isLoading: columnQueries[i]?.isLoading ?? false,
    count: columnQueries[i]?.data?.meta?.count ?? (columnQueries[i]?.data?.items?.length ?? 0),
  }));

  // List: paginated
  const listQuery = useQuery({
    queryKey: qk.leads({ ...baseFilters, page: listPage }),
    queryFn: () => crmApi.listLeads({ ...baseFilters, page: listPage }),
    staleTime: 30_000,
    enabled: view === 'list',
  });

  const handleRowClick = useCallback((lead: Lead) => {
    router.push(`/leads/${lead.id}`);
  }, [router]);

  const handleCardMove = useCallback(async (
    leadId: string,
    fromStatus: LeadStatus,
    toStatus: LeadStatus,
    fields?: Record<string, string>,
  ) => {
    if (toStatus === 'converted') {
      const customer = await crmApi.convertLead(leadId);
      queryClient.invalidateQueries({ queryKey: qk.leads() });
      queryClient.invalidateQueries({ queryKey: qk.customers() });
      toast.success('Lead converted to customer');
      router.push(`/customers/${customer.id}`);
      return;
    }
    await crmApi.changeLeadStatus(leadId, toStatus, fields?.reason);
    queryClient.invalidateQueries({ queryKey: qk.leads({ ...baseFilters, status: fromStatus }) });
    queryClient.invalidateQueries({ queryKey: qk.leads({ ...baseFilters, status: toStatus }) });
  }, [queryClient, router, baseFilters]);

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
        <h1 className="text-h1 text-[var(--text)] mr-2">Leads</h1>

        <div className="relative flex-1 min-w-[160px] max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-muted)]" />
          <Input
            placeholder="Search name, phone…"
            className="pl-9 h-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>

        {/* Source filter */}
        <Select value={sourceFilter} onValueChange={(v) => setSourceFilter(v as LeadSource | 'all')}>
          <SelectTrigger className="h-9 w-[140px]" aria-label="Source">
            <Filter className="h-3.5 w-3.5 text-[var(--text-muted)]" />
            <SelectValue placeholder="All sources" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All sources</SelectItem>
            {(Object.entries(SOURCE_LABELS) as [LeadSource, string][]).map(([v, l]) => (
              <SelectItem key={v} value={v}>{l}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Assignee filter */}
        <Select value={assignedFilter} onValueChange={setAssignedFilter}>
          <SelectTrigger className="h-9 w-[150px]" aria-label="Assignee">
            <Filter className="h-3.5 w-3.5 text-[var(--text-muted)]" />
            <SelectValue placeholder="All assignees" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All assignees</SelectItem>
            {users.map((u) => (
              <SelectItem key={u.id} value={u.id}>{u.full_name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Date range filter */}
        <input
          type="date"
          aria-label="Created from"
          className="h-9 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-body-sm text-[var(--text)]"
          value={dateFrom}
          max={dateTo || undefined}
          onChange={(e) => setDateFrom(e.target.value)}
        />
        <input
          type="date"
          aria-label="Created to"
          className="h-9 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-body-sm text-[var(--text)]"
          value={dateTo}
          min={dateFrom || undefined}
          onChange={(e) => setDateTo(e.target.value)}
        />

        <div className="flex items-center gap-1 ml-auto">
          <div className="flex rounded-md border border-[var(--border)] overflow-hidden">
            <button
              onClick={() => setView('kanban')}
              className={cn('h-9 w-9 flex items-center justify-center transition-colors', view === 'kanban' ? 'bg-[var(--accent)] text-white' : 'bg-[var(--surface)] text-[var(--text-muted)] hover:bg-[var(--surface-2)]')}
              title="Kanban view"
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
            <button
              onClick={() => setView('list')}
              className={cn('h-9 w-9 flex items-center justify-center transition-colors', view === 'list' ? 'bg-[var(--accent)] text-white' : 'bg-[var(--surface)] text-[var(--text-muted)] hover:bg-[var(--surface-2)]')}
              title="List view"
            >
              <List className="h-4 w-4" />
            </button>
          </div>

          <Can permission="crm.leads.create">
            <Button size="sm" className="h-9 ml-1" onClick={() => setCreateOpen(true)}>
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">New Lead</span>
            </Button>
          </Can>
        </div>
      </div>

      {/* Active filter chips */}
      {(sourceFilter !== 'all' || assignedFilter !== 'all' || dateFrom || dateTo) && (
        <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-[var(--border)] bg-[var(--surface)]">
          {sourceFilter !== 'all' && (
            <button
              onClick={() => setSourceFilter('all')}
              className="text-body-sm rounded-full border border-[var(--border)] px-2 py-0.5 text-[var(--text-muted)] hover:bg-[var(--surface-2)]"
            >
              Source: {SOURCE_LABELS[sourceFilter]} ×
            </button>
          )}
          {assignedFilter !== 'all' && (
            <button
              onClick={() => setAssignedFilter('all')}
              className="text-body-sm rounded-full border border-[var(--border)] px-2 py-0.5 text-[var(--text-muted)] hover:bg-[var(--surface-2)]"
            >
              Assignee: {assignedName ?? assignedFilter} ×
            </button>
          )}
          {dateFrom && (
            <button
              onClick={() => setDateFrom('')}
              className="text-body-sm rounded-full border border-[var(--border)] px-2 py-0.5 text-[var(--text-muted)] hover:bg-[var(--surface-2)]"
            >
              From {dateFrom} ×
            </button>
          )}
          {dateTo && (
            <button
              onClick={() => setDateTo('')}
              className="text-body-sm rounded-full border border-[var(--border)] px-2 py-0.5 text-[var(--text-muted)] hover:bg-[var(--surface-2)]"
            >
              To {dateTo} ×
            </button>
          )}
        </div>
      )}

      {/* Board / List */}
      <div className="flex-1 overflow-auto p-4 md:p-6">
        {view === 'kanban' ? (
          <LeadBoard columns={kanbanColumns} onCardMove={handleCardMove} />
        ) : (
          <DataTable
            columns={LIST_COLUMNS}
            data={listQuery.data?.items}
            loading={listQuery.isLoading}
            error={listQuery.error as Error | null}
            keyExtractor={(r) => r.id}
            onRowClick={handleRowClick}
            emptyTitle="No leads yet"
            emptyDescription="Add your first lead to start the pipeline."
            emptyAction={{ label: 'New Lead', onClick: () => setCreateOpen(true) }}
            page={listPage}
            totalPages={listQuery.data?.meta?.total_pages}
            onPageChange={setListPage}
            totalCount={listQuery.data?.meta?.count}
          />
        )}
      </div>

      {/* Create lead dialog */}
      <CreateLeadDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        shopId={activeShopId ?? ''}
        onSuccess={() => queryClient.invalidateQueries({ queryKey: qk.leads() })}
      />
    </div>
  );
}

// ── Create lead dialog ────────────────────────────────────────────────────────

function CreateLeadDialog({
  open, onOpenChange, shopId, onSuccess,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  shopId: string;
  onSuccess: () => void;
}) {
  const form = useForm<LeadFormValues>({
    resolver: zodResolver(leadSchema),
    defaultValues: { name: '', phone: '', email: '', source: 'walk_in', device_type: '', notes: '' },
  });

  const mutation = useMutation({
    mutationFn: (values: LeadFormValues) =>
      crmApi.createLead({
        shop_id: shopId,
        name: values.name,
        phone: normalizePhone(values.phone),
        email: values.email || undefined,
        source: values.source,
        device_type: values.device_type || undefined,
        notes: values.notes || undefined,
      }),
    onSuccess: () => {
      toast.success('Lead created');
      form.reset();
      onSuccess();
      onOpenChange(false);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader><DialogTitle>New lead</DialogTitle></DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
            <FormField control={form.control} name="name" render={({ field }) => (
              <FormItem>
                <FormLabel>Name *</FormLabel>
                <FormControl><Input placeholder="Rahul Sharma" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <div className="grid grid-cols-2 gap-3">
              <FormField control={form.control} name="phone" render={({ field }) => (
                <FormItem>
                  <FormLabel>Phone *</FormLabel>
                  <FormControl><Input inputMode="tel" placeholder="+91…" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="email" render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl><Input type="email" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormField control={form.control} name="source" render={({ field }) => (
                <FormItem>
                  <FormLabel>Source *</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      {(Object.keys(SOURCE_LABELS) as LeadSource[]).map((s) => (
                        <SelectItem key={s} value={s}>{SOURCE_LABELS[s]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="device_type" render={({ field }) => (
                <FormItem>
                  <FormLabel>Device type</FormLabel>
                  <FormControl><Input placeholder="Smartphone…" {...field} /></FormControl>
                </FormItem>
              )} />
            </div>
            <FormField control={form.control} name="notes" render={({ field }) => (
              <FormItem>
                <FormLabel>Notes</FormLabel>
                <FormControl>
                  <textarea
                    className="flex min-h-[60px] w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-body text-[var(--text)] placeholder:text-[var(--text-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] resize-none"
                    {...field}
                  />
                </FormControl>
              </FormItem>
            )} />
            <div className="flex gap-3">
              <Button type="button" variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" className="flex-1" disabled={mutation.isPending}>
                {mutation.isPending ? 'Creating…' : 'Create lead'}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
