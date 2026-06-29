'use client';

import { useCallback, useState } from 'react';
import { useQueries, useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { crmApi, DEAL_PIPELINE_COLS, type DealStage } from '@/lib/api/crm';
import { qk } from '@/lib/query/keys';
import { ApiError } from '@/lib/api/client';
import { DealBoard, type DealColumnData } from '@/components/crm/DealBoard';
import { useActiveShopStore } from '@/lib/stores/activeShopStore';

const schema = z.object({
  title: z.string().min(2, 'Title required'),
  customer: z.string().optional(),
  expected_revenue: z.number().min(0),
  probability: z.number().min(0).max(100),
  expected_close_date: z.string().optional(),
});
type FormValues = z.infer<typeof schema>;

export default function DealsPage() {
  const queryClient = useQueryClient();
  const { activeShopId, isAllShops } = useActiveShopStore();
  const [open, setOpen] = useState(false);

  const columnQueries = useQueries({
    queries: DEAL_PIPELINE_COLS.map(({ stage }) => ({
      queryKey: qk.deals({ stage }),
      queryFn: () => crmApi.listDeals({ stage }),
      staleTime: 30_000,
    })),
  });

  const columns: DealColumnData[] = DEAL_PIPELINE_COLS.map(({ stage }, i) => ({
    stage,
    deals: columnQueries[i]?.data?.items ?? [],
    isLoading: columnQueries[i]?.isLoading ?? false,
    count: columnQueries[i]?.data?.meta?.count ?? (columnQueries[i]?.data?.items?.length ?? 0),
  }));

  const customersQuery = useQuery({
    queryKey: qk.customers(),
    queryFn: () => crmApi.listCustomers(),
    staleTime: 300_000,
    enabled: open,
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { title: '', customer: '', expected_revenue: 0, probability: 0, expected_close_date: '' },
  });

  const createMutation = useMutation({
    mutationFn: (v: FormValues) => crmApi.createDeal({
      shop: activeShopId ?? '',
      title: v.title,
      customer: v.customer || undefined,
      expected_revenue: v.expected_revenue,
      probability: v.probability,
      expected_close_date: v.expected_close_date || undefined,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.deals() });
      setOpen(false);
      form.reset();
      toast.success('Deal created');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to create deal'),
  });

  const handleCardMove = useCallback(async (
    dealId: string, _from: DealStage, toStage: DealStage, fields?: Record<string, string>,
  ) => {
    if (toStage === 'won' || toStage === 'lost') {
      await crmApi.closeDeal(dealId, toStage, fields?.reason);
    } else {
      await crmApi.changeDealStage(dealId, toStage);
    }
    queryClient.invalidateQueries({ queryKey: qk.deals() });
    toast.success(toStage === 'won' ? 'Deal won 🎉' : toStage === 'lost' ? 'Deal marked lost' : 'Deal moved');
  }, [queryClient]);

  const canCreate = !!activeShopId && !isAllShops;
  const customers = customersQuery.data?.items ?? [];

  return (
    <div className="p-4 md:p-6 h-full flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-h1 text-[var(--text)]">Deals</h1>
        <Button onClick={() => setOpen(true)} disabled={!canCreate}
          title={canCreate ? undefined : 'Select a single shop to add a deal'}>
          <Plus className="h-4 w-4 mr-1" /> Add deal
        </Button>
      </div>

      <div className="flex-1 min-h-0">
        <DealBoard columns={columns} onCardMove={handleCardMove} />
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New deal</DialogTitle></DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit((v) => createMutation.mutate(v))} className="space-y-4">
              <FormField control={form.control} name="title" render={({ field }) => (
                <FormItem><FormLabel>Title</FormLabel><FormControl><Input {...field} /></FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="customer" render={({ field }) => (
                <FormItem><FormLabel>Customer (optional)</FormLabel><FormControl>
                  <select className="w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-body-sm" {...field}>
                    <option value="">No customer</option>
                    {customers.map((cu) => <option key={cu.id} value={cu.id}>{cu.name}</option>)}
                  </select>
                </FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="expected_revenue" render={({ field }) => (
                <FormItem><FormLabel>Expected revenue (₹)</FormLabel><FormControl>
                  <Input type="number" step="1" {...field} onChange={(e) => field.onChange(Number(e.target.value))} />
                </FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="probability" render={({ field }) => (
                <FormItem><FormLabel>Probability (%)</FormLabel><FormControl>
                  <Input type="number" step="1" {...field} onChange={(e) => field.onChange(Number(e.target.value))} />
                </FormControl><FormMessage /></FormItem>
              )} />
              <FormField control={form.control} name="expected_close_date" render={({ field }) => (
                <FormItem><FormLabel>Expected close date</FormLabel><FormControl><Input type="date" {...field} /></FormControl><FormMessage /></FormItem>
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
  );
}
