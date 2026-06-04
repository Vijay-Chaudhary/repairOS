import { CheckCircle2 } from 'lucide-react';
import { Money } from '@/components/shared/Money';
import { GstBreakdown } from '@/components/shared/GstBreakdown';
import { SALE_TYPE_LABELS, SALE_PAYMENT_METHOD_LABELS, type Sale } from '@/lib/api/pos';
import { formatDatetime } from '@/lib/format/date';
import { formatPhone } from '@/lib/format/phone';
import { cn } from '@/lib/utils';

interface ReceiptViewProps {
  sale: Sale;
  className?: string;
}

export function ReceiptView({ sale, className }: ReceiptViewProps) {
  const totalGst = sale.cgst + sale.sgst + sale.igst;
  const effectiveRate = sale.subtotal > 0 ? Math.round((totalGst / sale.subtotal) * 100) : 18;
  const isInterState = sale.igst > 0;

  return (
    <div className={cn('space-y-4', className)}>
      {/* Header */}
      <div className="text-center space-y-1">
        <div className="flex items-center justify-center gap-2 text-[var(--success)]">
          <CheckCircle2 className="h-5 w-5" />
          <span className="text-body-sm font-semibold">Sale complete</span>
        </div>
        <p className="font-mono text-code font-semibold text-[var(--text)]">{sale.sale_number}</p>
        <p className="text-xs text-[var(--text-muted)]">{formatDatetime(sale.sale_date)}</p>
        <span className="text-xs bg-[var(--surface-2)] rounded px-2 py-0.5">
          {SALE_TYPE_LABELS[sale.sale_type]}
        </span>
      </div>

      {/* Customer */}
      {sale.customer_name && (
        <div className="rounded-lg border border-[var(--border)] px-4 py-3">
          <p className="text-body-sm font-medium text-[var(--text)]">{sale.customer_name}</p>
          {sale.customer_phone && (
            <p className="text-xs text-[var(--text-muted)]">{formatPhone(sale.customer_phone)}</p>
          )}
        </div>
      )}

      {/* Line items */}
      <div className="space-y-2">
        {(sale.items ?? []).map((item) => (
          <div key={item.id} className="flex items-start justify-between gap-3 text-body-sm">
            <div className="min-w-0">
              <p className="text-[var(--text)] font-medium truncate">{item.product_name_snapshot}</p>
              <p className="text-xs text-[var(--text-muted)]">
                {item.variant_name_snapshot && `${item.variant_name_snapshot} · `}
                {item.quantity} × <Money amount={item.unit_price} className="text-xs" />
                {item.discount_per_unit > 0 && (
                  <span className="text-[var(--success)]"> − <Money amount={item.discount_per_unit} className="text-xs text-inherit" />/unit</span>
                )}
              </p>
            </div>
            <Money amount={item.line_total} className="shrink-0 tabular-nums" />
          </div>
        ))}
      </div>

      {/* GST breakdown */}
      <div className="rounded-lg border border-[var(--border)] p-4">
        <GstBreakdown
          subtotal={sale.subtotal}
          gstRate={effectiveRate}
          cgst={isInterState ? undefined : sale.cgst}
          sgst={isInterState ? undefined : sale.sgst}
          igst={isInterState ? sale.igst : undefined}
          total={sale.grand_total}
        />
        {sale.discount_amount > 0 && (
          <div className="flex justify-between text-body-sm text-[var(--success)] mt-1 pt-1 border-t border-[var(--border)]">
            <span>Discount applied</span>
            <Money amount={sale.discount_amount} className="text-inherit tabular-nums" />
          </div>
        )}
      </div>

      {/* Payments */}
      {(sale.payments ?? []).length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">Paid</p>
          {(sale.payments ?? []).map((p) => (
            <div key={p.id} className="flex justify-between text-body-sm">
              <span className="text-[var(--text-muted)]">{SALE_PAYMENT_METHOD_LABELS[p.method]}</span>
              <Money amount={p.amount} className="tabular-nums" />
            </div>
          ))}
        </div>
      )}

      {/* Outstanding */}
      {sale.amount_outstanding > 0 && (
        <div className="flex justify-between text-body-sm font-semibold text-[var(--danger)]">
          <span>Outstanding</span>
          <Money amount={sale.amount_outstanding} className="tabular-nums text-inherit" />
        </div>
      )}
    </div>
  );
}
