'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { toast } from 'sonner';
import { Plus, Users, Send, Pencil, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/EmptyState';
import { Can } from '@/components/shared/Can';
import { TagInput } from '@/components/crm/TagInput';
import { MoneyInput } from '@/components/shared/MoneyInput';
import { crmApi, type Segment, type SegmentMember } from '@/lib/api/crm';
import { qk } from '@/lib/query/keys';
import { ApiError } from '@/lib/api/client';
import { formatPhone } from '@/lib/format/phone';

// ── Segment filter rules schema ────────────────────────────────────────────────

const segmentSchema = z.object({
  name: z.string().min(2, 'Name required'),
  description: z.string().optional(),
  is_dynamic: z.boolean(),
  // Filter rules fields
  tags: z.array(z.string()),
  min_total_billed: z.number().min(0),
  min_total_jobs: z.number().min(0),
  customer_type: z.enum(['individual', 'business', 'all']),
  city: z.string(),
});

type SegmentFormValues = z.infer<typeof segmentSchema>;

export function buildFilterRules(values: SegmentFormValues): Record<string, unknown> {
  const rules: Record<string, unknown> = {};
  if (values.tags.length > 0) rules.tags = values.tags;
  if (values.min_total_billed > 0) rules.min_total_billed = values.min_total_billed;
  if (values.min_total_jobs > 0) rules.min_total_jobs = values.min_total_jobs;
  if (values.customer_type !== 'all') rules.customer_type = values.customer_type;
  if (values.city.trim()) rules.city = values.city.trim();
  return rules;
}

export function parseFilterRules(rules: Record<string, unknown>): Partial<SegmentFormValues> {
  return {
    tags: Array.isArray(rules.tags) ? (rules.tags as string[]) : [],
    min_total_billed: typeof rules.min_total_billed === 'number' ? rules.min_total_billed : 0,
    min_total_jobs: typeof rules.min_total_jobs === 'number' ? rules.min_total_jobs : 0,
    customer_type: (rules.customer_type as 'individual' | 'business') ?? 'all',
    city: typeof rules.city === 'string' ? rules.city : '',
  };
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function SegmentsPage() {
  const queryClient = useQueryClient();
  const [formOpen, setFormOpen] = useState(false);
  const [editingSegment, setEditingSegment] = useState<Segment | null>(null);
  const [membersSegment, setMembersSegment] = useState<Segment | null>(null);
  const [bulkDialogSegment, setBulkDialogSegment] = useState<Segment | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: qk.segments(),
    queryFn: () => crmApi.listSegments(),
    staleTime: 60_000,
  });

  const segments = data?.items ?? [];

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-h1 text-[var(--text)]">Segments</h1>
          <p className="text-body-sm text-[var(--text-muted)] mt-0.5">
            Group customers for bulk WhatsApp campaigns.
          </p>
        </div>
        <Can permission="crm.segments.manage">
          <Button onClick={() => { setEditingSegment(null); setFormOpen(true); }}>
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">New segment</span>
          </Button>
        </Can>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-20 rounded-lg" />)}
        </div>
      ) : segments.length === 0 ? (
        <EmptyState
          icon={Users}
          title="No segments yet"
          description="Create segments to group customers and send bulk WhatsApp messages."
          action={{ label: 'New segment', onClick: () => setFormOpen(true) }}
        />
      ) : (
        <div className="space-y-3">
          {segments.map((segment) => (
            <div
              key={segment.id}
              className="flex items-center justify-between p-4 rounded-lg border border-[var(--border)] bg-[var(--surface)]"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-body-sm font-medium text-[var(--text)]">{segment.name}</p>
                  {segment.is_dynamic && (
                    <span className="text-[10px] font-medium bg-[var(--info)]/15 text-[var(--info)] rounded-full px-1.5 py-0.5">
                      Dynamic
                    </span>
                  )}
                </div>
                {segment.description && (
                  <p className="text-xs text-[var(--text-muted)] mt-0.5 truncate">{segment.description}</p>
                )}
                <p className="text-xs text-[var(--text-muted)] mt-1">
                  {Object.keys(segment.filter_rules).length > 0
                    ? Object.keys(segment.filter_rules).join(', ')
                    : 'No filters — all customers'}
                  {segment.member_count != null && ` · ${segment.member_count} members`}
                </p>
              </div>

              <Can permission="crm.segments.manage">
                <div className="flex items-center gap-1 shrink-0 ml-3">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 p-0"
                    onClick={() => setMembersSegment(segment)}
                    title="View members"
                  >
                    <Users className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-8 w-8 p-0"
                    onClick={() => { setEditingSegment(segment); setFormOpen(true); }}
                    title="Edit segment"
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs"
                    onClick={() => setBulkDialogSegment(segment)}
                  >
                    <Send className="h-3.5 w-3.5" /> WhatsApp
                  </Button>
                </div>
              </Can>
            </div>
          ))}
        </div>
      )}

      {/* Segment form dialog */}
      <SegmentFormDialog
        open={formOpen}
        onOpenChange={(v) => { setFormOpen(v); if (!v) setEditingSegment(null); }}
        editing={editingSegment}
        onSuccess={() => {
          queryClient.invalidateQueries({ queryKey: qk.segments() });
          setFormOpen(false);
          setEditingSegment(null);
        }}
      />

      {/* Members sheet */}
      {membersSegment && (
        <SegmentMembersSheet
          open={!!membersSegment}
          onOpenChange={(v) => !v && setMembersSegment(null)}
          segment={membersSegment}
        />
      )}

      {/* Bulk WhatsApp dialog */}
      {bulkDialogSegment && (
        <BulkWhatsappDialog
          open={!!bulkDialogSegment}
          onOpenChange={(v) => !v && setBulkDialogSegment(null)}
          segment={bulkDialogSegment}
        />
      )}
    </div>
  );
}

// ── Segment form dialog ───────────────────────────────────────────────────────

function SegmentFormDialog({
  open, onOpenChange, editing, onSuccess,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editing: Segment | null;
  onSuccess: () => void;
}) {
  const parsed = editing ? parseFilterRules(editing.filter_rules) : {};

  const form = useForm<SegmentFormValues>({
    resolver: zodResolver(segmentSchema),
    defaultValues: {
      name: editing?.name ?? '',
      description: editing?.description ?? '',
      is_dynamic: editing?.is_dynamic ?? true,
      tags: parsed.tags ?? [],
      min_total_billed: parsed.min_total_billed ?? 0,
      min_total_jobs: parsed.min_total_jobs ?? 0,
      customer_type: parsed.customer_type ?? 'all',
      city: parsed.city ?? '',
    },
  });

  const mutation = useMutation({
    mutationFn: (values: SegmentFormValues) => {
      const body = {
        name: values.name,
        description: values.description || undefined,
        filter_rules: buildFilterRules(values),
        is_dynamic: values.is_dynamic,
      };
      return editing
        ? crmApi.updateSegment(editing.id, body)
        : crmApi.createSegment(body);
    },
    onSuccess: () => {
      toast.success(editing ? 'Segment updated' : 'Segment created');
      form.reset();
      onSuccess();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? 'Edit segment' : 'New segment'}</DialogTitle>
        </DialogHeader>
        <Form {...form}>
          <form onSubmit={form.handleSubmit((v) => mutation.mutate(v))} className="space-y-4">
            <FormField control={form.control} name="name" render={({ field }) => (
              <FormItem>
                <FormLabel>Segment name *</FormLabel>
                <FormControl><Input placeholder="VIP customers" {...field} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />

            <FormField control={form.control} name="description" render={({ field }) => (
              <FormItem>
                <FormLabel>Description</FormLabel>
                <FormControl><Input placeholder="Customers with VIP tag…" {...field} /></FormControl>
              </FormItem>
            )} />

            <FormField control={form.control} name="is_dynamic" render={({ field }) => (
              <FormItem className="flex items-center justify-between rounded-lg border border-[var(--border)] p-3">
                <div>
                  <FormLabel className="font-medium">Dynamic segment</FormLabel>
                  <p className="text-xs text-[var(--text-muted)]">Recomputes membership on every read</p>
                </div>
                <FormControl>
                  <Switch checked={field.value} onCheckedChange={field.onChange} />
                </FormControl>
              </FormItem>
            )} />

            <div className="rounded-lg border border-[var(--border)] p-4 space-y-4">
              <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide">Filter rules</p>
              <p className="text-xs text-[var(--text-muted)] -mt-2">Leave empty to include all customers.</p>

              <FormField control={form.control} name="tags" render={({ field }) => (
                <FormItem>
                  <FormLabel>Has tags</FormLabel>
                  <FormControl>
                    <TagInput value={field.value} onChange={field.onChange} placeholder="vip, cctv…" />
                  </FormControl>
                </FormItem>
              )} />

              <div className="grid grid-cols-2 gap-3">
                <FormField control={form.control} name="min_total_billed" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Min billed</FormLabel>
                    <FormControl>
                      <MoneyInput value={field.value} onChange={field.onChange} />
                    </FormControl>
                  </FormItem>
                )} />
                <FormField control={form.control} name="min_total_jobs" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Min jobs</FormLabel>
                    <FormControl>
                      <Input
                        type="number"
                        min={0}
                        inputMode="numeric"
                        value={field.value}
                        onChange={(e) => field.onChange(parseInt(e.target.value, 10) || 0)}
                      />
                    </FormControl>
                  </FormItem>
                )} />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <FormField control={form.control} name="customer_type" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Customer type</FormLabel>
                    <FormControl>
                      <select
                        className="flex h-9 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-body text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                        value={field.value}
                        onChange={(e) => field.onChange(e.target.value)}
                      >
                        <option value="all">All</option>
                        <option value="individual">Individual</option>
                        <option value="business">Business</option>
                      </select>
                    </FormControl>
                  </FormItem>
                )} />
                <FormField control={form.control} name="city" render={({ field }) => (
                  <FormItem>
                    <FormLabel>City</FormLabel>
                    <FormControl>
                      <Input placeholder="Delhi…" {...field} />
                    </FormControl>
                  </FormItem>
                )} />
              </div>
            </div>

            <div className="flex gap-3">
              <Button type="button" variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" className="flex-1" disabled={mutation.isPending}>
                {mutation.isPending ? 'Saving…' : editing ? 'Save changes' : 'Create segment'}
              </Button>
            </div>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}

// ── Members sheet ─────────────────────────────────────────────────────────────

function SegmentMembersSheet({
  open, onOpenChange, segment,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  segment: Segment;
}) {
  const { data, isLoading } = useQuery({
    queryKey: qk.segmentMembers(segment.id),
    queryFn: () => crmApi.getSegmentMembers(segment.id),
    staleTime: 60_000,
  });

  const members = data?.items ?? [];

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{segment.name} — Members</SheetTitle>
        </SheetHeader>
        <div className="mt-4">
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 rounded-md" />)}
            </div>
          ) : members.length === 0 ? (
            <p className="text-body-sm text-[var(--text-muted)] py-8 text-center">No members match the filter rules.</p>
          ) : (
            <div className="space-y-1">
              {members.map((m) => (
                <div key={m.customer_id} className="flex items-center justify-between p-3 rounded-md hover:bg-[var(--surface-2)]">
                  <div>
                    <p className="text-body-sm font-medium text-[var(--text)]">{m.customer_name}</p>
                    <p className="text-xs text-[var(--text-muted)]">{formatPhone(m.customer_phone)}</p>
                  </div>
                </div>
              ))}
              <p className="text-xs text-[var(--text-muted)] text-center pt-2">{members.length} member{members.length !== 1 ? 's' : ''}</p>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ── Bulk WhatsApp dialog ──────────────────────────────────────────────────────

function BulkWhatsappDialog({
  open, onOpenChange, segment,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  segment: Segment;
}) {
  const [templateName, setTemplateName] = useState('');

  const { data: count, isLoading: countLoading } = useQuery({
    queryKey: ['segment-recipient-count', segment.id],
    queryFn: () => crmApi.getSegmentRecipientCount(segment.id),
    enabled: open,
    staleTime: 30_000,
  });

  const mutation = useMutation({
    mutationFn: () => crmApi.bulkWhatsapp(segment.id, { template_name: templateName }),
    onSuccess: (result) => {
      toast.success(`Queued ${result.queued} messages (${result.excluded_optout} excluded — opted out)`);
      onOpenChange(false);
      setTemplateName('');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });

  const noRecipients = count?.recipients === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Bulk WhatsApp — {segment.name}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <p className="text-body-sm text-[var(--text-muted)]">
            Sends to all segment members. Customers who have opted out of WhatsApp will be excluded automatically.
          </p>
          {countLoading ? (
            <p className="text-body-sm text-[var(--text-muted)]">Counting recipients…</p>
          ) : count ? (
            <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2">
              <p className="text-body-sm text-[var(--text)]">
                <span className="font-semibold">{count.recipients}</span> recipient{count.recipients !== 1 ? 's' : ''} will receive this
                {count.excluded_optout > 0 && (
                  <span className="text-[var(--text-muted)]"> · {count.excluded_optout} excluded (opted out)</span>
                )}
              </p>
            </div>
          ) : null}
          <div>
            <label className="text-body-sm font-medium text-[var(--text)] block mb-1">Template name *</label>
            <Input
              placeholder="e.g. promo_june_2026"
              value={templateName}
              onChange={(e) => setTemplateName(e.target.value)}
            />
          </div>
          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button
              className="flex-1"
              disabled={!templateName.trim() || mutation.isPending || noRecipients}
              onClick={() => mutation.mutate()}
            >
              {mutation.isPending ? 'Sending…' : 'Send'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
