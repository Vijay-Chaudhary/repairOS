import { CheckCircle2 } from 'lucide-react';
import { Money } from '@/components/shared/Money';
import { PAYMENT_METHOD_LABELS, PAYMENT_METHOD_COLORS, type Payment } from '@/lib/api/billing';
import { formatDatetime } from '@/lib/format/date';
import { cn } from '@/lib/utils';

interface PaymentHistoryProps {
  payments: Payment[];
}

export function PaymentHistory({ payments }: PaymentHistoryProps) {
  if (payments.length === 0) {
    return <p className="text-body-sm text-[var(--text-muted)] py-2">No payments recorded yet.</p>;
  }

  return (
    <div className="space-y-2">
      {payments.map((p) => (
        <div key={p.id} className="flex items-start gap-3 p-3 rounded-lg border border-[var(--border)] bg-[var(--surface)]">
          <CheckCircle2 className="h-4 w-4 text-[var(--success)] shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <div className="flex items-center justify-between gap-2">
              <span className={cn(
                'text-xs font-semibold rounded px-1.5 py-0.5',
                PAYMENT_METHOD_COLORS[p.method],
              )}>
                {PAYMENT_METHOD_LABELS[p.method]}
              </span>
              <Money amount={p.amount} className="text-body-sm font-semibold tabular-nums" />
            </div>
            <div className="flex items-center justify-between mt-1 text-xs text-[var(--text-muted)]">
              <span>{formatDatetime(p.paid_at)}</span>
              {p.reference_id && (
                <span className="font-mono truncate max-w-[120px]" title={p.reference_id}>
                  Ref: {p.reference_id}
                </span>
              )}
            </div>
            {p.recorded_by_name && (
              <p className="text-xs text-[var(--text-muted)] mt-0.5">By {p.recorded_by_name}</p>
            )}
            {p.notes && (
              <p className="text-xs text-[var(--text-muted)] mt-0.5 italic">{p.notes}</p>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
