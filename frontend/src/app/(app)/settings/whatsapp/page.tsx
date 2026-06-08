'use client';

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { MessageSquare, CheckCircle2, XCircle, Loader2, Unlink } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Skeleton } from '@/components/ui/skeleton';
import { ConfirmDialog } from '@/components/shared/ConfirmDialog';
import { ForbiddenPage } from '@/components/shared/ForbiddenPage';
import { settingsApi, type NotifTemplate } from '@/lib/api/settings';
import { ApiError } from '@/lib/api/client';
import { useAuthStore } from '@/lib/stores/authStore';
import { qk } from '@/lib/query/keys';

const MODULE_ORDER = ['repair', 'crm', 'pos', 'billing', 'amc', 'hr'] as const;
const MODULE_LABELS: Record<string, string> = {
  repair:  'Repair',
  crm:     'CRM',
  pos:     'POS',
  billing: 'Billing',
  amc:     'AMC',
  hr:      'HR & Payroll',
};

function TemplateRow({ template }: { template: NotifTemplate }) {
  const qc = useQueryClient();

  const toggleMutation = useMutation({
    mutationFn: (active: boolean) =>
      settingsApi.updateTemplate(template.id, { is_active: active }),
    onSuccess: (updated) => {
      qc.setQueryData<{ items: NotifTemplate[] }>(
        qk.notifTemplates(),
        (old) => old ? { ...old, items: old.items.map((t) => t.id === updated.id ? updated : t) } : old,
      );
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });

  return (
    <div className="flex items-start gap-3 px-4 py-3 border-b border-[var(--border)] last:border-0">
      <div className="flex-1 min-w-0">
        <p className="text-body-sm font-medium text-[var(--text)] font-mono">{template.template_name}</p>
        <p className="text-xs text-[var(--text-muted)] mt-0.5">{template.trigger} → {template.recipient}</p>
        {template.variables.length > 0 && (
          <p className="text-[10px] text-[var(--text-muted)] mt-0.5">
            vars: {template.variables.join(', ')}
          </p>
        )}
      </div>
      <Switch
        checked={template.is_active}
        onCheckedChange={(v) => toggleMutation.mutate(v)}
        disabled={toggleMutation.isPending}
      />
    </div>
  );
}

export default function WhatsAppPage() {
  const { hasPermission } = useAuthStore();
  if (!hasPermission('settings.notifications.manage')) return <ForbiddenPage />;
  return <WhatsAppInner />;
}

function WhatsAppInner() {
  const qc = useQueryClient();
  const [phoneInput, setPhoneInput] = useState('');
  const [disconnectOpen, setDisconnectOpen] = useState(false);

  const { data: connection, isLoading: connLoading } = useQuery({
    queryKey: qk.whatsAppConnection(),
    queryFn: () => settingsApi.getWhatsAppConnection(),
    staleTime: 60_000,
  });

  const { data: templatesData, isLoading: templatesLoading } = useQuery({
    queryKey: qk.notifTemplates(),
    queryFn: () => settingsApi.listTemplates(),
    staleTime: 120_000,
  });

  const connectMutation = useMutation({
    mutationFn: () => settingsApi.connectWhatsApp(phoneInput),
    onSuccess: (updated) => {
      qc.setQueryData(qk.whatsAppConnection(), updated);
      toast.success('WhatsApp connected');
      setPhoneInput('');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });

  const disconnectMutation = useMutation({
    mutationFn: () => settingsApi.disconnectWhatsApp(),
    onSuccess: () => {
      qc.setQueryData(qk.whatsAppConnection(), { phone_number: null, is_connected: false });
      toast.success('WhatsApp disconnected');
      setDisconnectOpen(false);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });

  const templates = templatesData?.items ?? [];

  // Group by module, respect MODULE_ORDER, then others
  const byModule: Record<string, NotifTemplate[]> = {};
  for (const t of templates) {
    (byModule[t.module] ??= []).push(t);
  }
  const orderedModules = [
    ...MODULE_ORDER.filter((m) => byModule[m]?.length),
    ...Object.keys(byModule).filter((m) => !MODULE_ORDER.includes(m as typeof MODULE_ORDER[number])),
  ];

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--surface)] shrink-0">
        <h1 className="text-h1 text-[var(--text)]">WhatsApp & Notifications</h1>
        <p className="text-body-sm text-[var(--text-muted)] mt-0.5">
          {templates.length} notification templates via Meta Cloud API.
        </p>
      </div>

      <div className="flex-1 overflow-auto p-4 md:p-6 space-y-6">
        {/* ── Connection card ── */}
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 rounded-lg bg-[var(--success)]/10">
              <MessageSquare className="h-5 w-5 text-[var(--success)]" />
            </div>
            <div>
              <h2 className="text-body font-semibold text-[var(--text)]">WhatsApp Business</h2>
              <p className="text-body-sm text-[var(--text-muted)]">Meta Cloud API — per-tenant number</p>
            </div>
          </div>

          {connLoading ? (
            <Skeleton className="h-10 w-64" />
          ) : connection?.is_connected ? (
            <div className="flex items-center gap-3 flex-wrap">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-4 w-4 text-[var(--success)]" />
                <span className="text-body-sm font-medium text-[var(--text)]">{connection.phone_number}</span>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="text-[var(--danger)] border-[var(--danger)]/30 hover:bg-[var(--danger)]/10"
                onClick={() => setDisconnectOpen(true)}
              >
                <Unlink className="h-3.5 w-3.5 mr-1.5" /> Disconnect
              </Button>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-[var(--text-muted)]">
                <XCircle className="h-4 w-4" />
                <span className="text-body-sm">No WhatsApp number connected</span>
              </div>
              <div className="flex gap-3 flex-wrap">
                <Input
                  className="h-9 w-[200px]"
                  placeholder="+91XXXXXXXXXX"
                  value={phoneInput}
                  onChange={(e) => setPhoneInput(e.target.value)}
                />
                <Button
                  size="sm"
                  disabled={!phoneInput.trim() || connectMutation.isPending}
                  onClick={() => connectMutation.mutate()}
                >
                  {connectMutation.isPending
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : 'Connect'}
                </Button>
              </div>
            </div>
          )}
        </div>

        {/* ── Template list ── */}
        <div>
          <h2 className="text-body-sm font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-4">
            Notification templates ({templates.length} total)
          </h2>

          {templatesLoading ? (
            <div className="space-y-2">{[1,2,3,4,5].map((i) => <Skeleton key={i} className="h-14" />)}</div>
          ) : templates.length === 0 ? (
            <p className="text-body-sm text-[var(--text-muted)]">No templates configured.</p>
          ) : (
            <div className="space-y-5">
              {orderedModules.map((mod) => (
                <div key={mod}>
                  <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-2">
                    {MODULE_LABELS[mod] ?? mod}
                    <span className="font-normal ml-1">({byModule[mod]?.length ?? 0})</span>
                  </p>
                  <div className="rounded-lg border border-[var(--border)] overflow-hidden">
                    {(byModule[mod] ?? []).map((t) => (
                      <TemplateRow key={t.id} template={t} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={disconnectOpen}
        onOpenChange={setDisconnectOpen}
        title="Disconnect WhatsApp?"
        description="All notification templates will be disabled. Customers will stop receiving WhatsApp messages."
        confirmLabel="Disconnect"
        loading={disconnectMutation.isPending}
        onConfirm={() => disconnectMutation.mutate()}
      />
    </div>
  );
}
