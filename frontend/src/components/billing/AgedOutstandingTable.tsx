'use client';

import { useRouter } from 'next/navigation';
import { Money } from '@/components/shared/Money';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { daysOverdue, agingBucket, type Invoice } from '@/lib/api/billing';
import { formatDate } from '@/lib/format/date';
import { formatPhone } from '@/lib/format/phone';
import { cn } from '@/lib/utils';

const BUCKET_ORDER = ['Current', '8–30 days', '31–60 days', '60+ days'];

const BUCKET_COLOR: Record<string, string> = {
  'Current':    'bg-[var(--info)]/10 text-[var(--info)]',
  '8–30 days':  'bg-[var(--warning)]/10 text-[var(--warning)]',
  '31–60 days': 'bg-[var(--danger)]/10 text-[var(--danger)]',
  '60+ days':   'bg-[var(--danger)]/20 text-[var(--danger)] font-semibold',
};

interface AgedOutstandingTableProps {
  invoices: Invoice[];
}

export function AgedOutstandingTable({ invoices }: AgedOutstandingTableProps) {
  const router = useRouter();

  const outstanding = invoices.filter((i) => i.amount_outstanding > 0);

  if (outstanding.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-center">
        <p className="text-h2 text-[var(--success)]">All clear</p>
        <p className="text-body-sm text-[var(--text-muted)] mt-1">No outstanding amounts.</p>
      </div>
    );
  }

  // Group into buckets
  const byBucket: Record<string, Invoice[]> = {};
  for (const inv of outstanding) {
    const days = daysOverdue(inv);
    const bucket = agingBucket(days);
    if (!byBucket[bucket]) byBucket[bucket] = [];
    byBucket[bucket].push(inv);
  }

  // Summary row totals
  const totals = BUCKET_ORDER.map((b) => ({
    bucket: b,
    count: byBucket[b]?.length ?? 0,
    total: (byBucket[b] ?? []).reduce((s, i) => s + i.amount_outstanding, 0),
  }));

  return (
    <div className="space-y-6">
      {/* Summary strip */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {totals.map(({ bucket, count, total }) => (
          <div key={bucket} className={cn('rounded-lg p-3 text-center', BUCKET_COLOR[bucket] ?? '')}>
            <p className="text-xs font-semibold uppercase tracking-wide mb-1">{bucket}</p>
            <p className="text-h2 font-mono tabular-nums"><Money amount={total} className="text-inherit" /></p>
            <p className="text-xs mt-0.5">{count} invoice{count !== 1 ? 's' : ''}</p>
          </div>
        ))}
      </div>

      {/* Per-bucket detail */}
      {BUCKET_ORDER.filter((b) => (byBucket[b]?.length ?? 0) > 0).map((bucket) => (
        <div key={bucket}>
          <h3 className="text-body-sm font-semibold text-[var(--text)] mb-2">{bucket}</h3>
          <div className="rounded-lg border border-[var(--border)] overflow-hidden">
            <table className="w-full text-body-sm">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--surface-2)] text-left">
                  <th className="px-4 py-2 text-[var(--text-muted)] font-medium">Invoice</th>
                  <th className="px-4 py-2 text-[var(--text-muted)] font-medium">Customer</th>
                  <th className="px-4 py-2 text-[var(--text-muted)] font-medium hidden md:table-cell">Due</th>
                  <th className="px-4 py-2 text-[var(--text-muted)] font-medium text-right">Outstanding</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody>
                {byBucket[bucket].map((inv) => {
                  const days = daysOverdue(inv);
                  return (
                    <tr
                      key={inv.id}
                      className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-2)] cursor-pointer transition-colors"
                      onClick={() => router.push(`/invoices/${inv.id}`)}
                    >
                      <td className="px-4 py-3">
                        <p className="font-mono text-xs font-medium text-[var(--text)]">{inv.invoice_number}</p>
                        <StatusBadge status={inv.status} className="mt-0.5 text-[10px]" />
                      </td>
                      <td className="px-4 py-3">
                        <p className="font-medium text-[var(--text)]">{inv.customer_name}</p>
                        {inv.customer_phone && (
                          <p className="text-xs text-[var(--text-muted)]">{formatPhone(inv.customer_phone)}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-[var(--text-muted)] hidden md:table-cell">
                        {inv.due_date ? formatDate(inv.due_date) : '—'}
                        {days > 7 && (
                          <span className="ml-1 text-xs text-[var(--danger)]">({days}d)</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Money amount={inv.amount_outstanding} className="font-semibold tabular-nums text-[var(--danger)]" />
                      </td>
                      <td className="px-4 py-2">
                        <span className="text-xs text-[var(--accent)]">View →</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}
