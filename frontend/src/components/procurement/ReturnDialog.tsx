'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Trash2, Check, ChevronsUpDown, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Money } from '@/components/shared/Money';
import { Can } from '@/components/shared/Can';
import { procurementApi, type PurchaseInvoice, type PurchaseReturn } from '@/lib/api/procurement';
import { inventoryApi, type StockRecord } from '@/lib/api/inventory';
import { qk } from '@/lib/query/keys';
import { useActiveShopStore } from '@/lib/stores/activeShopStore';
import { useDebounce } from '@/lib/hooks/useDebounce';
import { ApiError } from '@/lib/api/client';
import { cn } from '@/lib/utils';

interface ReturnItem {
  variant_id: string;
  variant_label: string;
  quantity: string;
  unit_cost: string;
}

const EMPTY_ITEM: ReturnItem = { variant_id: '', variant_label: '', quantity: '1', unit_cost: '0' };

export interface ReturnDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  invoice: PurchaseInvoice;
}

export function ReturnDialog({ open, onOpenChange, invoice }: ReturnDialogProps) {
  const queryClient = useQueryClient();
  const { activeShopId } = useActiveShopStore();
  const [mode, setMode] = useState<'list' | 'create'>('list');
  const [reason, setReason] = useState('');
  const [items, setItems] = useState<ReturnItem[]>([{ ...EMPTY_ITEM }]);
  const [openPopovers, setOpenPopovers] = useState<Record<number, boolean>>({});
  const [variantQueries, setVariantQueries] = useState<Record<number, string>>({});

  const { data: returns = [], isLoading: returnsLoading } = useQuery({
    queryKey: qk.purchaseReturns(invoice.id),
    queryFn: () => procurementApi.listReturns(invoice.id),
    staleTime: 30_000,
    enabled: open,
  });

  const createMutation = useMutation({
    mutationFn: () =>
      procurementApi.createReturn({
        purchase_invoice_id: invoice.id,
        reason,
        items: items.map((i) => ({
          variant_id: i.variant_id,
          quantity: i.quantity,
          unit_cost: i.unit_cost,
        })),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.purchaseReturns(invoice.id) });
      toast.success('Return created');
      setMode('list');
      setReason('');
      setItems([{ ...EMPTY_ITEM }]);
      setOpenPopovers({});
      setVariantQueries({});
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to create return'),
  });

  const dispatchMutation = useMutation({
    mutationFn: (returnId: string) => procurementApi.dispatchReturn(returnId),
    onSuccess: (ret) => {
      queryClient.invalidateQueries({ queryKey: qk.purchaseReturns(invoice.id) });
      const dn = ret.debit_note_number ?? 'generated';
      toast.success(`Return dispatched — debit note ${dn}`);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Dispatch failed'),
  });

  function addRow() {
    setItems((prev) => [...prev, { ...EMPTY_ITEM }]);
  }

  function removeRow(idx: number) {
    setItems((prev) => prev.filter((_, i) => i !== idx));
    setOpenPopovers((prev) => {
      const next: Record<number, boolean> = {};
      Object.entries(prev).forEach(([k, v]) => {
        const n = Number(k);
        if (n < idx) next[n] = v;
        else if (n > idx) next[n - 1] = v;
      });
      return next;
    });
    setVariantQueries((prev) => {
      const next: Record<number, string> = {};
      Object.entries(prev).forEach(([k, v]) => {
        const n = Number(k);
        if (n < idx) next[n] = v;
        else if (n > idx) next[n - 1] = v;
      });
      return next;
    });
  }

  function updateRow(idx: number, patch: Partial<ReturnItem>) {
    setItems((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  function selectVariant(idx: number, stock: StockRecord) {
    updateRow(idx, {
      variant_id: stock.variant_id,
      variant_label: `${stock.product_name} — ${stock.variant_name}`,
    });
    setOpenPopovers((p) => ({ ...p, [idx]: false }));
  }

  const canSubmit =
    reason.trim().length > 0 &&
    items.length > 0 &&
    items.every((i) => i.variant_id && parseFloat(i.quantity) > 0);

  function handleClose(v: boolean) {
    if (!v) {
      setMode('list');
      setReason('');
      setItems([{ ...EMPTY_ITEM }]);
      setOpenPopovers({});
      setVariantQueries({});
    }
    onOpenChange(v);
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {mode === 'list' ? `Returns — ${invoice.bill_number}` : 'New purchase return'}
          </DialogTitle>
        </DialogHeader>

        {mode === 'list' ? (
          <div className="space-y-4">
            <div className="text-body-sm text-[var(--text-muted)]">
              Supplier:{' '}
              <span className="text-[var(--text)]">{invoice.supplier_name}</span>
              {' · '}
              <Money amount={invoice.grand_total} className="text-[var(--text)]" />
            </div>

            {returnsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-[var(--text-muted)]" />
              </div>
            ) : returns.length === 0 ? (
              <p className="text-body-sm text-[var(--text-muted)] text-center py-6">
                No returns yet
              </p>
            ) : (
              <div className="space-y-2">
                {(returns as PurchaseReturn[]).map((ret) => (
                  <div
                    key={ret.id}
                    className="rounded-lg border border-[var(--border)] px-3 py-2.5 space-y-1.5"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-xs text-[var(--text)]">
                        {ret.return_number}
                      </span>
                      <StatusBadge status={ret.status} />
                    </div>
                    <div className="flex items-center justify-between gap-2 text-body-sm">
                      <Money
                        amount={parseFloat(ret.total_amount)}
                        className="font-medium text-[var(--text)]"
                      />
                      {ret.debit_note_number && (
                        <span className="text-xs text-[var(--text-muted)]">
                          DN: {ret.debit_note_number}
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-[var(--text-muted)] truncate">{ret.reason}</p>
                    {ret.status === 'pending' && (
                      <Can permission="erp.purchase_returns.create">
                        <Button
                          size="sm"
                          variant="outline"
                          className="w-full mt-1"
                          onClick={() => dispatchMutation.mutate(ret.id)}
                          disabled={dispatchMutation.isPending}
                        >
                          {dispatchMutation.isPending ? (
                            <>
                              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Dispatching…
                            </>
                          ) : (
                            'Dispatch (generates debit note)'
                          )}
                        </Button>
                      </Can>
                    )}
                  </div>
                ))}
              </div>
            )}

            <Can permission="erp.purchase_returns.create">
              <Button className="w-full" onClick={() => setMode('create')}>
                <Plus className="h-4 w-4" /> New return
              </Button>
            </Can>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="text-body-sm font-medium text-[var(--text)]">Reason *</label>
              <textarea
                className="mt-1 flex min-h-[72px] w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-body text-[var(--text)] placeholder:text-[var(--text-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] resize-none"
                placeholder="Describe why items are being returned…"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
              />
            </div>

            <div>
              <label className="text-body-sm font-medium text-[var(--text)] mb-2 block">
                Items *
              </label>
              <div className="grid grid-cols-[auto_80px_24px] text-xs text-[var(--text-muted)] mb-1 px-0.5">
                <span>Product / variant</span>
                <span className="text-right pr-1">Qty · Cost</span>
                <span />
              </div>
              <div className="space-y-2">
                {items.map((item, idx) => (
                  <ReturnItemRow
                    key={idx}
                    idx={idx}
                    item={item}
                    shopId={activeShopId}
                    popoverOpen={!!openPopovers[idx]}
                    variantQuery={variantQueries[idx] ?? ''}
                    onPopoverChange={(v) =>
                      setOpenPopovers((p) => ({ ...p, [idx]: v }))
                    }
                    onVariantQueryChange={(q) =>
                      setVariantQueries((p) => ({ ...p, [idx]: q }))
                    }
                    onSelectVariant={(s) => selectVariant(idx, s)}
                    onUpdateRow={(patch) => updateRow(idx, patch)}
                    onRemove={() => removeRow(idx)}
                    canRemove={items.length > 1}
                  />
                ))}
              </div>
              <Button variant="outline" size="sm" className="mt-2" onClick={addRow}>
                <Plus className="h-3.5 w-3.5" /> Add item
              </Button>
            </div>

            <div className="flex gap-2 pt-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => setMode('list')}
                disabled={createMutation.isPending}
              >
                Back
              </Button>
              <Button
                className="flex-1"
                onClick={() => createMutation.mutate()}
                disabled={!canSubmit || createMutation.isPending}
              >
                {createMutation.isPending ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> Submitting…
                  </>
                ) : (
                  'Create return'
                )}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

// ── Sub-component: one line item row ────────────────────────────────────────

interface ReturnItemRowProps {
  idx: number;
  item: ReturnItem;
  shopId: string | null;
  popoverOpen: boolean;
  variantQuery: string;
  onPopoverChange: (v: boolean) => void;
  onVariantQueryChange: (q: string) => void;
  onSelectVariant: (s: StockRecord) => void;
  onUpdateRow: (patch: Partial<ReturnItem>) => void;
  onRemove: () => void;
  canRemove: boolean;
}

function ReturnItemRow({
  item,
  shopId,
  popoverOpen,
  variantQuery,
  onPopoverChange,
  onVariantQueryChange,
  onSelectVariant,
  onUpdateRow,
  onRemove,
  canRemove,
}: ReturnItemRowProps) {
  const debouncedQ = useDebounce(variantQuery, 350);

  const { data: stockData } = useQuery({
    queryKey: ['return-variant-search', shopId, debouncedQ],
    queryFn: () =>
      inventoryApi.listStock({ shop_id: shopId ?? undefined, search: debouncedQ || undefined }),
    staleTime: 30_000,
    enabled: !!(popoverOpen && shopId),
  });
  const stockItems = stockData?.items ?? [];

  return (
    <div className="grid grid-cols-[1fr_76px_76px_28px] gap-1.5 items-start">
      {/* Variant picker */}
      <Popover open={popoverOpen} onOpenChange={onPopoverChange}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={cn(
              'h-9 w-full flex items-center justify-between rounded-md border border-[var(--border)]',
              'bg-[var(--surface)] px-3 text-body-sm hover:border-[var(--accent)]',
              'focus:outline-none focus:ring-1 focus:ring-[var(--accent)]',
              !item.variant_label && 'text-[var(--text-muted)]',
            )}
          >
            <span className="truncate">
              {item.variant_label || 'Search product…'}
            </span>
            <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 ml-1 text-[var(--text-muted)]" />
          </button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-2" align="start">
          <Input
            placeholder="Search by name or SKU…"
            value={variantQuery}
            onChange={(e) => onVariantQueryChange(e.target.value)}
            className="mb-2 h-8 text-body-sm"
            autoFocus
          />
          <div className="max-h-40 overflow-y-auto space-y-0.5">
            {stockItems.length === 0 ? (
              <p className="text-xs text-[var(--text-muted)] text-center py-3">
                {variantQuery ? 'No results' : 'Type to search'}
              </p>
            ) : (
              stockItems.slice(0, 20).map((s) => (
                <button
                  key={s.variant_id}
                  type="button"
                  className={cn(
                    'w-full flex items-center gap-2 rounded px-2 py-1.5 text-left',
                    'hover:bg-[var(--surface-2)] text-body-sm',
                    item.variant_id === s.variant_id && 'bg-[var(--surface-2)]',
                  )}
                  onClick={() => onSelectVariant(s)}
                >
                  {item.variant_id === s.variant_id && (
                    <Check className="h-3.5 w-3.5 text-[var(--accent)] shrink-0" />
                  )}
                  <div className="min-w-0">
                    <p className="font-medium truncate text-[var(--text)]">{s.product_name}</p>
                    <p className="text-xs text-[var(--text-muted)] truncate">{s.variant_name}</p>
                  </div>
                </button>
              ))
            )}
          </div>
        </PopoverContent>
      </Popover>

      {/* Quantity */}
      <Input
        type="number"
        min="0.001"
        step="0.001"
        placeholder="Qty"
        value={item.quantity}
        onChange={(e) => onUpdateRow({ quantity: e.target.value })}
        className="h-9 text-body-sm"
      />

      {/* Unit cost */}
      <Input
        type="number"
        min="0"
        step="0.01"
        placeholder="Cost ₹"
        value={item.unit_cost}
        onChange={(e) => onUpdateRow({ unit_cost: e.target.value })}
        className="h-9 text-body-sm"
      />

      {/* Remove */}
      <button
        type="button"
        onClick={onRemove}
        disabled={!canRemove}
        className="h-9 w-7 flex items-center justify-center rounded-md text-[var(--text-muted)] hover:text-[var(--danger)] disabled:opacity-30"
        aria-label="Remove item"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
