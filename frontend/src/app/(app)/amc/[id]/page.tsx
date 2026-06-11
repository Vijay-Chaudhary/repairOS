'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Building, MapPin } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Money } from '@/components/shared/Money';
import { EmptyState } from '@/components/shared/EmptyState';
import {
  VisitTimeline,
  VisitCompleteDialog,
  RescheduleDialog,
  RenewalPanel,
  type CompletePayload,
} from '@/components/amc';
import { amcApi, PAYMENT_TERMS_LABELS, type AmcVisit } from '@/lib/api/amc';
import { qk } from '@/lib/query/keys';
import { ApiError } from '@/lib/api/client';
import { formatDate } from '@/lib/format/date';

export default function AmcContractPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [selectedVisit, setSelectedVisit] = useState<AmcVisit | null>(null);
  const [rescheduleVisit, setRescheduleVisit] = useState<AmcVisit | null>(null);

  const { data: contract, isLoading } = useQuery({
    queryKey: qk.amcContract(id),
    queryFn: () => amcApi.getContract(id),
    staleTime: 30_000,
  });

  const { data: visitsData, isLoading: visitsLoading } = useQuery({
    queryKey: qk.amcVisits(id),
    queryFn: () => amcApi.getVisits(id),
    staleTime: 30_000,
    enabled: !!contract,
  });

  const completeMutation = useMutation({
    mutationFn: (payload: CompletePayload) =>
      amcApi.completeVisit(selectedVisit!.id, {
        work_done: payload.work_done,
        issues_found: payload.issues_found || undefined,
        customer_signature_url: payload.signature ?? undefined,
        photos: payload.photos,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.amcContract(id) });
      queryClient.invalidateQueries({ queryKey: qk.amcVisits(id) });
      toast.success('Visit completed — next visit scheduled');
      setSelectedVisit(null);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });

  const rescheduleMutation = useMutation({
    mutationFn: (newDate: string) =>
      amcApi.rescheduleVisit(rescheduleVisit!.id, { new_date: newDate }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.amcVisits(id) });
      toast.success('Visit rescheduled');
      setRescheduleVisit(null);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Reschedule failed'),
  });

  const renewMutation = useMutation({
    mutationFn: ({ newEndDate, newValue }: { newEndDate: string; newValue?: number }) =>
      amcApi.renewContract(id, { new_end_date: newEndDate, new_value: newValue }),
    onSuccess: (c) => {
      queryClient.invalidateQueries({ queryKey: qk.amcContract(id) });
      toast.success(`Contract renewed — new expiry ${formatDate(c.end_date)}`);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Renewal failed'),
  });

  if (isLoading) {
    return <div className="p-4 space-y-3">{[1, 2, 3].map((i) => <Skeleton key={i} className="h-12" />)}</div>;
  }
  if (!contract) {
    return <EmptyState icon={Building} title="Contract not found" action={{ label: 'Back', onClick: () => router.back() }} />;
  }

  const visits = visitsData?.items ?? [];
  const daysToExpiry = Math.floor((new Date(contract.end_date).getTime() - Date.now()) / 86_400_000);
  const renewalDue = daysToExpiry <= contract.renewal_reminder_days && contract.status !== 'cancelled';

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-6 pb-10">
      {/* Header */}
      <div className="flex items-start gap-3">
        <button
          onClick={() => router.back()}
          className="p-1.5 rounded-md hover:bg-[var(--surface-2)] text-[var(--text-muted)] mt-0.5"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-code text-[var(--text-muted)]">{contract.contract_number}</span>
            <StatusBadge status={contract.status} />
          </div>
          <h1 className="text-h1 text-[var(--text)] mt-0.5">{contract.title}</h1>
          <p className="text-body-sm text-[var(--text-muted)]">{contract.customer_name}</p>
        </div>
      </div>

      <RenewalPanel
        contract={contract}
        daysToExpiry={daysToExpiry}
        renewalDue={renewalDue}
        onConfirm={(newEndDate, newValue) => renewMutation.mutate({ newEndDate, newValue })}
        isSubmitting={renewMutation.isPending}
      />

      {/* Contract details */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded-lg border border-[var(--border)] px-3 py-2">
          <p className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wide">Value</p>
          <Money amount={contract.value} className="text-body font-semibold" />
        </div>
        <div className="rounded-lg border border-[var(--border)] px-3 py-2">
          <p className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wide">Visits / year</p>
          <p className="text-body font-semibold text-[var(--text)]">{contract.visits_per_year}</p>
        </div>
        <div className="rounded-lg border border-[var(--border)] px-3 py-2 col-span-2">
          <p className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wide">Period</p>
          <p className="text-body-sm text-[var(--text)]">
            {formatDate(contract.start_date)} – {formatDate(contract.end_date)}
            <span className="text-[var(--text-muted)] ml-2">({PAYMENT_TERMS_LABELS[contract.payment_terms]})</span>
          </p>
        </div>
        {contract.location_address && (
          <div className="rounded-lg border border-[var(--border)] px-3 py-2 col-span-2 flex items-start gap-2">
            <MapPin className="h-4 w-4 text-[var(--text-muted)] mt-0.5 shrink-0" />
            <p className="text-body-sm text-[var(--text)]">{contract.location_address}</p>
          </div>
        )}
      </div>

      {/* Visit timeline */}
      <div>
        <h2 className="text-body-sm font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-3">
          Visit schedule
        </h2>
        <VisitTimeline
          visits={visits}
          isLoading={visitsLoading}
          onComplete={setSelectedVisit}
          onReschedule={setRescheduleVisit}
        />
      </div>

      <VisitCompleteDialog
        visit={selectedVisit}
        onOpenChange={(open) => { if (!open) setSelectedVisit(null); }}
        onSubmit={(payload) => completeMutation.mutate(payload)}
        isPending={completeMutation.isPending}
      />
      <RescheduleDialog
        visit={rescheduleVisit}
        onOpenChange={(open) => { if (!open) setRescheduleVisit(null); }}
        onSubmit={(newDate) => rescheduleMutation.mutate(newDate)}
        isPending={rescheduleMutation.isPending}
      />
    </div>
  );
}
