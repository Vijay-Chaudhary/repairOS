'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Money } from '@/components/shared/Money';
import { posApi, REFUND_METHOD_LABELS, type Sale, type RefundMethod } from '@/lib/api/pos';
import { qk } from '@/lib/query/keys';
import { ApiError } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface ReturnDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  sale: Sale;
}

interface ReturnLine {
  sale_item_id: string;
  quantity: number;
  maxQty: number;
  checked: boolean;
}

export function ReturnDialog({ open, onOpenChange, sale }: ReturnDialogProps) {
  const queryClient = useQueryClient();

  const [lines, setLines] = useState<ReturnLine[]>(
    (sale.items ?? []).map((i) => ({
      sale_item_id: i.id,
      quantity: i.quantity,
      maxQty: i.quantity,
      checked: false,
    })),
  );
  const [reason, setReason] = useState('');
  const [refundMethod, setRefundMethod] = useState<RefundMethod>('cash');

  const mutation = useMutation({
    mutationFn: () =>
      posApi.createReturn(sale.id, {
        items: lines.filter((l) => l.checked).map((l) => ({
          sale_item_id: l.sale_item_id,
          quantity: l.quantity,
        })),
        reason,
        refund_method: refundMethod,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.posSale(sale.id) });
      queryClient.invalidateQueries({ queryKey: qk.posSales() });
      toast.success('Return request submitted — pending approval');
      onOpenChange(false);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Return failed'),
  });

  const selectedItems = lines.filter((l) => l.checked);
  const canSubmit = selectedItems.length > 0 && reason.trim().length > 0;

  function toggleLine(id: string) {
    setLines((prev) => prev.map((l) => l.sale_item_id === id ? { ...l, checked: !l.checked } : l));
  }

  function setQty(id: string, qty: number) {
    setLines((prev) => prev.map((l) => l.sale_item_id === id ? { ...l, quantity: Math.max(1, Math.min(qty, l.maxQty)) } : l));
  }

  const saleItems = sale.items ?? [];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Return — {sale.sale_number}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          {/* Item selection */}
          <div className="space-y-2">
            <p className="text-body-sm font-semibold text-[var(--text)]">Select items to return</p>
            {saleItems.map((item, i) => {
              const line = lines[i];
              if (!line) return null;
              return (
                <label
                  key={item.id}
                  className={cn(
                    'flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors',
                    line.checked
                      ? 'border-[var(--accent)] bg-[var(--accent)]/5'
                      : 'border-[var(--border)] hover:border-[var(--accent)]/50',
                  )}
                >
                  <input
                    type="checkbox"
                    checked={line.checked}
                    onChange={() => toggleLine(item.id)}
                    className="rounded border-[var(--border)]"
                  />
                  <div className="flex-1 min-w-0">
                    <p className="text-body-sm font-medium text-[var(--text)] truncate">{item.product_name_snapshot}</p>
                    <p className="text-xs text-[var(--text-muted)]">
                      Purchased: {item.quantity} · <Money amount={item.line_total} className="text-xs" />
                    </p>
                  </div>
                  {line.checked && (
                    <div className="flex items-center gap-1 shrink-0">
                      <span className="text-xs text-[var(--text-muted)]">Qty:</span>
                      <Input
                        type="number"
                        min={1}
                        max={line.maxQty}
                        value={line.quantity}
                        onChange={(e) => setQty(item.id, parseInt(e.target.value, 10) || 1)}
                        className="h-8 w-16 text-center text-sm"
                        onClick={(e) => e.preventDefault()}
                      />
                    </div>
                  )}
                </label>
              );
            })}
          </div>

          {/* Reason */}
          <div>
            <label className="text-body-sm font-medium text-[var(--text)] block mb-1">
              Reason <span className="text-[var(--danger)]">*</span>
            </label>
            <Input
              placeholder="Defective, wrong item, customer changed mind…"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </div>

          {/* Refund method */}
          <div>
            <label className="text-body-sm font-medium text-[var(--text)] block mb-1">Refund method</label>
            <Select value={refundMethod} onValueChange={(v) => setRefundMethod(v as RefundMethod)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {(Object.keys(REFUND_METHOD_LABELS) as RefundMethod[]).map((m) => (
                  <SelectItem key={m} value={m}>{REFUND_METHOD_LABELS[m]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {selectedItems.length > 0 && (
            <div className="rounded-lg bg-[var(--surface-2)] px-4 py-3">
              <p className="text-body-sm font-medium text-[var(--text)]">
                {selectedItems.length} item{selectedItems.length !== 1 ? 's' : ''} selected for return
              </p>
              <p className="text-xs text-[var(--text-muted)] mt-0.5">
                Return will be submitted for approval. Stock is restocked on approval.
              </p>
            </div>
          )}

          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button
              className="flex-1"
              disabled={!canSubmit || mutation.isPending}
              onClick={() => mutation.mutate()}
            >
              {mutation.isPending ? 'Submitting…' : 'Submit return'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
