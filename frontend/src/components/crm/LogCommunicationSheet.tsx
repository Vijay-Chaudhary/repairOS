'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { crmApi, COMM_TYPE_LABELS, type CommType, type CommDirection } from '@/lib/api/crm';
import { qk } from '@/lib/query/keys';
import { ApiError } from '@/lib/api/client';

const schema = z.object({
  type: z.enum(['call', 'whatsapp', 'visit', 'email', 'sms', 'note']),
  direction: z.enum(['inbound', 'outbound']).optional(),
  summary: z.string().min(1, 'Summary is required'),
  duration_minutes: z.number().min(1).optional(),
});

type FormValues = z.infer<typeof schema>;

const TYPES_WITH_DIRECTION: CommType[] = ['call', 'whatsapp', 'email', 'sms'];

interface LogCommunicationSheetProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  customerId?: string;
  leadId?: string;
}

export function LogCommunicationSheet({ open, onOpenChange, customerId, leadId }: LogCommunicationSheetProps) {
  const queryClient = useQueryClient();

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { type: 'call', direction: 'inbound', summary: '' },
  });

  const commType = form.watch('type') as CommType;
  const showDirection = TYPES_WITH_DIRECTION.includes(commType);
  const showDuration = commType === 'call';

  const mutation = useMutation({
    mutationFn: (values: FormValues) =>
      crmApi.logCommunication({
        customer_id: customerId,
        lead_id: leadId,
        type: values.type,
        direction: values.direction as CommDirection | undefined,
        summary: values.summary,
        duration_minutes: values.duration_minutes,
      }),
    onSuccess: () => {
      if (customerId) {
        queryClient.invalidateQueries({ queryKey: qk.customerTimeline(customerId) });
        queryClient.invalidateQueries({ queryKey: qk.customer(customerId) });
      }
      if (leadId) {
        queryClient.invalidateQueries({ queryKey: qk.lead(leadId) });
      }
      toast.success('Communication logged');
      form.reset();
      onOpenChange(false);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to log'),
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Log communication</SheetTitle>
        </SheetHeader>

        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="mt-6 space-y-4">
            <FormField control={form.control} name="type" render={({ field }) => (
              <FormItem>
                <FormLabel>Type</FormLabel>
                <Select onValueChange={field.onChange} value={field.value}>
                  <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                  <SelectContent>
                    {(Object.keys(COMM_TYPE_LABELS) as CommType[]).map((t) => (
                      <SelectItem key={t} value={t}>{COMM_TYPE_LABELS[t]}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FormMessage />
              </FormItem>
            )} />

            {showDirection && (
              <FormField control={form.control} name="direction" render={({ field }) => (
                <FormItem>
                  <FormLabel>Direction</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value ?? ''}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      <SelectItem value="inbound">Inbound</SelectItem>
                      <SelectItem value="outbound">Outbound</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
            )}

            <FormField control={form.control} name="summary" render={({ field }) => (
              <FormItem>
                <FormLabel>Summary *</FormLabel>
                <FormControl>
                  <textarea
                    className="flex min-h-[80px] w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-body text-[var(--text)] placeholder:text-[var(--text-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] resize-none"
                    placeholder="What was discussed…"
                    {...field}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )} />

            {showDuration && (
              <FormField control={form.control} name="duration_minutes" render={({ field }) => (
                <FormItem>
                  <FormLabel>Duration (minutes)</FormLabel>
                  <FormControl>
                    <Input
                      type="number"
                      inputMode="numeric"
                      min={1}
                      placeholder="5"
                      value={field.value ?? ''}
                      onChange={(e) => field.onChange(e.target.value ? parseInt(e.target.value, 10) : undefined)}
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            )}

            <div className="flex gap-3 pt-2">
              <Button type="button" variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" className="flex-1" disabled={mutation.isPending}>
                {mutation.isPending ? 'Saving…' : 'Log communication'}
              </Button>
            </div>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}
