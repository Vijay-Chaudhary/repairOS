'use client';

import { useQuery } from '@tanstack/react-query';
import { billingApi, type AgingBucket } from '@/lib/api/billing';
import { qk } from '@/lib/query/keys';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/EmptyState';
import { formatDate } from '@/lib/format/date';

const BUCKETS: AgingBucket[] = ['current', '1-30', '31-60', '61-90', '90+'];
const BUCKET_LABELS: Record<AgingBucket, string> = {
  current: 'Current', '1-30': '1–30d', '31-60': '31–60d', '61-90': '61–90d', '90+': '90d+',
};
const inr = (v: string) => `₹${Number(v).toLocaleString('en-IN')}`;

export default function OutstandingPage() {
  const { data, isLoading } = useQuery({
    queryKey: qk.outstanding(),
    queryFn: () => billingApi.getOutstanding(),
    staleTime: 60_000,
  });

  if (isLoading) return <div className="p-4 md:p-6"><Skeleton className="h-40 w-full" /></div>;

  const summary = data?.summary;
  const rows = data?.results ?? [];

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-h1 text-[var(--text)]">Outstanding</h1>
        <p className="text-body-sm text-[var(--text-muted)] mt-1">
          {summary?.invoice_count ?? 0} unpaid invoice{(summary?.invoice_count ?? 0) === 1 ? '' : 's'}
          {summary ? ` · ${inr(summary.total_outstanding)} due` : ''}
        </p>
      </div>

      {/* Aging strip */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {BUCKETS.map((b) => (
          <div key={b} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3">
            <p className="text-xs text-[var(--text-muted)]">{BUCKET_LABELS[b]}</p>
            <p className="text-body font-semibold text-[var(--text)] mt-1">
              {summary ? inr(summary.buckets[b]) : '—'}
            </p>
          </div>
        ))}
      </div>

      {rows.length === 0 ? (
        <EmptyState title="Nothing outstanding" description="All invoices are fully paid." />
      ) : (
        <div className="rounded-lg border border-[var(--border)] overflow-x-auto">
          <table className="w-full text-body-sm">
            <thead className="bg-[var(--surface-2)] text-[var(--text-muted)]">
              <tr>
                <th className="text-left px-4 py-2 font-medium">Invoice</th>
                <th className="text-left px-4 py-2 font-medium">Customer</th>
                <th className="text-right px-4 py-2 font-medium">Total</th>
                <th className="text-right px-4 py-2 font-medium">Outstanding</th>
                <th className="text-left px-4 py-2 font-medium">Due</th>
                <th className="text-right px-4 py-2 font-medium">Overdue</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--border)]">
              {rows.map((r) => (
                <tr key={r.id} className="bg-[var(--surface)]">
                  <td className="px-4 py-2 font-medium text-[var(--text)]">{r.invoice_number}</td>
                  <td className="px-4 py-2 text-[var(--text)]">{r.customer_name}</td>
                  <td className="px-4 py-2 text-right">{inr(r.grand_total)}</td>
                  <td className="px-4 py-2 text-right font-medium text-[var(--danger)]">{inr(r.amount_outstanding)}</td>
                  <td className="px-4 py-2">{r.due_date ? formatDate(r.due_date) : '—'}</td>
                  <td className="px-4 py-2 text-right">{r.days_overdue > 0 ? `${r.days_overdue}d` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
