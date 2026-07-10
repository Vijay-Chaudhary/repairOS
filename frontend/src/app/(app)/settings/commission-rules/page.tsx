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
import { Can } from '@/components/shared/Can';
import { commissionsApi, type CommissionRule } from '@/lib/api/commissions';
import { qk } from '@/lib/query/keys';
import { ApiError } from '@/lib/api/client';
import { formatDate } from '@/lib/format/date';

const schema = z.object({
  name: z.string().min(2, 'Name required'),
  rate: z.number().min(0).max(100),
  lead_tech_share: z.number().min(0).max(100),
  effective_from: z.string().min(1, 'Effective from required'),
  effective_to: z.string().optional(),
  applies_to_job_type: z.string().optional(),
});

type FormValues = z.infer<typeof schema>;

export default function CommissionRulesPage() {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: qk.commissionRules(),
    queryFn: () => commissionsApi.listRules(),
    staleTime: 300_000,
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { name: '', rate: 30, lead_tech_share: 50, effective_from: '', effective_to: '', applies_to_job_type: '' },
  });

  const mutation = useMutation({
    mutationFn: (values: FormValues) => commissionsApi.createRule({
      name: values.name,
      rate: values.rate,
      lead_tech_share: values.lead_tech_share,
      effective_from: values.effective_from,
      effective_to: values.effective_to || undefined,
      applies_to_job_type: values.applies_to_job_type || undefined,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.commissionRules() });
      toast.success('Rule created');
      form.reset();
      setOpen(false);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });

  const rules = data?.items ?? [];

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-h1 text-[var(--text)]">Commission Rules</h1>
          <p className="text-body-sm text-[var(--text-muted)] mt-0.5">
            Rules are matched by job type and effective date at job closure.
          </p>
        </div>
        <Can permission="settings.commission_rules.manage">
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus className="h-4 w-4" /> New rule
          </Button>
        </Can>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[1,2,3].map((i) => <Skeleton key={i} className="h-16" />)}</div>
      ) : rules.length === 0 ? (
        <div className="rounded-lg border border-[var(--border)] p-8 text-center">
          <p className="text-body-sm text-[var(--text-muted)]">No commission rules defined.</p>
        </div>
      ) : (
        <div className="rounded-lg border border-[var(--border)] overflow-hidden">
          <div className="overflow-x-auto"><table className="w-full min-w-max text-body-sm">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--surface-2)] text-left">
                <th className="px-4 py-2 font-medium text-[var(--text-muted)]">Name</th>
                <th className="px-4 py-2 font-medium text-[var(--text-muted)] text-right">Rate</th>
                <th className="px-4 py-2 font-medium text-[var(--text-muted)] text-right">Lead share</th>
                <th className="px-4 py-2 font-medium text-[var(--text-muted)]">Job type</th>
                <th className="px-4 py-2 font-medium text-[var(--text-muted)]">Effective</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule: CommissionRule) => (
                <tr key={rule.id} className="border-b border-[var(--border)] last:border-0">
                  <td className="px-4 py-3 font-medium text-[var(--text)]">{rule.name}</td>
                  <td className="px-4 py-3 text-right font-mono">{rule.rate}%</td>
                  <td className="px-4 py-3 text-right font-mono text-[var(--text-muted)]">{rule.lead_tech_share}%</td>
                  <td className="px-4 py-3 text-[var(--text-muted)]">{rule.applies_to_job_type ?? 'All'}</td>
                  <td className="px-4 py-3 text-[var(--text-muted)]">
                    {formatDate(rule.effective_from)}{rule.effective_to ? ` – ${formatDate(rule.effective_to)}` : ' →'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table></div>
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>New commission rule</DialogTitle></DialogHeader>
          <Form {...form}>
            <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
              <FormField control={form.control} name="name" render={({ field }) => (
                <FormItem>
                  <FormLabel>Rule name *</FormLabel>
                  <FormControl><Input placeholder="Standard repair commission" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <div className="grid grid-cols-2 gap-3">
                <FormField control={form.control} name="rate" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Rate % *</FormLabel>
                    <FormControl>
                      <Input type="number" min={0} max={100} step={0.5}
                        value={field.value}
                        onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="lead_tech_share" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Lead share %</FormLabel>
                    <FormControl>
                      <Input type="number" min={0} max={100} step={0.5}
                        value={field.value}
                        onChange={(e) => field.onChange(parseFloat(e.target.value) || 0)} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="effective_from" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Effective from *</FormLabel>
                    <FormControl><Input type="date" {...field} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={form.control} name="effective_to" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Effective to</FormLabel>
                    <FormControl><Input type="date" {...field} /></FormControl>
                  </FormItem>
                )} />
              </div>
              <FormField control={form.control} name="applies_to_job_type" render={({ field }) => (
                <FormItem>
                  <FormLabel>Job type (blank = all)</FormLabel>
                  <FormControl><Input placeholder="repair, amc, …" {...field} /></FormControl>
                </FormItem>
              )} />
              <div className="flex gap-3">
                <Button type="button" variant="outline" className="flex-1" onClick={() => setOpen(false)}>Cancel</Button>
                <Button type="submit" className="flex-1" disabled={mutation.isPending}>
                  {mutation.isPending ? 'Creating…' : 'Create rule'}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
