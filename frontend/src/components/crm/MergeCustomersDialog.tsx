'use client';

import { useState } from 'react';
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowRight, AlertTriangle } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { CustomerSearch, type CustomerOption } from '@/components/repair/CustomerSearch';
import { Money } from '@/components/shared/Money';
import { crmApi, type Customer } from '@/lib/api/crm';
import { qk } from '@/lib/query/keys';
import { ApiError } from '@/lib/api/client';

interface MergeCustomersDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  sourceCustomer: Customer;
  onSuccess: () => void;
}

export function MergeCustomersDialog({ open, onOpenChange, sourceCustomer, onSuccess }: MergeCustomersDialogProps) {
  const queryClient = useQueryClient();
  const [target, setTarget] = useState<CustomerOption | null>(null);
  const [confirmed, setConfirmed] = useState(false);

  const { data: targetDetail, isLoading: targetLoading } = useQuery({
    queryKey: qk.customer(target?.id ?? ''),
    queryFn: () => crmApi.getCustomer(target!.id),
    enabled: !!target,
  });

  const mergeMutation = useMutation({
    mutationFn: () => crmApi.mergeCustomers({ source_id: sourceCustomer.id, target_id: target!.id }),
    onSuccess: (merged) => {
      queryClient.invalidateQueries({ queryKey: qk.customers() });
      queryClient.invalidateQueries({ queryKey: qk.customer(merged.id) });
      toast.success('Customers merged');
      onSuccess();
      onOpenChange(false);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Merge failed'),
  });

  function handleClose() {
    setTarget(null);
    setConfirmed(false);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Merge customers</DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          {/* Source customer */}
          <div className="rounded-lg border border-[var(--border)] p-4">
            <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-2">
              Source (will be deleted)
            </p>
            <CustomerSummary customer={sourceCustomer} />
          </div>

          {/* Arrow */}
          <div className="flex items-center justify-center gap-2 text-[var(--text-muted)]">
            <ArrowRight className="h-4 w-4" />
            <span className="text-body-sm">merge into</span>
          </div>

          {/* Target customer picker */}
          <div>
            <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-2">
              Target (kept, gains all data)
            </p>
            {target && targetDetail ? (
              <div className="rounded-lg border border-[var(--accent)]/30 bg-[var(--accent)]/5 p-4">
                <CustomerSummary customer={targetDetail} />
                <Button size="sm" variant="ghost" className="mt-2 text-xs" onClick={() => setTarget(null)}>
                  Change
                </Button>
              </div>
            ) : targetLoading ? (
              <Skeleton className="h-20 w-full rounded-lg" />
            ) : (
              <CustomerSearch
                value={null}
                onChange={(c) => {
                  if (c?.id === sourceCustomer.id) {
                    toast.error('Cannot merge a customer with itself');
                    return;
                  }
                  setTarget(c);
                  setConfirmed(false);
                }}
              />
            )}
          </div>

          {/* Preview merged totals */}
          {targetDetail && (
            <div className="rounded-lg bg-[var(--surface-2)] border border-[var(--border)] p-4 space-y-2">
              <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">After merge (target gains)</p>
              <div className="grid grid-cols-3 gap-2 text-center">
                <div>
                  <p className="text-xs text-[var(--text-muted)]">Jobs</p>
                  <p className="text-body font-semibold font-mono">{sourceCustomer.total_jobs + targetDetail.total_jobs}</p>
                </div>
                <div>
                  <p className="text-xs text-[var(--text-muted)]">Billed</p>
                  <Money amount={sourceCustomer.total_billed + targetDetail.total_billed} className="text-body font-semibold" />
                </div>
                <div>
                  <p className="text-xs text-[var(--text-muted)]">Outstanding</p>
                  <Money amount={sourceCustomer.total_outstanding + targetDetail.total_outstanding} className="text-body font-semibold" />
                </div>
              </div>
            </div>
          )}

          {/* Warning */}
          {target && (
            <div className="flex items-start gap-2 rounded-lg border border-[var(--warning)]/30 bg-[var(--warning)]/10 p-3">
              <AlertTriangle className="h-4 w-4 text-[var(--warning)] shrink-0 mt-0.5" />
              <p className="text-body-sm text-[var(--warning)]">
                This is irreversible. All jobs, sales, contracts, communications, and tasks from{' '}
                <strong>{sourceCustomer.name}</strong> will be repointed to{' '}
                <strong>{target.name}</strong>, and the source record will be deleted.
              </p>
            </div>
          )}

          {/* Confirm checkbox */}
          {target && (
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={confirmed}
                onChange={(e) => setConfirmed(e.target.checked)}
                className="rounded border-[var(--border)]"
              />
              <span className="text-body-sm text-[var(--text)]">I understand this cannot be undone</span>
            </label>
          )}

          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" onClick={handleClose}>Cancel</Button>
            <Button
              variant="destructive"
              className="flex-1"
              disabled={!target || !confirmed || mergeMutation.isPending}
              onClick={() => mergeMutation.mutate()}
            >
              {mergeMutation.isPending ? 'Merging…' : 'Merge customers'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CustomerSummary({ customer }: { customer: Customer }) {
  return (
    <div>
      <p className="text-body-sm font-medium text-[var(--text)]">{customer.name}</p>
      <p className="text-xs text-[var(--text-muted)]">{customer.phone}</p>
      <p className="text-xs text-[var(--text-muted)]">
        {customer.total_jobs} jobs · <Money amount={customer.total_billed} className="text-xs" /> billed
      </p>
    </div>
  );
}
