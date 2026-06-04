'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Copy, ExternalLink, Smartphone } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { MoneyInput } from '@/components/shared/MoneyInput';
import { Money } from '@/components/shared/Money';
import { billingApi, PAYMENT_METHOD_LABELS, type Invoice, type PaymentMethod, type RazorpayLinkResponse } from '@/lib/api/billing';
import { qk } from '@/lib/query/keys';
import { ApiError } from '@/lib/api/client';
import { useOfflineQueueStore } from '@/lib/stores/offlineQueueStore';

const paymentSchema = z.object({
  amount: z.number().min(0.01, 'Amount must be positive'),
  method: z.enum(['cash', 'upi', 'card', 'cheque', 'neft', 'other']),
  reference_id: z.string().optional(),
  notes: z.string().optional(),
});

type PaymentFormValues = z.infer<typeof paymentSchema>;

interface AddPaymentDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  invoice: Invoice;
}

export function AddPaymentDialog({ open, onOpenChange, invoice }: AddPaymentDialogProps) {
  const queryClient = useQueryClient();
  const { isOnline } = useOfflineQueueStore();
  const [razorpayResult, setRazorpayResult] = useState<RazorpayLinkResponse | null>(null);

  const form = useForm<PaymentFormValues>({
    resolver: zodResolver(paymentSchema),
    defaultValues: {
      amount: invoice.amount_outstanding,
      method: 'upi',
      reference_id: '',
      notes: '',
    },
  });

  const method = form.watch('method') as PaymentMethod;
  const showReference = method !== 'cash';

  const recordMutation = useMutation({
    mutationFn: (values: PaymentFormValues) => {
      const idempotencyKey = crypto.randomUUID();
      return billingApi.recordPayment(
        {
          invoice_id: invoice.id,
          amount: values.amount,
          method: values.method,
          reference_id: values.reference_id || undefined,
          notes: values.notes || undefined,
        },
        idempotencyKey,
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.invoice(invoice.id) });
      queryClient.invalidateQueries({ queryKey: qk.invoices() });
      queryClient.invalidateQueries({ queryKey: qk.dashboard(null) });
      queryClient.invalidateQueries({ queryKey: qk.customer(invoice.customer_id) });
      toast.success('Payment recorded');
      onOpenChange(false);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Payment failed'),
  });

  const razorpayMutation = useMutation({
    mutationFn: (amount: number) =>
      billingApi.createRazorpayLink({ invoice_id: invoice.id, amount }),
    onSuccess: (result) => {
      setRazorpayResult(result);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not create link'),
  });

  function handleClose() {
    form.reset({ amount: invoice.amount_outstanding, method: 'upi', reference_id: '', notes: '' });
    setRazorpayResult(null);
    onOpenChange(false);
  }

  if (!isOnline) {
    return (
      <Dialog open={open} onOpenChange={handleClose}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Add payment</DialogTitle></DialogHeader>
          <div className="py-6 text-center space-y-2">
            <p className="text-body-sm font-medium text-[var(--text)]">Needs connection</p>
            <p className="text-body-sm text-[var(--text-muted)]">Payments cannot be recorded offline.</p>
            <Button variant="outline" onClick={handleClose}>Close</Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add payment — {invoice.invoice_number}</DialogTitle>
        </DialogHeader>

        {/* Outstanding info */}
        <div className="flex items-center justify-between rounded-lg bg-[var(--surface-2)] px-4 py-3">
          <span className="text-body-sm text-[var(--text-muted)]">Outstanding</span>
          <Money amount={invoice.amount_outstanding} className="text-body font-semibold text-[var(--danger)]" />
        </div>

        <Tabs defaultValue="direct">
          <TabsList className="w-full">
            <TabsTrigger value="direct" className="flex-1">Direct payment</TabsTrigger>
            <TabsTrigger value="razorpay" className="flex-1">
              <Smartphone className="h-3.5 w-3.5 mr-1" />Razorpay
            </TabsTrigger>
          </TabsList>

          {/* Direct payment */}
          <TabsContent value="direct" className="mt-4">
            <Form {...form}>
              <form onSubmit={form.handleSubmit((v) => recordMutation.mutate(v))} className="space-y-4">
                <FormField control={form.control} name="amount" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Amount *</FormLabel>
                    <FormControl>
                      <MoneyInput
                        value={field.value}
                        onChange={field.onChange}
                        max={invoice.amount_outstanding}
                      />
                    </FormControl>
                    <FormMessage />
                    {field.value > invoice.amount_outstanding && (
                      <p className="text-xs text-[var(--danger)]">
                        Cannot exceed outstanding amount
                      </p>
                    )}
                  </FormItem>
                )} />

                <FormField control={form.control} name="method" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Method *</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        {(Object.keys(PAYMENT_METHOD_LABELS) as PaymentMethod[]).map((m) => (
                          <SelectItem key={m} value={m}>{PAYMENT_METHOD_LABELS[m]}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )} />

                {showReference && (
                  <FormField control={form.control} name="reference_id" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Reference / UTR</FormLabel>
                      <FormControl>
                        <Input placeholder="UPI ref, cheque #, NEFT UTR…" className="font-mono" {...field} />
                      </FormControl>
                    </FormItem>
                  )} />
                )}

                <FormField control={form.control} name="notes" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Notes</FormLabel>
                    <FormControl>
                      <Input placeholder="Optional notes…" {...field} />
                    </FormControl>
                  </FormItem>
                )} />

                <div className="flex gap-3 pt-1">
                  <Button type="button" variant="outline" className="flex-1" onClick={handleClose}>Cancel</Button>
                  <Button
                    type="submit"
                    className="flex-1"
                    disabled={recordMutation.isPending || form.watch('amount') > invoice.amount_outstanding}
                  >
                    {recordMutation.isPending ? 'Recording…' : 'Record payment'}
                  </Button>
                </div>
              </form>
            </Form>
          </TabsContent>

          {/* Razorpay */}
          <TabsContent value="razorpay" className="mt-4 space-y-4">
            {razorpayResult ? (
              <div className="space-y-4">
                <div className="rounded-lg border border-[var(--success)]/30 bg-[var(--success)]/5 p-4 text-center">
                  <p className="text-body-sm font-medium text-[var(--success)] mb-2">Payment link created</p>
                  <p className="text-xs text-[var(--text-muted)] mb-3">
                    Share this link with the customer. Payment will be confirmed automatically via webhook.
                  </p>
                  <div className="flex items-center gap-2 bg-[var(--surface)] rounded-md border border-[var(--border)] px-3 py-2">
                    <span className="flex-1 text-xs text-[var(--text)] font-mono truncate">
                      {razorpayResult.payment_link}
                    </span>
                    <button
                      className="shrink-0 text-[var(--accent)] hover:opacity-70"
                      onClick={() => {
                        navigator.clipboard.writeText(razorpayResult.payment_link);
                        toast.success('Link copied');
                      }}
                    >
                      <Copy className="h-4 w-4" />
                    </button>
                    <a
                      href={razorpayResult.payment_link}
                      target="_blank"
                      rel="noreferrer"
                      className="shrink-0 text-[var(--accent)] hover:opacity-70"
                    >
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </div>
                  <p className="text-xs text-[var(--text-muted)] mt-2">
                    This dialog can be closed — payment updates automatically.
                  </p>
                </div>
                <Button variant="outline" className="w-full" onClick={handleClose}>Close</Button>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-body-sm text-[var(--text-muted)]">
                  Creates a Razorpay payment link for{' '}
                  <Money amount={invoice.amount_outstanding} className="font-semibold" />.
                  The invoice updates automatically when payment is confirmed via webhook.
                </p>
                <div className="flex gap-3">
                  <Button variant="outline" className="flex-1" onClick={handleClose}>Cancel</Button>
                  <Button
                    className="flex-1"
                    onClick={() => razorpayMutation.mutate(invoice.amount_outstanding)}
                    disabled={razorpayMutation.isPending}
                  >
                    {razorpayMutation.isPending ? 'Creating…' : 'Create link'}
                  </Button>
                </div>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
