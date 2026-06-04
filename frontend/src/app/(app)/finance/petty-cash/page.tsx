'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Can } from '@/components/shared/Can';
import { Money } from '@/components/shared/Money';
import { MoneyInput } from '@/components/shared/MoneyInput';
import { financeApi, type PettyCashType } from '@/lib/api/finance';
import { qk } from '@/lib/query/keys';
import { useActiveShopStore } from '@/lib/stores/activeShopStore';
import { ApiError } from '@/lib/api/client';
import { formatDate } from '@/lib/format/date';
import { cn } from '@/lib/utils';

const CATEGORIES = ['Office supplies', 'Travel', 'Utilities', 'Food & beverages', 'Repairs', 'Miscellaneous'];

export default function PettyCashPage() {
  const queryClient = useQueryClient();
  const { activeShopId } = useActiveShopStore();
  const [entryOpen, setEntryOpen] = useState(false);

  // Entry form
  const [entryType, setEntryType] = useState<PettyCashType>('debit');
  const [amount, setAmount] = useState(0);
  const [category, setCategory] = useState('');
  const [description, setDescription] = useState('');
  const [entryDate, setEntryDate] = useState(new Date().toISOString().split('T')[0]);
  const [cursor, setCursor] = useState<string | undefined>(undefined);

  const { data: account, isLoading: accountLoading } = useQuery({
    queryKey: qk.pettyCash({ shopId: activeShopId }),
    queryFn: () => financeApi.getPettyCashAccount(activeShopId ?? ''),
    enabled: !!activeShopId,
    staleTime: 30_000,
  });

  const { data: txData, isLoading: txLoading } = useQuery({
    queryKey: qk.pettyCash({ account: activeShopId, cursor }),
    queryFn: () => financeApi.listPettyCashTransactions({ account_id: account?.id, cursor }),
    enabled: !!account,
    staleTime: 30_000,
  });

  const addMutation = useMutation({
    mutationFn: () => financeApi.addPettyCashEntry({
      account_id: account!.id,
      type: entryType,
      amount,
      category: category || 'Miscellaneous',
      description,
      date: entryDate,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.pettyCash() });
      toast.success('Entry recorded');
      setAmount(0); setCategory(''); setDescription('');
      setEntryOpen(false);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });

  const isLow = account && account.current_balance < account.low_balance_threshold;
  const txs = txData?.items ?? [];

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--surface)] flex items-center justify-between gap-3">
        <h1 className="text-h1 text-[var(--text)]">Petty Cash</h1>
        <Can permission="hr.petty_cash.manage">
          <Button size="sm" onClick={() => setEntryOpen(true)}>
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">New entry</span>
          </Button>
        </Can>
      </div>

      <div className="flex-1 overflow-auto p-4 md:p-6 space-y-5">
        {/* Balance card */}
        {accountLoading ? (
          <Skeleton className="h-24 w-full rounded-xl" />
        ) : account ? (
          <div className={cn(
            'rounded-xl border p-5 flex items-center justify-between',
            isLow ? 'border-[var(--warning)]/30 bg-[var(--warning)]/10' : 'border-[var(--border)] bg-[var(--surface)]',
          )}>
            <div>
              {isLow && (
                <div className="flex items-center gap-1 text-[var(--warning)] text-xs font-medium mb-1">
                  <AlertTriangle className="h-3.5 w-3.5" /> Balance below threshold
                </div>
              )}
              <p className="text-body-sm text-[var(--text-muted)]">Current balance</p>
              <Money amount={account.current_balance} className="text-h1 font-bold font-mono" />
            </div>
            <p className="text-xs text-[var(--text-muted)]">
              Alert below <Money amount={account.low_balance_threshold} className="text-xs" />
            </p>
          </div>
        ) : null}

        {/* Transaction ledger */}
        <div>
          <h2 className="text-body-sm font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-3">Ledger</h2>
          {txLoading ? (
            <div className="space-y-2">{[1,2,3].map((i) => <Skeleton key={i} className="h-12" />)}</div>
          ) : txs.length === 0 ? (
            <p className="text-body-sm text-[var(--text-muted)] py-8 text-center">No transactions yet.</p>
          ) : (
            <div className="rounded-lg border border-[var(--border)] overflow-hidden">
              <table className="w-full text-body-sm">
                <thead>
                  <tr className="border-b border-[var(--border)] bg-[var(--surface-2)] text-left">
                    <th className="px-4 py-2 font-medium text-[var(--text-muted)]">Date</th>
                    <th className="px-4 py-2 font-medium text-[var(--text-muted)]">Category / Description</th>
                    <th className="px-4 py-2 font-medium text-[var(--text-muted)] text-right">Amount</th>
                    <th className="px-4 py-2 font-medium text-[var(--text-muted)] text-right">Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {txs.map((tx) => (
                    <tr key={tx.id} className="border-b border-[var(--border)] last:border-0">
                      <td className="px-4 py-3 text-[var(--text-muted)]">{formatDate(tx.date)}</td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-[var(--text)]">{tx.category}</p>
                        <p className="text-xs text-[var(--text-muted)]">{tx.description}</p>
                      </td>
                      <td className={cn('px-4 py-3 text-right tabular-nums font-semibold', tx.type === 'credit' ? 'text-[var(--success)]' : 'text-[var(--danger)]')}>
                        {tx.type === 'credit' ? '+' : '−'}<Money amount={tx.amount} className="text-inherit" />
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-[var(--text)]">
                        <Money amount={tx.balance_after} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* New entry dialog */}
      <Dialog open={entryOpen} onOpenChange={setEntryOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>New petty cash entry</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div className="flex rounded-md border border-[var(--border)] overflow-hidden">
              {(['credit', 'debit'] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setEntryType(t)}
                  className={cn(
                    'flex-1 py-2.5 text-body-sm font-medium capitalize transition-colors',
                    entryType === t
                      ? t === 'credit' ? 'bg-[var(--success)] text-white' : 'bg-[var(--danger)] text-white'
                      : 'text-[var(--text-muted)] hover:bg-[var(--surface-2)]',
                  )}
                >
                  {t === 'credit' ? '+ Credit (cash in)' : '− Debit (cash out)'}
                </button>
              ))}
            </div>
            <div>
              <label className="text-body-sm font-medium text-[var(--text)] block mb-1">Amount *</label>
              <MoneyInput value={amount} onChange={setAmount} />
            </div>
            <div>
              <label className="text-body-sm font-medium text-[var(--text)] block mb-1">Category</label>
              <Select value={category} onValueChange={setCategory}>
                <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-body-sm font-medium text-[var(--text)] block mb-1">Description *</label>
              <Input value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div>
              <label className="text-body-sm font-medium text-[var(--text)] block mb-1">Date</label>
              <Input type="date" value={entryDate} onChange={(e) => setEntryDate(e.target.value)} />
            </div>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setEntryOpen(false)}>Cancel</Button>
              <Button
                className="flex-1"
                disabled={!amount || !description || addMutation.isPending}
                onClick={() => addMutation.mutate()}
              >
                {addMutation.isPending ? 'Recording…' : 'Record entry'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
