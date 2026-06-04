'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Input } from '@/components/ui/input';
import { MoneyInput } from '@/components/shared/MoneyInput';
import { GstBreakdown } from '@/components/shared/GstBreakdown';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Money } from '@/components/shared/Money';
import { repairApi, type JobEstimate } from '@/lib/api/repair';
import { ApiError } from '@/lib/api/client';
import { Can } from '@/components/shared/Can';
import { formatDate } from '@/lib/format/date';

const schema = z.object({
  labor_charge: z.number().min(0),
  parts_cost: z.number().min(0),
  valid_until: z.string().optional(),
  notes: z.string().optional(),
  send_via: z.enum(['whatsapp', 'email', 'in_person']),
});

type FormValues = z.infer<typeof schema>;

interface EstimateBuilderProps {
  jobId: string;
  estimate?: JobEstimate | null;
  onSuccess: () => void;
}

export function EstimateBuilder({ jobId, estimate, onSuccess }: EstimateBuilderProps) {
  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      labor_charge: estimate?.labor_charge ?? 0,
      parts_cost: estimate?.parts_cost ?? 0,
      valid_until: estimate?.valid_until ?? '',
      notes: estimate?.notes ?? '',
      send_via: 'whatsapp',
    },
  });

  const laborCharge = form.watch('labor_charge') ?? 0;
  const partsCost = form.watch('parts_cost') ?? 0;
  const total = laborCharge + partsCost;

  const sendMutation = useMutation({
    mutationFn: (values: FormValues) =>
      repairApi.createEstimate(jobId, {
        labor_charge: values.labor_charge,
        parts_cost: values.parts_cost,
        valid_until: values.valid_until || undefined,
        notes: values.notes || undefined,
        send_via: values.send_via,
      }),
    onSuccess: () => {
      toast.success('Estimate sent');
      onSuccess();
    },
    onError: (e) => {
      toast.error(e instanceof ApiError ? e.message : 'Failed to send estimate');
    },
  });

  const respondMutation = useMutation({
    mutationFn: (response: 'approved' | 'rejected') =>
      repairApi.respondEstimate(jobId, { response, method: 'in_person' }),
    onSuccess: (_, response) => {
      toast.success(`Estimate ${response}`);
      onSuccess();
    },
    onError: (e) => {
      toast.error(e instanceof ApiError ? e.message : 'Failed to update estimate');
    },
  });

  if (estimate && ['sent', 'approved', 'rejected'].includes(estimate.status)) {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-body-sm font-medium text-[var(--text-muted)]">Estimate</p>
            <p className="font-mono text-code text-[var(--text)]">{estimate.estimate_number}</p>
          </div>
          <StatusBadge status={estimate.status} />
        </div>

        <div className="rounded-md border border-[var(--border)] p-4 space-y-2">
          <div className="flex justify-between text-body-sm">
            <span className="text-[var(--text-muted)]">Labour</span>
            <Money amount={estimate.labor_charge} />
          </div>
          <div className="flex justify-between text-body-sm">
            <span className="text-[var(--text-muted)]">Parts</span>
            <Money amount={estimate.parts_cost} />
          </div>
          <div className="flex justify-between text-body font-semibold border-t border-[var(--border)] pt-2">
            <span>Total</span>
            <Money amount={estimate.total_estimate} />
          </div>
          {estimate.valid_until && (
            <p className="text-xs text-[var(--text-muted)]">Valid until {formatDate(estimate.valid_until)}</p>
          )}
        </div>

        {estimate.status === 'sent' && (
          <Can permission="repair.estimates.approve">
            <div className="flex gap-2">
              <Button
                className="flex-1"
                onClick={() => respondMutation.mutate('approved')}
                disabled={respondMutation.isPending}
              >
                Mark approved
              </Button>
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => respondMutation.mutate('rejected')}
                disabled={respondMutation.isPending}
              >
                Mark rejected
              </Button>
            </div>
          </Can>
        )}
      </div>
    );
  }

  return (
    <Can permission="repair.estimates.send">
      <Form {...form}>
        <form onSubmit={form.handleSubmit((v) => sendMutation.mutate(v))} className="space-y-4">
          <FormField control={form.control} name="labor_charge" render={({ field }) => (
            <FormItem>
              <FormLabel>Labour charge</FormLabel>
              <FormControl>
                <MoneyInput value={field.value} onChange={field.onChange} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )} />

          <FormField control={form.control} name="parts_cost" render={({ field }) => (
            <FormItem>
              <FormLabel>Parts cost</FormLabel>
              <FormControl>
                <MoneyInput value={field.value} onChange={field.onChange} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )} />

          <div className="rounded-md bg-[var(--surface-2)] p-3">
            <div className="flex justify-between text-body-sm font-semibold">
              <span>Total estimate</span>
              <Money amount={total} />
            </div>
          </div>

          <FormField control={form.control} name="valid_until" render={({ field }) => (
            <FormItem>
              <FormLabel>Valid until</FormLabel>
              <FormControl>
                <Input type="date" {...field} />
              </FormControl>
              <FormMessage />
            </FormItem>
          )} />

          <FormField control={form.control} name="notes" render={({ field }) => (
            <FormItem>
              <FormLabel>Notes for customer</FormLabel>
              <FormControl>
                <textarea
                  className="flex min-h-[72px] w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-body text-[var(--text)] placeholder:text-[var(--text-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] resize-none"
                  placeholder="SSD 512GB replacement + 2h labour…"
                  {...field}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )} />

          <FormField control={form.control} name="send_via" render={({ field }) => (
            <FormItem>
              <FormLabel>Send via</FormLabel>
              <Select onValueChange={field.onChange} defaultValue={field.value}>
                <FormControl>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem value="whatsapp">WhatsApp</SelectItem>
                  <SelectItem value="email">Email</SelectItem>
                  <SelectItem value="in_person">In person</SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )} />

          <Button type="submit" className="w-full" disabled={sendMutation.isPending}>
            {sendMutation.isPending ? 'Sending…' : 'Send estimate'}
          </Button>
        </form>
      </Form>
    </Can>
  );
}
