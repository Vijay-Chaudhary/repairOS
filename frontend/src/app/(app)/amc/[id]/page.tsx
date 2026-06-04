'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Building, MapPin, Calendar, CheckCircle2, AlertCircle, Clock, RotateCcw } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Money } from '@/components/shared/Money';
import { MoneyInput } from '@/components/shared/MoneyInput';
import { EmptyState } from '@/components/shared/EmptyState';
import { Can } from '@/components/shared/Can';
import { PhotoUploader } from '@/components/shared/PhotoUploader';
import { SignaturePad } from '@/components/shared/SignaturePad';
import { amcApi, PAYMENT_TERMS_LABELS, VISIT_STATUS_COLORS, type AmcVisit } from '@/lib/api/amc';
import { qk } from '@/lib/query/keys';
import { ApiError } from '@/lib/api/client';
import { formatDate } from '@/lib/format/date';
import { cn } from '@/lib/utils';

export default function AmcContractPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [selectedVisit, setSelectedVisit] = useState<AmcVisit | null>(null);
  const [renewOpen, setRenewOpen] = useState(false);
  const [renewEndDate, setRenewEndDate] = useState('');
  const [renewValue, setRenewValue] = useState(0);

  // Completion form state
  const [workDone, setWorkDone] = useState('');
  const [issuesFound, setIssuesFound] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [signature, setSignature] = useState<string | null>(null);

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
    mutationFn: () =>
      amcApi.completeVisit(selectedVisit!.id, {
        work_done: workDone,
        issues_found: issuesFound || undefined,
        customer_signature_url: signature ?? undefined,
        photos,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.amcContract(id) });
      queryClient.invalidateQueries({ queryKey: qk.amcVisits(id) });
      toast.success('Visit completed — next visit scheduled');
      setSelectedVisit(null);
      setWorkDone('');
      setIssuesFound('');
      setPhotos([]);
      setSignature(null);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });

  const renewMutation = useMutation({
    mutationFn: () =>
      amcApi.renewContract(id, {
        new_end_date: renewEndDate,
        new_value: renewValue > 0 ? renewValue : undefined,
      }),
    onSuccess: (c) => {
      queryClient.invalidateQueries({ queryKey: qk.amcContract(id) });
      toast.success(`Contract renewed — new expiry ${formatDate(c.end_date)}`);
      setRenewOpen(false);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Renewal failed'),
  });

  if (isLoading) {
    return <div className="p-4 space-y-3">{[1,2,3].map((i) => <Skeleton key={i} className="h-12" />)}</div>;
  }
  if (!contract) {
    return <EmptyState icon={Building} title="Contract not found" action={{ label: 'Back', onClick: () => router.back() }} />;
  }

  const visits = visitsData?.items ?? [];
  const daysToExpiry = Math.floor((new Date(contract.end_date).getTime() - Date.now()) / 86_400_000);
  const renewalDue = daysToExpiry <= contract.renewal_reminder_days && contract.status !== 'cancelled';

  const VISIT_ICON: Record<string, React.ReactNode> = {
    scheduled:   <Clock className="h-4 w-4 text-[var(--info)]" />,
    completed:   <CheckCircle2 className="h-4 w-4 text-[var(--success)]" />,
    missed:      <AlertCircle className="h-4 w-4 text-[var(--danger)]" />,
    rescheduled: <RotateCcw className="h-4 w-4 text-[var(--warning)]" />,
    cancelled:   <AlertCircle className="h-4 w-4 text-[var(--text-muted)]" />,
  };

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-6 pb-10">
      {/* Header */}
      <div className="flex items-start gap-3">
        <button onClick={() => router.back()} className="p-1.5 rounded-md hover:bg-[var(--surface-2)] text-[var(--text-muted)] mt-0.5">
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
        {renewalDue && (
          <Can permission="amc.renewals.manage">
            <Button size="sm" onClick={() => { setRenewEndDate(''); setRenewValue(contract.value); setRenewOpen(true); }}>
              Renew
            </Button>
          </Can>
        )}
      </div>

      {/* Renewal due banner */}
      {renewalDue && (
        <div className="flex items-center gap-2 rounded-lg border border-[var(--warning)]/30 bg-[var(--warning)]/10 px-4 py-3">
          <AlertCircle className="h-4 w-4 text-[var(--warning)] shrink-0" />
          <p className="text-body-sm text-[var(--warning)]">
            {daysToExpiry > 0 ? `Expires in ${daysToExpiry} days` : 'Expired'} — renewal recommended
          </p>
        </div>
      )}

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
        <h2 className="text-body-sm font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-3">Visit schedule</h2>
        {visitsLoading ? (
          <div className="space-y-2">{[1,2,3].map((i) => <Skeleton key={i} className="h-12" />)}</div>
        ) : visits.length === 0 ? (
          <p className="text-body-sm text-[var(--text-muted)] py-4">No visits scheduled.</p>
        ) : (
          <div className="relative space-y-3">
            <div className="absolute left-[19px] top-5 bottom-5 w-px bg-[var(--border)]" />
            {visits.map((visit) => (
              <div key={visit.id} className="flex gap-3 relative">
                <div className="w-10 h-10 rounded-full border-2 border-[var(--border)] bg-[var(--surface)] flex items-center justify-center shrink-0 z-10">
                  {VISIT_ICON[visit.status]}
                </div>
                <div className={cn(
                  'flex-1 rounded-lg border p-3',
                  visit.status === 'missed' ? 'border-[var(--danger)]/30 bg-[var(--danger)]/5' : 'border-[var(--border)] bg-[var(--surface)]',
                )}>
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="text-body-sm font-medium text-[var(--text)]">
                        Visit {visit.visit_number} · {formatDate(visit.scheduled_date)}
                      </p>
                      {visit.technician_name && (
                        <p className="text-xs text-[var(--text-muted)]">{visit.technician_name}</p>
                      )}
                      {visit.work_done && (
                        <p className="text-xs text-[var(--text-muted)] mt-0.5 italic">{visit.work_done}</p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className={cn('text-[10px] font-semibold rounded px-1.5 py-0.5', VISIT_STATUS_COLORS[visit.status])}>
                        {visit.status.replace('_', ' ')}
                      </span>
                      {visit.status === 'scheduled' && (
                        <Can permission="amc.visits.complete">
                          <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setSelectedVisit(visit)}>
                            Complete
                          </Button>
                        </Can>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Complete visit dialog */}
      <Dialog open={!!selectedVisit} onOpenChange={(v) => !v && setSelectedVisit(null)}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Complete visit {selectedVisit?.visit_number}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-body-sm font-medium text-[var(--text)] block mb-1">
                Work done <span className="text-[var(--danger)]">*</span>
              </label>
              <textarea
                className="flex min-h-[80px] w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-body text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] resize-none"
                placeholder="Describe the work done during this visit…"
                value={workDone}
                onChange={(e) => setWorkDone(e.target.value)}
              />
            </div>
            <div>
              <label className="text-body-sm font-medium text-[var(--text)] block mb-1">Issues found</label>
              <Input placeholder="Any issues found or recommendations…" value={issuesFound} onChange={(e) => setIssuesFound(e.target.value)} />
            </div>
            <div>
              <p className="text-body-sm font-medium text-[var(--text)] mb-2">Photos</p>
              <PhotoUploader value={photos} onChange={setPhotos} />
            </div>
            <div>
              <p className="text-body-sm font-medium text-[var(--text)] mb-2">Customer signature</p>
              <SignaturePad onChange={setSignature} />
            </div>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setSelectedVisit(null)}>Cancel</Button>
              <Button
                className="flex-1"
                disabled={!workDone.trim() || completeMutation.isPending}
                onClick={() => completeMutation.mutate()}
              >
                {completeMutation.isPending ? 'Saving…' : 'Mark complete'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Renew dialog */}
      <Dialog open={renewOpen} onOpenChange={setRenewOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Renew contract</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <p className="text-body-sm text-[var(--text-muted)]">
              Current expiry: {formatDate(contract.end_date)}. Renewal will generate an invoice.
            </p>
            <div>
              <label className="text-body-sm font-medium text-[var(--text)] block mb-1">New end date *</label>
              <Input type="date" value={renewEndDate} onChange={(e) => setRenewEndDate(e.target.value)} />
            </div>
            <div>
              <label className="text-body-sm font-medium text-[var(--text)] block mb-1">New value</label>
              <MoneyInput value={renewValue} onChange={setRenewValue} />
            </div>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setRenewOpen(false)}>Cancel</Button>
              <Button
                className="flex-1"
                disabled={!renewEndDate || renewMutation.isPending}
                onClick={() => renewMutation.mutate()}
              >
                {renewMutation.isPending ? 'Renewing…' : 'Confirm renewal'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
