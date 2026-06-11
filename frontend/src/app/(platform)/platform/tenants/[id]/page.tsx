'use client';

import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { useState } from 'react';
import {
  platformApi, DB_STATUS_LABELS, DB_STATUS_COLORS, SUB_STATUS_LABELS,
  type TenantDetail,
} from '@/lib/api/platform';
import { ApiError } from '@/lib/api/client';
import { formatDate } from '@/lib/format/date';
import { money } from '@/lib/format/money';
import { qk } from '@/lib/query/keys';
import { cn } from '@/lib/utils';

const PLAN_LABELS: Record<string, string> = {
  starter: 'Starter',
  professional: 'Professional',
  enterprise: 'Enterprise',
};

const TENANT_STATUS_COLORS: Record<string, string> = {
  active: 'bg-[var(--success)]/10 text-[var(--success)]',
  provisioning: 'bg-[var(--warning)]/10 text-[var(--warning)]',
  provisioning_failed: 'bg-[var(--danger)]/10 text-[var(--danger)]',
  suspended: 'bg-[var(--danger)]/10 text-[var(--danger)]',
  deleted: 'bg-[var(--text-muted)]/10 text-[var(--text-muted)]',
};

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 py-3 border-b border-[var(--border)] last:border-0">
      <span className="text-xs text-[var(--text-muted)]">{label}</span>
      <span className="text-body-sm text-[var(--text)]">{children}</span>
    </div>
  );
}

export default function TenantDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const [showSuspend, setShowSuspend] = useState(false);

  const { data: tenant, isLoading, error } = useQuery({
    queryKey: qk.tenant(id),
    queryFn: () => platformApi.getTenant(id),
    staleTime: 30_000,
  });

  const suspendMutation = useMutation({
    mutationFn: () => platformApi.suspendTenant(id),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: qk.tenant(id) });
      queryClient.invalidateQueries({ queryKey: qk.tenants() });
      toast.success(`${updated.name} has been suspended`);
      setShowSuspend(false);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to suspend'),
  });

  if (isLoading) {
    return (
      <div className="p-6 max-w-3xl mx-auto space-y-4">
        <Skeleton className="h-6 w-32" />
        <Skeleton className="h-10 w-56" />
        <div className="grid grid-cols-2 gap-4 mt-6">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-20 rounded-lg" />)}
        </div>
      </div>
    );
  }

  if (error || !tenant) {
    return (
      <div className="p-6 max-w-3xl mx-auto">
        <button
          onClick={() => router.back()}
          className="flex items-center gap-1.5 text-body-sm text-[var(--text-muted)] hover:text-[var(--text)] mb-6"
        >
          <ArrowLeft className="h-4 w-4" /> Back
        </button>
        <p className="text-body-sm text-[var(--danger)]">Failed to load tenant details.</p>
      </div>
    );
  }

  const canSuspend = tenant.status === 'active';

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-6">
      {/* Back */}
      <button
        onClick={() => router.push('/platform/tenants')}
        className="flex items-center gap-1.5 text-body-sm text-[var(--text-muted)] hover:text-[var(--text)]"
      >
        <ArrowLeft className="h-4 w-4" /> All tenants
      </button>

      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-h1 text-[var(--text)]">{tenant.name}</h1>
          <p className="font-mono text-sm text-[var(--text-muted)] mt-0.5">{tenant.slug}</p>
        </div>
        <div className="flex items-center gap-3 flex-shrink-0">
          <span className={cn(
            'text-xs font-medium px-2.5 py-1 rounded-full capitalize',
            TENANT_STATUS_COLORS[tenant.status] ?? 'bg-[var(--surface-2)] text-[var(--text-muted)]',
          )}>
            {tenant.status.replace(/_/g, ' ')}
          </span>
          {canSuspend && (
            <Button
              size="sm"
              variant="outline"
              className="text-[var(--danger)] border-[var(--danger)]/30 hover:bg-[var(--danger)]/10 hover:text-[var(--danger)]"
              onClick={() => setShowSuspend(true)}
            >
              Suspend
            </Button>
          )}
        </div>
      </div>

      {/* Info grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Tenant info */}
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
          <h2 className="text-body-sm font-medium text-[var(--text)] mb-1">Tenant info</h2>
          <DetailRow label="Owner email">{tenant.owner_email}</DetailRow>
          <DetailRow label="Owner phone">{tenant.owner_phone}</DetailRow>
          <DetailRow label="Plan">{PLAN_LABELS[tenant.plan] ?? tenant.plan}</DetailRow>
          <DetailRow label="Created">{formatDate(tenant.created_at)}</DetailRow>
          <DetailRow label="Last updated">{formatDate(tenant.updated_at)}</DetailRow>
        </div>

        {/* DB / subscription */}
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
          <h2 className="text-body-sm font-medium text-[var(--text)] mb-1">Database & subscription</h2>
          <DetailRow label="DB status">
            <span className={cn('font-medium', DB_STATUS_COLORS[tenant.db_status])}>
              {DB_STATUS_LABELS[tenant.db_status]}
            </span>
          </DetailRow>
          {tenant.subscription ? (
            <>
              <DetailRow label="Subscription plan">{tenant.subscription.plan.name}</DetailRow>
              <DetailRow label="Subscription status">
                <span className={cn(
                  'text-xs font-medium px-2 py-0.5 rounded-full',
                  tenant.subscription.status === 'active' || tenant.subscription.status === 'trialing'
                    ? 'bg-[var(--success)]/10 text-[var(--success)]'
                    : 'bg-[var(--danger)]/10 text-[var(--danger)]',
                )}>
                  {SUB_STATUS_LABELS[tenant.subscription.status]}
                </span>
              </DetailRow>
              <DetailRow label="Billing period">
                {formatDate(tenant.subscription.current_period_start)} –{' '}
                {formatDate(tenant.subscription.current_period_end)}
              </DetailRow>
              <DetailRow label="Monthly price">
                {money(parseFloat(tenant.subscription.plan.price_monthly_inr))}
              </DetailRow>
            </>
          ) : (
            <DetailRow label="Subscription">No subscription on record</DetailRow>
          )}
        </div>
      </div>

      {/* Plan features */}
      {tenant.subscription?.plan.features && (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
          <h2 className="text-body-sm font-medium text-[var(--text)] mb-3">Plan features</h2>
          <div className="flex flex-wrap gap-2">
            {Object.entries(tenant.subscription.plan.features).map(([key, enabled]) => (
              <span
                key={key}
                className={cn(
                  'text-xs px-2.5 py-1 rounded-full font-medium',
                  enabled
                    ? 'bg-[var(--success)]/10 text-[var(--success)]'
                    : 'bg-[var(--surface-2)] text-[var(--text-muted)] line-through',
                )}
              >
                {key.replace(/_/g, ' ')}
              </span>
            ))}
          </div>
        </div>
      )}

      <ConfirmDialog
        open={showSuspend}
        onOpenChange={(v) => { if (!v) setShowSuspend(false); }}
        title={`Suspend ${tenant.name}?`}
        description="Their users will be blocked from logging in immediately. You can reactivate from the database."
        confirmLabel="Suspend tenant"
        loading={suspendMutation.isPending}
        onConfirm={() => suspendMutation.mutate()}
      />
    </div>
  );
}
