'use client';

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowRightLeft, Check, ChevronsUpDown, Loader2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { inventoryApi, type StockRecord } from '@/lib/api/inventory';
import { qk } from '@/lib/query/keys';
import { ApiError } from '@/lib/api/client';
import { useActiveShopStore } from '@/lib/stores/activeShopStore';
import { useDebounce } from '@/lib/hooks/useDebounce';
import { cn } from '@/lib/utils';

const schema = z.object({
  source_shop_id: z.string().min(1, 'Select source shop'),
  dest_shop_id: z.string().min(1, 'Select destination shop'),
  variant_id: z.string().min(1, 'Select a product variant'),
  quantity: z.number().int().min(1, 'Quantity must be at least 1'),
  note: z.string().optional(),
}).refine((d) => d.source_shop_id !== d.dest_shop_id, {
  message: 'Source and destination must be different shops',
  path: ['dest_shop_id'],
});

type FormValues = z.infer<typeof schema>;

export interface TransferDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}

export function TransferDialog({ open, onOpenChange }: TransferDialogProps) {
  const queryClient = useQueryClient();
  const { activeShopId, shops } = useActiveShopStore();

  const [selectedVariant, setSelectedVariant] = useState<StockRecord | null>(null);
  const [variantQuery, setVariantQuery] = useState('');
  const [variantOpen, setVariantOpen] = useState(false);

  const debouncedVariantQuery = useDebounce(variantQuery, 350);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      source_shop_id: activeShopId ?? '',
      dest_shop_id: '',
      variant_id: '',
      quantity: 1,
      note: '',
    },
  });

  const sourceShopId = form.watch('source_shop_id');
  const quantity = form.watch('quantity') ?? 1;
  const sourceQty = selectedVariant?.quantity_in_stock ?? 0;
  const resultingStock = sourceQty - quantity;
  const wouldGoNegative = resultingStock < 0;

  // Reset variant when source shop changes
  useEffect(() => {
    setSelectedVariant(null);
    setVariantQuery('');
    form.setValue('variant_id', '');
  }, [sourceShopId, form]);

  const stockQuery = useQuery({
    queryKey: ['transfer-variant-search', sourceShopId, debouncedVariantQuery],
    queryFn: () => inventoryApi.listStock({
      shop_id: sourceShopId || undefined,
      search: debouncedVariantQuery || undefined,
    }),
    enabled: variantOpen && !!sourceShopId,
    staleTime: 30_000,
  });

  const stockItems = stockQuery.data?.items ?? [];

  function handleVariantSelect(record: StockRecord) {
    setSelectedVariant(record);
    form.setValue('variant_id', record.variant_id, { shouldValidate: true });
    setVariantOpen(false);
    setVariantQuery('');
  }

  const destShopName = shops.find((s) => s.id === form.watch('dest_shop_id'))?.name ?? '';

  const mutation = useMutation({
    mutationFn: (values: FormValues) =>
      inventoryApi.transferStock({
        source_shop_id: values.source_shop_id,
        dest_shop_id: values.dest_shop_id,
        variant_id: values.variant_id,
        quantity: values.quantity,
        note: values.note || undefined,
      }),
    onSuccess: (_, values) => {
      queryClient.invalidateQueries({ queryKey: qk.stock() });
      queryClient.invalidateQueries({ queryKey: qk.stockMovements() });
      const label = selectedVariant
        ? `${selectedVariant.product_name}${selectedVariant.variant_name ? ` ${selectedVariant.variant_name}` : ''}`
        : 'item';
      toast.success(`Transferred ${values.quantity} × ${label} → ${destShopName}`);
      handleClose();
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'INSUFFICIENT_STOCK') {
        toast.error('Insufficient stock at source shop');
      } else {
        toast.error(e instanceof ApiError ? e.message : 'Transfer failed');
      }
    },
  });

  function handleClose() {
    form.reset({
      source_shop_id: activeShopId ?? '',
      dest_shop_id: '',
      variant_id: '',
      quantity: 1,
      note: '',
    });
    setSelectedVariant(null);
    setVariantQuery('');
    onOpenChange(false);
  }

  if (shops.length < 2) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Transfer stock</DialogTitle></DialogHeader>
          <p className="text-body-sm text-[var(--text-muted)] text-center py-6">
            Inter-shop transfers require at least two shops.
          </p>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) handleClose(); else onOpenChange(true); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <ArrowRightLeft className="h-4 w-4" />
            Transfer stock
          </DialogTitle>
        </DialogHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">

            {/* Source shop */}
            <FormField control={form.control} name="source_shop_id" render={({ field }) => (
              <FormItem>
                <FormLabel>From shop *</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger><SelectValue placeholder="Select source…" /></SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {shops.map((s) => (
                      <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />

            {/* Variant picker */}
            <FormField control={form.control} name="variant_id" render={({ field }) => (
              <FormItem>
                <FormLabel>Product / variant *</FormLabel>
                <Popover open={variantOpen} onOpenChange={(v) => { setVariantOpen(v); if (!v) setVariantQuery(''); }}>
                  <PopoverTrigger asChild>
                    <FormControl>
                      <Button
                        variant="outline"
                        role="combobox"
                        disabled={!sourceShopId}
                        className={cn(
                          'w-full justify-between min-h-[44px] font-normal text-left',
                          !selectedVariant && 'text-[var(--text-muted)]',
                        )}
                      >
                        <span className="truncate">
                          {selectedVariant
                            ? `${selectedVariant.product_name}${selectedVariant.variant_name ? ` — ${selectedVariant.variant_name}` : ''}`
                            : 'Search product…'}
                        </span>
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </Button>
                    </FormControl>
                  </PopoverTrigger>
                  <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
                    <div className="p-2 border-b border-[var(--border)]">
                      <Input
                        placeholder="Search by name, SKU…"
                        value={variantQuery}
                        onChange={(e) => setVariantQuery(e.target.value)}
                        autoFocus
                        className="h-8"
                      />
                    </div>
                    <div className="max-h-56 overflow-y-auto">
                      {stockQuery.isLoading && (
                        <div className="flex items-center justify-center py-6 gap-2 text-[var(--text-muted)]">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          <span className="text-body-sm">Searching…</span>
                        </div>
                      )}
                      {!stockQuery.isLoading && stockItems.length === 0 && (
                        <p className="py-6 text-center text-body-sm text-[var(--text-muted)]">
                          {debouncedVariantQuery ? 'No results.' : 'Type to search.'}
                        </p>
                      )}
                      {!stockQuery.isLoading && stockItems.map((item) => (
                        <button
                          key={item.variant_id}
                          type="button"
                          className={cn(
                            'w-full flex items-center gap-3 px-3 py-2.5 text-left min-h-[44px]',
                            'hover:bg-[var(--surface-muted)] transition-colors',
                            field.value === item.variant_id && 'bg-[var(--accent)]/10',
                          )}
                          onClick={() => handleVariantSelect(item)}
                        >
                          <Check className={cn(
                            'h-4 w-4 shrink-0 text-[var(--accent)]',
                            field.value !== item.variant_id && 'invisible',
                          )} />
                          <div className="min-w-0 flex-1">
                            <p className="text-body-sm font-medium text-[var(--text)] truncate">
                              {item.product_name}
                              {item.variant_name && (
                                <span className="font-normal text-[var(--text-muted)]"> — {item.variant_name}</span>
                              )}
                            </p>
                            <p className="text-xs text-[var(--text-muted)]">
                              <span className="font-mono">{item.sku}</span> · {item.quantity_in_stock} in stock
                            </p>
                          </div>
                        </button>
                      ))}
                    </div>
                  </PopoverContent>
                </Popover>
                <FormMessage />
              </FormItem>
            )} />

            {/* Destination shop */}
            <FormField control={form.control} name="dest_shop_id" render={({ field }) => (
              <FormItem>
                <FormLabel>To shop *</FormLabel>
                <Select value={field.value} onValueChange={field.onChange}>
                  <FormControl>
                    <SelectTrigger><SelectValue placeholder="Select destination…" /></SelectTrigger>
                  </FormControl>
                  <SelectContent>
                    {shops
                      .filter((s) => s.id !== sourceShopId)
                      .map((s) => (
                        <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />

            {/* Quantity */}
            <FormField control={form.control} name="quantity" render={({ field }) => (
              <FormItem>
                <FormLabel>Quantity *</FormLabel>
                <FormControl>
                  <Input
                    type="number"
                    min={1}
                    inputMode="numeric"
                    value={field.value}
                    onChange={(e) => field.onChange(parseInt(e.target.value, 10) || 1)}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />

            {/* Preview — only when a variant is selected */}
            {selectedVariant && (
              <div className={cn(
                'rounded-lg px-3 py-2.5 space-y-1 text-body-sm',
                wouldGoNegative
                  ? 'bg-[var(--danger)]/10 text-[var(--danger)]'
                  : 'bg-[var(--surface-2)] text-[var(--text)]',
              )}>
                <div className="flex justify-between">
                  <span>Source stock after transfer</span>
                  <span className="font-mono font-semibold">{resultingStock}</span>
                </div>
                {wouldGoNegative && (
                  <p className="text-xs">Insufficient stock — reduce quantity or choose another shop</p>
                )}
              </div>
            )}

            {/* Note */}
            <FormField control={form.control} name="note" render={({ field }) => (
              <FormItem>
                <FormLabel>
                  Note <span className="text-[var(--text-muted)] font-normal">(optional)</span>
                </FormLabel>
                <FormControl>
                  <Input placeholder="Restock branch, seasonal rotation, etc." {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <div className="flex gap-3 pt-1">
              <Button type="button" variant="outline" className="flex-1" onClick={handleClose}>
                Cancel
              </Button>
              <Button
                type="submit"
                className="flex-1"
                disabled={mutation.isPending || wouldGoNegative}
              >
                {mutation.isPending ? 'Transferring…' : 'Transfer'}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
