'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { ArrowLeft, Phone, Mail, Wrench, ExternalLink, Pencil, MessageSquare, Users } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/EmptyState';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Can } from '@/components/shared/Can';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { TaskList } from '@/components/crm/TaskList';
import { LogCommunicationSheet } from '@/components/crm/LogCommunicationSheet';
import {
  crmApi, LEAD_TRANSITIONS, SOURCE_LABELS, COMM_TYPE_LABELS,
  type Lead, type LeadSource, type CommunicationLog,
} from '@/lib/api/crm';
import { qk } from '@/lib/query/keys';
import { ApiError } from '@/lib/api/client';
import { formatDate, formatDatetime } from '@/lib/format/date';
import { formatPhone } from '@/lib/format/phone';

// ── Edit schema ───────────────────────────────────────────────────────────────

const editSchema = z.object({
  name: z.string().min(2, 'Name required'),
  phone: z.string().min(10, 'Valid phone required'),
  email: z.string().email().optional().or(z.literal('')),
  source: z.enum(['walk_in', 'whatsapp', 'referral', 'google', 'facebook', 'other']),
  device_type: z.string().optional(),
  notes: z.string().optional(),
});
type EditValues = z.infer<typeof editSchema>;

// ── Page ──────────────────────────────────────────────────────────────────────

export default function LeadDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [editOpen, setEditOpen] = useState(false);
  const [logCommOpen, setLogCommOpen] = useState(false);
  const [lostDialogOpen, setLostDialogOpen] = useState(false);
  const [lostReason, setLostReason] = useState('');
  const [convertConfirmOpen, setConvertConfirmOpen] = useState(false);

  const { data: lead, isLoading, error } = useQuery({
    queryKey: qk.lead(id),
    queryFn: () => crmApi.getLead(id),
    staleTime: 30_000,
  });

  const { data: commsData, isLoading: commsLoading } = useQuery({
    queryKey: qk.leadComms(id),
    queryFn: () => crmApi.listCommunications({ lead_id: id }),
    staleTime: 60_000,
    enabled: !!lead,
  });

  const { data: tasksData, isLoading: tasksLoading } = useQuery({
    queryKey: qk.tasks({ lead_id: id }),
    queryFn: () => crmApi.listTasks({ lead_id: id }),
    staleTime: 30_000,
    enabled: !!lead,
  });

  const statusMutation = useMutation({
    mutationFn: ({ toStatus, reason }: { toStatus: Lead['status']; reason?: string }) =>
      crmApi.changeLeadStatus(id, toStatus, reason),
    onSuccess: (updated) => {
      queryClient.setQueryData(qk.lead(id), updated);
      queryClient.invalidateQueries({ queryKey: qk.leads() });
      toast.success('Status updated');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });

  const convertMutation = useMutation({
    mutationFn: () => crmApi.convertLead(id),
    onSuccess: (customer) => {
      queryClient.invalidateQueries({ queryKey: qk.leads() });
      toast.success('Lead converted to customer');
      router.push(`/customers/${customer.id}`);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Conversion failed'),
  });

  if (isLoading) {
    return (
      <div className="p-4 space-y-4">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-44 w-full rounded-lg" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-48 w-full rounded-lg" />
      </div>
    );
  }

  if (error || !lead) {
    return (
      <EmptyState
        icon={Users}
        title="Lead not found"
        description="This lead doesn't exist or you don't have access."
        action={{ label: 'Back to leads', onClick: () => router.push('/leads') }}
      />
    );
  }

  const transitions = LEAD_TRANSITIONS[lead.status] ?? [];

  return (
    <div className="flex flex-col min-h-full">
      {/* Back nav */}
      <div className="flex items-center gap-2 px-4 pt-3 pb-0">
        <button
          onClick={() => router.back()}
          className="p-1.5 rounded-md hover:bg-[var(--surface-2)] text-[var(--text-muted)]"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <span className="text-body-sm text-[var(--text-muted)]">Leads</span>
      </div>

      {/* Lead header */}
      <div className="px-4 py-4 border-b border-[var(--border)]">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-h1 text-[var(--text)]">{lead.name}</h1>
              <StatusBadge status={lead.status} />
            </div>
            <a
              href={`tel:${lead.phone}`}
              className="flex items-center gap-1 text-body-sm text-[var(--accent)] hover:underline mt-1"
            >
              <Phone className="h-3.5 w-3.5" />{formatPhone(lead.phone)}
            </a>
            {lead.email && (
              <div className="flex items-center gap-1 text-body-sm text-[var(--text-muted)] mt-0.5">
                <Mail className="h-3.5 w-3.5" />{lead.email}
              </div>
            )}
          </div>
          <Can permission="crm.leads.edit">
            <Button size="sm" variant="outline" className="shrink-0" onClick={() => setEditOpen(true)}>
              <Pencil className="h-3.5 w-3.5" /> Edit
            </Button>
          </Can>
        </div>

        {/* Meta chips */}
        <div className="flex flex-wrap gap-2 mt-3">
          <span className="text-xs bg-[var(--surface-2)] border border-[var(--border)] rounded px-2 py-1 text-[var(--text)]">
            {SOURCE_LABELS[lead.source]}
          </span>
          {lead.device_type && (
            <span className="flex items-center gap-1 text-xs text-[var(--text-muted)] bg-[var(--surface-2)] border border-[var(--border)] rounded px-2 py-1">
              <Wrench className="h-3 w-3" />{lead.device_type}
            </span>
          )}
          {lead.assigned_to_name && (
            <span className="text-xs text-[var(--text-muted)] self-center">
              Assigned: {lead.assigned_to_name}
            </span>
          )}
          <span className="text-xs text-[var(--text-muted)] self-center">
            Created {formatDate(lead.created_at)}
          </span>
        </div>

        {lead.notes && (
          <p className="mt-3 text-body-sm text-[var(--text-muted)]">{lead.notes}</p>
        )}

        {lead.lost_reason && lead.status === 'lost' && (
          <p className="mt-2 text-body-sm text-[var(--danger)]">Lost reason: {lead.lost_reason}</p>
        )}

        {/* Action bar */}
        <div className="flex flex-wrap gap-2 mt-4">
          <Can permission="crm.communications.log">
            <Button size="sm" variant="outline" onClick={() => setLogCommOpen(true)}>
              <MessageSquare className="h-3.5 w-3.5" /> Log comm
            </Button>
          </Can>

          <Can permission="crm.leads.edit">
            {transitions.map((t) =>
              t.to === 'converted' ? (
                <Button
                  key={t.to}
                  size="sm"
                  disabled={convertMutation.isPending}
                  onClick={() => setConvertConfirmOpen(true)}
                >
                  {t.label}
                </Button>
              ) : t.requiresReason ? (
                <Button
                  key={t.to}
                  size="sm"
                  variant="outline"
                  className="text-[var(--danger)] border-[var(--danger)]/40 hover:bg-[var(--danger)]/5"
                  onClick={() => setLostDialogOpen(true)}
                >
                  {t.label}
                </Button>
              ) : (
                <Button
                  key={t.to}
                  size="sm"
                  variant="outline"
                  disabled={statusMutation.isPending}
                  onClick={() => statusMutation.mutate({ toStatus: t.to })}
                >
                  {t.label}
                </Button>
              )
            )}
          </Can>

          {lead.converted_customer_id && (
            <Button
              size="sm"
              variant="ghost"
              className="text-[var(--text-muted)]"
              onClick={() => router.push(`/customers/${lead.converted_customer_id}`)}
            >
              <ExternalLink className="h-3.5 w-3.5" /> View customer
            </Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <Tabs defaultValue="communications" className="flex-1 min-h-0">
        <div className="border-b border-[var(--border)] bg-[var(--surface)] sticky top-0 z-10 px-4">
          <TabsList className="h-10 bg-transparent gap-0 -mb-px w-full justify-start overflow-x-auto">
            {[
              { value: 'communications', label: 'Communications' },
              { value: 'tasks', label: 'Tasks' },
            ].map(({ value, label }) => (
              <TabsTrigger
                key={value}
                value={value}
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-[var(--accent)] data-[state=active]:text-[var(--accent)] px-3 py-2 text-body-sm shrink-0"
              >
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <div className="flex-1 overflow-auto">
          <TabsContent value="communications" className="p-4 md:p-6 mt-0">
            <CommLog comms={commsData?.items ?? []} loading={commsLoading} />
          </TabsContent>
          <TabsContent value="tasks" className="p-4 md:p-6 mt-0">
            <TaskList
              tasks={tasksData?.items ?? []}
              loading={tasksLoading}
              leadId={id}
            />
          </TabsContent>
        </div>
      </Tabs>

      {/* Mark lost dialog */}
      <Dialog open={lostDialogOpen} onOpenChange={setLostDialogOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Mark lead as lost</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <div>
              <label className="text-body-sm font-medium text-[var(--text)] block mb-1">
                Reason <span className="text-[var(--danger)]">*</span>
              </label>
              <Input
                placeholder="Why was this lead lost?"
                value={lostReason}
                onChange={(e) => setLostReason(e.target.value)}
              />
            </div>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setLostDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                className="flex-1"
                disabled={!lostReason.trim() || statusMutation.isPending}
                onClick={() => {
                  statusMutation.mutate({ toStatus: 'lost', reason: lostReason });
                  setLostDialogOpen(false);
                  setLostReason('');
                }}
              >
                Mark lost
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Convert confirm */}
      <ConfirmDialog
        open={convertConfirmOpen}
        onOpenChange={setConvertConfirmOpen}
        title="Convert lead to customer?"
        description="This creates a customer record linked to this lead. The action is idempotent — you can re-convert safely."
        confirmLabel="Convert"
        onConfirm={() => convertMutation.mutate()}
        loading={convertMutation.isPending}
      />

      {/* Log communication */}
      <LogCommunicationSheet
        open={logCommOpen}
        onOpenChange={(v) => {
          setLogCommOpen(v);
          if (!v) queryClient.invalidateQueries({ queryKey: qk.leadComms(id) });
        }}
        leadId={id}
      />

      {/* Edit sheet */}
      {editOpen && (
        <LeadEditSheet
          open={editOpen}
          onOpenChange={setEditOpen}
          lead={lead}
          onSuccess={(updated) => {
            queryClient.setQueryData(qk.lead(id), updated);
            queryClient.invalidateQueries({ queryKey: qk.leads() });
            setEditOpen(false);
          }}
        />
      )}
    </div>
  );
}

// ── Communication log display ─────────────────────────────────────────────────

function CommLog({ comms, loading }: { comms: CommunicationLog[]; loading: boolean }) {
  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 rounded-lg" />)}
      </div>
    );
  }
  if (comms.length === 0) {
    return (
      <p className="text-body-sm text-[var(--text-muted)] py-4">No communications logged yet.</p>
    );
  }
  return (
    <div className="space-y-3">
      {comms.map((c) => (
        <div key={c.id} className="p-3 rounded-lg border border-[var(--border)] bg-[var(--surface)]">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium bg-[var(--surface-2)] border border-[var(--border)] rounded px-1.5 py-0.5 text-[var(--text)]">
                {COMM_TYPE_LABELS[c.type]}
              </span>
              {c.direction && (
                <span className="text-xs text-[var(--text-muted)] capitalize">{c.direction}</span>
              )}
            </div>
            <span className="text-xs text-[var(--text-muted)] shrink-0">{formatDatetime(c.logged_at)}</span>
          </div>
          <p className="text-body-sm text-[var(--text)] mt-2">{c.summary}</p>
          <div className="flex items-center gap-3 mt-1 text-xs text-[var(--text-muted)]">
            {c.logged_by_name && <span>{c.logged_by_name}</span>}
            {c.duration_minutes && <span>· {c.duration_minutes} min</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Edit sheet ────────────────────────────────────────────────────────────────

function LeadEditSheet({ open, onOpenChange, lead, onSuccess }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  lead: Lead;
  onSuccess: (updated: Lead) => void;
}) {
  const form = useForm<EditValues>({
    resolver: zodResolver(editSchema),
    defaultValues: {
      name: lead.name,
      phone: lead.phone,
      email: lead.email ?? '',
      source: lead.source,
      device_type: lead.device_type ?? '',
      notes: lead.notes ?? '',
    },
  });

  const mutation = useMutation({
    mutationFn: (values: EditValues) =>
      crmApi.updateLead(lead.id, {
        name: values.name,
        phone: values.phone,
        email: values.email || undefined,
        source: values.source as LeadSource,
        device_type: values.device_type || undefined,
        notes: values.notes || undefined,
      }),
    onSuccess: (updated) => {
      toast.success('Lead updated');
      onSuccess(updated);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Edit lead</SheetTitle>
        </SheetHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="mt-6 space-y-4">
            <FormField control={form.control} name="name" render={({ field }) => (
              <FormItem>
                <FormLabel>Name *</FormLabel>
                <FormControl><Input placeholder="Rahul Sharma" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <div className="grid grid-cols-2 gap-3">
              <FormField control={form.control} name="phone" render={({ field }) => (
                <FormItem>
                  <FormLabel>Phone *</FormLabel>
                  <FormControl><Input inputMode="tel" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="email" render={({ field }) => (
                <FormItem>
                  <FormLabel>Email</FormLabel>
                  <FormControl><Input type="email" {...field} /></FormControl>
                  <FormMessage />
                </FormItem>
              )} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FormField control={form.control} name="source" render={({ field }) => (
                <FormItem>
                  <FormLabel>Source *</FormLabel>
                  <Select onValueChange={field.onChange} value={field.value}>
                    <FormControl><SelectTrigger><SelectValue /></SelectTrigger></FormControl>
                    <SelectContent>
                      {(Object.keys(SOURCE_LABELS) as LeadSource[]).map((s) => (
                        <SelectItem key={s} value={s}>{SOURCE_LABELS[s]}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )} />
              <FormField control={form.control} name="device_type" render={({ field }) => (
                <FormItem>
                  <FormLabel>Device type</FormLabel>
                  <FormControl><Input placeholder="iPhone 14…" {...field} /></FormControl>
                </FormItem>
              )} />
            </div>
            <FormField control={form.control} name="notes" render={({ field }) => (
              <FormItem>
                <FormLabel>Notes</FormLabel>
                <FormControl>
                  <textarea
                    className="flex min-h-[80px] w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-body text-[var(--text)] placeholder:text-[var(--text-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] resize-none"
                    {...field}
                  />
                </FormControl>
              </FormItem>
            )} />
            <div className="flex gap-3 pt-2">
              <Button type="button" variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" className="flex-1" disabled={mutation.isPending}>
                {mutation.isPending ? 'Saving…' : 'Save changes'}
              </Button>
            </div>
          </form>
        </Form>
      </SheetContent>
    </Sheet>
  );
}
