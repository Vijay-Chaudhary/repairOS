'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  ArrowLeft, Wrench, User, Calendar, MapPin, Shield,
  AlertTriangle, Star, ExternalLink, Plus, ChevronLeft, ChevronRight,
} from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Money } from '@/components/shared/Money';
import { Can } from '@/components/shared/Can';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { EntityTimeline } from '@/components/shared/EntityTimeline';
import { EmptyState } from '@/components/shared/EmptyState';
import { JobStatusStepper } from '@/components/repair/JobStatusStepper';
import { CheckinForm } from '@/components/repair/CheckinForm';
import { EstimateBuilder } from '@/components/repair/EstimateBuilder';
import { StageWorkflow } from '@/components/repair/StageWorkflow';
import { SparePartRequestSheet } from '@/components/repair/SparePartRequestSheet';
import { StaffPicker } from '@/components/shared/StaffPicker';
import { GenerateInvoiceDialog } from '@/components/billing/GenerateInvoiceDialog';
import {
  repairApi, STATUS_TRANSITIONS, STAGE_LABELS,
  type JobStatus, type StageType,
} from '@/lib/api/repair';
import { qk } from '@/lib/query/keys';
import { ApiError } from '@/lib/api/client';
import { formatDate, formatDatetime } from '@/lib/format/date';
import { money } from '@/lib/format/money';
import { useAuthStore } from '@/lib/stores/authStore';
import { cn } from '@/lib/utils';

const PRIORITY_BADGE: Record<string, { icon: React.ReactNode; className: string }> = {
  urgent: {
    icon: <AlertTriangle className="h-3.5 w-3.5" />,
    className: 'text-[var(--warning)] bg-[var(--warning)]/10 border-[var(--warning)]/30',
  },
  vip: {
    icon: <Star className="h-3.5 w-3.5" />,
    className: 'text-[var(--accent)] bg-[var(--accent)]/10 border-[var(--accent)]/30',
  },
};

const STAGE_TYPE_OPTIONS: StageType[] = ['diagnosis', 'repair', 'parts_install', 'testing', 'qc', 'packing'];

// ── Page ──────────────────────────────────────────────────────────────────────

export default function JobDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user } = useAuthStore();

  const [partsSheetOpen, setPartsSheetOpen] = useState(false);
  const [stagesDialogOpen, setStagesDialogOpen] = useState(false);
  const [generateInvoiceOpen, setGenerateInvoiceOpen] = useState(false);
  const [pendingTransition, setPendingTransition] = useState<{ to: JobStatus; label: string; requiresReason?: boolean } | null>(null);
  const [transitionReason, setTransitionReason] = useState('');
  const [warrantyConfirmOpen, setWarrantyConfirmOpen] = useState(false);
  const [timelineCursor, setTimelineCursor] = useState<string | undefined>(undefined);

  const { data: job, isLoading, error } = useQuery({
    queryKey: qk.job(id),
    queryFn: () => repairApi.getJob(id),
    staleTime: 30_000,
  });

  const { data: timelineData, isLoading: timelineLoading } = useQuery({
    queryKey: [...qk.jobTimeline(id), timelineCursor],
    queryFn: () => repairApi.getTimeline(id, timelineCursor),
    staleTime: 60_000,
  });

  const hasDevice = !!(job?.serial_number || job?.imei);
  const { data: deviceHistory } = useQuery({
    queryKey: qk.deviceHistory({ serial: job?.serial_number ?? '', imei: job?.imei ?? '' }),
    queryFn: () => repairApi.getDeviceHistory({ serial: job?.serial_number ?? undefined, imei: job?.imei ?? undefined }),
    enabled: hasDevice,
    staleTime: 60_000,
  });
  const otherDeviceJobs = (deviceHistory?.items ?? []).filter((r) => r.job_id !== id);

  const statusMutation = useMutation({
    mutationFn: ({ to, reason }: { to: JobStatus; reason?: string }) =>
      repairApi.changeStatus(id, { to_status: to, reason }),
    onSuccess: (updated) => {
      queryClient.invalidateQueries({ queryKey: qk.job(id) });
      queryClient.invalidateQueries({ queryKey: qk.jobs() });
      toast.success(`Status updated to ${updated.status.replace(/_/g, ' ')}`);
      setPendingTransition(null);
      setTransitionReason('');
    },
    onError: (e) => {
      if (e instanceof ApiError && e.code === 'INVALID_STATUS_TRANSITION') {
        toast.error('This job was updated elsewhere — refreshing');
        queryClient.invalidateQueries({ queryKey: qk.job(id) });
      } else {
        toast.error(e instanceof ApiError ? e.message : 'Status change failed');
      }
      setPendingTransition(null);
    },
  });

  const checkinMutation = useMutation({
    mutationFn: (data: Parameters<typeof repairApi.submitCheckin>[1]) =>
      repairApi.submitCheckin(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.job(id) });
      toast.success('Check-in saved');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Check-in failed'),
  });

  const warrantyMutation = useMutation({
    mutationFn: () => repairApi.warrantyClaim(id),
    onSuccess: (newJob) => {
      toast.success(`Warranty job ${newJob.job_number} created`);
      router.push(`/jobs/${newJob.id}`);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Warranty claim failed'),
  });

  // ── Loading / error states ────────────────────────────────────────────────

  if (isLoading) {
    return (
      <div className="p-4 md:p-6 space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-6 w-64" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (error || !job) {
    return (
      <EmptyState
        icon={Wrench}
        title="Job not found"
        description="This job doesn't exist or you don't have access."
        action={{ label: 'Back to jobs', onClick: () => router.push('/jobs') }}
      />
    );
  }

  const transitions = STATUS_TRANSITIONS[job.status] ?? [];
  const priorityBadge = PRIORITY_BADGE[job.priority];
  const isWarrantyExpired = job.warranty_expires_at
    ? new Date(job.warranty_expires_at) < new Date()
    : true;

  function handleTransition(t: typeof transitions[0]) {
    if (t.requiresReason) {
      setPendingTransition(t);
    } else {
      statusMutation.mutate({ to: t.to });
    }
  }

  return (
    <div className="flex flex-col min-h-full">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="border-b border-[var(--border)] bg-[var(--surface)] px-4 pt-4 pb-3">
        <div className="flex items-center gap-2 mb-3">
          <button
            onClick={() => router.back()}
            className="p-1.5 rounded-md hover:bg-[var(--surface-2)] text-[var(--text-muted)]"
          >
            <ArrowLeft className="h-5 w-5" />
          </button>
          <span className="font-mono text-code text-[var(--text-muted)]">{job.job_number}</span>
          <StatusBadge status={job.status} />
          {priorityBadge && (
            <span className={cn(
              'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium',
              priorityBadge.className,
            )}>
              {priorityBadge.icon}
              {job.priority.toUpperCase()}
            </span>
          )}
        </div>

        <h1 className="text-h1 text-[var(--text)] leading-tight">{job.customer_name}</h1>
        <p className="text-body-sm text-[var(--text-muted)] mt-0.5">
          {[job.device_brand, job.device_type, job.device_model].filter(Boolean).join(' ')}
        </p>

        {/* Status flow */}
        <JobStatusStepper status={job.status} className="mt-4" />
      </div>

      {/* ── Tabs ────────────────────────────────────────────────────────── */}
      <Tabs defaultValue="overview" className="flex-1 min-h-0">
        <div className="border-b border-[var(--border)] bg-[var(--surface)] sticky top-0 z-10 px-4">
          <TabsList className="h-10 bg-transparent gap-0 -mb-px w-full justify-start overflow-x-auto">
            {['overview', 'checkin', 'estimate', 'stages', 'parts', ...(hasDevice ? ['history'] : []), 'timeline'].map((tab) => (
              <TabsTrigger
                key={tab}
                value={tab}
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-[var(--accent)] data-[state=active]:text-[var(--accent)] px-3 py-2 text-body-sm capitalize shrink-0"
              >
                {tab === 'checkin' ? 'Check-in' : tab.charAt(0).toUpperCase() + tab.slice(1)}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <div className="flex-1 overflow-auto pb-24">
          {/* Overview */}
          <TabsContent value="overview" className="p-4 md:p-6 space-y-4 mt-0">
            <div className="grid grid-cols-2 gap-3">
              <InfoCard label="Service charge" value={<Money amount={job.service_charge} />} />
              <InfoCard label="Advance paid" value={<Money amount={job.advance_paid} />} />
              <InfoCard label="Intake date" value={formatDate(job.intake_date)} />
              {job.expected_delivery_date && (
                <InfoCard label="Expected by" value={formatDate(job.expected_delivery_date)} />
              )}
              {job.assigned_technician_name && (
                <InfoCard
                  label="Technician"
                  value={
                    <span className="flex items-center gap-1">
                      <User className="h-3.5 w-3.5" />
                      {job.assigned_technician_name}
                    </span>
                  }
                />
              )}
              {job.serial_number && <InfoCard label="Serial" value={<span className="font-mono text-xs">{job.serial_number}</span>} />}
              {job.imei && <InfoCard label="IMEI" value={<span className="font-mono text-xs">{job.imei}</span>} />}
            </div>

            {job.problem_description && (
              <div className="rounded-lg border border-[var(--border)] p-4">
                <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1">Problem</p>
                <p className="text-body text-[var(--text)]">{job.problem_description}</p>
              </div>
            )}

            {job.notes && (
              <div className="rounded-lg border border-[var(--border)] p-4">
                <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1">Notes</p>
                <p className="text-body text-[var(--text)]">{job.notes}</p>
              </div>
            )}

            {job.is_field_job && job.location_address && (
              <div className="flex items-start gap-2 rounded-lg border border-[var(--border)] p-4">
                <MapPin className="h-4 w-4 text-[var(--text-muted)] mt-0.5 shrink-0" />
                <div>
                  <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-0.5">Field location</p>
                  <p className="text-body text-[var(--text)]">{job.location_address}</p>
                </div>
              </div>
            )}

            {/* Invoice CTA */}
            {['ready_for_pickup', 'delivered', 'closed'].includes(job.status) && (
              <Can permission="billing.repair_invoices.create">
                <div className="flex items-center justify-between rounded-lg border border-[var(--accent)]/30 bg-[var(--accent)]/5 p-4">
                  <div>
                    <p className="text-body-sm font-medium text-[var(--text)]">Ready to invoice</p>
                    <p className="text-xs text-[var(--text-muted)]">Generate GST invoice for this job</p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="ghost" asChild>
                      <a href={`/invoices?job_id=${id}`}>View invoices</a>
                    </Button>
                    <Button size="sm" onClick={() => setGenerateInvoiceOpen(true)}>
                      Generate
                    </Button>
                  </div>
                </div>
              </Can>
            )}

            {/* Warranty */}
            {job.warranty_expires_at && (
              <div className={cn(
                'flex items-center justify-between rounded-lg border p-4',
                isWarrantyExpired
                  ? 'border-[var(--text-muted)]/30 bg-[var(--surface-2)]'
                  : 'border-[var(--success)]/30 bg-[var(--success)]/5',
              )}>
                <div className="flex items-center gap-2">
                  <Shield className={cn('h-4 w-4', isWarrantyExpired ? 'text-[var(--text-muted)]' : 'text-[var(--success)]')} />
                  <div>
                    <p className="text-body-sm font-medium text-[var(--text)]">
                      {isWarrantyExpired ? 'Warranty expired' : 'Under warranty'}
                    </p>
                    <p className="text-xs text-[var(--text-muted)]">Until {formatDate(job.warranty_expires_at)}</p>
                  </div>
                </div>
                <Can permission="repair.jobs.create">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={isWarrantyExpired || warrantyMutation.isPending}
                    onClick={() => setWarrantyConfirmOpen(true)}
                  >
                    Claim
                  </Button>
                </Can>
              </div>
            )}

            {/* Linked warranty job */}
            {job.warranty_of_job_id && (
              <div className="flex items-center justify-between rounded-lg border border-[var(--accent)]/30 bg-[var(--accent)]/5 p-4">
                <p className="text-body-sm text-[var(--text)]">This is a warranty job</p>
                <Button size="sm" variant="ghost" asChild>
                  <a href={`/jobs/${job.warranty_of_job_id}`}>
                    View original <ExternalLink className="h-3.5 w-3.5 ml-1" />
                  </a>
                </Button>
              </div>
            )}
          </TabsContent>

          {/* Check-in */}
          <TabsContent value="checkin" className="p-4 md:p-6 mt-0">
            {job.checkin ? (
              <CheckinReadonly checkin={job.checkin} />
            ) : (
              <Can permission="repair.jobs.create" fallback={
                <EmptyState icon={Wrench} title="No check-in yet" description="A staff member needs to complete the check-in." />
              }>
                <div className="space-y-4">
                  <p className="text-body-sm text-[var(--text-muted)]">
                    Record the device condition before starting work.
                  </p>
                  <CheckinForm
                    onSubmit={async (data) => { await checkinMutation.mutateAsync(data); }}
                    loading={checkinMutation.isPending}
                  />
                </div>
              </Can>
            )}
          </TabsContent>

          {/* Estimate */}
          <TabsContent value="estimate" className="p-4 md:p-6 mt-0">
            <EstimateBuilder
              jobId={id}
              estimate={job.estimates.at(-1) ?? null}
              onSuccess={() => queryClient.invalidateQueries({ queryKey: qk.job(id) })}
            />
          </TabsContent>

          {/* Stages */}
          <TabsContent value="stages" className="p-4 md:p-6 mt-0 space-y-4">
            {job.stages.length === 0 ? (
              <Can permission="repair.jobs.change_status" fallback={
                <EmptyState icon={Wrench} title="No stages" description="No workflow stages defined for this job yet." />
              }>
                <div className="space-y-3">
                  <EmptyState
                    icon={Wrench}
                    title="No stages defined"
                    description="Set up a workflow for this job."
                    action={{ label: 'Define stages', onClick: () => setStagesDialogOpen(true) }}
                  />
                </div>
              </Can>
            ) : (
              <div className="space-y-4">
                <Can permission="repair.jobs.change_status">
                  <div className="flex justify-end">
                    <Button size="sm" variant="outline" onClick={() => setStagesDialogOpen(true)}>
                      <Plus className="h-3.5 w-3.5" /> Add stage
                    </Button>
                  </div>
                </Can>
                <StageWorkflow jobId={id} stages={job.stages} jobStatus={job.status} />
              </div>
            )}
          </TabsContent>

          {/* Parts */}
          <TabsContent value="parts" className="p-4 md:p-6 mt-0 space-y-4">
            <Can permission="repair.jobs.create">
              <Button size="sm" onClick={() => setPartsSheetOpen(true)}>
                <Plus className="h-4 w-4" /> Request part
              </Button>
            </Can>
            {job.spare_part_requests.length === 0 ? (
              <EmptyState
                icon={Wrench}
                title="No part requests"
                description="Request spare parts for this job."
              />
            ) : (
              <div className="space-y-2">
                {job.spare_part_requests.map((part) => (
                  <div key={part.id} className="flex items-start justify-between p-3 rounded-lg border border-[var(--border)]">
                    <div>
                      <p className="text-body-sm font-medium text-[var(--text)]">
                        {part.variant_name ?? part.custom_part_name}
                      </p>
                      <p className="text-xs text-[var(--text-muted)]">
                        Qty: {part.quantity}{part.is_urgent ? ' · Urgent' : ''}
                      </p>
                      {part.requested_by_name && (
                        <p className="text-xs text-[var(--text-muted)]">By {part.requested_by_name}</p>
                      )}
                    </div>
                    <StatusBadge status={part.status} />
                  </div>
                ))}
              </div>
            )}
          </TabsContent>

          {/* Device history */}
          {hasDevice && (
            <TabsContent value="history" className="p-4 md:p-6 mt-0">
              <p className="text-body-sm text-[var(--text-muted)] mb-3">
                Other repairs for this device{job.serial_number ? ` (S/N ${job.serial_number})` : ''}{job.imei ? ` (IMEI ${job.imei})` : ''}.
              </p>
              {otherDeviceJobs.length === 0 ? (
                <EmptyState title="No prior repairs" description="This is the only job recorded for this device." />
              ) : (
                <div className="rounded-lg border border-[var(--border)] divide-y divide-[var(--border)]">
                  {otherDeviceJobs.map((r) => (
                    <button
                      key={r.job_id}
                      onClick={() => router.push(`/jobs/${r.job_id}`)}
                      className="w-full text-left px-4 py-3 bg-[var(--surface)] hover:bg-[var(--surface-2)] flex items-center justify-between"
                    >
                      <span>
                        <span className="block text-body-sm font-medium text-[var(--text)]">{r.job_number}</span>
                        <span className="block text-xs text-[var(--text-muted)]">{r.device} · {formatDate(r.created_at)}</span>
                      </span>
                      <span className="text-xs text-[var(--text-muted)]">{r.status}</span>
                    </button>
                  ))}
                </div>
              )}
            </TabsContent>
          )}

          {/* Timeline */}
          <TabsContent value="timeline" className="p-4 md:p-6 mt-0">
            <EntityTimeline
              events={timelineData?.items ?? []}
              loading={timelineLoading}
            />
            {(timelineData?.meta?.next_cursor || timelineCursor) && (
              <div className="flex items-center justify-center gap-2 mt-4">
                <Button
                  variant="outline" size="sm"
                  disabled={!timelineCursor || timelineLoading}
                  onClick={() => setTimelineCursor(undefined)}
                >
                  <ChevronLeft className="h-3.5 w-3.5" /> Newest
                </Button>
                <Button
                  variant="outline" size="sm"
                  disabled={!timelineData?.meta?.next_cursor || timelineLoading}
                  onClick={() => setTimelineCursor(timelineData?.meta?.next_cursor ?? undefined)}
                >
                  Older <ChevronRight className="h-3.5 w-3.5" />
                </Button>
              </div>
            )}
          </TabsContent>
        </div>
      </Tabs>

      {/* ── Sticky action bar ────────────────────────────────────────────── */}
      {transitions.length > 0 && (
        <div className="sticky bottom-0 z-20 border-t border-[var(--border)] bg-[var(--surface)] px-4 py-3 flex gap-2">
          <Can permission="repair.jobs.change_status">
            {transitions.slice(0, 2).map((t, i) => (
              <Button
                key={t.to}
                variant={i === 0 ? 'default' : 'outline'}
                className={cn('flex-1', i === 0 && 'min-h-[44px]')}
                onClick={() => handleTransition(t)}
                disabled={statusMutation.isPending}
              >
                {t.label}
              </Button>
            ))}
          </Can>
        </div>
      )}

      {/* ── Dialogs ──────────────────────────────────────────────────────── */}

      {/* Status transition reason */}
      <Dialog open={!!pendingTransition} onOpenChange={(o) => !o && setPendingTransition(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>{pendingTransition?.label}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-body-sm font-medium text-[var(--text)] block mb-1">
                Reason <span className="text-[var(--danger)]">*</span>
              </label>
              <textarea
                className="flex min-h-[80px] w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-body text-[var(--text)] placeholder:text-[var(--text-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] resize-none"
                placeholder="Provide a reason…"
                value={transitionReason}
                onChange={(e) => setTransitionReason(e.target.value)}
              />
            </div>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setPendingTransition(null)}>Cancel</Button>
              <Button
                className="flex-1"
                disabled={!transitionReason.trim() || statusMutation.isPending}
                onClick={() => pendingTransition && statusMutation.mutate({ to: pendingTransition.to, reason: transitionReason })}
              >
                Confirm
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Warranty claim confirm */}
      <ConfirmDialog
        open={warrantyConfirmOpen}
        onOpenChange={setWarrantyConfirmOpen}
        title="Raise warranty claim?"
        description="This will create a new job linked to this one with service charge ₹0."
        confirmLabel="Raise claim"
        onConfirm={() => { warrantyMutation.mutate(); setWarrantyConfirmOpen(false); }}
        loading={warrantyMutation.isPending}
      />

      {/* Define stages dialog */}
      <DefineStagesDialog
        open={stagesDialogOpen}
        onOpenChange={setStagesDialogOpen}
        jobId={id}
        onSuccess={() => queryClient.invalidateQueries({ queryKey: qk.job(id) })}
      />

      {/* Generate invoice dialog */}
      <GenerateInvoiceDialog
        open={generateInvoiceOpen}
        onOpenChange={setGenerateInvoiceOpen}
        jobId={id}
        jobNumber={job.job_number}
        serviceCharge={job.service_charge}
      />

      {/* Parts sheet */}
      <SparePartRequestSheet
        open={partsSheetOpen}
        onOpenChange={setPartsSheetOpen}
        jobId={id}
        requests={job.spare_part_requests}
      />
    </div>
  );
}

// ── Info card ─────────────────────────────────────────────────────────────────

function InfoCard({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-[var(--border)] px-3 py-2.5">
      <p className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-0.5">{label}</p>
      <div className="text-body-sm font-medium text-[var(--text)]">{value}</div>
    </div>
  );
}

// ── Checkin readonly view ─────────────────────────────────────────────────────

function CheckinReadonly({ checkin }: { checkin: NonNullable<Awaited<ReturnType<typeof repairApi.getJob>>['checkin']> }) {
  const conditions = [
    checkin.has_scratches && 'Scratches',
    checkin.has_cracks && 'Cracks',
    checkin.has_liquid_damage && 'Liquid damage',
    checkin.has_missing_parts && 'Missing parts',
  ].filter(Boolean);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <InfoCard label="Condition" value={checkin.physical_condition} />
        <InfoCard label="Issues" value={conditions.length > 0 ? conditions.join(', ') : 'None noted'} />
      </div>
      {checkin.accessory_received.length > 0 && (
        <InfoCard label="Accessories received" value={checkin.accessory_received.join(', ')} />
      )}
      {checkin.customer_description && (
        <div className="rounded-lg border border-[var(--border)] p-4">
          <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1">Customer&apos;s description</p>
          <p className="text-body text-[var(--text)]">{checkin.customer_description}</p>
        </div>
      )}
      {checkin.technician_notes && (
        <div className="rounded-lg border border-[var(--border)] p-4">
          <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1">Technician notes</p>
          <p className="text-body text-[var(--text)]">{checkin.technician_notes}</p>
        </div>
      )}
      {checkin.photos.length > 0 && (
        <div>
          <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-2">{checkin.photos.length} photo{checkin.photos.length !== 1 ? 's' : ''}</p>
          <div className="grid grid-cols-3 gap-2">
            {checkin.photos.map((url, i) => (
              <a key={i} href={url} target="_blank" rel="noreferrer" className="aspect-square rounded-md overflow-hidden border border-[var(--border)]">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={url} alt={`Photo ${i + 1}`} className="w-full h-full object-cover" />
              </a>
            ))}
          </div>
        </div>
      )}
      {checkin.customer_signature_url && (
        <div>
          <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-2">Customer signature</p>
          <div className="rounded-md border border-[var(--border)] overflow-hidden bg-white p-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={checkin.customer_signature_url} alt="Signature" className="max-h-24 mx-auto" />
          </div>
        </div>
      )}
      {checkin.acknowledged_at && (
        <p className="text-xs text-[var(--text-muted)]">Acknowledged {formatDatetime(checkin.acknowledged_at)}</p>
      )}
    </div>
  );
}

// ── Define stages dialog ──────────────────────────────────────────────────────

interface StageRow {
  stage_type: StageType;
  assigned_technician_id: string;
}

function DefineStagesDialog({
  open, onOpenChange, jobId, onSuccess,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  jobId: string;
  onSuccess: () => void;
}) {
  const [rows, setRows] = useState<StageRow[]>([{ stage_type: 'diagnosis', assigned_technician_id: '' }]);

  const mutation = useMutation({
    mutationFn: () => repairApi.setStages(jobId, {
      stages: rows
        .filter((r) => r.assigned_technician_id.trim())
        .map((r, i) => ({ stage_order: i + 1, stage_type: r.stage_type, assigned_technician_id: r.assigned_technician_id })),
    }),
    onSuccess: () => {
      toast.success('Stages defined');
      onOpenChange(false);
      onSuccess();
      setRows([{ stage_type: 'diagnosis', assigned_technician_id: '' }]);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to set stages'),
  });

  function updateRow(index: number, field: keyof StageRow, value: string) {
    setRows((prev) => prev.map((r, i) => (i === index ? { ...r, [field]: value } : r)));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Define workflow stages</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {rows.map((row, i) => (
            <div key={i} className="flex gap-2 items-start">
              <span className="text-xs text-[var(--text-muted)] mt-2.5 w-5 shrink-0 text-right">{i + 1}.</span>
              <Select value={row.stage_type} onValueChange={(v) => updateRow(i, 'stage_type', v)}>
                <SelectTrigger className="flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {STAGE_TYPE_OPTIONS.map((t) => (
                    <SelectItem key={t} value={t}>{STAGE_LABELS[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <StaffPicker
                className="flex-1"
                placeholder="Assign technician…"
                value={row.assigned_technician_id}
                onChange={(id) => updateRow(i, 'assigned_technician_id', id)}
              />
              {rows.length > 1 && (
                <button
                  className="mt-2 text-[var(--danger)] hover:opacity-70 shrink-0"
                  onClick={() => setRows((p) => p.filter((_, j) => j !== i))}
                >✕</button>
              )}
            </div>
          ))}
          <Button
            size="sm" variant="outline"
            onClick={() => setRows((p) => [...p, { stage_type: 'repair', assigned_technician_id: '' }])}
          >
            <Plus className="h-3.5 w-3.5" /> Add stage
          </Button>
          <div className="flex gap-3 pt-2">
            <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button
              className="flex-1"
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending || rows.every((r) => !r.assigned_technician_id.trim())}
            >
              {mutation.isPending ? 'Saving…' : 'Save stages'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
