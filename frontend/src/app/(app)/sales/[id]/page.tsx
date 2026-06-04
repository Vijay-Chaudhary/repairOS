'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, RotateCcw, Check, X, ShoppingBag } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/shared/EmptyState';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Money } from '@/components/shared/Money';
import { Can } from '@/components/shared/Can';
import { ReceiptView } from '@/components/pos/ReceiptView';
import { ReturnDialog } from '@/components/pos/ReturnDialog';
import { posApi, SALE_TYPE_LABELS, type ReturnStatus } from '@/lib/api/pos';
import { qk } from '@/lib/query/keys';
import { ApiError } from '@/lib/api/client';
import { formatDate } from '@/lib/format/date';
import { cn } from '@/lib/utils';

const RETURN_STATUS_STYLE: Record<ReturnStatus, string> = {
  pending:  'bg-[var(--warning)]/15 text-[var(--warning)]',
  approved: 'bg-[var(--success)]/15 text-[var(--success)]',
  rejected: 'bg-[var(--danger)]/15 text-[var(--danger)]',
};

export default function SaleDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [returnDialogOpen, setReturnDialogOpen] = useState(false);

  const { data: sale, isLoading, error } = useQuery({
    queryKey: qk.posSale(id),
    queryFn: () => posApi.getSale(id),
    staleTime: 30_000,
  });

  const reviewReturnMutation = useMutation({
    mutationFn: ({ returnId, status }: { returnId: string; status: 'approved' | 'rejected' }) =>
      posApi.reviewReturn(returnId, status),
    onSuccess: (ret) => {
      queryClient.invalidateQueries({ queryKey: qk.posSale(id) });
      toast.success(`Return ${ret.status}`);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });

  if (isLoading) {
    return (
      <div className="p-4 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (error || !sale) {
    return (
      <EmptyState
        icon={ShoppingBag}
        title="Sale not found"
        description="This sale doesn't exist or you don't have access."
        action={{ label: 'Back to POS', onClick: () => router.push('/pos') }}
      />
    );
  }

  const returns = sale.returns ?? [];
  const pendingReturns = returns.filter((r) => r.status === 'pending');
  const canReturn = !['cancelled', 'returned'].includes(sale.status);

  return (
    <div className="max-w-lg mx-auto px-4 py-6 space-y-6">
      {/* Nav */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => router.back()}
          className="p-1.5 rounded-md hover:bg-[var(--surface-2)] text-[var(--text-muted)]"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex items-center gap-2">
          <span className="font-mono text-code text-[var(--text-muted)]">{sale.sale_number}</span>
          <StatusBadge status={sale.status} />
          <span className="text-xs text-[var(--text-muted)] bg-[var(--surface-2)] rounded px-1.5 py-0.5">
            {SALE_TYPE_LABELS[sale.sale_type]}
          </span>
        </div>
      </div>

      {/* Receipt */}
      <div className="rounded-xl border border-[var(--border)] p-5">
        <ReceiptView sale={sale} />
      </div>

      {/* Pending return approvals */}
      {pendingReturns.length > 0 && (
        <Can permission="pos.returns.approve">
          <div className="space-y-2">
            <h2 className="text-body-sm font-semibold text-[var(--text)]">Pending returns</h2>
            {pendingReturns.map((ret) => (
              <div key={ret.id} className="flex items-center justify-between p-4 rounded-lg border border-[var(--warning)]/30 bg-[var(--warning)]/5">
                <div>
                  <p className="text-body-sm font-medium text-[var(--text)]">{ret.return_number}</p>
                  <p className="text-xs text-[var(--text-muted)]">{ret.reason}</p>
                  <Money amount={ret.total_refund_amount} className="text-xs font-semibold mt-0.5" />
                </div>
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="text-[var(--danger)] border-[var(--danger)]/30 hover:bg-[var(--danger)]/10"
                    onClick={() => reviewReturnMutation.mutate({ returnId: ret.id, status: 'rejected' })}
                    disabled={reviewReturnMutation.isPending}
                  >
                    <X className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    className="bg-[var(--success)] hover:bg-[var(--success)]/90"
                    onClick={() => reviewReturnMutation.mutate({ returnId: ret.id, status: 'approved' })}
                    disabled={reviewReturnMutation.isPending}
                  >
                    <Check className="h-3.5 w-3.5" />
                    Approve
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Can>
      )}

      {/* Historical returns */}
      {returns.filter((r) => r.status !== 'pending').length > 0 && (
        <div className="space-y-2">
          <h2 className="text-body-sm font-semibold text-[var(--text)]">Returns</h2>
          {returns.filter((r) => r.status !== 'pending').map((ret) => (
            <div key={ret.id} className="flex items-center justify-between p-3 rounded-lg border border-[var(--border)]">
              <div>
                <p className="font-mono text-xs text-[var(--text)]">{ret.return_number}</p>
                <p className="text-xs text-[var(--text-muted)]">{ret.reason}</p>
                {ret.credit_note_number && (
                  <p className="text-xs text-[var(--text-muted)]">Credit note: {ret.credit_note_number}</p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Money amount={ret.total_refund_amount} className="text-xs" />
                <span className={cn(
                  'text-[10px] font-semibold rounded px-1.5 py-0.5 capitalize',
                  RETURN_STATUS_STYLE[ret.status],
                )}>
                  {ret.status}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3">
        {canReturn && (
          <Can permission="pos.returns.create">
            <Button variant="outline" className="flex-1" onClick={() => setReturnDialogOpen(true)}>
              <RotateCcw className="h-4 w-4" /> Return
            </Button>
          </Can>
        )}
        {sale.customer_id && (
          <Button variant="ghost" onClick={() => router.push(`/customers/${sale.customer_id}`)}>
            Customer →
          </Button>
        )}
      </div>

      {/* Return dialog */}
      <ReturnDialog open={returnDialogOpen} onOpenChange={setReturnDialogOpen} sale={sale} />
    </div>
  );
}
