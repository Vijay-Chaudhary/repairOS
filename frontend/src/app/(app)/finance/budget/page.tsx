'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Money } from '@/components/shared/Money';
import { MoneyInput } from '@/components/shared/MoneyInput';
import { Can } from '@/components/shared/Can';
import { financeApi, BUDGET_CATEGORY_LABELS, MONTHS, type BudgetCategory } from '@/lib/api/finance';
import { qk } from '@/lib/query/keys';
import { useActiveShopStore } from '@/lib/stores/activeShopStore';
import { ApiError } from '@/lib/api/client';
import { cn } from '@/lib/utils';

export default function BudgetPage() {
  const queryClient = useQueryClient();
  const { activeShopId } = useActiveShopStore();
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [newHeadOpen, setNewHeadOpen] = useState(false);
  const [setBudgetOpen, setSetBudgetOpen] = useState(false);
  const [selectedHeadId, setSelectedHeadId] = useState('');
  const [budgetAmount, setBudgetAmount] = useState(0);

  // New head form
  const [headName, setHeadName] = useState('');
  const [headCategory, setHeadCategory] = useState<BudgetCategory>('variable');

  const { data: allocations, isLoading } = useQuery({
    queryKey: qk.budgets(activeShopId ?? null),
    queryFn: () => financeApi.listBudgetAllocations({ shop_id: activeShopId ?? undefined, month, year }),
    enabled: !!activeShopId,
    staleTime: 30_000,
  });

  const { data: headsData } = useQuery({
    queryKey: ['budget-heads', activeShopId],
    queryFn: () => financeApi.listBudgetHeads(activeShopId ?? ''),
    enabled: !!activeShopId,
    staleTime: 300_000,
  });
  const heads = headsData?.items ?? [];

  const createHeadMutation = useMutation({
    mutationFn: () => financeApi.createBudgetHead({ shop_id: activeShopId ?? '', name: headName, category: headCategory }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['budget-heads', activeShopId] });
      toast.success('Budget head created');
      setHeadName('');
      setNewHeadOpen(false);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });

  const setBudgetMutation = useMutation({
    mutationFn: () => financeApi.setBudgetAllocation({
      head_id: selectedHeadId,
      month,
      year,
      budgeted_amount: budgetAmount,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.budgets(activeShopId ?? null) });
      toast.success('Budget set');
      setSetBudgetOpen(false);
      setBudgetAmount(0);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });

  const allocs = allocations?.items ?? [];
  const totalBudgeted = allocs.reduce((s, a) => s + a.budgeted_amount, 0);
  const totalActual = allocs.reduce((s, a) => s + a.actual_amount, 0);
  const isOverall = totalActual > totalBudgeted;
  const years = [year - 1, year, year + 1];

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--surface)] flex items-center justify-between gap-3">
        <h1 className="text-h1 text-[var(--text)]">Budget vs Actual</h1>
        <Can permission="erp.budget.manage">
          <Button size="sm" variant="outline" onClick={() => setNewHeadOpen(true)}>
            <Plus className="h-4 w-4" /> Head
          </Button>
        </Can>
      </div>

      <div className="flex gap-2 px-4 py-2 border-b border-[var(--border)]">
        <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
          <SelectTrigger className="h-9 w-[120px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {MONTHS.map((m, i) => <SelectItem key={i} value={String(i+1)}>{m}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
          <SelectTrigger className="h-9 w-[90px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {years.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      <div className="flex-1 overflow-auto p-4 md:p-6 space-y-5">
        {/* Summary */}
        {allocs.length > 0 && (
          <div className={cn('rounded-lg border p-4 grid grid-cols-3 gap-3', isOverall ? 'border-[var(--danger)]/30 bg-[var(--danger)]/5' : 'border-[var(--border)]')}>
            <div className="text-center">
              <p className="text-xs text-[var(--text-muted)]">Budgeted</p>
              <Money amount={totalBudgeted} className="text-body font-semibold" />
            </div>
            <div className="text-center">
              <p className="text-xs text-[var(--text-muted)]">Actual</p>
              <Money amount={totalActual} className={cn('text-body font-semibold', isOverall ? 'text-[var(--danger)]' : '')} />
            </div>
            <div className="text-center">
              <p className="text-xs text-[var(--text-muted)]">Variance</p>
              <Money
                amount={Math.abs(totalActual - totalBudgeted)}
                className={cn('text-body font-semibold', isOverall ? 'text-[var(--danger)]' : 'text-[var(--success)]')}
              />
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="space-y-2">{[1,2,3].map((i) => <Skeleton key={i} className="h-14" />)}</div>
        ) : allocs.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-body-sm text-[var(--text-muted)]">No budget allocations for this period.</p>
            {heads.length > 0 && (
              <Button size="sm" className="mt-3" onClick={() => { setSelectedHeadId(heads[0]?.id ?? ''); setSetBudgetOpen(true); }}>
                Set budget
              </Button>
            )}
          </div>
        ) : (
          <div className="rounded-lg border border-[var(--border)] overflow-hidden">
            <table className="w-full text-body-sm">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--surface-2)] text-left">
                  <th className="px-4 py-2 font-medium text-[var(--text-muted)]">Budget head</th>
                  <th className="px-4 py-2 font-medium text-[var(--text-muted)] text-right">Budgeted</th>
                  <th className="px-4 py-2 font-medium text-[var(--text-muted)] text-right">Actual</th>
                  <th className="px-4 py-2 font-medium text-[var(--text-muted)] text-right">Variance</th>
                  <th className="px-4 py-2 font-medium text-[var(--text-muted)]">Bar</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {allocs.map((a) => {
                  const overBudget = a.actual_amount > a.budgeted_amount;
                  const pct = a.budgeted_amount > 0 ? Math.min(100, (a.actual_amount / a.budgeted_amount) * 100) : 100;
                  return (
                    <tr key={a.id} className={cn('border-b border-[var(--border)] last:border-0', overBudget ? 'bg-[var(--danger)]/5' : '')}>
                      <td className="px-4 py-3">
                        <p className="font-medium text-[var(--text)]">{a.head_name}</p>
                        <p className="text-xs text-[var(--text-muted)] capitalize">{a.category}</p>
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums"><Money amount={a.budgeted_amount} /></td>
                      <td className={cn('px-4 py-3 text-right tabular-nums font-semibold', overBudget ? 'text-[var(--danger)]' : '')}>
                        <Money amount={a.actual_amount} />
                      </td>
                      <td className={cn('px-4 py-3 text-right tabular-nums', overBudget ? 'text-[var(--danger)]' : 'text-[var(--success)]')}>
                        {overBudget ? '+' : ''}
                        <Money amount={Math.abs(a.variance)} className="text-inherit" />
                      </td>
                      <td className="px-4 py-3 w-24">
                        <div className="h-2 rounded-full bg-[var(--surface-2)] overflow-hidden">
                          <div
                            className={cn('h-full rounded-full', overBudget ? 'bg-[var(--danger)]' : 'bg-[var(--success)]')}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <p className="text-[10px] text-[var(--text-muted)] mt-0.5 text-right">{pct.toFixed(0)}%</p>
                      </td>
                      <td className="px-4 py-3">
                        <Can permission="erp.budget.manage">
                          <Button size="sm" variant="ghost" className="h-7 text-xs"
                            onClick={() => { setSelectedHeadId(a.head_id); setBudgetAmount(a.budgeted_amount); setSetBudgetOpen(true); }}>
                            Edit
                          </Button>
                        </Can>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {heads.length > 0 && allocs.length > 0 && (
          <Can permission="erp.budget.manage">
            <Button size="sm" variant="outline" onClick={() => { setSelectedHeadId(''); setBudgetAmount(0); setSetBudgetOpen(true); }}>
              <Plus className="h-3.5 w-3.5" /> Set budget for head
            </Button>
          </Can>
        )}
      </div>

      {/* New head dialog */}
      <Dialog open={newHeadOpen} onOpenChange={setNewHeadOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>New budget head</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-body-sm font-medium text-[var(--text)] block mb-1">Name *</label>
              <Input placeholder="Rent, Salaries, Marketing…" value={headName} onChange={(e) => setHeadName(e.target.value)} />
            </div>
            <div>
              <label className="text-body-sm font-medium text-[var(--text)] block mb-1">Category</label>
              <Select value={headCategory} onValueChange={(v) => setHeadCategory(v as BudgetCategory)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(BUDGET_CATEGORY_LABELS) as BudgetCategory[]).map((c) => (
                    <SelectItem key={c} value={c}>{BUDGET_CATEGORY_LABELS[c]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setNewHeadOpen(false)}>Cancel</Button>
              <Button className="flex-1" disabled={!headName || createHeadMutation.isPending} onClick={() => createHeadMutation.mutate()}>
                {createHeadMutation.isPending ? 'Creating…' : 'Create'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Set budget dialog */}
      <Dialog open={setBudgetOpen} onOpenChange={setSetBudgetOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Set budget allocation</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-body-sm font-medium text-[var(--text)] block mb-1">Budget head *</label>
              <Select value={selectedHeadId} onValueChange={setSelectedHeadId}>
                <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>
                  {heads.map((h) => <SelectItem key={h.id} value={h.id}>{h.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-body-sm font-medium text-[var(--text)] block mb-1">Budgeted amount *</label>
              <MoneyInput value={budgetAmount} onChange={setBudgetAmount} />
            </div>
            <p className="text-xs text-[var(--text-muted)]">For {MONTHS[month-1]} {year}</p>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setSetBudgetOpen(false)}>Cancel</Button>
              <Button className="flex-1" disabled={!selectedHeadId || setBudgetMutation.isPending} onClick={() => setBudgetMutation.mutate()}>
                {setBudgetMutation.isPending ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
