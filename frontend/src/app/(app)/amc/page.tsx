'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Plus, Search, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Money } from '@/components/shared/Money';
import { Can } from '@/components/shared/Can';
import { MoneyInput } from '@/components/shared/MoneyInput';
import { CustomerSearch, type CustomerOption } from '@/components/repair/CustomerSearch';
import { amcApi, PAYMENT_TERMS_LABELS, type AmcContract, type ContractStatus, type PaymentTerms } from '@/lib/api/amc';
import { qk } from '@/lib/query/keys';
import { useActiveShopStore } from '@/lib/stores/activeShopStore';
import { ApiError } from '@/lib/api/client';
import { useDebounce } from '@/lib/hooks/useDebounce';
import { formatDate } from '@/lib/format/date';

const contractSchema = z.object({
  title: z.string().min(2, 'Title required'),
  value: z.number().min(1, 'Value required'),
  start_date: z.string().min(1, 'Start date required'),
  end_date: z.string().min(1, 'End date required'),
  visits_per_year: z.number().int().min(0),
  payment_terms: z.enum(['upfront', 'quarterly', 'monthly']),
  auto_renew: z.boolean(),
  renewal_reminder_days: z.number().int().min(1),
  description: z.string().optional(),
  notes: z.string().optional(),
});

type ContractFormValues = z.infer<typeof contractSchema>;

const COLUMNS: Column<AmcContract>[] = [
  {
    key: 'number',
    header: 'Contract',
    cell: (r) => (
      <div>
        <p className="font-mono text-xs text-[var(--text-muted)]">{r.contract_number}</p>
        <p className="text-body-sm font-medium text-[var(--text)]">{r.title}</p>
      </div>
    ),
  },
  { key: 'customer', header: 'Customer', cell: (r) => <span className="text-body-sm">{r.customer_name}</span> },
  { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
  { key: 'value', header: 'Value', cell: (r) => <Money amount={r.value} className="text-body-sm tabular-nums" /> },
  {
    key: 'dates',
    header: 'Period',
    cell: (r) => (
      <span className="text-body-sm text-[var(--text-muted)]">
        {formatDate(r.start_date)} – {formatDate(r.end_date)}
      </span>
    ),
  },
  {
    key: 'next',
    header: 'Next visit',
    cell: (r) => r.next_visit_date
      ? <span className="text-body-sm text-[var(--text-muted)]">{formatDate(r.next_visit_date)}</span>
      : <span className="text-[var(--text-muted)] text-xs">—</span>,
  },
];

export default function AmcPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { activeShopId, isAllShops } = useActiveShopStore();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<ContractStatus | 'all'>('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [customer, setCustomer] = useState<CustomerOption | null>(null);
  const debouncedSearch = useDebounce(search, 350);

  const filters = {
    shop_id: isAllShops ? undefined : activeShopId ?? undefined,
    status: statusFilter === 'all' ? undefined : statusFilter,
    search: debouncedSearch || undefined,
  };

  const { data, isLoading, error } = useQuery({
    queryKey: qk.amcContracts(filters),
    queryFn: () => amcApi.listContracts(filters),
    staleTime: 30_000,
  });

  const form = useForm<ContractFormValues>({
    resolver: zodResolver(contractSchema),
    defaultValues: {
      title: '', value: 0, start_date: '', end_date: '',
      visits_per_year: 4, payment_terms: 'upfront',
      auto_renew: true, renewal_reminder_days: 30,
      description: '', notes: '',
    },
  });

  const createMutation = useMutation({
    mutationFn: (values: ContractFormValues) => {
      if (!customer) throw new Error('Customer required');
      return amcApi.createContract({
        shop_id: activeShopId ?? '',
        customer_id: customer.id,
        title: values.title,
        description: values.description || undefined,
        value: values.value,
        start_date: values.start_date,
        end_date: values.end_date,
        visits_per_year: values.visits_per_year,
        payment_terms: values.payment_terms,
        auto_renew: values.auto_renew,
        renewal_reminder_days: values.renewal_reminder_days,
        notes: values.notes || undefined,
      });
    },
    onSuccess: (c) => {
      queryClient.invalidateQueries({ queryKey: qk.amcContracts() });
      toast.success(`Contract ${c.contract_number} created`);
      form.reset();
      setCustomer(null);
      setCreateOpen(false);
      router.push(`/amc/${c.id}`);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });

  const contracts = data?.items ?? [];
  const renewalDue = contracts.filter((c) => c.status === 'pending_renewal').length;

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--surface)] flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-h1 text-[var(--text)]">AMC Contracts</h1>
          {renewalDue > 0 && (
            <p className="flex items-center gap-1 text-xs text-[var(--warning)] mt-0.5">
              <AlertTriangle className="h-3 w-3" />{renewalDue} renewal{renewalDue !== 1 ? 's' : ''} due
            </p>
          )}
        </div>
        <Can permission="amc.contracts.create">
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">New contract</span>
          </Button>
        </Can>
      </div>

      <div className="flex gap-3 px-4 py-2 border-b border-[var(--border)] flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-muted)]" />
          <Input placeholder="Search contract, customer…" className="pl-9 h-9" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as ContractStatus | 'all')}>
          <SelectTrigger className="h-9 w-[180px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="pending_renewal">Renewal due</SelectItem>
            <SelectItem value="expired">Expired</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <div className="flex-1 overflow-auto p-4 md:p-6">
        <DataTable
          columns={COLUMNS}
          data={contracts}
          loading={isLoading}
          error={error as Error | null}
          keyExtractor={(r) => r.id}
          onRowClick={(r) => router.push(`/amc/${r.id}`)}
          emptyTitle="No AMC contracts"
          emptyDescription="Create your first maintenance contract."
          emptyAction={{ label: 'New contract', onClick: () => setCreateOpen(true) }}
        />
      </div>

      {/* Create contract dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>New AMC contract</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <p className="text-body-sm font-medium text-[var(--text)] mb-2">Customer *</p>
              <CustomerSearch value={customer} onChange={setCustomer} />
            </div>
            <form onSubmit={form.handleSubmit((v) => createMutation.mutate(v))} className="space-y-3">
              {/* reuse form fields inline */}
              {[
                { name: 'title' as const, label: 'Contract title *', placeholder: 'CCTV AMC – 4 cameras' },
              ].map(({ name, label, placeholder }) => (
                <div key={name}>
                  <label className="text-body-sm font-medium text-[var(--text)] block mb-1">{label}</label>
                  <Input placeholder={placeholder} {...form.register(name)} />
                  {form.formState.errors[name] && (
                    <p className="text-xs text-[var(--danger)] mt-0.5">{form.formState.errors[name]?.message}</p>
                  )}
                </div>
              ))}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-body-sm font-medium text-[var(--text)] block mb-1">Value *</label>
                  <MoneyInput value={form.watch('value')} onChange={(v) => form.setValue('value', v)} />
                </div>
                <div>
                  <label className="text-body-sm font-medium text-[var(--text)] block mb-1">Visits/year</label>
                  <Input type="number" min={0} {...form.register('visits_per_year', { valueAsNumber: true })} />
                </div>
                <div>
                  <label className="text-body-sm font-medium text-[var(--text)] block mb-1">Start date *</label>
                  <Input type="date" {...form.register('start_date')} />
                </div>
                <div>
                  <label className="text-body-sm font-medium text-[var(--text)] block mb-1">End date *</label>
                  <Input type="date" {...form.register('end_date')} />
                </div>
                <div>
                  <label className="text-body-sm font-medium text-[var(--text)] block mb-1">Payment terms</label>
                  <Select value={form.watch('payment_terms')} onValueChange={(v) => form.setValue('payment_terms', v as PaymentTerms)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {(Object.keys(PAYMENT_TERMS_LABELS) as PaymentTerms[]).map((t) => (
                        <SelectItem key={t} value={t}>{PAYMENT_TERMS_LABELS[t]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-body-sm font-medium text-[var(--text)] block mb-1">Renewal reminder (days)</label>
                  <Input type="number" min={1} {...form.register('renewal_reminder_days', { valueAsNumber: true })} />
                </div>
              </div>
              <label className="flex items-center gap-2 text-body-sm cursor-pointer">
                <input type="checkbox" {...form.register('auto_renew')} className="rounded" />
                Auto-renew this contract
              </label>
              <div className="flex gap-3 pt-2">
                <Button type="button" variant="outline" className="flex-1" onClick={() => setCreateOpen(false)}>Cancel</Button>
                <Button type="submit" className="flex-1" disabled={!customer || createMutation.isPending}>
                  {createMutation.isPending ? 'Creating…' : 'Create contract'}
                </Button>
              </div>
            </form>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
