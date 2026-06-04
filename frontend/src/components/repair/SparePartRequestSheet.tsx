'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { repairApi, type SparePartRequest, type SparePartStatus } from '@/lib/api/repair';
import { qk } from '@/lib/query/keys';
import { ApiError } from '@/lib/api/client';
import { Can } from '@/components/shared/Can';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { formatDate } from '@/lib/format/date';

const schema = z.object({
  custom_part_name: z.string().min(2, 'Part name required'),
  quantity: z.number().int().min(1, 'Min quantity is 1'),
  is_urgent: z.boolean(),
});

type FormValues = z.infer<typeof schema>;

interface SparePartRequestSheetProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  jobId: string;
  requests: SparePartRequest[];
}

export function SparePartRequestSheet({ open, onOpenChange, jobId, requests }: SparePartRequestSheetProps) {
  const queryClient = useQueryClient();

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: { custom_part_name: '', quantity: 1, is_urgent: false },
  });

  const requestMutation = useMutation({
    mutationFn: (values: FormValues) =>
      repairApi.requestSparePart(jobId, {
        custom_part_name: values.custom_part_name,
        quantity: values.quantity,
        is_urgent: values.is_urgent,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.job(jobId) });
      toast.success('Part requested');
      form.reset();
    },
    onError: (e) => {
      toast.error(e instanceof ApiError ? e.message : 'Failed to request part');
    },
  });

  const reviewMutation = useMutation({
    mutationFn: ({ partId, status }: { partId: string; status: SparePartStatus }) =>
      repairApi.reviewSparePart(partId, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.job(jobId) });
      toast.success('Request updated');
    },
    onError: (e) => {
      toast.error(e instanceof ApiError ? e.message : 'Failed to update request');
    },
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Spare Part Requests</SheetTitle>
        </SheetHeader>

        <div className="mt-6 space-y-6">
          {/* Existing requests */}
          {requests.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-body-sm font-semibold text-[var(--text-muted)] uppercase tracking-wide">
                Requests ({requests.length})
              </h3>
              {requests.map((req) => (
                <div key={req.id} className="rounded-md border border-[var(--border)] p-3 space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-body-sm font-medium text-[var(--text)]">
                        {req.custom_part_name ?? req.variant_name ?? 'Unknown part'}
                      </p>
                      <p className="text-xs text-[var(--text-muted)]">
                        Qty: {req.quantity} · {req.requested_by_name ?? 'Technician'}
                        {req.is_urgent && ' · 🔴 Urgent'}
                      </p>
                      <p className="text-xs text-[var(--text-muted)]">{formatDate(req.created_at)}</p>
                    </div>
                    <StatusBadge status={req.status} />
                  </div>

                  {req.status === 'requested' && (
                    <Can permission="repair.spare_parts.approve">
                      <div className="flex gap-2 pt-1">
                        <Button
                          size="sm"
                          className="h-8 text-xs min-h-[auto] flex-1"
                          onClick={() => reviewMutation.mutate({ partId: req.id, status: 'approved' })}
                          disabled={reviewMutation.isPending}
                        >
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8 text-xs min-h-[auto] flex-1"
                          onClick={() => reviewMutation.mutate({ partId: req.id, status: 'rejected' })}
                          disabled={reviewMutation.isPending}
                        >
                          Reject
                        </Button>
                      </div>
                    </Can>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* New request form */}
          <Can permission="repair.spare_parts.request">
            <div className="space-y-3">
              <h3 className="text-body-sm font-semibold text-[var(--text-muted)] uppercase tracking-wide">
                New Request
              </h3>
              <Form {...form}>
                <form onSubmit={form.handleSubmit((v) => requestMutation.mutate(v))} className="space-y-3">
                  <FormField control={form.control} name="custom_part_name" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Part name</FormLabel>
                      <FormControl>
                        <Input placeholder="Hinge bracket (OEM), screen assembly…" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />

                  <FormField control={form.control} name="quantity" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Quantity</FormLabel>
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

                  <FormField control={form.control} name="is_urgent" render={({ field }) => (
                    <FormItem className="flex items-center justify-between">
                      <FormLabel>Urgent</FormLabel>
                      <FormControl>
                        <Switch checked={field.value} onCheckedChange={field.onChange} />
                      </FormControl>
                    </FormItem>
                  )} />

                  <Button type="submit" className="w-full" disabled={requestMutation.isPending}>
                    {requestMutation.isPending ? 'Requesting…' : 'Request part'}
                  </Button>
                </form>
              </Form>
            </div>
          </Can>
        </div>
      </SheetContent>
    </Sheet>
  );
}
