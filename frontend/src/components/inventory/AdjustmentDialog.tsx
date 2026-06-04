'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Minus } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { inventoryApi, type StockRecord } from '@/lib/api/inventory';
import { qk } from '@/lib/query/keys';
import { ApiError } from '@/lib/api/client';
import { useActiveShopStore } from '@/lib/stores/activeShopStore';
import { cn } from '@/lib/utils';

const schema = z.object({
  quantity: z.number().int().refine((v) => v !== 0, 'Quantity cannot be zero'),
  note: z.string().min(3, 'Note is required (min 3 characters)'),
});

type FormValues = z.infer<typeof schema>;

interface AdjustmentDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  record: StockRecord | null;
}

export function AdjustmentDialog({ open, onOpenChange, record }: AdjustmentDialogProps) {
  const queryClient = useQueryClient();
  const { activeShopId } = useActiveShopStore();
  const [direction, setDirection] = useState<'add' | 'remove'>('add');

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { quantity: 1, note: '' },
  });

  const qty = form.watch('quantity') ?? 1;
  const signedQty = direction === 'add' ? Math.abs(qty) : -Math.abs(qty);
  const resultingStock = (record?.quantity_in_stock ?? 0) + signedQty;
  const wouldGoNegative = resultingStock < 0;

  const mutation = useMutation({
    mutationFn: (values: FormValues) =>
      inventoryApi.adjustStock({
        shop_id: activeShopId ?? '',
        variant_id: record!.variant_id,
        quantity: direction === 'add' ? Math.abs(values.quantity) : -Math.abs(values.quantity),
        note: values.note,
      }),
    onSuccess: ({ new_qty }) => {
      queryClient.invalidateQueries({ queryKey: qk.stock(activeShopId ?? null) });
      queryClient.invalidateQueries({ queryKey: qk.stockMovements() });
      toast.success(`Stock adjusted to ${new_qty} units`);
      form.reset({ quantity: 1, note: '' });
      onOpenChange(false);
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'INSUFFICIENT_STOCK') {
        toast.error('Adjustment would make stock negative');
      } else {
        toast.error(e instanceof ApiError ? e.message : 'Adjustment failed');
      }
    },
  });

  if (!record) return null;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) form.reset({ quantity: 1, note: '' }); onOpenChange(v); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Adjust stock</DialogTitle>
        </DialogHeader>

        <div className="rounded-lg bg-[var(--surface-2)] px-4 py-3 space-y-0.5">
          <p className="text-body-sm font-medium text-[var(--text)]">{record.product_name}</p>
          <p className="text-xs text-[var(--text-muted)]">{record.variant_name}</p>
          <p className="text-xs text-[var(--text-muted)]">
            Current: <span className="font-mono font-semibold text-[var(--text)]">{record.quantity_in_stock}</span>
          </p>
        </div>

        {/* Direction toggle */}
        <div className="flex rounded-md border border-[var(--border)] overflow-hidden">
          <button
            onClick={() => setDirection('add')}
            className={cn(
              'flex-1 flex items-center justify-center gap-1.5 py-2.5 text-body-sm font-medium transition-colors',
              direction === 'add' ? 'bg-[var(--success)] text-white' : 'text-[var(--text-muted)] hover:bg-[var(--surface-2)]',
            )}
          >
            <Plus className="h-4 w-4" /> Add stock
          </button>
          <button
            onClick={() => setDirection('remove')}
            className={cn(
              'flex-1 flex items-center justify-center gap-1.5 py-2.5 text-body-sm font-medium transition-colors',
              direction === 'remove' ? 'bg-[var(--danger)] text-white' : 'text-[var(--text-muted)] hover:bg-[var(--surface-2)]',
            )}
          >
            <Minus className="h-4 w-4" /> Remove
          </button>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
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

            {/* Preview */}
            <div className={cn(
              'flex justify-between text-body-sm rounded-md px-3 py-2',
              wouldGoNegative ? 'bg-[var(--danger)]/10 text-[var(--danger)]' : 'bg-[var(--surface-2)] text-[var(--text)]',
            )}>
              <span>After adjustment</span>
              <span className="font-mono font-semibold">{resultingStock}</span>
            </div>
            {wouldGoNegative && (
              <p className="text-xs text-[var(--danger)]">Cannot reduce below zero</p>
            )}

            <FormField control={form.control} name="note" render={({ field }) => (
              <FormItem>
                <FormLabel>Reason / note *</FormLabel>
                <FormControl>
                  <Input placeholder="Damaged in storage, cycle count, etc." {...field} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <div className="flex gap-3">
              <Button type="button" variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" className="flex-1" disabled={mutation.isPending || wouldGoNegative}>
                {mutation.isPending ? 'Saving…' : 'Apply adjustment'}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
