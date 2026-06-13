'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  Wrench, Users, CreditCard, TrendingUp, Calendar, AlertTriangle,
  CheckSquare, Building, WifiOff, BarChart3, CheckCircle,
  AlertCircle, Package, UserPlus, FileText,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, Tooltip, ResponsiveContainer,
} from 'recharts';
import { qk } from '@/lib/query/keys';
import { reportApi } from '@/lib/api/reports';
import { useActiveShopStore } from '@/lib/stores/activeShopStore';
import { useOfflineQueueStore } from '@/lib/stores/offlineQueueStore';
import { useAuthStore } from '@/lib/stores/authStore';
import { KpiCard } from '@/components/shared/KpiCard';
import { Can } from '@/components/shared/Can';
import { money } from '@/lib/format/money';
import { cn } from '@/lib/utils';

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function formatDate() {
  return new Date().toLocaleDateString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'short', year: 'numeric',
  });
}

function formatAxisDate(raw: string) {
  try {
    return new Date(raw).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  } catch {
    return raw;
  }
}

export default function DashboardPage() {
  const { activeShopId, isAllShops } = useActiveShopStore();
  const { isOnline } = useOfflineQueueStore();
  const { user } = useAuthStore();

  const { data, isLoading } = useQuery({
    queryKey: qk.dashboard(activeShopId),
    queryFn: () => reportApi.getDashboard(isAllShops ? undefined : activeShopId),
    staleTime: 60_000,
    refetchInterval: 5 * 60 * 1000,
  });

  const firstName = user?.name?.split(' ')[0] ?? '';

  const trendTotal = data?.revenue_trend?.reduce((s, d) => s + d.revenue, 0) ?? 0;
  const trendAvg = data?.revenue_trend?.length
    ? trendTotal / data.revenue_trend.length
    : 0;

  const hasAlerts =
    (data?.low_stock_alerts ?? 0) > 0 ||
    (data?.contracts_expiring_this_month ?? 0) > 0 ||
    (data?.over_budget_heads ?? 0) > 0;

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
      {!isOnline && (
        <div className="flex items-center gap-2 rounded-lg border border-[var(--warning)]/30 bg-[var(--warning)]/10 px-4 py-2.5 text-body-sm text-[var(--warning)] font-medium">
          <WifiOff className="h-4 w-4 shrink-0" />
          Offline — showing cached data. Changes will sync when reconnected.
        </div>
      )}

      {/* Greeting header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-h1 text-[var(--text)]">
            {getGreeting()}{firstName ? `, ${firstName}` : ''}
          </h1>
          <p className="text-body-sm text-[var(--text-muted)] mt-0.5">{formatDate()}</p>
        </div>
        <Can anyOf={['reports.billing.view', 'reports.repair.view']}>
          <Link
            href="/reports"
            className="flex items-center gap-1.5 text-body-sm text-[var(--accent)] hover:underline shrink-0 mt-1"
          >
            <BarChart3 className="h-4 w-4" />
            All reports
          </Link>
        </Can>
      </div>

      {/* Quick actions */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        <Can permission="repair.jobs.create">
          <Link
            href="/jobs/new"
            className="flex items-center gap-2 px-4 py-2 rounded-full border border-[var(--border)] bg-[var(--surface)] text-body-sm font-medium text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors whitespace-nowrap min-h-[auto] min-w-[auto]"
          >
            <Wrench className="h-4 w-4 text-[var(--accent)]" />
            New Job
          </Link>
        </Can>
        <Can permission="crm.customers.create">
          <Link
            href="/customers/new"
            className="flex items-center gap-2 px-4 py-2 rounded-full border border-[var(--border)] bg-[var(--surface)] text-body-sm font-medium text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors whitespace-nowrap min-h-[auto] min-w-[auto]"
          >
            <UserPlus className="h-4 w-4 text-[var(--accent)]" />
            New Customer
          </Link>
        </Can>
        <Can permission="billing.payments.record">
          <Link
            href="/payments/new"
            className="flex items-center gap-2 px-4 py-2 rounded-full border border-[var(--border)] bg-[var(--surface)] text-body-sm font-medium text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors whitespace-nowrap min-h-[auto] min-w-[auto]"
          >
            <CreditCard className="h-4 w-4 text-[var(--accent)]" />
            Record Payment
          </Link>
        </Can>
        <Can permission="billing.repair_invoices.create">
          <Link
            href="/invoices/new"
            className="flex items-center gap-2 px-4 py-2 rounded-full border border-[var(--border)] bg-[var(--surface)] text-body-sm font-medium text-[var(--text)] hover:bg-[var(--surface-2)] transition-colors whitespace-nowrap min-h-[auto] min-w-[auto]"
          >
            <FileText className="h-4 w-4 text-[var(--accent)]" />
            New Invoice
          </Link>
        </Can>
      </div>

      {/* Repair & Service KPIs */}
      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] opacity-70">
          Repair &amp; Service
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
          <KpiCard
            title="Open Jobs"
            value={data?.open_jobs ?? 0}
            icon={Wrench}
            loading={isLoading}
          />
          <KpiCard
            title="Completed Today"
            value={data?.jobs_completed_today ?? 0}
            icon={CheckCircle}
            variant="success"
            loading={isLoading}
          />
          {(isLoading || data?.tasks_due_today !== undefined) && (
            <KpiCard
              title="Tasks Due Today"
              value={data?.tasks_due_today ?? 0}
              icon={CheckSquare}
              variant={data && (data.tasks_due_today ?? 0) > 0 ? 'warning' : 'default'}
              loading={isLoading}
            />
          )}
          {(isLoading || data?.amc_visits_this_week !== undefined) && (
            <KpiCard
              title="AMC Visits This Week"
              value={data?.amc_visits_this_week ?? 0}
              icon={Calendar}
              loading={isLoading}
            />
          )}
        </div>
      </section>

      {/* Revenue & Finance KPIs */}
      <section className="space-y-3">
        <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] opacity-70">
          Revenue &amp; Finance
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
          <KpiCard
            title="Revenue Today"
            value={data ? money(data.revenue_today) : '—'}
            icon={CreditCard}
            loading={isLoading}
          />
          <KpiCard
            title="Revenue This Month"
            value={data ? money(data.revenue_month) : '—'}
            icon={TrendingUp}
            loading={isLoading}
          />
          <KpiCard
            title="Outstanding Dues"
            value={data ? money(data.outstanding_amount) : '—'}
            icon={AlertCircle}
            variant={data && data.outstanding_amount > 0 ? 'warning' : 'default'}
            loading={isLoading}
            className={data && data.outstanding_amount > 0 ? 'border-[var(--warning)]/30' : ''}
          />
          <KpiCard
            title="New Customers"
            value={data?.new_customers_month ?? 0}
            icon={Users}
            variant="success"
            loading={isLoading}
            subtitle="This month"
          />
        </div>
      </section>

      {/* Alerts (only shown when at least one alert is present or loading) */}
      {(isLoading || hasAlerts) && (
        <section className="space-y-3">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-[var(--text-muted)] opacity-70">
            Alerts
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
            {(isLoading || data?.low_stock_alerts !== undefined) && (
              <KpiCard
                title="Low Stock Alerts"
                value={data?.low_stock_alerts ?? 0}
                icon={Package}
                variant="warning"
                loading={isLoading}
                className={data && (data.low_stock_alerts ?? 0) > 0 ? 'border-[var(--warning)]/30' : ''}
              />
            )}
            {(isLoading || data?.contracts_expiring_this_month !== undefined) && (
              <KpiCard
                title="Contracts Expiring"
                value={data?.contracts_expiring_this_month ?? 0}
                icon={Building}
                variant="warning"
                loading={isLoading}
                subtitle="This month"
              />
            )}
            {(isLoading || (data?.over_budget_heads !== undefined && data.over_budget_heads > 0)) && (
              <KpiCard
                title="Over-Budget Heads"
                value={data?.over_budget_heads ?? 0}
                icon={AlertTriangle}
                variant="danger"
                loading={isLoading}
                className="border-[var(--danger)]/30 bg-[var(--danger)]/5"
              />
            )}
          </div>
        </section>
      )}

      {/* Revenue trend chart */}
      {data?.revenue_trend && data.revenue_trend.length > 0 && (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 md:p-5">
          <div className="flex items-start justify-between gap-4 mb-4">
            <div>
              <h2 className="text-body-sm font-semibold text-[var(--text-muted)] uppercase tracking-wide">
                Revenue trend — last 14 days
              </h2>
            </div>
            <div className="text-right shrink-0">
              <p className="text-h2 font-semibold text-[var(--text)] tabular-nums">{money(trendTotal)}</p>
              <p className="text-xs text-[var(--text-muted)]">avg {money(trendAvg)}/day</p>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={220}>
            <BarChart
              data={data.revenue_trend}
              margin={{ top: 0, right: 0, left: -20, bottom: 0 }}
            >
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11, fill: '#6b7280' }}
                tickLine={false}
                axisLine={false}
                tickFormatter={formatAxisDate}
              />
              <Tooltip
                formatter={(v: number) => [money(v), 'Revenue']}
                labelFormatter={formatAxisDate}
                contentStyle={{
                  border: '1px solid var(--border)',
                  background: 'var(--surface)',
                  borderRadius: 8,
                  fontSize: 12,
                }}
                cursor={{ fill: 'rgba(31, 111, 235, 0.08)' }}
              />
              <Bar dataKey="revenue" fill="#1f6feb" radius={[3, 3, 0, 0]} maxBarSize={40} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}
