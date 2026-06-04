'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import {
  Wrench, Users, CreditCard, TrendingUp, Calendar, AlertTriangle,
  CheckSquare, Building, WifiOff, BarChart3,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, Tooltip, ResponsiveContainer,
} from 'recharts';
import { qk } from '@/lib/query/keys';
import { reportApi } from '@/lib/api/reports';
import { useActiveShopStore } from '@/lib/stores/activeShopStore';
import { useOfflineQueueStore } from '@/lib/stores/offlineQueueStore';
import { KpiCard } from '@/components/shared/KpiCard';
import { Can } from '@/components/shared/Can';
import { money } from '@/lib/format/money';
import { cn } from '@/lib/utils';

export default function DashboardPage() {
  const { activeShopId, isAllShops } = useActiveShopStore();
  const { isOnline } = useOfflineQueueStore();

  const { data, isLoading } = useQuery({
    queryKey: qk.dashboard(activeShopId),
    queryFn: () => reportApi.getDashboard(isAllShops ? undefined : activeShopId),
    staleTime: 60_000,
    refetchInterval: 5 * 60 * 1000,
  });

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
      {!isOnline && (
        <div className="flex items-center gap-2 rounded-lg border border-[var(--warning)]/30 bg-[var(--warning)]/10 px-4 py-2.5 text-body-sm text-[var(--warning)] font-medium">
          <WifiOff className="h-4 w-4 shrink-0" />
          Offline — showing cached data. Changes will sync when reconnected.
        </div>
      )}

      <div className="flex items-center justify-between">
        <h1 className="text-h1 text-[var(--text)]">Dashboard</h1>
        <Can anyOf={['reports.billing.view', 'reports.repair.view']}>
          <Link
            href="/reports"
            className="flex items-center gap-1.5 text-body-sm text-[var(--accent)] hover:underline"
          >
            <BarChart3 className="h-4 w-4" />
            All reports
          </Link>
        </Can>
      </div>

      {/* KPI grid */}
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
          icon={Wrench}
          loading={isLoading}
        />
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
          icon={CreditCard}
          loading={isLoading}
          className={data && data.outstanding_amount > 0 ? 'border-[var(--warning)]/30' : ''}
        />
        <KpiCard
          title="New Customers"
          value={data?.new_customers_month ?? 0}
          icon={Users}
          loading={isLoading}
          subtitle="This month"
        />
        {(isLoading || data?.tasks_due_today !== undefined) && (
          <KpiCard
            title="Tasks Due Today"
            value={data?.tasks_due_today ?? 0}
            icon={CheckSquare}
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
        {(isLoading || data?.low_stock_alerts !== undefined) && (
          <KpiCard
            title="Low Stock Alerts"
            value={data?.low_stock_alerts ?? 0}
            icon={AlertTriangle}
            loading={isLoading}
            className={data && (data.low_stock_alerts ?? 0) > 0 ? 'border-[var(--warning)]/30' : ''}
          />
        )}
        {(isLoading || data?.contracts_expiring_this_month !== undefined) && (
          <KpiCard
            title="Contracts Expiring"
            value={data?.contracts_expiring_this_month ?? 0}
            icon={Building}
            loading={isLoading}
            subtitle="This month"
          />
        )}
        {data?.over_budget_heads !== undefined && data.over_budget_heads > 0 && (
          <KpiCard
            title="Over-Budget Heads"
            value={data.over_budget_heads}
            icon={AlertTriangle}
            loading={isLoading}
            className="border-[var(--danger)]/30 bg-[var(--danger)]/5"
          />
        )}
      </div>

      {/* Revenue trend chart */}
      {data?.revenue_trend && data.revenue_trend.length > 0 && (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-4 md:p-5">
          <h2 className="text-body-sm font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-4">
            Revenue trend — last 14 days
          </h2>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart
              data={data.revenue_trend}
              margin={{ top: 0, right: 0, left: -20, bottom: 0 }}
            >
              <XAxis
                dataKey="date"
                tick={{ fontSize: 11, fill: '#6b7280' }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                formatter={(v: number) => [money(v), 'Revenue']}
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
