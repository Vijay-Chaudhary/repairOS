'use client';

import { AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Money } from '@/components/shared/Money';
import { Can } from '@/components/shared/Can';
import type { StockRecord } from '@/lib/api/inventory';
import { cn } from '@/lib/utils';

interface StockTableProps {
  records: StockRecord[];
  loading?: boolean;
  onAdjust?: (record: StockRecord) => void;
}

export function StockTable({ records, loading, onAdjust }: StockTableProps) {
  if (loading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="h-14 rounded-lg bg-[var(--surface-2)] animate-pulse" />
        ))}
      </div>
    );
  }

  if (records.length === 0) {
    return (
      <div className="text-center py-12">
        <p className="text-body-sm text-[var(--text-muted)]">No stock records found.</p>
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-[var(--border)] overflow-hidden">
      {/* Desktop table */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-body-sm">
          <thead>
            <tr className="border-b border-[var(--border)] bg-[var(--surface-2)] text-left">
              <th className="px-4 py-3 font-medium text-[var(--text-muted)]">Product / Variant</th>
              <th className="px-4 py-3 font-medium text-[var(--text-muted)]">SKU</th>
              <th className="px-4 py-3 font-medium text-[var(--text-muted)] text-right">In stock</th>
              <th className="px-4 py-3 font-medium text-[var(--text-muted)] text-right">Reorder at</th>
              <th className="px-4 py-3 font-medium text-[var(--text-muted)] text-right">Value</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {records.map((r) => (
              <tr
                key={r.id}
                className={cn(
                  'border-b border-[var(--border)] last:border-0 transition-colors',
                  r.is_low_stock ? 'bg-[var(--warning)]/5' : 'hover:bg-[var(--surface-2)]',
                )}
              >
                <td className="px-4 py-3">
                  <p className="font-medium text-[var(--text)]">{r.product_name}</p>
                  <p className="text-xs text-[var(--text-muted)]">{r.variant_name}</p>
                </td>
                <td className="px-4 py-3 font-mono text-xs text-[var(--text-muted)]">{r.sku}</td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    {r.is_low_stock && (
                      <AlertTriangle className="h-3.5 w-3.5 text-[var(--warning)]" />
                    )}
                    <span className={cn(
                      'font-mono font-semibold tabular-nums',
                      r.quantity_in_stock === 0 ? 'text-[var(--danger)]' : r.is_low_stock ? 'text-[var(--warning)]' : 'text-[var(--text)]',
                    )}>
                      {r.quantity_in_stock}
                    </span>
                  </div>
                </td>
                <td className="px-4 py-3 text-right font-mono text-xs text-[var(--text-muted)]">{r.reorder_level}</td>
                <td className="px-4 py-3 text-right tabular-nums">
                  <Money amount={r.quantity_in_stock * r.cost_price} className="text-body-sm" />
                </td>
                <td className="px-4 py-3 text-right">
                  <Can permission="erp.inventory.adjust">
                    {onAdjust && (
                      <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => onAdjust(r)}>
                        Adjust
                      </Button>
                    )}
                  </Can>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden divide-y divide-[var(--border)]">
        {records.map((r) => (
          <div
            key={r.id}
            className={cn(
              'flex items-center justify-between p-4',
              r.is_low_stock ? 'bg-[var(--warning)]/5' : '',
            )}
          >
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                {r.is_low_stock && <AlertTriangle className="h-3.5 w-3.5 text-[var(--warning)] shrink-0" />}
                <p className="text-body-sm font-medium text-[var(--text)] truncate">{r.product_name}</p>
              </div>
              <p className="text-xs text-[var(--text-muted)]">{r.variant_name} · <span className="font-mono">{r.sku}</span></p>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <span className={cn(
                'font-mono text-body font-semibold',
                r.quantity_in_stock === 0 ? 'text-[var(--danger)]' : r.is_low_stock ? 'text-[var(--warning)]' : 'text-[var(--text)]',
              )}>
                {r.quantity_in_stock}
              </span>
              <Can permission="erp.inventory.adjust">
                {onAdjust && (
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => onAdjust(r)}>
                    Adj
                  </Button>
                )}
              </Can>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
