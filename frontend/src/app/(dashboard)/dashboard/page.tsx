"use client";

import { useQuery } from "@tanstack/react-query";
import { Wrench, Users, ShoppingCart, TrendingUp, Clock, CheckCircle, AlertCircle } from "lucide-react";
import { api } from "@/lib/api";
import { formatCurrency } from "@/lib/utils";

interface DashboardStats {
  repair_jobs: { total: number; pending: number; in_progress: number; ready: number };
  pos_sales: { today_total: number; today_count: number };
  customers: { total: number; new_this_month: number };
  revenue: { today: number; this_month: number };
}

async function fetchDashboardStats(): Promise<DashboardStats> {
  const res = await api.get("/reports/dashboard/");
  return res.data.data;
}

export default function DashboardPage() {
  const { data, isLoading } = useQuery({
    queryKey: ["dashboard-stats"],
    queryFn: fetchDashboardStats,
    refetchInterval: 30_000,
  });

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Dashboard</h1>
        <p className="text-sm text-gray-500">Today&apos;s overview</p>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatCard
          icon={<TrendingUp className="w-5 h-5 text-green-600" />}
          label="Today's Revenue"
          value={isLoading ? "…" : formatCurrency(data?.revenue?.today ?? 0)}
          bg="bg-green-50"
        />
        <StatCard
          icon={<Wrench className="w-5 h-5 text-blue-600" />}
          label="Active Jobs"
          value={isLoading ? "…" : String(data?.repair_jobs?.in_progress ?? 0)}
          bg="bg-blue-50"
        />
        <StatCard
          icon={<ShoppingCart className="w-5 h-5 text-purple-600" />}
          label="POS Sales"
          value={isLoading ? "…" : String(data?.pos_sales?.today_count ?? 0)}
          bg="bg-purple-50"
        />
        <StatCard
          icon={<Users className="w-5 h-5 text-orange-600" />}
          label="Customers"
          value={isLoading ? "…" : String(data?.customers?.total ?? 0)}
          bg="bg-orange-50"
        />
      </div>

      {/* Repair Job Status */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <h2 className="text-sm font-semibold text-gray-700 mb-3">Repair Jobs</h2>
        <div className="grid grid-cols-3 gap-3">
          <StatusTile
            icon={<Clock className="w-4 h-4 text-yellow-600" />}
            label="Pending"
            count={data?.repair_jobs?.pending ?? 0}
            color="text-yellow-700 bg-yellow-50"
          />
          <StatusTile
            icon={<Wrench className="w-4 h-4 text-blue-600" />}
            label="In Progress"
            count={data?.repair_jobs?.in_progress ?? 0}
            color="text-blue-700 bg-blue-50"
          />
          <StatusTile
            icon={<CheckCircle className="w-4 h-4 text-green-600" />}
            label="Ready"
            count={data?.repair_jobs?.ready ?? 0}
            color="text-green-700 bg-green-50"
          />
        </div>
      </div>

      {/* Monthly Revenue */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-semibold text-gray-700">Monthly Revenue</h2>
          <AlertCircle className="w-4 h-4 text-gray-400" />
        </div>
        <p className="text-2xl font-bold text-gray-900">
          {isLoading ? "…" : formatCurrency(data?.revenue?.this_month ?? 0)}
        </p>
        <p className="text-xs text-gray-500 mt-1">Month to date</p>
      </div>
    </div>
  );
}

function StatCard({
  icon,
  label,
  value,
  bg,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  bg: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <div className={`inline-flex items-center justify-center w-9 h-9 rounded-lg ${bg} mb-3`}>
        {icon}
      </div>
      <p className="text-2xl font-bold text-gray-900">{value}</p>
      <p className="text-xs text-gray-500 mt-0.5">{label}</p>
    </div>
  );
}

function StatusTile({
  icon,
  label,
  count,
  color,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  color: string;
}) {
  return (
    <div className={`rounded-lg p-3 flex items-center gap-2 ${color}`}>
      {icon}
      <div>
        <p className="text-lg font-bold">{count}</p>
        <p className="text-xs opacity-80">{label}</p>
      </div>
    </div>
  );
}
