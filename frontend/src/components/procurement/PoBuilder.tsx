'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Trash2, Search } from 'lucide-react';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { MoneyInput } from '@/components/shared/MoneyInput';
import { Money } from '@/components/shared/Money';
import { procurementApi, type Supplier } from '@/lib/api/procurement';
import { inventoryApi, TAX_RATES } from '@/lib/api/inventory';
import { qk } from '@/lib/query/keys';
import { ApiError } from '@/lib/api/client';
import { useActiveShopStore } from '@/lib/stores/activeShopStore';
import { useDebounce } from '@/lib/hooks/useDebounce';

const headerSchema = z.object({
  supplier_id: z.string().min(1, 'Supplier required'),
  expected_delivery_date: z.string().optional(),
  notes: z.string().optional(),
});

type HeaderValues = z.infer<typeof headerSchema>;

interface PoLine {
  localId: string;
  variant_id: string;
  variant_name: string;
  product_name: string;
  quantity_ordered: number;
  unit_cost: number;
  tax_rate: number;
  hsn_code: string;
}

interface PoBuilderProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  suppliers: Supplier[];
  onSuccess: () => void;
}

export function PoBuilder({ open, onOpenChange, suppliers, onSuccess }: PoBuilderProps) {
  const queryClient = useQueryClient();
  const { activeShopId } = useActiveShopStore();

  const [lines, setLines] = useState<PoLine[]>([]);
  const [productSearch, setProductSearch] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const debouncedSearch = useDebounce(productSearch, 300);

  const { data: searchData } = useQuery({
    queryKey: ['po-product-search', debouncedSearch],
    queryFn: () => inventoryApi.listProducts({ search: debouncedSearch }),
    enabled: debouncedSearch.length >= 2,
    staleTime: 30_000,
  });

  const form = useForm<HeaderValues>({
    resolver: zodResolver(headerSchema),
    defaultValues: { supplier_id: '', expected_delivery_date: '', notes: '' },
  });

  const mutation = useMutation({
    mutationFn: (values: HeaderValues) =>
      procurementApi.createPO({
        shop_id: activeShopId ?? '',
        supplier_id: values.supplier_id,
        expected_delivery_date: values.expected_delivery_date || undefined,
        notes: values.notes || undefined,
        items: lines.map((l) => ({
          variant_id: l.variant_id,
          quantity_ordered: l.quantity_ordered,
          unit_cost: l.unit_cost,
          tax_rate: l.tax_rate,
          hsn_code: l.hsn_code || undefined,
        })),
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.purchaseOrders() });
      toast.success('Purchase order created');
      form.reset();
      setLines([]);
      onSuccess();
      onOpenChange(false);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });

  const grandTotal = lines.reduce((s, l) => s + l.quantity_ordered * l.unit_cost * (1 + l.tax_rate / 100), 0);

  function addLine(variantId: string, variantName: string, productName: string, unitCost: number, taxRate: number, hsnCode: string) {
    setLines((prev) => {
      const existing = prev.find((l) => l.variant_id === variantId);
      if (existing) {
        return prev.map((l) => l.variant_id === variantId ? { ...l, quantity_ordered: l.quantity_ordered + 1 } : l);
      }
      return [...prev, {
        localId: `${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
        variant_id: variantId, variant_name: variantName, product_name: productName,
        quantity_ordered: 1, unit_cost: unitCost, tax_rate: taxRate, hsn_code: hsnCode,
      }];
    });
    setProductSearch('');
    setShowSearch(false);
  }

  function updateLine(localId: string, field: keyof PoLine, value: string | number) {
    setLines((prev) => prev.map((l) => l.localId === localId ? { ...l, [field]: value } : l));
  }

  function removeLine(localId: string) {
    setLines((prev) => prev.filter((l) => l.localId !== localId));
  }

  const products = searchData?.items ?? [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader>
          <SheetTitle>New purchase order</SheetTitle>
        </SheetHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="mt-6 space-y-6">
            {/* PO header */}
            <div className="grid grid-cols-2 gap-3">
              <FormField control={form.control} name="supplier_id" render={({ field }) => (
                <FormItem className="col-span-2">
                  <FormLabel>Supplier *</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue placeholder="Select supplier…" /></SelectTrigger></FormControl>
                    <SelectContent>
                      {suppliers.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="expected_delivery_date" render={({ field }) => (
                <FormItem>
                  <FormLabel>Expected delivery</FormLabel>
                  <FormControl><Input type="date" {...field} /></FormControl>
                </FormItem>
              )} />
              <FormField control={form.control} name="notes" render={({ field }) => (
                <FormItem>
                  <FormLabel>Notes</FormLabel>
                  <FormControl><Input placeholder="Optional notes…" {...field} /></FormControl>
                </FormItem>
              )} />
            </div>

            {/* Line items */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-body-sm font-semibold text-[var(--text)]">Items</h3>
                <Button type="button" size="sm" variant="outline" onClick={() => setShowSearch(true)}>
                  <Plus className="h-3.5 w-3.5" /> Add item
                </Button>
              </div>

              {/* Product search dropdown */}
              {showSearch && (
                <div className="relative">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-muted)]" />
                    <Input
                      autoFocus
                      placeholder="Search product…"
                      className="pl-9"
                      value={productSearch}
                      onChange={(e) => setProductSearch(e.target.value)}
                    />
                  </div>
                  {debouncedSearch.length >= 2 && (
                    <div className="absolute z-20 w-full mt-1 rounded-md border border-[var(--border)] bg-[var(--surface)] shadow-lg overflow-hidden max-h-[280px] overflow-y-auto">
                      {products.length === 0 ? (
                        <p className="p-3 text-body-sm text-[var(--text-muted)]">No products found</p>
                      ) : (
                        products.flatMap((p) =>
                          (p.variants ?? []).map((v) => (
                            <button
                              key={v.id}
                              type="button"
                              className="w-full text-left px-4 py-3 hover:bg-[var(--surface-2)] flex items-center justify-between gap-3"
                              onClick={() => addLine(v.id, v.variant_name, p.name, v.cost_price, p.default_tax_rate, p.hsn_code ?? '')}
                            >
                              <div>
                                <p className="text-body-sm font-medium text-[var(--text)]">{p.name}</p>
                                <p className="text-xs text-[var(--text-muted)]">{v.variant_name} · <span className="font-mono">{p.sku}</span></p>
                              </div>
                              <Money amount={v.cost_price} className="text-xs" />
                            </button>
                          ))
                        )
                      )}
                    </div>
                  )}
                </div>
              )}

              {lines.length === 0 ? (
                <p className="text-body-sm text-[var(--text-muted)] py-4 text-center">No items added</p>
              ) : (
                <div className="space-y-2">
                  {lines.map((line) => (
                    <div key={line.localId} className="rounded-lg border border-[var(--border)] p-3 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-body-sm font-medium text-[var(--text)]">{line.product_name}</p>
                          <p className="text-xs text-[var(--text-muted)]">{line.variant_name}</p>
                        </div>
                        <button type="button" onClick={() => removeLine(line.localId)} className="text-[var(--text-muted)] hover:text-[var(--danger)]">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                      <div className="grid grid-cols-3 gap-2">
                        <div>
                          <p className="text-xs text-[var(--text-muted)] mb-1">Qty</p>
                          <Input
                            type="number" min={1}
                            value={line.quantity_ordered}
                            onChange={(e) => updateLine(line.localId, 'quantity_ordered', parseInt(e.target.value, 10) || 1)}
                          />
                        </div>
                        <div>
                          <p className="text-xs text-[var(--text-muted)] mb-1">Unit cost</p>
                          <MoneyInput value={line.unit_cost} onChange={(v) => updateLine(line.localId, 'unit_cost', v)} />
                        </div>
                        <div>
                          <p className="text-xs text-[var(--text-muted)] mb-1">Tax %</p>
                          <Select value={String(line.tax_rate)} onValueChange={(v) => updateLine(line.localId, 'tax_rate', Number(v))}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {TAX_RATES.map((r) => <SelectItem key={r} value={String(r)}>{r}%</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>
                  ))}
                  <div className="flex justify-between font-semibold text-body px-1">
                    <span>Total (incl. tax)</span>
                    <Money amount={grandTotal} />
                  </div>
                </div>
              )}
            </div>

            <div className="flex gap-3 pb-4">
              <Button type="button" variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" className="flex-1" disabled={mutation.isPending || lines.length === 0}>
                {mutation.isPending ? 'Creating…' : 'Create PO'}
              </Button>
            </div>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}
