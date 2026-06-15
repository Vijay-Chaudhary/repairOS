'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { Money } from '@/components/shared/Money';
import { MoneyInput } from '@/components/shared/MoneyInput';
import { Can } from '@/components/shared/Can';
import { financeApi, type Expense } from '@/lib/api/finance';
import { qk } from '@/lib/query/keys';
import { useActiveShopStore } from '@/lib/stores/activeShopStore';
import { ApiError } from '@/lib/api/client';
import { formatDate } from '@/lib/format/date';

const COLUMNS: Column<Expense>[] = [
  { key: 'date', header: 'Date', cell: (r) => <span className="text-body-sm text-[var(--text-muted)]">{formatDate(r.date)}</span> },
  { key: 'cat', header: 'Category', cell: (r) => (
    <div>
      <p className="text-body-sm font-medium text-[var(--text)]">{r.category}</p>
      {r.budget_head_name && <p className="text-xs text-[var(--text-muted)]">{r.budget_head_name}</p>}
    </div>
  )},
  { key: 'desc', header: 'Description', cell: (r) => <span className="text-body-sm text-[var(--text-muted)]">{r.description}</span> },
  { key: 'amount', header: 'Amount', cell: (r) => <Money amount={r.amount} className="text-body-sm font-semibold tabular-nums" /> },
  { key: 'by', header: 'By', cell: (r) => <span className="text-body-sm text-[var(--text-muted)]">{r.recorded_by_name ?? '—'}</span> },
];

export default function ExpensesPage() {
  const queryClient = useQueryClient();
  const { activeShopId, isAllShops } = useActiveShopStore();
  const [createOpen, setCreateOpen] = useState(false);
  const [listPage, setListPage] = useState(1);

  // Form state
  const [category, setCategory] = useState('');
  const [amount, setAmount] = useState(0);
  const [description, setDescription] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [budgetHeadId, setBudgetHeadId] = useState('');

  const filters = {
    shop_id: isAllShops ? undefined : activeShopId ?? undefined,
    page: listPage,
  };

  const { data, isLoading, error } = useQuery({
    queryKey: qk.expenses(filters),
    queryFn: () => financeApi.listExpenses(filters),
    staleTime: 30_000,
  });

  const { data: headsData } = useQuery({
    queryKey: ['budget-heads', activeShopId],
    queryFn: () => financeApi.listBudgetHeads(activeShopId ?? ''),
    enabled: !!activeShopId,
    staleTime: 300_000,
  });
  const heads = headsData?.items ?? [];

  const createMutation = useMutation({
    mutationFn: () => financeApi.createExpense({
      shop_id: activeShopId ?? '',
      category,
      amount,
      description,
      date,
      budget_head_id: budgetHeadId || undefined,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.expenses() });
      toast.success('Expense recorded');
      setCategory(''); setAmount(0); setDescription(''); setBudgetHeadId('');
      setCreateOpen(false);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--surface)] flex items-center justify-between gap-3">
        <h1 className="text-h1 text-[var(--text)]">Expenses</h1>
        <Can permission="erp.expenses.create">
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">Add expense</span>
          </Button>
        </Can>
      </div>
      <div className="flex-1 overflow-auto p-4 md:p-6">
        <DataTable
          columns={COLUMNS}
          data={data?.items}
          loading={isLoading}
          error={error as Error | null}
          keyExtractor={(r) => r.id}
          emptyTitle="No expenses"
          emptyDescription="Record business expenses to track against your budget."
          emptyAction={{ label: 'Add expense', onClick: () => setCreateOpen(true) }}
          page={listPage}
          totalPages={data?.meta?.total_pages}
          onPageChange={setListPage}
          totalCount={data?.meta?.count}
        />
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Add expense</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-body-sm font-medium text-[var(--text)] block mb-1">Category *</label>
              <Input placeholder="Office supplies, rent, utilities…" value={category} onChange={(e) => setCategory(e.target.value)} />
            </div>
            <div>
              <label className="text-body-sm font-medium text-[var(--text)] block mb-1">Amount *</label>
              <MoneyInput value={amount} onChange={setAmount} />
            </div>
            <div>
              <label className="text-body-sm font-medium text-[var(--text)] block mb-1">Description *</label>
              <Input value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div>
              <label className="text-body-sm font-medium text-[var(--text)] block mb-1">Date</label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            {heads.length > 0 && (
              <div>
                <label className="text-body-sm font-medium text-[var(--text)] block mb-1">Budget head</label>
                <Select value={budgetHeadId} onValueChange={setBudgetHeadId}>
                  <SelectTrigger><SelectValue placeholder="Select head…" /></SelectTrigger>
                  <SelectContent>
                    {heads.map((h) => <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setCreateOpen(false)}>Cancel</Button>
              <Button
                className="flex-1"
                disabled={!category || !amount || !description || createMutation.isPending}
                onClick={() => createMutation.mutate()}
              >
                {createMutation.isPending ? 'Recording…' : 'Record'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
