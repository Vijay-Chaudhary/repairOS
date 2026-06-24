'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { UserPlus, ListChecks, AlertTriangle, TrendingUp, Users } from 'lucide-react';
import { crmApi, type CrmOverview } from '@/lib/api/crm';
import { qk } from '@/lib/query/keys';
import { useActiveShopStore } from '@/lib/stores/activeShopStore';

const PIPELINE_LABEL: Record<string, string> = {
  new: 'New', contacted: 'Contacted', interested: 'Interested',
  quoted: 'Quoted', converted: 'Converted', lost: 'Lost',
};

const KPI_DEFS: Array<{ key: keyof CrmOverview['kpis']; label: string; icon: React.ElementType; tone: string }> = [
  { key: 'new_leads',          label: 'New leads',           icon: UserPlus,      tone: 'text-[var(--text)]' },
  { key: 'tasks_due_today',    label: 'Tasks due today',     icon: ListChecks,    tone: 'text-[var(--text)]' },
  { key: 'tasks_overdue',      label: 'Overdue tasks',       icon: AlertTriangle, tone: 'text-[var(--danger)]' },
  { key: 'conversions_30d',    label: 'Conversions (30d)',   icon: TrendingUp,    tone: 'text-[var(--success)]' },
  { key: 'new_customers_30d',  label: 'New customers (30d)', icon: Users,         tone: 'text-[var(--text)]' },
];

export default function CrmOverviewPage() {
  const { activeShopId, isAllShops } = useActiveShopStore();
  const shopId = isAllShops ? undefined : activeShopId ?? undefined;

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: qk.crmOverview(shopId ?? null),
    queryFn: () => crmApi.getOverview(shopId),
    staleTime: 30_000,
  });

  if (isLoading) {
    return (
      <div className="p-4 md:p-6 space-y-4">
        <div className="h-7 w-40 bg-[var(--surface-2)] rounded animate-pulse" />
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {KPI_DEFS.map((k) => <div key={k.key} className="h-24 bg-[var(--surface-2)] rounded-lg animate-pulse" />)}
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6">
        <p className="text-body-sm text-[var(--danger)] mb-3">Couldn’t load the CRM overview.</p>
        <button onClick={() => refetch()} className="text-body-sm underline">Retry</button>
      </div>
    );
  }

  const noAttention = data.overdue_tasks.length === 0 && data.unassigned_leads.length === 0;

  return (
    <div className="p-4 md:p-6 space-y-6">
      <h1 className="text-h2 font-semibold">CRM Overview</h1>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {KPI_DEFS.map(({ key, label, icon: Icon, tone }) => (
          <div key={key} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4">
            <Icon className={`h-4 w-4 mb-2 ${tone}`} />
            <div className="text-h3 font-semibold">{data.kpis[key]}</div>
            <div className="text-body-sm text-[var(--text-muted)]">{label}</div>
          </div>
        ))}
      </div>

      <section>
        <h2 className="text-body font-medium mb-2">Lead pipeline</h2>
        <div className="flex flex-wrap gap-2">
          {data.pipeline.map((p) => (
            <Link key={p.status} href={`/leads?status=${p.status}`}
              className="rounded-md border border-[var(--border)] px-3 py-2 text-body-sm hover:bg-[var(--surface-2)]">
              <span className="text-[var(--text-muted)]">{PIPELINE_LABEL[p.status] ?? p.status}</span>{' '}
              <span className="font-semibold">{p.count}</span>
            </Link>
          ))}
        </div>
      </section>

      <section>
        <h2 className="text-body font-medium mb-2">Needs attention</h2>
        {noAttention ? (
          <p className="text-body-sm text-[var(--text-muted)]">All clear — no overdue tasks or unassigned leads.</p>
        ) : (
          <div className="grid md:grid-cols-2 gap-4">
            <div>
              <h3 className="text-body-sm font-medium mb-1">Overdue tasks</h3>
              <ul className="space-y-1">
                {data.overdue_tasks.map((t) => (
                  <li key={t.id} className="text-body-sm flex justify-between border-b border-[var(--border)] py-1">
                    <span>
                      <span>{t.title}</span>
                      {t.customer_name && <span className="text-[var(--text-muted)]"> · {t.customer_name}</span>}
                    </span>
                    <span className="text-[var(--text-muted)]">{t.due_date}</span>
                  </li>
                ))}
                {data.overdue_tasks.length === 0 && <li className="text-body-sm text-[var(--text-muted)]">None</li>}
              </ul>
            </div>
            <div>
              <h3 className="text-body-sm font-medium mb-1">Unassigned new leads</h3>
              <ul className="space-y-1">
                {data.unassigned_leads.map((l) => (
                  <li key={l.id} className="text-body-sm flex justify-between border-b border-[var(--border)] py-1">
                    <Link href={`/leads/${l.id}`} className="hover:underline">{l.name}</Link>
                    <span className="text-[var(--text-muted)]">{l.phone}</span>
                  </li>
                ))}
                {data.unassigned_leads.length === 0 && <li className="text-body-sm text-[var(--text-muted)]">None</li>}
              </ul>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
