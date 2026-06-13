'use client';

import { useState, useCallback, useMemo } from 'react';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ShoppingCart, WifiOff, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MoneyInput } from '@/components/shared/MoneyInput';
import { Money } from '@/components/shared/Money';
import { GstBreakdown } from '@/components/shared/GstBreakdown';
import { Can } from '@/components/shared/Can';
import { CustomerSearch, type CustomerOption } from '@/components/repair/CustomerSearch';
import { ProductSearch } from '@/components/pos/ProductSearch';
import { CartLine } from '@/components/pos/CartLine';
import { PaymentSplit } from '@/components/pos/PaymentSplit';
import { ReceiptView } from '@/components/pos/ReceiptView';
import {
  posApi, computeCartTotals, SALE_TYPE_LABELS,
  type ProductVariant, type CartItem, type CartPayment,
  type SaleType, type DiscountType, type Sale,
} from '@/lib/api/pos';
import { useActiveShopStore } from '@/lib/stores/activeShopStore';
import { useOfflineQueueStore } from '@/lib/stores/offlineQueueStore';
import { ApiError } from '@/lib/api/client';
import { cn } from '@/lib/utils';

function makeId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
}

const DEFAULT_GST_RATE = 18;

export default function PosPage() {
  const { activeShopId } = useActiveShopStore();
  const { isOnline } = useOfflineQueueStore();

  // ── Cart state ────────────────────────────────────────────────────────────
  const [saleType, setSaleType] = useState<SaleType>('counter');
  const [customer, setCustomer] = useState<CustomerOption | null>(null);
  const [items, setItems] = useState<CartItem[]>([]);
  const [discountType, setDiscountType] = useState<DiscountType>('none');
  const [discountValue, setDiscountValue] = useState(0);
  const [payments, setPayments] = useState<CartPayment[]>([
    { localId: makeId(), method: 'cash', amount: 0, reference_id: '' },
  ]);
  const [completedSale, setCompletedSale] = useState<Sale | null>(null);

  // ── Derived ───────────────────────────────────────────────────────────────
  const totals = useMemo(
    () => computeCartTotals(items, discountType, discountValue),
    [items, discountType, discountValue],
  );

  const totalPaid = payments.reduce((s, p) => s + p.amount, 0);
  const hasOverstock = items.some((i) => i.quantity > i.stock_quantity);
  const canCharge =
    !hasOverstock &&
    items.length > 0 &&
    (saleType === 'wholesale' || totalPaid >= totals.grandTotal) &&
    (saleType !== 'wholesale' || !!customer);

  const effectiveGstRate = totals.subtotal > 0
    ? Math.round((totals.totalTax / totals.taxableBase) * 100)
    : DEFAULT_GST_RATE;

  // ── Handlers ──────────────────────────────────────────────────────────────
  const addToCart = useCallback((variant: ProductVariant) => {
    setItems((prev) => {
      const existing = prev.find((i) => i.variant_id === variant.id);
      if (existing) {
        return prev.map((i) =>
          i.variant_id === variant.id ? { ...i, quantity: i.quantity + 1 } : i,
        );
      }
      const newItem: CartItem = {
        localId: makeId(),
        variant_id: variant.id,
        product_name: variant.product_name,
        variant_name: variant.variant_name,
        hsn_code: variant.hsn_code,
        quantity: 1,
        unit_price: saleType === 'wholesale' ? variant.wholesale_price : variant.selling_price,
        discount_per_unit: 0,
        tax_rate: variant.tax_rate,
        cost_price: variant.cost_price,
        stock_quantity: variant.stock_quantity,
      };
      return [...prev, newItem];
    });
  }, [saleType]);

  const updateQty = useCallback((localId: string, qty: number) => {
    setItems((prev) => prev.map((i) => i.localId === localId ? { ...i, quantity: qty } : i));
  }, []);

  const updateDiscount = useCallback((localId: string, discount: number) => {
    setItems((prev) => prev.map((i) => i.localId === localId ? { ...i, discount_per_unit: discount } : i));
  }, []);

  const removeItem = useCallback((localId: string) => {
    setItems((prev) => prev.filter((i) => i.localId !== localId));
  }, []);

  // Auto-fill payment amount when totals change
  const syncPaymentTotal = useCallback(() => {
    setPayments((prev) => {
      if (prev.length === 1) {
        return [{ ...prev[0], amount: totals.grandTotal }];
      }
      return prev;
    });
  }, [totals.grandTotal]);

  // ── Submit ─────────────────────────────────────────────────────────────────
  const submitMutation = useMutation({
    mutationFn: () => {
      const idempotencyKey = crypto.randomUUID();
      return posApi.createSale(
        {
          shop_id: activeShopId ?? '',
          sale_type: saleType,
          customer_id: customer?.id ?? null,
          items: items.map((i) => ({
            variant_id: i.variant_id,
            product_name_snapshot: i.product_name,
            variant_name_snapshot: i.variant_name ?? '',
            hsn_code: i.hsn_code ?? '',
            tax_rate: i.tax_rate,
            quantity: i.quantity,
            unit_price: i.unit_price,
            discount_per_unit: i.discount_per_unit,
          })),
          discount_type: discountType,
          discount_value: discountValue,
          payments: payments
            .filter((p) => p.amount > 0)
            .map((p) => ({
              method: p.method,
              amount: p.amount,
              reference_id: p.reference_id || undefined,
            })),
        },
        idempotencyKey,
      );
    },
    onSuccess: (sale) => {
      setCompletedSale(sale);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'INSUFFICIENT_STOCK') {
        toast.error(`Insufficient stock: ${e.message}`);
      } else if (e instanceof ApiError && e.code === 'CREDIT_LIMIT_EXCEEDED') {
        toast.error(`Credit limit exceeded: ${e.message}`);
      } else {
        toast.error(e instanceof ApiError ? e.message : 'Sale failed');
      }
    },
  });

  function resetCart() {
    setItems([]);
    setCustomer(null);
    setDiscountType('none');
    setDiscountValue(0);
    setPayments([{ localId: makeId(), method: 'cash', amount: 0, reference_id: '' }]);
    setCompletedSale(null);
  }

  // ── Offline block ─────────────────────────────────────────────────────────
  if (!isOnline) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center">
        <WifiOff className="h-12 w-12 text-[var(--text-muted)]" />
        <h2 className="text-h2 text-[var(--text)]">POS needs a connection</h2>
        <p className="text-body-sm text-[var(--text-muted)] max-w-xs">
          Sales affect stock and financial records — reconnect to use the terminal.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* ── Mode bar ──────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-[var(--border)] bg-[var(--surface)] flex-wrap">
        {/* Sale type */}
        <div className="flex rounded-md border border-[var(--border)] overflow-hidden shrink-0">
          {(['counter', 'wholesale', 'job_linked'] as SaleType[]).map((t) => (
            <Can key={t} permission={t === 'counter' ? 'pos.counter_sale.create' : t === 'wholesale' ? 'pos.wholesale_sale.create' : 'pos.job_sale.create'}>
              <button
                onClick={() => { setSaleType(t); setItems([]); }}
                className={cn(
                  'h-9 px-3 text-xs font-medium transition-colors',
                  saleType === t ? 'bg-[var(--accent)] text-white' : 'text-[var(--text-muted)] hover:bg-[var(--surface-2)]',
                )}
              >
                {SALE_TYPE_LABELS[t]}
              </button>
            </Can>
          ))}
        </div>

        {/* Customer picker */}
        {(saleType === 'wholesale' || saleType === 'job_linked') ? (
          <div className="flex-1 min-w-[200px] max-w-xs">
            <CustomerSearch
              value={customer}
              onChange={setCustomer}
            />
          </div>
        ) : (
          <div className="flex-1 min-w-[200px] max-w-xs">
            <CustomerSearch
              value={customer}
              onChange={setCustomer}
            />
          </div>
        )}
      </div>

      {/* ── Two-pane layout ────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-hidden grid grid-cols-1 md:grid-cols-[1fr_360px] lg:grid-cols-[1fr_420px]">

        {/* Left: Product search */}
        <div className="flex flex-col overflow-hidden border-r border-[var(--border)]">
          <div className="p-4">
            <ProductSearch
              shopId={activeShopId ?? ''}
              saleType={saleType}
              onAddToCart={addToCart}
            />
          </div>

          {/* Cart items — visible on mobile (md hidden) / desktop shows full */}
          <div className="flex-1 overflow-y-auto px-4 pb-4">
            {items.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full gap-3 py-16 text-center">
                <ShoppingCart className="h-12 w-12 text-[var(--text-muted)]" />
                <p className="text-body-sm text-[var(--text-muted)]">Cart empty — search or scan a product</p>
              </div>
            ) : (
              <div>
                {items.map((item) => (
                  <CartLine
                    key={item.localId}
                    item={item}
                    onUpdateQty={updateQty}
                    onUpdateDiscount={updateDiscount}
                    onRemove={removeItem}
                  />
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right: Totals + payment + charge */}
        <div className="flex flex-col overflow-hidden bg-[var(--surface)]">
          <div className="flex-1 overflow-y-auto p-4 space-y-5">
            {/* GST breakdown */}
            {items.length > 0 && (
              <section>
                <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-3">Total</h3>
                <div className="rounded-lg border border-[var(--border)] p-4 space-y-3">
                  <GstBreakdown
                    subtotal={totals.subtotal}
                    gstRate={effectiveGstRate}
                    cgst={totals.cgst}
                    sgst={totals.sgst}
                    total={totals.grandTotal}
                  />

                  {/* Cart-level discount */}
                  <Can permission="pos.discount.apply">
                    <div className="flex items-center gap-2 pt-2 border-t border-[var(--border)]">
                      <Select value={discountType} onValueChange={(v) => setDiscountType(v as DiscountType)}>
                        <SelectTrigger className="h-9 w-[120px]">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">No discount</SelectItem>
                          <SelectItem value="flat">₹ Flat</SelectItem>
                          <SelectItem value="percentage">% Percent</SelectItem>
                        </SelectContent>
                      </Select>
                      {discountType !== 'none' && (
                        <MoneyInput
                          value={discountValue}
                          onChange={(v) => setDiscountValue(v)}
                          className="flex-1 h-9"
                        />
                      )}
                    </div>
                  </Can>
                </div>
              </section>
            )}

            {/* Payment split */}
            {items.length > 0 && (
              <section>
                <h3 className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-3">Payment</h3>
                <PaymentSplit
                  grandTotal={totals.grandTotal}
                  payments={payments}
                  saleType={saleType}
                  onChange={setPayments}
                />
              </section>
            )}
          </div>

          {/* Charge button */}
          <div className="p-4 border-t border-[var(--border)] space-y-2">
            {saleType === 'wholesale' && !customer && (
              <p className="text-xs text-[var(--danger)] text-center">Wholesale sales require a customer</p>
            )}
            {hasOverstock && (
              <p className="text-xs text-[var(--danger)] text-center">Fix stock issues above before charging</p>
            )}
            <button
              className={cn(
                'w-full h-14 rounded-xl text-h2 font-bold transition-all',
                canCharge && !submitMutation.isPending
                  ? 'bg-[var(--accent)] text-white hover:bg-[var(--accent)]/90 active:scale-[0.98]'
                  : 'bg-[var(--surface-2)] text-[var(--text-muted)] cursor-not-allowed',
              )}
              disabled={!canCharge || submitMutation.isPending}
              onClick={() => submitMutation.mutate()}
            >
              {submitMutation.isPending ? 'Processing…' : (
                items.length > 0
                  ? `Charge ${new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 }).format(totals.grandTotal)}`
                  : 'Charge'
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Receipt dialog */}
      <Dialog open={!!completedSale} onOpenChange={(o) => !o && resetCart()}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Receipt</DialogTitle>
          </DialogHeader>
          {completedSale && <ReceiptView sale={completedSale} />}
          <div className="flex gap-3 pt-2">
            <Button variant="outline" className="flex-1" onClick={resetCart}>
              <RefreshCw className="h-4 w-4" /> New sale
            </Button>
            <Button className="flex-1" onClick={() => {
              if (completedSale) window.open(`/sales/${completedSale.id}`, '_blank');
            }}>
              View receipt
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
