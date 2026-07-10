'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Users, Pencil } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/shared/EmptyState';
import { Money } from '@/components/shared/Money';
import { Can } from '@/components/shared/Can';
import { SupplierForm } from '@/components/procurement/SupplierForm';
import { procurementApi } from '@/lib/api/procurement';
import { qk } from '@/lib/query/keys';
import { formatDate } from '@/lib/format/date';
import { cn } from '@/lib/utils';

export default function SupplierLedgerPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);

  const { data: supplier, isLoading } = useQuery({
    queryKey: qk.supplier(id),
    queryFn: () => procurementApi.getSupplier(id),
    staleTime: 60_000,
  });

  const { data: ledger, isLoading: ledgerLoading } = useQuery({
    queryKey: ['supplier-ledger', id],
    queryFn: () => procurementApi.getSupplierLedger(id),
    staleTime: 30_000,
    enabled: !!supplier,
  });

  if (isLoading) {
    return <div className="p-4 space-y-3">{[1,2,3].map(i => <Skeleton key={i} className="h-12 w-full" />)}</div>;
  }
  if (!supplier) {
    return <EmptyState icon={Users} title="Supplier not found" action={{ label: 'Back', onClick: () => router.back() }} />;
  }

  const balance = ledger?.balance ?? 0;
  const entries: import('@/lib/api/procurement').SupplierLedgerEntry[] = ledger?.items ?? [];

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
      {/* Nav */}
      <div className="flex items-center gap-3">
        <button onClick={() => router.back()} className="p-1.5 rounded-md hover:bg-[var(--surface-2)] text-[var(--text-muted)]">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex-1">
          <h1 className="text-h1 text-[var(--text)]">{supplier.name}</h1>
          <p className="text-body-sm text-[var(--text-muted)]">{supplier.phone}{supplier.gstin ? ` · ${supplier.gstin}` : ''}</p>
        </div>
        <Can permission="erp.suppliers.manage">
          <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
        </Can>
      </div>

      {/* Balance card */}
      <div className={cn(
        'rounded-xl border p-5 flex items-center justify-between',
        balance > 0 ? 'border-[var(--danger)]/30 bg-[var(--danger)]/5' : 'border-[var(--border)] bg-[var(--surface)]',
      )}>
        <div>
          <p className="text-body-sm text-[var(--text-muted)]">Balance payable</p>
          <p className="text-h1 font-mono font-bold">
            <Money amount={balance} className={cn('text-inherit', balance > 0 ? 'text-[var(--danger)]' : 'text-[var(--text)]')} />
          </p>
        </div>
        <div className="text-right text-body-sm text-[var(--text-muted)]">
          <p>Terms: {supplier.payment_terms_days} days</p>
          {supplier.state && <p>State: {supplier.state} ({supplier.state_code})</p>}
        </div>
      </div>

      {/* Ledger */}
      <div>
        <h2 className="text-body-sm font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-3">Transaction ledger</h2>
        {ledgerLoading ? (
          <div className="space-y-2">{[1,2,3].map(i => <Skeleton key={i} className="h-12" />)}</div>
        ) : entries.length === 0 ? (
          <p className="text-body-sm text-[var(--text-muted)] py-8 text-center">No transactions yet.</p>
        ) : (
          <div className="rounded-lg border border-[var(--border)] overflow-hidden">
            <div className="overflow-x-auto"><table className="w-full min-w-max text-body-sm">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--surface-2)] text-left">
                  <th className="px-4 py-2 text-[var(--text-muted)] font-medium">Date</th>
                  <th className="px-4 py-2 text-[var(--text-muted)] font-medium">Reference</th>
                  <th className="px-4 py-2 text-[var(--text-muted)] font-medium text-right">Debit (bill)</th>
                  <th className="px-4 py-2 text-[var(--text-muted)] font-medium text-right">Credit (paid)</th>
                  <th className="px-4 py-2 text-[var(--text-muted)] font-medium text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((e) => (
                  <tr key={e.id} className="border-b border-[var(--border)] last:border-0">
                    <td className="px-4 py-3 text-[var(--text-muted)]">{formatDate(e.date)}</td>
                    <td className="px-4 py-3 font-mono text-xs text-[var(--text)]">{e.reference}</td>
                    <td className="px-4 py-3 text-right">
                      {e.debit > 0 ? <Money amount={e.debit} className="text-[var(--danger)] tabular-nums" /> : '—'}
                    </td>
                    <td className="px-4 py-3 text-right">
                      {e.credit > 0 ? <Money amount={e.credit} className="text-[var(--success)] tabular-nums" /> : '—'}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-semibold">
                      <Money amount={e.balance} className={e.balance > 0 ? 'text-[var(--danger)]' : 'text-[var(--text)]'} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </div>
        )}
      </div>

      <SupplierForm
        open={editOpen}
        onOpenChange={setEditOpen}
        supplier={supplier}
        onSuccess={(s) => { queryClient.setQueryData(qk.supplier(id), s); setEditOpen(false); }}
      />
    </div>
  );
}
