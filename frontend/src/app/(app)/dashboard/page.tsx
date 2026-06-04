'use client';

import { useQuery } from '@tanstack/react-query';
import { Wrench, Users, CreditCard, TrendingUp } from 'lucide-react';
import { qk } from '@/lib/query/keys';
import { apiGet } from '@/lib/api/client';
import { useActiveShopStore } from '@/lib/stores/activeShopStore';
import { KpiCard } from '@/components/shared/KpiCard';
import { money } from '@/lib/format/money';

interface DashboardData {
  open_jobs: number;
  jobs_completed_today: number;
  revenue_today: number;
  revenue_month: number;
  new_customers_month: number;
  outstanding_amount: number;
}

export default function DashboardPage() {
  const { activeShopId, isAllShops } = useActiveShopStore();

  const { data, isLoading } = useQuery({
    queryKey: qk.dashboard(activeShopId),
    queryFn: () =>
      apiGet<DashboardData>('/reports/dashboard/', isAllShops ? {} : { shop_id: activeShopId ?? undefined }),
    staleTime: 60_000,
  });

  return (
    <div className="p-4 md:p-6 space-y-6 max-w-7xl mx-auto">
      <h1 className="text-h1 text-[var(--text)]">Dashboard</h1>

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
          title="Month Revenue"
          value={data ? money(data.revenue_month) : '—'}
          icon={TrendingUp}
          loading={isLoading}
        />
        <KpiCard
          title="New Customers"
          value={data?.new_customers_month ?? 0}
          icon={Users}
          loading={isLoading}
        />
        <KpiCard
          title="Outstanding"
          value={data ? money(data.outstanding_amount) : '—'}
          icon={CreditCard}
          loading={isLoading}
        />
      </div>
    </div>
  );
}
