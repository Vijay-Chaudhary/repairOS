'use client';

import { useQuery } from '@tanstack/react-query';
import { financeApi, type CashBookEntry } from '@/lib/api/finance';
import { qk } from '@/lib/query/keys';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/EmptyState';
import { formatDate } from '@/lib/format/date';

const inr = (v: number | string) => `₹${Number(v).toLocaleString('en-IN')}`;

export default function CashBookPage() {
  const { data, isLoading } = useQuery({
    queryKey: qk.cashBook(),
    queryFn: () => financeApi.getCashBook(),
    staleTime: 60_000,
  });

  if (isLoading) return <div className="p-4 md:p-6"><Skeleton className="h-40 w-full" /></div>;

  const rows: CashBookEntry[] = data?.results ?? [];

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-4xl mx-auto">
      <div className="flex items-center justify-between">
        <h2 className="text-h2 text-[var(--text)]">Cash Book</h2>
        <div className="text-body-sm text-[var(--text-muted)]">
          Closing: <span className="font-semibold text-[var(--text)]">{inr(data?.closing_balance ?? '0')}</span>
        </div>
      </div>

      <div className="rounded-lg border border-[var(--border)] overflow-x-auto">
        <table className="w-full text-body-sm">
          <thead className="bg-[var(--surface-2)] text-[var(--text-muted)]">
            <tr>
              <th className="text-left px-4 py-2 font-medium">Date</th>
              <th className="text-left px-4 py-2 font-medium">Particulars</th>
              <th className="text-right px-4 py-2 font-medium">Debit</th>
              <th className="text-right px-4 py-2 font-medium">Credit</th>
              <th className="text-right px-4 py-2 font-medium">Balance</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border)]">
            <tr className="bg-[var(--surface-2)]/40">
              <td className="px-4 py-2 text-[var(--text-muted)]" colSpan={4}>Opening balance</td>
              <td className="px-4 py-2 text-right font-medium">{inr(data?.opening_balance ?? '0')}</td>
            </tr>
            {rows.map((r) => (
              <tr key={r.id} className="bg-[var(--surface)]">
                <td className="px-4 py-2">{formatDate(r.date)}</td>
                <td className="px-4 py-2 text-[var(--text)]">{r.category || r.description || '—'}</td>
                <td className="px-4 py-2 text-right text-[var(--danger)]">
                  {r.txn_type === 'debit' ? inr(r.amount) : ''}
                </td>
                <td className="px-4 py-2 text-right text-[var(--success)]">
                  {r.txn_type === 'credit' ? inr(r.amount) : ''}
                </td>
                <td className="px-4 py-2 text-right font-medium">{inr(r.balance_after)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && (
          <div className="p-6"><EmptyState title="No cash movements" description="No petty-cash transactions in range." /></div>
        )}
      </div>
    </div>
  );
}
