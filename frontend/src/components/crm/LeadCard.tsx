'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Phone, Wrench, ChevronRight, MoreVertical, UserCheck, Pencil, Plus, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Can } from '@/components/shared/Can';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { LogCommunicationSheet } from './LogCommunicationSheet';
import { crmApi, LEAD_TRANSITIONS, SOURCE_LABELS, type Lead, type LeadSource, type QuoteItem } from '@/lib/api/crm';
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
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editName, setEditName] = useState(lead.name);
  const [editPhone, setEditPhone] = useState(lead.phone);
  const [editEmail, setEditEmail] = useState(lead.email ?? '');
  const [editSource, setEditSource] = useState<LeadSource>(lead.source);
  const [editDevice, setEditDevice] = useState(lead.device_type ?? '');
  const [editNotes, setEditNotes] = useState(lead.notes ?? '');

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

  const deleteMutation = useMutation({
    mutationFn: () => crmApi.deleteLead(lead.id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.leads() });
      toast.success('Lead deleted');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to delete lead'),
  });

  const editMutation = useMutation({
    mutationFn: () => crmApi.updateLead(lead.id, {
      name: editName.trim(),
      phone: editPhone.trim(),
      email: editEmail.trim() || undefined,
      source: editSource,
      device_type: editDevice.trim() || undefined,
      notes: editNotes.trim() || undefined,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.leads() });
      toast.success('Lead updated');
      setEditOpen(false);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed to update lead'),
  });

  function openEdit() {
    setEditName(lead.name);
    setEditPhone(lead.phone);
    setEditEmail(lead.email ?? '');
    setEditSource(lead.source);
    setEditDevice(lead.device_type ?? '');
    setEditNotes(lead.notes ?? '');
    setEditOpen(true);
  }

  function handleAdvance() {
    if (lead.status === 'lost') {
      advanceMutation.mutate({ status: lead.status_before_lost ?? 'new' });
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

  const isInterested = lead.status === 'interested';
  const isLost = lead.status === 'lost';
  const showPrimary = (primaryTransition || isLost) && lead.status !== 'converted';

  return (
    <div className="bg-[var(--surface)] rounded-md border border-[var(--border)] p-3 pt-0 space-y-2 select-none">
      {/* Header row: name + menu on one line, phone below */}
      <div>
        <div className="flex items-center justify-between gap-2">
          <div className="">
          <Link
            href={`/leads/${lead.id}`}
            className="text-body-sm font-medium text-[var(--text)] hover:underline truncate capitalize"
          >
            {lead.name}
          </Link>
          </div>
          <div className="">
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
                <Can permission="crm.leads.edit">
                  <DropdownMenuItem onClick={openEdit}>
                    Edit lead
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
                <Can permission="crm.leads.delete">
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-[var(--danger)]"
                    onClick={() => setDeleteConfirmOpen(true)}
                  >
                    Delete lead
                  </DropdownMenuItem>
                </Can>
              </DropdownMenuContent>
            </DropdownMenu>
          </Can>
          </div>
        </div>
        <a
          href={`tel:${lead.phone}`}
          className="flex items-center gap-1 text-xs text-[var(--accent)] hover:underline mt-0.5"
          onClick={(e) => e.stopPropagation()}
        >
          <Phone className="h-3 w-3" />{formatPhone(lead.phone)}
        </a>
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

      {/* Primary action(s) */}
      {showPrimary && (
        <Can permission="crm.leads.edit">
          {isInterested ? (
            <div className="flex gap-1.5">
              <Button
                size="sm"
                variant="outline"
                className="flex-1 h-7 text-xs"
                onClick={() => setQuoteOpen(true)}
                disabled={advanceMutation.isPending}
              >
                Send quote
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="flex-1 h-7 text-xs"
                onClick={() => advanceMutation.mutate({ status: 'quoted' })}
                disabled={advanceMutation.isPending}
              >
                 Quoted
                <ChevronRight className="h-3 w-3 ml-1" />
              </Button>
            </div>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="w-full h-7 text-xs"
              onClick={handleAdvance}
              disabled={advanceMutation.isPending || convertMutation.isPending}
            >
              {isLost ? 'Re-open' : primaryTransition!.label}
              <ChevronRight className="h-3 w-3 ml-1" />
            </Button>
          )}
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

      {/* Delete confirm */}
      <ConfirmDialog
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        title="Delete lead?"
        description="This permanently removes the lead and all its history. This cannot be undone."
        confirmLabel="Delete"
        onConfirm={() => deleteMutation.mutate()}
        loading={deleteMutation.isPending}
      />

      {/* Edit lead dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Edit lead</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <label className="text-body-sm font-medium text-[var(--text)] block mb-1">Name *</label>
              <Input value={editName} onChange={(e) => setEditName(e.target.value)} placeholder="Full name" />
            </div>
            <div>
              <label className="text-body-sm font-medium text-[var(--text)] block mb-1">Phone *</label>
              <Input value={editPhone} onChange={(e) => setEditPhone(e.target.value)} placeholder="+91…" />
            </div>
            <div>
              <label className="text-body-sm font-medium text-[var(--text)] block mb-1">Email</label>
              <Input type="email" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} placeholder="Optional" />
            </div>
            <div>
              <label className="text-body-sm font-medium text-[var(--text)] block mb-1">Source</label>
              <select
                className="flex h-9 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1 text-body text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)]"
                value={editSource}
                onChange={(e) => setEditSource(e.target.value as LeadSource)}
              >
                {(Object.entries(SOURCE_LABELS) as [LeadSource, string][]).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-body-sm font-medium text-[var(--text)] block mb-1">Device type</label>
              <Input value={editDevice} onChange={(e) => setEditDevice(e.target.value)} placeholder="e.g. iPhone 14" />
            </div>
            <div>
              <label className="text-body-sm font-medium text-[var(--text)] block mb-1">Notes</label>
              <textarea
                className="flex min-h-[64px] w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-body text-[var(--text)] placeholder:text-[var(--text-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] resize-none"
                value={editNotes}
                onChange={(e) => setEditNotes(e.target.value)}
                placeholder="Any notes…"
              />
            </div>
            <div className="flex gap-3 pt-1">
              <Button variant="outline" className="flex-1" onClick={() => setEditOpen(false)}>Cancel</Button>
              <Button
                className="flex-1"
                disabled={!editName.trim() || !editPhone.trim() || editMutation.isPending}
                onClick={() => editMutation.mutate()}
              >
                {editMutation.isPending ? 'Saving…' : 'Save'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Send quote dialog */}
      <Dialog open={quoteOpen} onOpenChange={setQuoteOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>Send quote to {lead.name}</DialogTitle></DialogHeader>
          <div className="space-y-4">
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

            {quoteItems.some(i => i.amount) && (
              <p className="text-body-sm text-right text-[var(--text)]">
                Total: <span className="font-semibold">
                  ₹{quoteItems.reduce((sum, i) => sum + (parseFloat(i.amount) || 0), 0).toFixed(2)}
                </span>
              </p>
            )}

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
