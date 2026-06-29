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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/EmptyState';
import { Can } from '@/components/shared/Can';
import { billingApi, type Refund } from '@/lib/api/billing';
import { qk } from '@/lib/query/keys';
import { ApiError } from '@/lib/api/client';

const inr = (v: string) => `₹${Number(v).toLocaleString('en-IN')}`;
const METHODS = ['cash', 'upi', 'card', 'cheque', 'neft', 'other'] as const;

const schema = z.object({
  invoice_id: z.string().min(1, 'Invoice required'),
  amount: z.number().min(0.01, 'Amount required'),
  method: z.enum(METHODS),
  reason: z.string().optional(),
});
type FormValues = z.infer<typeof schema>;

export default function RefundsPage() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: qk.refunds(),
    queryFn: () => billingApi.listRefunds(),
    staleTime: 30_000,
  });
  const invoicesQuery = useQuery({
    queryKey: ['billing', 'invoices', 'refundable'],
    queryFn: () => billingApi.listInvoices(),
    staleTime: 60_000,
    enabled: open,
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { invoice_id: '', amount: 0, method: 'cash', reason: '' },
  });

  const createMutation = useMutation({
    mutationFn: (v: FormValues) => billingApi.createRefund(v),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.refunds() });
      setOpen(false);
      form.reset();
      toast.success('Refund created');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to create refund'),
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => billingApi.approveRefund(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.refunds() });
      queryClient.invalidateQueries({ queryKey: qk.outstanding() });
      toast.success('Refund approved');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Approval failed'),
  });

  const rows: Refund[] = data ?? [];
  const invoices = (invoicesQuery.data?.items ?? []).filter((i) => Number(i.amount_paid) > 0);

  return (
    <Can permission="billing.refunds.view">
      <div className="p-4 md:p-6 space-y-4 max-w-5xl mx-auto">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-h1 text-[var(--text)]">Refunds</h1>
            <p className="text-body-sm text-[var(--text-muted)] mt-1">Money returned against paid invoices.</p>
          </div>
          <Can permission="billing.refunds.create">
            <Button onClick={() => setOpen(true)}><Plus className="h-4 w-4 mr-1" /> New refund</Button>
          </Can>
        </div>

        {isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : rows.length === 0 ? (
          <EmptyState title="No refunds" description="Create a refund against a paid invoice." />
        ) : (
          <div className="rounded-lg border border-[var(--border)] overflow-x-auto">
            <table className="w-full text-body-sm">
              <thead className="bg-[var(--surface-2)] text-[var(--text-muted)]">
                <tr>
                  <th className="text-left px-4 py-2 font-medium">Number</th>
                  <th className="text-left px-4 py-2 font-medium">Invoice</th>
                  <th className="text-left px-4 py-2 font-medium">Customer</th>
                  <th className="text-right px-4 py-2 font-medium">Amount</th>
                  <th className="text-left px-4 py-2 font-medium">Method</th>
                  <th className="text-left px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {rows.map((r) => (
                  <tr key={r.id} className="bg-[var(--surface)]">
                    <td className="px-4 py-2 font-medium text-[var(--text)]">{r.refund_number}</td>
                    <td className="px-4 py-2">{r.invoice_number}</td>
                    <td className="px-4 py-2">{r.customer_name}</td>
                    <td className="px-4 py-2 text-right">{inr(r.amount)}</td>
                    <td className="px-4 py-2 uppercase text-xs">{r.method}</td>
                    <td className="px-4 py-2 capitalize">{r.status}</td>
                    <td className="px-4 py-2 text-right">
                      {r.status === 'pending' && (
                        <Can permission="billing.refunds.approve">
                          <Button size="sm" variant="outline" disabled={approveMutation.isPending}
                            onClick={() => approveMutation.mutate(r.id)}>Approve</Button>
                        </Can>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <Dialog open={open} onOpenChange={setOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>New refund</DialogTitle></DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit((v) => createMutation.mutate(v))} className="space-y-4">
                <FormField control={form.control} name="invoice_id" render={({ field }) => (
                  <FormItem><FormLabel>Invoice (paid)</FormLabel><FormControl>
                    <select className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-body-sm" {...field}>
                      <option value="">Select invoice…</option>
                      {invoices.map((i) => (
                        <option key={i.id} value={i.id}>{i.invoice_number} — {i.customer_name} (paid ₹{Number(i.amount_paid).toLocaleString('en-IN')})</option>
                      ))}
                    </select>
                  </FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="amount" render={({ field }) => (
                  <FormItem><FormLabel>Amount (₹)</FormLabel><FormControl>
                    <Input type="number" step="0.01" {...field} onChange={(e) => field.onChange(Number(e.target.value))} />
                  </FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="method" render={({ field }) => (
                  <FormItem><FormLabel>Method</FormLabel><FormControl>
                    <select className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-body-sm" {...field}>
                      {METHODS.map((m) => <option key={m} value={m}>{m.toUpperCase()}</option>)}
                    </select>
                  </FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="reason" render={({ field }) => (
                  <FormItem><FormLabel>Reason</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <div className="flex justify-end gap-2">
                  <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
                  <Button type="submit" disabled={createMutation.isPending}>Create</Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>
    </Can>
  );
}
