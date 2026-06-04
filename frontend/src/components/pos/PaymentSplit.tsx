'use client';

import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MoneyInput } from '@/components/shared/MoneyInput';
import { Money } from '@/components/shared/Money';
import { SALE_PAYMENT_METHOD_LABELS, type CartPayment, type SalePaymentMethod, type SaleType } from '@/lib/api/pos';
import { cn } from '@/lib/utils';

const METHODS_FOR_COUNTER: SalePaymentMethod[] = ['cash', 'upi', 'card', 'cheque', 'neft', 'other'];
const METHODS_FOR_WHOLESALE: SalePaymentMethod[] = ['cash', 'upi', 'card', 'cheque', 'neft', 'credit', 'other'];

interface PaymentSplitProps {
  grandTotal: number;
  payments: CartPayment[];
  saleType: SaleType;
  onChange: (payments: CartPayment[]) => void;
}

export function PaymentSplit({ grandTotal, payments, saleType, onChange }: PaymentSplitProps) {
  const totalPaid = payments.reduce((s, p) => s + p.amount, 0);
  const remaining = grandTotal - totalPaid;
  const isValid = saleType === 'wholesale' ? true : totalPaid >= grandTotal;
  const methods = saleType === 'wholesale' ? METHODS_FOR_WHOLESALE : METHODS_FOR_COUNTER;

  function addPayment() {
    const newId = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    const autoAmount = Math.max(0, remaining);
    onChange([...payments, { localId: newId, method: 'cash', amount: autoAmount, reference_id: '' }]);
  }

  function update(localId: string, field: keyof CartPayment, value: string | number) {
    onChange(payments.map((p) => p.localId === localId ? { ...p, [field]: value } : p));
  }

  function remove(localId: string) {
    if (payments.length === 1) return;
    onChange(payments.filter((p) => p.localId !== localId));
  }

  const showReference = (method: SalePaymentMethod) => method !== 'cash' && method !== 'credit';

  return (
    <div className="space-y-3">
      {payments.map((p, index) => (
        <div key={p.localId} className="space-y-2">
          <div className="flex items-center gap-2">
            <Select value={p.method} onValueChange={(v) => update(p.localId, 'method', v)}>
              <SelectTrigger className="flex-1 h-10">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {methods.map((m) => (
                  <SelectItem key={m} value={m}>{SALE_PAYMENT_METHOD_LABELS[m]}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            <MoneyInput
              value={p.amount}
              onChange={(v) => update(p.localId, 'amount', v)}
              className="flex-1 h-10"
            />

            {payments.length > 1 && (
              <button
                onClick={() => remove(p.localId)}
                className="shrink-0 p-2 rounded-md hover:bg-[var(--danger)]/10 text-[var(--text-muted)] hover:text-[var(--danger)]"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            )}
          </div>

          {showReference(p.method) && (
            <Input
              placeholder="Reference / UTR / cheque #"
              className="h-9 text-sm font-mono"
              value={p.reference_id}
              onChange={(e) => update(p.localId, 'reference_id', e.target.value)}
            />
          )}
        </div>
      ))}

      <Button variant="ghost" size="sm" className="w-full text-[var(--text-muted)]" onClick={addPayment}>
        <Plus className="h-3.5 w-3.5" /> Add payment method
      </Button>

      {/* Totals */}
      <div className="rounded-lg bg-[var(--surface-2)] px-4 py-3 space-y-1">
        <div className="flex justify-between text-body-sm text-[var(--text-muted)]">
          <span>Total to pay</span>
          <Money amount={grandTotal} className="tabular-nums" />
        </div>
        <div className="flex justify-between text-body-sm text-[var(--text-muted)]">
          <span>Entered</span>
          <Money amount={totalPaid} className="tabular-nums" />
        </div>
        {remaining !== 0 && (
          <div className={cn(
            'flex justify-between text-body-sm font-semibold',
            remaining > 0 ? 'text-[var(--danger)]' : 'text-[var(--success)]',
          )}>
            <span>{remaining > 0 ? 'Remaining' : 'Change'}</span>
            <Money amount={Math.abs(remaining)} className="tabular-nums text-inherit" />
          </div>
        )}
        {!isValid && remaining > 0 && (
          <p className="text-xs text-[var(--danger)]">Enter full amount to charge</p>
        )}
        {saleType === 'wholesale' && remaining > 0 && (
          <p className="text-xs text-[var(--info)]">Remaining will be recorded as credit outstanding</p>
        )}
      </div>
    </div>
  );
}
