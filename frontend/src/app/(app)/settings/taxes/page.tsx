'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Skeleton } from '@/components/ui/skeleton';
import { billingApi, type TaxRate, type TaxType } from '@/lib/api/billing';
import { qk } from '@/lib/query/keys';
import { ApiError } from '@/lib/api/client';

const schema = z.object({
  name: z.string().min(2, 'Name required'),
  rate: z.number().min(0).max(100),
  tax_type: z.enum(['gst', 'igst', 'exempt']),
});
type FormValues = z.infer<typeof schema>;

const TYPE_LABELS: Record<TaxType, string> = { gst: 'GST', igst: 'IGST', exempt: 'Exempt' };

export default function TaxesPage() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: qk.taxRates(),
    queryFn: () => billingApi.listTaxRates(),
    staleTime: 300_000,
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', rate: 18, tax_type: 'gst' },
  });

  const createMutation = useMutation({
    mutationFn: (values: FormValues) => billingApi.createTaxRate(values),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.taxRates() });
      setOpen(false);
      form.reset();
      toast.success('Tax rate added');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to add tax rate'),
  });

  const toggleMutation = useMutation({
    mutationFn: (rate: TaxRate) => billingApi.updateTaxRate(rate.id, { is_active: !rate.is_active }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: qk.taxRates() }),
    onError: () => toast.error('Failed to update'),
  });

  const rates = data ?? [];

  return (
    <div className="p-4 md:p-6 space-y-4 max-w-3xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-h2 text-[var(--text)]">Taxes</h2>
          <p className="text-body-sm text-[var(--text-muted)] mt-1">GST tax-rate slabs.</p>
        </div>
        <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" /> Add slab</Button>
      </div>

      {isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <div className="rounded-lg border border-[var(--border)] divide-y divide-[var(--border)]">
          {rates.map((r) => (
            <div key={r.id} className="flex items-center justify-between px-4 py-3 bg-[var(--surface)]">
              <div>
                <p className="text-body-sm font-medium text-[var(--text)]">{r.name}</p>
                <p className="text-xs text-[var(--text-muted)]">{Number(r.rate)}% · {TYPE_LABELS[r.tax_type]}</p>
              </div>
              <Switch checked={r.is_active} onCheckedChange={() => toggleMutation.mutate(r)} />
            </div>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Add tax slab</DialogTitle></DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit((v) => createMutation.mutate(v))} className="space-y-4">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem><FormLabel>Name</FormLabel><FormControl><Input placeholder="GST 18%" {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="rate" render={({ field }) => (
                <FormItem><FormLabel>Rate (%)</FormLabel><FormControl>
                  <Input type="number" step="0.01" {...field} onChange={(e) => field.onChange(Number(e.target.value))} />
                </FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="tax_type" render={({ field }) => (
                <FormItem><FormLabel>Type</FormLabel><FormControl>
                  <select className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-body-sm" {...field}>
                    <option value="gst">GST (CGST + SGST)</option>
                    <option value="igst">IGST (inter-state)</option>
                    <option value="exempt">Exempt</option>
                  </select>
                </FormControl><FormMessage /></FormItem>
              )} />
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
                <Button type="submit" disabled={createMutation.isPending}>Save</Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
