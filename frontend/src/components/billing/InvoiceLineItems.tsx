import { money } from '@/lib/format/money';
import { INVOICE_ITEM_TYPE_LABELS, type InvoiceItem } from '@/lib/api/billing';
import { cn } from '@/lib/utils';

const TYPE_BADGE: Record<string, string> = {
  labor:     'bg-[var(--info)]/15 text-[var(--info)]',
  component: 'bg-[var(--accent)]/15 text-[var(--accent)]',
  custom:    'bg-[var(--text-muted)]/15 text-[var(--text-muted)]',
};

interface InvoiceLineItemsProps {
  items: InvoiceItem[];
}

export function InvoiceLineItems({ items }: InvoiceLineItemsProps) {
  if (items.length === 0) {
    return <p className="text-body-sm text-[var(--text-muted)] py-4">No line items.</p>;
  }

  return (
    <div className="overflow-x-auto -mx-4 md:mx-0">
      <table className="w-full min-w-[480px] text-body-sm">
        <thead>
          <tr className="border-b border-[var(--border)] text-left">
            <th className="px-4 py-2 text-[var(--text-muted)] font-medium">Description</th>
            <th className="px-4 py-2 text-[var(--text-muted)] font-medium text-right">Qty</th>
            <th className="px-4 py-2 text-[var(--text-muted)] font-medium text-right">Rate</th>
            <th className="px-4 py-2 text-[var(--text-muted)] font-medium text-right">Tax %</th>
            <th className="px-4 py-2 text-[var(--text-muted)] font-medium text-right">Total</th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => (
            <tr key={item.id} className="border-b border-[var(--border)] last:border-0">
              <td className="px-4 py-3">
                <div className="flex items-start gap-2">
                  <span className={cn(
                    'shrink-0 text-[10px] font-semibold rounded px-1.5 py-0.5 mt-0.5',
                    TYPE_BADGE[item.item_type] ?? TYPE_BADGE.custom,
                  )}>
                    {INVOICE_ITEM_TYPE_LABELS[item.item_type]}
                  </span>
                  <div>
                    <p className="text-[var(--text)] font-medium">{item.description}</p>
                    {(item.sac_code || item.hsn_code) && (
                      <p className="text-xs text-[var(--text-muted)] font-mono">
                        {item.sac_code ? `SAC ${item.sac_code}` : `HSN ${item.hsn_code}`}
                      </p>
                    )}
                  </div>
                </div>
              </td>
              <td className="px-4 py-3 text-right font-mono text-[var(--text)]">{item.quantity}</td>
              <td className="px-4 py-3 text-right tabular-nums text-[var(--text)]">{money(item.unit_price)}</td>
              <td className="px-4 py-3 text-right text-[var(--text-muted)]">{item.tax_rate}%</td>
              <td className="px-4 py-3 text-right tabular-nums font-semibold text-[var(--text)]">{money(item.line_total)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
