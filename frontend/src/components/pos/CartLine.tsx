'use client';

import { Trash2, Minus, Plus, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Money } from '@/components/shared/Money';
import { Can } from '@/components/shared/Can';
import type { CartItem } from '@/lib/api/pos';
import { cn } from '@/lib/utils';

interface CartLineProps {
  item: CartItem;
  onUpdateQty: (localId: string, qty: number) => void;
  onUpdateDiscount: (localId: string, discount: number) => void;
  onRemove: (localId: string) => void;
  showPriceEdit?: boolean;
}

export function CartLine({ item, onUpdateQty, onUpdateDiscount, onRemove, showPriceEdit }: CartLineProps) {
  const lineSubtotal = item.quantity * Math.max(0, item.unit_price - item.discount_per_unit);
  const isOverstock = item.quantity > item.stock_quantity;
  const belowCost = item.unit_price < item.cost_price;

  return (
    <div className={cn(
      'flex items-start gap-2 py-3 border-b border-[var(--border)] last:border-0',
      isOverstock && 'bg-[var(--danger)]/5',
    )}>
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-1">
          <div className="min-w-0">
            <p className="text-body-sm font-medium text-[var(--text)] truncate">{item.product_name}</p>
            {item.variant_name && (
              <p className="text-xs text-[var(--text-muted)]">{item.variant_name}</p>
            )}
          </div>
          <Money amount={lineSubtotal} className="text-body-sm font-semibold tabular-nums shrink-0" />
        </div>

        {/* Warnings */}
        {isOverstock && (
          <p className="flex items-center gap-1 text-xs text-[var(--danger)] mt-0.5">
            <AlertTriangle className="h-3 w-3" />
            Only {item.stock_quantity} available
          </p>
        )}
        {belowCost && (
          <p className="text-xs text-[var(--warning)] mt-0.5">⚠ Below cost price</p>
        )}

        <div className="flex items-center gap-2 mt-2 flex-wrap">
          {/* Qty stepper */}
          <div className="flex items-center gap-1 rounded-md border border-[var(--border)]">
            <button
              className="h-7 w-7 flex items-center justify-center hover:bg-[var(--surface-2)] transition-colors rounded-l-md"
              onClick={() => onUpdateQty(item.localId, Math.max(1, item.quantity - 1))}
            >
              <Minus className="h-3 w-3" />
            </button>
            <Input
              type="number"
              min={1}
              value={item.quantity}
              onChange={(e) => onUpdateQty(item.localId, Math.max(1, parseInt(e.target.value, 10) || 1))}
              className="h-7 w-12 border-0 text-center text-body-sm p-0 focus-visible:ring-0"
            />
            <button
              className="h-7 w-7 flex items-center justify-center hover:bg-[var(--surface-2)] transition-colors rounded-r-md"
              onClick={() => onUpdateQty(item.localId, item.quantity + 1)}
            >
              <Plus className="h-3 w-3" />
            </button>
          </div>

          {/* Per-line discount */}
          <Can permission="pos.discount.apply">
            <div className="flex items-center gap-1">
              <span className="text-xs text-[var(--text-muted)]">Disc/unit ₹</span>
              <Input
                type="number"
                min={0}
                max={item.unit_price}
                value={item.discount_per_unit || ''}
                placeholder="0"
                onChange={(e) => onUpdateDiscount(item.localId, Math.min(item.unit_price, parseFloat(e.target.value) || 0))}
                className="h-7 w-16 text-body-sm text-right px-2"
              />
            </div>
          </Can>

          <p className="text-xs text-[var(--text-muted)] ml-auto">
            {money(item.unit_price)}{item.tax_rate > 0 ? ` +${item.tax_rate}%` : ''}
          </p>
        </div>
      </div>

      <button
        onClick={() => onRemove(item.localId)}
        className="shrink-0 mt-0.5 p-1.5 rounded-md hover:bg-[var(--danger)]/10 text-[var(--text-muted)] hover:text-[var(--danger)] transition-colors"
      >
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}

// Tiny helper used inside CartLine (avoids another import)
function money(n: number) {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 }).format(n);
}
