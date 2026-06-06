'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { useQueries, useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Search, LayoutGrid, List } from 'lucide-react';
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
  type Lead, type LeadSource,
} from '@/lib/api/crm';
import { qk } from '@/lib/query/keys';
import { useActiveShopStore } from '@/lib/stores/activeShopStore';
import { useDebounce } from '@/lib/hooks/useDebounce';
import { ApiError } from '@/lib/api/client';
import { formatDate } from '@/lib/format/date';
import { formatPhone } from '@/lib/format/phone';
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

const LIST_COLUMNS: Column<Lead>[] = [
  { key: 'name', header: 'Name', cell: (r) => (
    <div>
      <p className="text-body-sm font-medium text-[var(--text)]">{r.name}</p>
      <p className="text-xs text-[var(--text-muted)]">{formatPhone(r.phone)}</p>
    </div>
  )},
  { key: 'source', header: 'Source', cell: (r) => (
    <span className="text-body-sm text-[var(--text-muted)]">{SOURCE_LABELS[r.source]}</span>
  )},
  { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
  { key: 'device', header: 'Device', cell: (r) => (
    <span className="text-body-sm text-[var(--text-muted)]">{r.device_type ?? '—'}</span>
  )},
  { key: 'assigned', header: 'Assigned', cell: (r) => (
    <span className="text-body-sm text-[var(--text-muted)]">{r.assigned_to_name ?? '—'}</span>
  )},
  { key: 'date', header: 'Created', cell: (r) => (
    <span className="text-body-sm text-[var(--text-muted)]">{formatDate(r.created_at)}</span>
  )},
];

export default function LeadsPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { activeShopId, isAllShops } = useActiveShopStore();

  const [view, setView] = useState<ViewMode>('kanban');
  const [search, setSearch] = useState('');
  const [createOpen, setCreateOpen] = useState(false);
  const [listCursor, setListCursor] = useState<string | undefined>(undefined);

  const debouncedSearch = useDebounce(search, 350);

  const baseFilters = {
    shop_id: isAllShops ? undefined : activeShopId ?? undefined,
    search: debouncedSearch || undefined,
  };

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
    queryKey: qk.leads({ ...baseFilters, cursor: listCursor }),
    queryFn: () => crmApi.listLeads({ ...baseFilters, cursor: listCursor }),
    staleTime: 30_000,
    enabled: view === 'list',
  });

  const handleRowClick = useCallback((lead: Lead) => {
    router.push(`/leads/${lead.id}`);
  }, [router]);

  return (
    <div className="flex flex-col h-full">
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

        <div className="flex items-center gap-1 ml-auto">
          <div className="flex rounded-md border border-[var(--border)] overflow-hidden">
            <button
              onClick={() => setView('kanban')}
              className={cn('p-2 transition-colors', view === 'kanban' ? 'bg-[var(--accent)] text-white' : 'bg-[var(--surface)] text-[var(--text-muted)] hover:bg-[var(--surface-2)]')}
              title="Kanban view"
            >
              <LayoutGrid className="h-4 w-4" />
            </button>
            <button
              onClick={() => setView('list')}
              className={cn('p-2 transition-colors', view === 'list' ? 'bg-[var(--accent)] text-white' : 'bg-[var(--surface)] text-[var(--text-muted)] hover:bg-[var(--surface-2)]')}
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

      {/* Board / List */}
      <div className="flex-1 overflow-hidden p-4 md:p-6 flex flex-col min-h-0">
        {view === 'kanban' ? (
          <div className="overflow-auto flex-1">
            <LeadBoard columns={kanbanColumns} />
          </div>
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
            hasNextPage={!!listQuery.data?.meta?.next_cursor}
            hasPrevPage={!!listCursor}
            onNextPage={() => setListCursor(listQuery.data?.meta?.next_cursor ?? undefined)}
            onPrevPage={() => setListCursor(undefined)}
            totalCount={listQuery.data?.meta?.count}
            className="flex-1 min-h-0"
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
        phone: values.phone,
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
