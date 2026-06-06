'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Phone, Wrench, ChevronRight, MoreVertical, UserCheck, Pencil, Plus, Trash2 } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Can } from '@/components/shared/Can';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { LogCommunicationSheet } from './LogCommunicationSheet';
import { crmApi, LEAD_TRANSITIONS, SOURCE_LABELS, type Lead, type QuoteItem } from '@/lib/api/crm';
import { qk } from '@/lib/query/keys';
import { ApiError } from '@/lib/api/client';
import { formatDate } from '@/lib/format/date';
import { formatPhone } from '@/lib/format/phone';

interface LeadCardProps {
  lead: Lead;
}

export function LeadCard({ lead }: LeadCardProps) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [logCommOpen, setLogCommOpen] = useState(false);
  const [lostDialogOpen, setLostDialogOpen] = useState(false);
  const [lostReason, setLostReason] = useState('');
  const [convertConfirmOpen, setConvertConfirmOpen] = useState(false);
  const [quoteOpen, setQuoteOpen] = useState(false);
  const [quoteItems, setQuoteItems] = useState<QuoteItem[]>([{ description: '', amount: '' }]);
  const [quoteValidUntil, setQuoteValidUntil] = useState('');
  const [quoteNotes, setQuoteNotes] = useState('');

  const transitions = LEAD_TRANSITIONS[lead.status] ?? [];
  const primaryTransition = transitions[0];

  const advanceMutation = useMutation({
    mutationFn: ({ status, lost_reason }: { status: string; lost_reason?: string }) =>
      crmApi.changeLeadStatus(lead.id, status as Lead['status'], lost_reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.leads() });
      toast.success('Lead updated');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });

  const convertMutation = useMutation({
    mutationFn: () => crmApi.convertLead(lead.id),
    onSuccess: (customer) => {
      queryClient.invalidateQueries({ queryKey: qk.leads() });
      queryClient.invalidateQueries({ queryKey: qk.customers() });
      toast.success('Lead converted to customer');
      router.push(`/customers/${customer.id}`);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Conversion failed'),
  });

  const quoteMutation = useMutation({
    mutationFn: () => crmApi.sendQuote(lead.id, {
      items: quoteItems.filter(i => i.description.trim() && i.amount),
      valid_until: quoteValidUntil,
      notes: quoteNotes,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.leads() });
      queryClient.invalidateQueries({ queryKey: qk.leadQuotes(lead.id) });
      toast.success('Quote sent');
      setQuoteOpen(false);
      setQuoteItems([{ description: '', amount: '' }]);
      setQuoteValidUntil('');
      setQuoteNotes('');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to send quote'),
  });

  function handleAdvance() {
    if (lead.status === 'lost') {
      if (lead.status_before_lost) {
        advanceMutation.mutate({ status: lead.status_before_lost });
      }
      return;
    }
    if (!primaryTransition) return;
    if (primaryTransition.to === 'converted') {
      setConvertConfirmOpen(true);
    } else if (primaryTransition.requiresQuote) {
      setQuoteOpen(true);
    } else {
      advanceMutation.mutate({ status: primaryTransition.to });
    }
  }

  return (
    <div className="bg-[var(--surface)] rounded-md border border-[var(--border)] p-3 space-y-2 select-none">
      {/* Header row */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-body-sm font-medium text-[var(--text)] truncate">{lead.name}</p>
          <a
            href={`tel:${lead.phone}`}
            className="flex items-center gap-1 text-xs text-[var(--accent)] hover:underline mt-0.5"
            onClick={(e) => e.stopPropagation()}
          >
            <Phone className="h-3 w-3" />{formatPhone(lead.phone)}
          </a>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <StatusBadge status={lead.status} className="text-[10px]" />
          <Can anyOf={['crm.leads.edit', 'crm.leads.convert']}>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-6 w-6 p-0">
                  <MoreVertical className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <Can permission="crm.communications.log">
                  <DropdownMenuItem onClick={() => setLogCommOpen(true)}>
                    Log communication
                  </DropdownMenuItem>
                </Can>
                {lead.status !== 'converted' && lead.status !== 'lost' && (
                  <Can permission="crm.leads.convert">
                    <DropdownMenuItem onClick={() => setConvertConfirmOpen(true)}>
                      <UserCheck className="h-4 w-4" /> Convert to customer
                    </DropdownMenuItem>
                  </Can>
                )}
                {lead.status !== 'lost' && (
                  <Can permission="crm.leads.edit">
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      className="text-[var(--danger)]"
                      onClick={() => setLostDialogOpen(true)}
                    >
                      Mark as lost
                    </DropdownMenuItem>
                  </Can>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </Can>
        </div>
      </div>

      {/* Meta */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-[var(--text-muted)] bg-[var(--surface-2)] rounded px-1.5 py-0.5">
          {SOURCE_LABELS[lead.source]}
        </span>
        {lead.device_type && (
          <span className="flex items-center gap-0.5 text-xs text-[var(--text-muted)]">
            <Wrench className="h-3 w-3" />{lead.device_type}
          </span>
        )}
        <span className="text-xs text-[var(--text-muted)] ml-auto">{formatDate(lead.created_at)}</span>
      </div>

      {/* Primary action */}
      {(primaryTransition || (lead.status === 'lost' && lead.status_before_lost)) && lead.status !== 'converted' && (
        <Can permission="crm.leads.edit">
          <Button
            size="sm"
            variant="outline"
            className="w-full h-7 text-xs"
            onClick={handleAdvance}
            disabled={advanceMutation.isPending || convertMutation.isPending}
          >
            {lead.status === 'lost' ? 'Re-open' : primaryTransition!.label}
            <ChevronRight className="h-3 w-3 ml-1" />
          </Button>
        </Can>
      )}

      {/* Log comm sheet */}
      <LogCommunicationSheet
        open={logCommOpen}
        onOpenChange={setLogCommOpen}
        leadId={lead.id}
      />

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
              <Button variant="outline" className="flex-1" onClick={() => setLostDialogOpen(false)}>Cancel</Button>
              <Button
                variant="destructive"
                className="flex-1"
                disabled={!lostReason.trim() || advanceMutation.isPending}
                onClick={() => {
                  advanceMutation.mutate({ status: 'lost', lost_reason: lostReason });
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

      {/* Send quote dialog */}
      <Dialog open={quoteOpen} onOpenChange={setQuoteOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Send quote to {lead.name}</DialogTitle></DialogHeader>
          <div className="space-y-4">
            {/* Line items */}
            <div>
              <p className="text-body-sm font-medium text-[var(--text)] mb-2">Items</p>
              <div className="space-y-2">
                {quoteItems.map((item, idx) => (
                  <div key={idx} className="flex gap-2 items-center">
                    <Input
                      placeholder="Description"
                      className="flex-1"
                      value={item.description}
                      onChange={(e) => {
                        const next = [...quoteItems];
                        next[idx] = { ...next[idx], description: e.target.value };
                        setQuoteItems(next);
                      }}
                    />
                    <Input
                      placeholder="Amount"
                      type="number"
                      min="0"
                      step="0.01"
                      className="w-28"
                      value={item.amount}
                      onChange={(e) => {
                        const next = [...quoteItems];
                        next[idx] = { ...next[idx], amount: e.target.value };
                        setQuoteItems(next);
                      }}
                    />
                    {quoteItems.length > 1 && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0 text-[var(--text-muted)]"
                        onClick={() => setQuoteItems(quoteItems.filter((_, i) => i !== idx))}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="mt-2 text-xs text-[var(--accent)] h-7 px-2"
                onClick={() => setQuoteItems([...quoteItems, { description: '', amount: '' }])}
              >
                <Plus className="h-3 w-3 mr-1" /> Add item
              </Button>
            </div>

            {/* Total */}
            {quoteItems.some(i => i.amount) && (
              <p className="text-body-sm text-right text-[var(--text)]">
                Total: <span className="font-semibold">
                  ₹{quoteItems.reduce((sum, i) => sum + (parseFloat(i.amount) || 0), 0).toFixed(2)}
                </span>
              </p>
            )}

            {/* Valid until */}
            <div>
              <label className="text-body-sm font-medium text-[var(--text)] block mb-1">
                Valid until <span className="text-[var(--danger)]">*</span>
              </label>
              <Input
                type="date"
                value={quoteValidUntil}
                onChange={(e) => setQuoteValidUntil(e.target.value)}
              />
            </div>

            {/* Notes */}
            <div>
              <label className="text-body-sm font-medium text-[var(--text)] block mb-1">Notes</label>
              <textarea
                className="flex min-h-[64px] w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-body text-[var(--text)] placeholder:text-[var(--text-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] resize-none"
                placeholder="Any additional notes…"
                value={quoteNotes}
                onChange={(e) => setQuoteNotes(e.target.value)}
              />
            </div>

            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setQuoteOpen(false)}>Cancel</Button>
              <Button
                className="flex-1"
                disabled={
                  !quoteValidUntil ||
                  !quoteItems.some(i => i.description.trim() && i.amount) ||
                  quoteMutation.isPending
                }
                onClick={() => quoteMutation.mutate()}
              >
                <Pencil className="h-3.5 w-3.5 mr-1.5" />
                {quoteMutation.isPending ? 'Sending…' : 'Send quote'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
