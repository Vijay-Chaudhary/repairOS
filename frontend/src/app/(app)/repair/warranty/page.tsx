'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Can } from '@/components/shared/Can';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/EmptyState';
import { repairApi } from '@/lib/api/repair';
import { qk } from '@/lib/query/keys';
import { formatDate } from '@/lib/format/date';
import { cn } from '@/lib/utils';

type Tab = 'active' | 'claims';

export default function WarrantyPage() {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('active');

  const { data, isLoading } = useQuery({
    queryKey: qk.warranty(),
    queryFn: () => repairApi.getWarranty(),
    staleTime: 60_000,
  });

  const active = data?.active ?? [];
  const claims = data?.claims ?? [];

  return (
    <Can permission="repair.warranty.view">
      <div className="flex flex-col h-full">
        <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--surface)]">
          <h1 className="text-h1 text-[var(--text)]">Warranty</h1>
          <p className="text-body-sm text-[var(--text-muted)] mt-0.5">Devices under warranty and warranty claims.</p>
        </div>

        <div className="px-4 pt-3 flex gap-1 border-b border-[var(--border)] bg-[var(--surface)]">
          {(['active', 'claims'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                'px-3 py-2 text-body-sm font-medium border-b-2 -mb-px capitalize',
                tab === t ? 'border-[var(--accent)] text-[var(--accent)]'
                  : 'border-transparent text-[var(--text-muted)] hover:text-[var(--text)]',
              )}
            >
              {t === 'active' ? `Active (${active.length})` : `Claims (${claims.length})`}
            </button>
          ))}
        </div>

        <div className="flex-1 p-4 md:p-6 min-h-0 overflow-auto">
          {isLoading ? (
            <Skeleton className="h-40 w-full" />
          ) : tab === 'active' ? (
            active.length === 0 ? (
              <EmptyState title="No active warranties" description="No devices are currently under warranty." />
            ) : (
              <div className="rounded-lg border border-[var(--border)] overflow-x-auto">
                <table className="w-full text-body-sm">
                  <thead className="bg-[var(--surface-2)] text-[var(--text-muted)]">
                    <tr>
                      <th className="text-left px-4 py-2 font-medium">Job</th>
                      <th className="text-left px-4 py-2 font-medium">Customer</th>
                      <th className="text-left px-4 py-2 font-medium">Device</th>
                      <th className="text-left px-4 py-2 font-medium">Expires</th>
                      <th className="text-right px-4 py-2 font-medium">Days left</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border)]">
                    {active.map((r) => (
                      <tr key={r.job_id} className="bg-[var(--surface)] cursor-pointer hover:bg-[var(--surface-2)]"
                        onClick={() => router.push(`/jobs/${r.job_id}`)}>
                        <td className="px-4 py-2 font-medium text-[var(--text)]">{r.job_number}</td>
                        <td className="px-4 py-2">{r.customer_name}</td>
                        <td className="px-4 py-2">{r.device}</td>
                        <td className="px-4 py-2">{formatDate(r.warranty_expires_at)}</td>
                        <td className={cn('px-4 py-2 text-right font-medium', r.days_remaining <= 7 ? 'text-[var(--danger)]' : 'text-[var(--text)]')}>
                          {r.days_remaining}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : claims.length === 0 ? (
            <EmptyState title="No warranty claims" description="No warranty-claim jobs yet." />
          ) : (
            <div className="rounded-lg border border-[var(--border)] overflow-x-auto">
              <table className="w-full text-body-sm">
                <thead className="bg-[var(--surface-2)] text-[var(--text-muted)]">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium">Job</th>
                    <th className="text-left px-4 py-2 font-medium">Customer</th>
                    <th className="text-left px-4 py-2 font-medium">Device</th>
                    <th className="text-left px-4 py-2 font-medium">Status</th>
                    <th className="text-left px-4 py-2 font-medium">Original job</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--border)]">
                  {claims.map((r) => (
                    <tr key={r.job_id} className="bg-[var(--surface)] cursor-pointer hover:bg-[var(--surface-2)]"
                      onClick={() => router.push(`/jobs/${r.job_id}`)}>
                      <td className="px-4 py-2 font-medium text-[var(--text)]">{r.job_number}</td>
                      <td className="px-4 py-2">{r.customer_name}</td>
                      <td className="px-4 py-2">{r.device}</td>
                      <td className="px-4 py-2">{r.status}</td>
                      <td className="px-4 py-2 text-[var(--text-muted)]">{r.original_job_number ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </Can>
  );
}
