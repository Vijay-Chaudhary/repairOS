'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, ShoppingBag, Send } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/shared/EmptyState';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Money } from '@/components/shared/Money';
import { Can } from '@/components/shared/Can';
import { GrnReceiveForm } from '@/components/procurement/GrnReceiveForm';
import { procurementApi, PO_STATUS_LABELS } from '@/lib/api/procurement';
import { qk } from '@/lib/query/keys';
import { ApiError } from '@/lib/api/client';
import { formatDate } from '@/lib/format/date';
import { cn } from '@/lib/utils';

export default function PurchaseOrderDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [showGrn, setShowGrn] = useState(false);

  const { data: po, isLoading } = useQuery({
    queryKey: qk.purchaseOrder(id),
    queryFn: () => procurementApi.getPO(id),
    staleTime: 30_000,
  });

  const sendMutation = useMutation({
    mutationFn: () => procurementApi.updatePO(id, { status: 'sent' }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.purchaseOrder(id) });
      queryClient.invalidateQueries({ queryKey: qk.purchaseOrders() });
      toast.success('PO marked as sent to supplier');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });

  if (isLoading) {
    return <div className="p-4 space-y-3">{[1,2,3].map((i: number) => <Skeleton key={i} className="h-12 w-full" />)}</div>;
  }
  if (!po) {
    return <EmptyState icon={ShoppingBag} title="PO not found" action={{ label: 'Back', onClick: () => router.back() }} />;
  }

  const items: import('@/lib/api/procurement').POItem[] = po.items ?? [];
  const canReceive = ['sent', 'partially_received'].includes(po.status);
  const canSend = po.status === 'draft';
  const isFullyReceived = po.status === 'received';
  const pendingItems = items.filter((i) => i.quantity_ordered > i.quantity_received);

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">
      {/* Nav */}
      <div className="flex items-center gap-3">
        <button onClick={() => router.back()} className="p-1.5 rounded-md hover:bg-[var(--surface-2)] text-[var(--text-muted)]">
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-code text-[var(--text-muted)]">{po.po_number}</span>
            <StatusBadge status={po.status} />
          </div>
          <p className="text-body text-[var(--text)] font-medium mt-0.5">{po.supplier_name}</p>
        </div>
        {canSend && (
          <Can permission="erp.purchase_orders.create">
            <Button size="sm" onClick={() => sendMutation.mutate()} disabled={sendMutation.isPending}>
              <Send className="h-3.5 w-3.5" /> Mark sent
            </Button>
          </Can>
        )}
      </div>

      {/* Meta */}
      <div className="grid grid-cols-2 gap-3 text-body-sm">
        {po.expected_delivery_date && (
          <div className="rounded-lg border border-[var(--border)] px-3 py-2">
            <p className="text-xs text-[var(--text-muted)]">Expected delivery</p>
            <p className="font-medium text-[var(--text)]">{formatDate(po.expected_delivery_date)}</p>
          </div>
        )}
        {po.grand_total != null && (
          <div className="rounded-lg border border-[var(--border)] px-3 py-2">
            <p className="text-xs text-[var(--text-muted)]">Total value</p>
            <Money amount={po.grand_total} className="font-medium text-[var(--text)]" />
          </div>
        )}
      </div>

      {/* Line items */}
      <div>
        <h2 className="text-body-sm font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-3">Items</h2>
        <div className="rounded-lg border border-[var(--border)] overflow-hidden">
          <div className="overflow-x-auto"><table className="w-full min-w-max text-body-sm">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--surface-2)] text-left">
                <th className="px-4 py-2 text-[var(--text-muted)] font-medium">Item</th>
                <th className="px-4 py-2 text-[var(--text-muted)] font-medium text-right">Ordered</th>
                <th className="px-4 py-2 text-[var(--text-muted)] font-medium text-right">Received</th>
                <th className="px-4 py-2 text-[var(--text-muted)] font-medium text-right">Unit cost</th>
                <th className="px-4 py-2 text-[var(--text-muted)] font-medium text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const pending = item.quantity_ordered - item.quantity_received;
                return (
                  <tr key={item.id} className={cn(
                    'border-b border-[var(--border)] last:border-0',
                    pending > 0 && !isFullyReceived ? 'bg-[var(--warning)]/5' : '',
                  )}>
                    <td className="px-4 py-3">
                      <p className="font-medium text-[var(--text)]">{item.product_name}</p>
                      <p className="text-xs text-[var(--text-muted)]">{item.variant_name}</p>
                    </td>
                    <td className="px-4 py-3 text-right font-mono">{item.quantity_ordered}</td>
                    <td className={cn('px-4 py-3 text-right font-mono', pending > 0 ? 'text-[var(--warning)]' : 'text-[var(--success)]')}>
                      {item.quantity_received}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums"><Money amount={item.unit_cost} /></td>
                    <td className="px-4 py-3 text-right tabular-nums font-semibold"><Money amount={item.line_total} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        </div>
      </div>

      {/* GRN section */}
      {canReceive && pendingItems.length > 0 && (
        <Can permission="erp.grn.receive">
          {showGrn ? (
            <div className="space-y-3">
              <h2 className="text-body-sm font-semibold text-[var(--text-muted)] uppercase tracking-wide">Receive goods</h2>
              <GrnReceiveForm
                po={po}
                onSuccess={() => setShowGrn(false)}
                onCancel={() => setShowGrn(false)}
              />
            </div>
          ) : (
            <Button onClick={() => setShowGrn(true)} className="w-full">
              Receive goods (GRN)
            </Button>
          )}
        </Can>
      )}

      {isFullyReceived && (
        <div className="rounded-lg border border-[var(--success)]/30 bg-[var(--success)]/5 px-4 py-3">
          <p className="text-body-sm font-medium text-[var(--success)]">✓ All items fully received</p>
        </div>
      )}
    </div>
  );
}
