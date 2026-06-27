'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Send } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Can } from '@/components/shared/Can';
import { crmApi, type Campaign } from '@/lib/api/crm';
import { qk } from '@/lib/query/keys';
import { ApiError } from '@/lib/api/client';
import { formatDatetime } from '@/lib/format/date';

export default function CampaignsPage() {
  const [page, setPage] = useState(1);
  const [composerOpen, setComposerOpen] = useState(false);

  const filters = { page };
  const { data, isLoading, error } = useQuery({
    queryKey: qk.campaigns(filters),
    queryFn: () => crmApi.listCampaigns(filters),
    staleTime: 30_000,
  });

  const columns: Column<Campaign>[] = [
    { key: 'name', header: 'Campaign', cell: (c) => <span className="font-medium text-[var(--text)]">{c.name}</span> },
    { key: 'segment', header: 'Segment', cell: (c) => <span className="text-[var(--text-muted)]">{c.segment_name ?? '—'}</span> },
    {
      key: 'recipients', header: 'Recipients', className: 'text-right tabular-nums', headerClassName: 'text-right',
      cell: (c) => c.recipient_count,
    },
    {
      key: 'excluded', header: 'Excluded (opt-out)', className: 'text-right tabular-nums', headerClassName: 'text-right',
      cell: (c) => (c.excluded_optout_count > 0
        ? <span className="text-[var(--text-muted)]">{c.excluded_optout_count}</span>
        : <span className="text-[var(--text-muted)]">—</span>),
    },
    { key: 'status', header: 'Status', cell: (c) => <StatusBadge status={c.status} /> },
    {
      key: 'sent', header: 'Sent', cell: (c) => (
        <span className="text-[var(--text-muted)]">{c.sent_at ? formatDatetime(c.sent_at) : '—'}</span>
      ),
    },
  ];

  return (
    <Can permission="crm.segments.manage">
      <div className="flex flex-col h-full">
        <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--surface)] flex items-center justify-between gap-3">
          <div>
            <h1 className="text-h1 text-[var(--text)]">Campaigns</h1>
            <p className="text-body-sm text-[var(--text-muted)] mt-0.5">Past bulk-WhatsApp sends to segments.</p>
          </div>
          <Button onClick={() => setComposerOpen(true)}>
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">New campaign</span>
          </Button>
        </div>

        <div className="flex-1 p-4 md:p-6 min-h-0">
          <DataTable
            columns={columns}
            data={data?.items}
            loading={isLoading}
            error={error as Error | null}
            keyExtractor={(c) => c.id}
            emptyTitle="No campaigns yet"
            emptyDescription="Send a bulk WhatsApp to a segment to start tracking campaigns."
            emptyAction={{ label: 'New campaign', onClick: () => setComposerOpen(true) }}
            page={page}
            totalPages={data?.meta?.total_pages}
            onPageChange={setPage}
            totalCount={data?.meta?.count}
          />
        </div>

        <NewCampaignDialog open={composerOpen} onOpenChange={setComposerOpen} />
      </div>
    </Can>
  );
}

function NewCampaignDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  const queryClient = useQueryClient();
  const [segmentId, setSegmentId] = useState('');
  const [name, setName] = useState('');
  const [template, setTemplate] = useState('');

  const { data: segments } = useQuery({
    queryKey: qk.segments(),
    queryFn: () => crmApi.listSegments(),
    enabled: open,
  });

  const { data: count, isLoading: countLoading } = useQuery({
    queryKey: ['segment-recipient-count', segmentId],
    queryFn: () => crmApi.getSegmentRecipientCount(segmentId),
    enabled: open && !!segmentId,
    staleTime: 30_000,
  });

  const reset = () => { setSegmentId(''); setName(''); setTemplate(''); };

  const mutation = useMutation({
    mutationFn: () => crmApi.createCampaign({ name: name.trim(), segment_id: segmentId, template: template.trim() }),
    onSuccess: (c) => {
      queryClient.invalidateQueries({ queryKey: qk.campaigns() });
      toast.success(`Campaign sent to ${c.recipient_count} recipient${c.recipient_count !== 1 ? 's' : ''}`);
      onOpenChange(false);
      reset();
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to send campaign'),
  });

  const noRecipients = count?.recipients === 0;
  const canSend = !!name.trim() && !!segmentId && !!template.trim() && !mutation.isPending && !noRecipients;

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) reset(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>New campaign</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <label className="text-body-sm font-medium text-[var(--text)] block mb-1">Name *</label>
            <Input placeholder="e.g. June promo" value={name} onChange={(e) => setName(e.target.value)} />
          </div>

          <div>
            <label className="text-body-sm font-medium text-[var(--text)] block mb-1">Segment *</label>
            <Select value={segmentId} onValueChange={setSegmentId}>
              <SelectTrigger aria-label="Segment">
                <SelectValue placeholder="Pick a segment…" />
              </SelectTrigger>
              <SelectContent>
                {(segments?.items ?? []).map((s) => (
                  <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {segmentId && (
            countLoading ? (
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
            ) : null
          )}

          <div>
            <label className="text-body-sm font-medium text-[var(--text)] block mb-1">Template name *</label>
            <Input placeholder="e.g. promo_june_2026" value={template} onChange={(e) => setTemplate(e.target.value)} />
          </div>

          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button className="flex-1" disabled={!canSend} onClick={() => mutation.mutate()}>
              <Send className="h-4 w-4" />
              {mutation.isPending ? 'Sending…' : 'Send'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
