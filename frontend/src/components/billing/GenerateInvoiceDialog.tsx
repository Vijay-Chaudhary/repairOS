'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { FileText, WifiOff } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { MoneyInput } from '@/components/shared/MoneyInput';
import { Money } from '@/components/shared/Money';
import { billingApi } from '@/lib/api/billing';
import { qk } from '@/lib/query/keys';
import { ApiError } from '@/lib/api/client';
import { useOfflineQueueStore } from '@/lib/stores/offlineQueueStore';

const schema = z.object({
  discount_amount: z.number().min(0),
  due_date: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

interface GenerateInvoiceDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  jobId: string;
  jobNumber?: string;
  serviceCharge: number;
}

export function GenerateInvoiceDialog({
  open, onOpenChange, jobId, jobNumber, serviceCharge,
}: GenerateInvoiceDialogProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { isOnline } = useOfflineQueueStore();

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { discount_amount: 0, due_date: '' },
  });

  const discount = form.watch('discount_amount') ?? 0;
  const estimatedTotal = Math.max(0, serviceCharge - discount);

  const mutation = useMutation({
    mutationFn: (values: FormValues) =>
      billingApi.createInvoice({
        job_id: jobId,
        discount_amount: values.discount_amount || undefined,
        due_date: values.due_date || undefined,
      }),
    onSuccess: (invoice) => {
      queryClient.invalidateQueries({ queryKey: qk.invoices() });
      queryClient.invalidateQueries({ queryKey: qk.job(jobId) });
      toast.success(`Invoice ${invoice.invoice_number} generated`);
      onOpenChange(false);
      router.push(`/invoices/${invoice.id}`);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to generate invoice'),
  });

  if (!isOnline) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Generate invoice</DialogTitle></DialogHeader>
          <div className="py-6 text-center space-y-3">
            <WifiOff className="h-10 w-10 text-[var(--text-muted)] mx-auto" />
            <p className="text-body-sm text-[var(--text-muted)]">Invoice generation requires a connection.</p>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Generate invoice{jobNumber ? ` — ${jobNumber}` : ''}</DialogTitle>
        </DialogHeader>

        {/* Preview */}
        <div className="rounded-lg border border-[var(--border)] p-4 space-y-2 bg-[var(--surface-2)]">
          <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">Preview</p>
          <div className="flex justify-between text-body-sm">
            <span className="text-[var(--text-muted)]">Labour (Service Charge)</span>
            <Money amount={serviceCharge} />
          </div>
          <div className="flex justify-between text-body-sm">
            <span className="text-[var(--text-muted)]">Parts consumed</span>
            <span className="text-xs text-[var(--text-muted)] italic">auto-listed by backend</span>
          </div>
          {discount > 0 && (
            <div className="flex justify-between text-body-sm text-[var(--success)]">
              <span>Discount</span>
              <span>− <Money amount={discount} className="text-inherit" /></span>
            </div>
          )}
          <div className="flex justify-between font-semibold text-body border-t border-[var(--border)] pt-2">
            <span>Est. grand total</span>
            <Money amount={estimatedTotal} />
          </div>
          <p className="text-xs text-[var(--text-muted)]">
            GST is computed by the backend and added to the final invoice.
          </p>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <FormField control={form.control} name="discount_amount" render={({ field }) => (
                <FormItem>
                  <FormLabel>Discount</FormLabel>
                  <FormControl>
                    <MoneyInput
                      value={field.value}
                      onChange={field.onChange}
                      max={serviceCharge}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="due_date" render={({ field }) => (
                <FormItem>
                  <FormLabel>Due date</FormLabel>
                  <FormControl><Input type="date" {...field} /></FormControl>
                </FormItem>
              )} />
            </div>

            <div className="flex gap-3">
              <Button type="button" variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" className="flex-1" disabled={mutation.isPending}>
                <FileText className="h-4 w-4" />
                {mutation.isPending ? 'Generating…' : 'Generate invoice'}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
