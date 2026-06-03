"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Building2, Users, CreditCard, AlertTriangle,
  CheckCircle, XCircle, Clock, Search, Loader2,
} from "lucide-react";
import { api } from "@/lib/api";
import { formatDate, cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth.store";

// ── Types ─────────────────────────────────────────────────────────────────────

interface TenantSummary {
  id: string;
  name: string;
  slug: string;
  status: "provisioning" | "active" | "suspended" | "provisioning_failed" | "deleted";
  plan: string;
  owner_email: string;
  owner_phone: string;
  created_at: string;
}

interface TenantDetail extends TenantSummary {
  updated_at: string;
  db_status: "active" | "inactive" | "not_provisioned";
  subscription: {
    id: string;
    plan: { id: string; name: string; max_shops: number; max_users: number; price_monthly_inr: string };
    status: string;
    current_period_start: string | null;
    current_period_end: string | null;
  } | null;
}

interface SubscriptionPlan {
  id: string;
  name: string;
  max_shops: number;
  max_users: number;
  max_products: number;
  max_jobs_per_month: number;
  features: Record<string, boolean>;
  price_monthly_inr: string;
}

// ── Status display ────────────────────────────────────────────────────────────

const TENANT_STATUS: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
  active:               { label: "Active",      cls: "bg-green-100 text-green-700", icon: <CheckCircle className="w-3.5 h-3.5" /> },
  suspended:            { label: "Suspended",   cls: "bg-orange-100 text-orange-700", icon: <AlertTriangle className="w-3.5 h-3.5" /> },
  provisioning:         { label: "Provisioning",cls: "bg-blue-100 text-blue-700",  icon: <Clock className="w-3.5 h-3.5" /> },
  provisioning_failed:  { label: "Failed",      cls: "bg-red-100 text-red-700",    icon: <XCircle className="w-3.5 h-3.5" /> },
  deleted:              { label: "Deleted",     cls: "bg-gray-100 text-gray-500",  icon: <XCircle className="w-3.5 h-3.5" /> },
};

type Tab = "tenants" | "plans";

// ── Page guard ────────────────────────────────────────────────────────────────

export default function PlatformAdminPage() {
  const user = useAuthStore((s) => s.user);
  const [tab, setTab] = useState<Tab>("tenants");

  if (!user?.is_platform_admin) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-gray-400">
        <AlertTriangle className="w-12 h-12 mb-4 opacity-40" />
        <p className="text-lg font-medium text-gray-600">Platform Admin Access Only</p>
        <p className="text-sm mt-1">This section requires platform administrator privileges.</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 bg-indigo-600 rounded-lg flex items-center justify-center flex-shrink-0">
          <Building2 className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Platform Admin</h1>
          <p className="text-xs text-gray-500">Manage tenants and subscription plans</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
        {([
          { id: "tenants", icon: Users,      label: "Tenants" },
          { id: "plans",   icon: CreditCard, label: "Subscription Plans" },
        ] as const).map(({ id, icon: Icon, label }) => (
          <button key={id} onClick={() => setTab(id)}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 py-2 text-sm font-medium rounded-md transition",
              tab === id ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
            )}>
            <Icon className="w-4 h-4" />{label}
          </button>
        ))}
      </div>

      {tab === "tenants" && <TenantsTab />}
      {tab === "plans"   && <PlansTab />}
    </div>
  );
}

// ── Tenants Tab ───────────────────────────────────────────────────────────────

function TenantsTab() {
  const qc = useQueryClient();
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: tenants, isLoading } = useQuery<TenantSummary[]>({
    queryKey: ["platform-tenants"],
    queryFn: () => api.get("/platform/tenants/").then((r) => Array.isArray(r.data.data) ? r.data.data : []),
  });

  const { data: detail, isLoading: detailLoading } = useQuery<TenantDetail>({
    queryKey: ["platform-tenant", selectedId],
    queryFn: () => api.get(`/platform/tenants/${selectedId}/`).then((r) => r.data.data),
    enabled: !!selectedId,
  });

  const suspendMutation = useMutation({
    mutationFn: (id: string) => api.post(`/platform/tenants/${id}/suspend/`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["platform-tenants"] }),
  });

  const filtered = tenants?.filter((t) =>
    !search || t.name.toLowerCase().includes(search.toLowerCase()) ||
    t.slug.includes(search) || t.owner_email.includes(search)
  ) ?? [];

  return (
    <div className="flex gap-4 flex-col lg:flex-row">
      {/* Tenant list */}
      <div className="flex-1 min-w-0 space-y-3">
        {/* Stats row */}
        {tenants && (
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: "Total", value: tenants.length, cls: "bg-gray-50" },
              { label: "Active", value: tenants.filter((t) => t.status === "active").length, cls: "bg-green-50" },
              { label: "Suspended", value: tenants.filter((t) => t.status === "suspended").length, cls: "bg-orange-50" },
            ].map(({ label, value, cls }) => (
              <div key={label} className={`rounded-xl p-3 text-center ${cls}`}>
                <p className="text-xl font-bold text-gray-900">{value}</p>
                <p className="text-xs text-gray-500">{label}</p>
              </div>
            ))}
          </div>
        )}

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input type="text" placeholder="Search tenants…" value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2.5 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500" />
        </div>

        {isLoading ? (
          <div className="space-y-2">{[...Array(4)].map((_, i) => <div key={i} className="h-16 bg-gray-100 rounded-xl animate-pulse" />)}</div>
        ) : !filtered.length ? (
          <p className="text-center py-10 text-gray-400 text-sm">No tenants found</p>
        ) : (
          <div className="space-y-2">
            {filtered.map((tenant) => {
              const s = TENANT_STATUS[tenant.status] ?? TENANT_STATUS.active;
              return (
                <button key={tenant.id} onClick={() => setSelectedId(tenant.id === selectedId ? null : tenant.id)}
                  className={cn(
                    "w-full flex items-center justify-between bg-white rounded-xl border p-3 text-left transition",
                    selectedId === tenant.id ? "border-blue-400 shadow-sm" : "border-gray-200 hover:border-gray-300"
                  )}>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="text-sm font-medium text-gray-900 truncate">{tenant.name}</p>
                      <span className={cn("flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full", s.cls)}>
                        {s.icon}{s.label}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500">{tenant.slug} · {tenant.owner_email}</p>
                    <p className="text-xs text-gray-400">Plan: {tenant.plan} · {formatDate(tenant.created_at)}</p>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Tenant detail panel */}
      {selectedId && (
        <div className="w-full lg:w-72 flex-shrink-0 space-y-3">
          {detailLoading ? (
            <div className="h-64 bg-gray-100 rounded-xl animate-pulse" />
          ) : detail ? (
            <>
              <div className="bg-white rounded-xl border border-gray-200 p-4 space-y-3">
                <h2 className="text-sm font-semibold text-gray-900">{detail.name}</h2>
                <div className="space-y-1.5 text-xs">
                  <Row label="Slug"    value={detail.slug} mono />
                  <Row label="Email"   value={detail.owner_email} />
                  <Row label="Phone"   value={detail.owner_phone} />
                  <Row label="Plan"    value={detail.plan} />
                  <Row label="DB"      value={detail.db_status} />
                  <Row label="Created" value={formatDate(detail.created_at)} />
                </div>

                {detail.subscription && (
                  <div className="pt-2 border-t border-gray-100">
                    <p className="text-xs font-medium text-gray-500 mb-1">Subscription</p>
                    <p className="text-xs text-gray-700">{detail.subscription.plan.name} · {detail.subscription.status}</p>
                    {detail.subscription.current_period_end && (
                      <p className="text-xs text-gray-400">Renews {formatDate(detail.subscription.current_period_end)}</p>
                    )}
                  </div>
                )}

                {detail.status === "active" && (
                  <button
                    onClick={() => suspendMutation.mutate(detail.id)}
                    disabled={suspendMutation.isPending}
                    className="w-full py-2 bg-orange-50 text-orange-700 border border-orange-200 rounded-lg text-xs font-medium hover:bg-orange-100 transition flex items-center justify-center gap-1.5 min-h-[40px]">
                    {suspendMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <AlertTriangle className="w-3.5 h-3.5" />}
                    Suspend Tenant
                  </button>
                )}
              </div>
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}

// ── Plans Tab ─────────────────────────────────────────────────────────────────

function PlansTab() {
  const { data: plans, isLoading } = useQuery<SubscriptionPlan[]>({
    queryKey: ["subscription-plans"],
    queryFn: () => api.get("/platform/plans/").then((r) => Array.isArray(r.data.data) ? r.data.data : []),
  });

  return (
    <div className="space-y-3">
      {isLoading ? (
        <div className="space-y-3">{[...Array(3)].map((_, i) => <div key={i} className="h-32 bg-gray-100 rounded-xl animate-pulse" />)}</div>
      ) : !plans?.length ? (
        <p className="text-center py-10 text-gray-400 text-sm">No subscription plans found</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {plans.map((plan) => (
            <div key={plan.id} className="bg-white rounded-xl border border-gray-200 p-5">
              <p className="text-base font-bold text-gray-900">{plan.name}</p>
              <p className="text-2xl font-bold text-blue-600 mt-1">
                ₹{parseInt(plan.price_monthly_inr).toLocaleString("en-IN")}
                <span className="text-sm font-normal text-gray-400">/mo</span>
              </p>
              <div className="mt-3 space-y-1.5">
                <Limit label="Shops"     value={plan.max_shops} />
                <Limit label="Users"     value={plan.max_users} />
                <Limit label="Products"  value={plan.max_products} />
                <Limit label="Jobs/mo"   value={plan.max_jobs_per_month} />
              </div>
              {plan.features && Object.keys(plan.features).length > 0 && (
                <div className="mt-3 pt-3 border-t border-gray-100">
                  <p className="text-xs font-medium text-gray-500 mb-1.5">Features</p>
                  <div className="space-y-1">
                    {Object.entries(plan.features).map(([key, enabled]) => (
                      <div key={key} className="flex items-center gap-1.5 text-xs">
                        {enabled
                          ? <CheckCircle className="w-3 h-3 text-green-500" />
                          : <XCircle className="w-3 h-3 text-gray-300" />}
                        <span className={enabled ? "text-gray-700" : "text-gray-400"}>{key}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-gray-500">{label}</span>
      <span className={cn("text-gray-900 font-medium", mono ? "font-mono" : "")}>{value}</span>
    </div>
  );
}

function Limit({ label, value }: { label: string; value: number }) {
  return (
    <div className="flex justify-between text-xs">
      <span className="text-gray-500">{label}</span>
      <span className="text-gray-900 font-medium">{value === 0 ? "Unlimited" : value.toLocaleString()}</span>
    </div>
  );
}
