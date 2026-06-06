'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCircle2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Money } from '@/components/shared/Money';
import { procurementApi, type PurchaseOrder } from '@/lib/api/procurement';
import { qk } from '@/lib/query/keys';
import { ApiError } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface GrnLine {
  po_item_id: string;
  quantity_received: number;
  quantity_accepted: number;
  quantity_rejected: number;
  rejection_reason: string;
}

interface GrnReceiveFormProps {
  po: PurchaseOrder;
  onSuccess: () => void;
  onCancel: () => void;
}

export function GrnReceiveForm({ po, onSuccess, onCancel }: GrnReceiveFormProps) {
  const queryClient = useQueryClient();
  const items = po.items ?? [];

  const [challanNumber, setChallanNumber] = useState('');
  const [receivedDate, setReceivedDate] = useState(new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<GrnLine[]>(
    items.map((item) => ({
      po_item_id: item.id,
      quantity_received: item.quantity_ordered - item.quantity_received,
      quantity_accepted: item.quantity_ordered - item.quantity_received,
      quantity_rejected: 0,
      rejection_reason: '',
    })),
  );

  const mutation = useMutation({
    mutationFn: () =>
      procurementApi.createGRN({
        po_id: po.id,
        received_date: receivedDate,
        challan_number: challanNumber || undefined,
        notes: notes || undefined,
        items: lines.filter((l) => l.quantity_received > 0),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.purchaseOrder(po.id) });
      queryClient.invalidateQueries({ queryKey: qk.purchaseOrders() });
      queryClient.invalidateQueries({ queryKey: qk.stock() });
      toast.success('Goods receipt recorded — stock updated for accepted items');
      onSuccess();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'GRN failed'),
  });

  function updateLine(poItemId: string, field: keyof GrnLine, value: string | number) {
    setLines((prev) => prev.map((l) => {
      if (l.po_item_id !== poItemId) return l;
      const updated = { ...l, [field]: value };
      if (field === 'quantity_received') {
        updated.quantity_accepted = Math.min(Number(value), updated.quantity_accepted);
        updated.quantity_rejected = Number(value) - updated.quantity_accepted;
      }
      if (field === 'quantity_accepted') {
        const accepted = Math.min(Number(value), updated.quantity_received);
        updated.quantity_accepted = accepted;
        updated.quantity_rejected = updated.quantity_received - accepted;
      }
      return updated;
    }));
  }

  const hasRejectedWithoutReason = lines.some(
    (l) => l.quantity_rejected > 0 && !l.rejection_reason.trim(),
  );
  const totalAccepted = lines.reduce((s, l) => s + l.quantity_accepted, 0);
  const canSubmit = totalAccepted > 0 && !hasRejectedWithoutReason && receivedDate;

  return (
    <div className="space-y-5">
      {/* GRN header */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-body-sm font-medium text-[var(--text)] block mb-1">Received date *</label>
          <Input type="date" value={receivedDate} onChange={(e) => setReceivedDate(e.target.value)} />
        </div>
        <div>
          <label className="text-body-sm font-medium text-[var(--text)] block mb-1">Challan #</label>
          <Input placeholder="CH-9981" value={challanNumber} onChange={(e) => setChallanNumber(e.target.value)} />
        </div>
        <div className="col-span-2">
          <label className="text-body-sm font-medium text-[var(--text)] block mb-1">Notes</label>
          <Input placeholder="Optional notes…" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
      </div>

      {/* Line items */}
      <div className="space-y-3">
        <p className="text-body-sm font-semibold text-[var(--text)]">Items to receive</p>
        {items.map((item, i) => {
          const line = lines[i];
          const pendingQty = item.quantity_ordered - item.quantity_received;
          if (pendingQty <= 0 || !line) return null;

          return (
            <div key={item.id} className={cn(
              'rounded-lg border p-4 space-y-3',
              line.quantity_rejected > 0 ? 'border-[var(--warning)]/40 bg-[var(--warning)]/5' : 'border-[var(--border)]',
            )}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-body-sm font-medium text-[var(--text)]">{item.product_name}</p>
                  <p className="text-xs text-[var(--text-muted)]">{item.variant_name}</p>
                  <p className="text-xs text-[var(--text-muted)]">Ordered: {item.quantity_ordered} · Pending: {pendingQty}</p>
                </div>
                <Money amount={item.unit_cost} className="text-body-sm shrink-0" />
              </div>

              <div className="grid grid-cols-3 gap-2">
                <div>
                  <label className="text-xs text-[var(--text-muted)] mb-1 block">Received</label>
                  <Input
                    type="number" min={0} max={pendingQty}
                    value={line.quantity_received}
                    onChange={(e) => updateLine(item.id, 'quantity_received', Math.min(pendingQty, parseInt(e.target.value, 10) || 0))}
                  />
                </div>
                <div>
                  <label className="flex items-center gap-1 text-xs text-[var(--success)] mb-1">
                    <CheckCircle2 className="h-3 w-3" />Accepted
                  </label>
                  <Input
                    type="number" min={0} max={line.quantity_received}
                    value={line.quantity_accepted}
                    onChange={(e) => updateLine(item.id, 'quantity_accepted', parseInt(e.target.value, 10) || 0)}
                  />
                </div>
                <div>
                  <label className="flex items-center gap-1 text-xs text-[var(--danger)] mb-1">
                    <XCircle className="h-3 w-3" />Rejected
                  </label>
                  <Input type="number" value={line.quantity_rejected} readOnly className="bg-[var(--surface-2)]" />
                </div>
              </div>

              {line.quantity_rejected > 0 && (
                <div>
                  <label className="text-xs text-[var(--text-muted)] mb-1 block">
                    Rejection reason <span className="text-[var(--danger)]">*</span>
                  </label>
                  <Input
                    placeholder="Damaged, wrong item, expired…"
                    value={line.rejection_reason}
                    onChange={(e) => updateLine(item.id, 'rejection_reason', e.target.value)}
                    className={!line.rejection_reason.trim() ? 'border-[var(--danger)]' : ''}
                  />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Summary */}
      {totalAccepted > 0 && (
        <div className="rounded-lg bg-[var(--success)]/10 border border-[var(--success)]/30 px-4 py-3">
          <p className="text-body-sm font-medium text-[var(--success)]">
            {totalAccepted} unit{totalAccepted !== 1 ? 's' : ''} will be added to stock
          </p>
        </div>
      )}

      {hasRejectedWithoutReason && (
        <p className="text-xs text-[var(--danger)]">Provide rejection reason for all rejected items</p>
      )}

      <div className="flex gap-3">
        <Button variant="outline" className="flex-1" onClick={onCancel}>Cancel</Button>
        <Button className="flex-1" disabled={!canSubmit || mutation.isPending} onClick={() => mutation.mutate()}>
          {mutation.isPending ? 'Receiving…' : `Receive goods (${totalAccepted} accepted)`}
        </Button>
      </div>
    </div>
  );
}
