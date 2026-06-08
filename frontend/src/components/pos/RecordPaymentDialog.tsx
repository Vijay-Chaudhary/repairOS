'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MoneyInput } from '@/components/shared/MoneyInput';
import { Money } from '@/components/shared/Money';
import { posApi, SALE_PAYMENT_METHOD_LABELS, type Sale, type SalePaymentMethod } from '@/lib/api/pos';
import { qk } from '@/lib/query/keys';
import { ApiError } from '@/lib/api/client';

const METHODS: SalePaymentMethod[] = ['cash', 'upi', 'card', 'cheque', 'neft', 'other'];

interface RecordPaymentDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  sale: Sale;
}

export function RecordPaymentDialog({ open, onOpenChange, sale }: RecordPaymentDialogProps) {
  const queryClient = useQueryClient();

  const [method, setMethod] = useState<SalePaymentMethod>('cash');
  const [amount, setAmount] = useState(sale.amount_outstanding);
  const [referenceId, setReferenceId] = useState('');

  const showReference = method !== 'cash';

  const mutation = useMutation({
    mutationFn: () =>
      posApi.addPayment(sale.id, {
        method,
        amount,
        reference_id: showReference ? referenceId : undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.posSale(sale.id) });
      queryClient.invalidateQueries({ queryKey: qk.posSales() });
      toast.success('Payment recorded');
      onOpenChange(false);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to record payment'),
  });

  const canSubmit = amount > 0 && amount <= sale.amount_outstanding;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Record payment — {sale.sale_number}</DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          <div className="rounded-lg bg-[var(--surface-2)] px-4 py-3 flex items-center justify-between">
            <span className="text-body-sm text-[var(--text-muted)]">Amount outstanding</span>
            <Money amount={sale.amount_outstanding} className="text-body-sm font-semibold" />
          </div>

          <div>
            <label className="text-body-sm font-medium text-[var(--text)] block mb-1">Method</label>
            <Select value={method} onValueChange={(v) => setMethod(v as SalePaymentMethod)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {METHODS.map((m) => (
                  <SelectItem key={m} value={m}>{SALE_PAYMENT_METHOD_LABELS[m]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="text-body-sm font-medium text-[var(--text)] block mb-1">Amount</label>
            <MoneyInput value={amount} onChange={setAmount} />
            {amount > sale.amount_outstanding && (
              <p className="text-xs text-[var(--danger)] mt-1">Cannot exceed amount outstanding.</p>
            )}
          </div>

          {showReference && (
            <div>
              <label className="text-body-sm font-medium text-[var(--text)] block mb-1">
                Reference / UTR / cheque #
              </label>
              <Input
                placeholder="Reference / UTR / cheque #"
                className="font-mono"
                value={referenceId}
                onChange={(e) => setReferenceId(e.target.value)}
              />
            </div>
          )}

          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button
              className="flex-1"
              disabled={!canSubmit || mutation.isPending}
              onClick={() => mutation.mutate()}
            >
              {mutation.isPending ? 'Recording…' : 'Record payment'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
