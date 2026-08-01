'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/EmptyState';
import { Money } from '@/components/shared/Money';
import { Can } from '@/components/shared/Can';
import { posApi, type ReturnStatus } from '@/lib/api/pos';
import { qk } from '@/lib/query/keys';
import { ApiError } from '@/lib/api/client';
import { formatDate } from '@/lib/format/date';
import { cn } from '@/lib/utils';

const RETURN_STATUS_STYLE: Record<ReturnStatus, string> = {
  pending:  'bg-[var(--warning)]/15 text-[var(--warning)]',
  approved: 'bg-[var(--success)]/15 text-[var(--success)]',
  rejected: 'bg-[var(--danger)]/15 text-[var(--danger)]',
};

const FILTERS: Array<{ label: string; value: ReturnStatus | 'all' }> = [
  { label: 'All',      value: 'all' },
  { label: 'Pending',  value: 'pending' },
  { label: 'Approved', value: 'approved' },
  { label: 'Rejected', value: 'rejected' },
];

export default function SalesReturnsPage() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<ReturnStatus | 'all'>('all');

  const { data, isLoading } = useQuery({
    queryKey: qk.salesReturns(statusFilter),
    queryFn: () =>
      posApi.listReturns(statusFilter === 'all' ? undefined : { status: statusFilter }),
    staleTime: 30_000,
  });

  const reviewMutation = useMutation({
    mutationFn: ({ returnId, status }: { returnId: string; status: 'approved' | 'rejected' }) =>
      posApi.reviewReturn(returnId, status),
    onSuccess: (ret) => {
      queryClient.invalidateQueries({ queryKey: ['sales-returns'] });
      queryClient.invalidateQueries({ queryKey: qk.posSale(ret.sale_id) });
      toast.success(`Return ${ret.status}`);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to review return'),
  });

  const rows = data ?? [];

  return (
    <Can permission="pos.returns.view">
      <div className="p-4 md:p-6 space-y-4 max-w-5xl mx-auto">
        <div>
          <h1 className="text-h1 text-[var(--text)]">Sales Returns</h1>
          <p className="text-body-sm text-[var(--text-muted)] mt-1">
            Goods returned by customers. Raise a return from the sale it belongs to.
          </p>
        </div>

        <div className="flex gap-2 overflow-x-auto">
          {FILTERS.map((f) => (
            <Button
              key={f.value}
              size="sm"
              variant={statusFilter === f.value ? 'default' : 'outline'}
              onClick={() => setStatusFilter(f.value)}
            >
              {f.label}
            </Button>
          ))}
        </div>

        {isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : rows.length === 0 ? (
          <EmptyState
            title="No sales returns"
            description="Returns raised against counter or wholesale sales appear here."
          />
        ) : (
          <div className="rounded-lg border border-[var(--border)] overflow-x-auto">
            <table className="w-full text-body-sm">
              <thead className="bg-[var(--surface-2)] text-[var(--text-muted)]">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Return</th>
                  <th className="text-left px-4 py-2 font-medium">Sale</th>
                  <th className="text-right px-4 py-2 font-medium">Refund</th>
                  <th className="text-left px-4 py-2 font-medium">Status</th>
                  <th className="text-left px-4 py-2 font-medium">Credit note</th>
                  <th className="text-left px-4 py-2 font-medium">Date</th>
                  <th className="text-right px-4 py-2 font-medium">Review</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {rows.map((r) => (
                  <tr key={r.id} className="bg-[var(--surface)]">
                    <td className="px-4 py-2 font-medium text-[var(--text)]">
                      {r.return_number}
                      <span className="block text-xs text-[var(--text-muted)]">{r.reason}</span>
                    </td>
                    <td className="px-4 py-2">
                      <Link
                        href={`/sales/${r.sale_id}`}
                        className="text-[var(--primary)] hover:underline"
                      >
                        {r.sale_number ?? 'View sale'}
                      </Link>
                    </td>
                    <td className="px-4 py-2 text-right">
                      <Money amount={r.total_refund_amount} />
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={cn(
                          'inline-block px-2 py-0.5 rounded-full text-xs capitalize',
                          RETURN_STATUS_STYLE[r.status],
                        )}
                      >
                        {r.status}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-[var(--text-muted)]">
                      {r.credit_note_number ?? '—'}
                    </td>
                    <td className="px-4 py-2 text-[var(--text-muted)]">
                      {r.created_at ? formatDate(r.created_at) : '—'}
                    </td>
                    <td className="px-4 py-2">
                      {r.status === 'pending' ? (
                        <Can permission="pos.returns.approve">
                          <div className="flex gap-2 justify-end">
                            <Button
                              size="sm"
                              variant="outline"
                              aria-label={`Reject ${r.return_number}`}
                              className="text-[var(--danger)] border-[var(--danger)]/30 hover:bg-[var(--danger)]/10"
                              onClick={() =>
                                reviewMutation.mutate({ returnId: r.id, status: 'rejected' })
                              }
                              disabled={reviewMutation.isPending}
                            >
                              <X className="h-3.5 w-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              aria-label={`Approve ${r.return_number}`}
                              className="bg-[var(--success)] hover:bg-[var(--success)]/90"
                              onClick={() =>
                                reviewMutation.mutate({ returnId: r.id, status: 'approved' })
                              }
                              disabled={reviewMutation.isPending}
                            >
                              <Check className="h-3.5 w-3.5" />
                              Approve
                            </Button>
                          </div>
                        </Can>
                      ) : (
                        <span className="block text-right text-xs text-[var(--text-muted)]">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Can>
  );
}
