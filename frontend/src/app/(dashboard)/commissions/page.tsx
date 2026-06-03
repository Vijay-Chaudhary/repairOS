"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  DollarSign, Users, FileText, Plus,
  CheckCircle, Loader2, AlertCircle,
} from "lucide-react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { api } from "@/lib/api";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import { PermissionGate } from "@/components/ui/permission-gate";
import { PERMISSIONS } from "@/lib/permissions";
import type { CommissionRule, CommissionPayout, TechnicianLedger, PayoutStatus } from "@/types/commissions";
import type { Employee } from "@/types/hr";

// ── Constants ─────────────────────────────────────────────────────────────────

const PAYOUT_STATUS: Record<PayoutStatus, { label: string; cls: string }> = {
  draft:    { label: "Draft",    cls: "bg-gray-100 text-gray-700" },
  approved: { label: "Approved", cls: "bg-blue-100 text-blue-700" },
  paid:     { label: "Paid",     cls: "bg-green-100 text-green-700" },
};

type Tab = "rules" | "ledger" | "payouts";

// ── Fetchers ──────────────────────────────────────────────────────────────────

const fetchRules = (): Promise<CommissionRule[]> =>
  api.get("/commissions/rules/").then((r) => r.data.data);

const fetchEmployees = (): Promise<Employee[]> =>
  api.get("/hr/employees/").then((r) => r.data.data);

const fetchPayouts = (techId?: string): Promise<CommissionPayout[]> => {
  const params = techId ? `?technician_id=${techId}` : "";
  return api.get(`/commissions/payouts/${params}`).then((r) => r.data.data);
};

const fetchLedger = (techId: string): Promise<TechnicianLedger> =>
  api.get(`/commissions/technician/${techId}/`).then((r) => r.data.data);

// ── Schemas ───────────────────────────────────────────────────────────────────

const ruleSchema = z.object({
  name:              z.string().min(1, "Name required"),
  rate:              z.string().min(1, "Rate required"),
  lead_tech_share:   z.string(),
  applies_to_job_type: z.string().optional(),
  effective_from:    z.string().min(1, "Start date required"),
  effective_to:      z.string().optional(),
});
type RuleForm = z.infer<typeof ruleSchema>;

const payoutSchema = z.object({
  technician_id: z.string().min(1, "Select a technician"),
  period_start:  z.string().min(1, "Start date required"),
  period_end:    z.string().min(1, "End date required"),
}).refine((d) => d.period_end >= d.period_start, {
  message: "End must be ≥ start", path: ["period_end"],
});
type PayoutForm = z.infer<typeof payoutSchema>;

// ── Page ──────────────────────────────────────────────────────────────────────

export default function CommissionsPage() {
  const [tab, setTab] = useState<Tab>("rules");

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-gray-900">Commissions</h1>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
        {([
          { id: "rules",   icon: DollarSign, label: "Rules" },
          { id: "ledger",  icon: Users,      label: "Technician Ledger" },
          { id: "payouts", icon: FileText,   label: "Payouts" },
        ] as const).map(({ id, icon: Icon, label }) => (
          <button key={id} onClick={() => setTab(id)}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium rounded-md transition",
              tab === id ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
            )}>
            <Icon className="w-3.5 h-3.5" />{label}
          </button>
        ))}
      </div>

      {tab === "rules"   && <RulesTab />}
      {tab === "ledger"  && <LedgerTab />}
      {tab === "payouts" && <PayoutsTab />}
    </div>
  );
}

// ── Rules Tab ─────────────────────────────────────────────────────────────────

function RulesTab() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);

  const { data: rules, isLoading } = useQuery({ queryKey: ["commission-rules"], queryFn: fetchRules });

  const form = useForm<RuleForm>({
    resolver: zodResolver(ruleSchema),
    defaultValues: { lead_tech_share: "50" },
  });

  const createMutation = useMutation({
    mutationFn: (d: RuleForm) => api.post("/commissions/rules/", d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["commission-rules"] }); form.reset(); setShowForm(false); },
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">Commission calculation rules</p>
        <PermissionGate perm={PERMISSIONS.BILLING_INVOICES_CREATE}>
          <button onClick={() => setShowForm(!showForm)}
            className="flex items-center gap-2 px-3 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition min-h-[44px]">
            <Plus className="w-4 h-4" /> New Rule
          </button>
        </PermissionGate>
      </div>

      {/* Create rule form */}
      {showForm && (
        <form onSubmit={form.handleSubmit((d) => createMutation.mutate(d))}
          className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-3">
          <p className="text-sm font-semibold text-blue-900">New Commission Rule</p>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Name *</label>
              <input {...form.register("name")} placeholder="Standard Rate" className={inp(!!form.formState.errors.name)} />
              {form.formState.errors.name && <p className="text-red-500 text-xs mt-1">{form.formState.errors.name.message}</p>}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Rate (% of SC) *</label>
              <input {...form.register("rate")} type="number" step="0.01" min="0" max="100" placeholder="10" className={inp(!!form.formState.errors.rate)} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Lead Tech Share (%)</label>
              <input {...form.register("lead_tech_share")} type="number" step="1" min="0" max="100" placeholder="50" className={inp(false)} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Job Type Filter</label>
              <input {...form.register("applies_to_job_type")} placeholder="Smartphone (leave blank = all)" className={inp(false)} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Effective From *</label>
              <input {...form.register("effective_from")} type="date" className={inp(!!form.formState.errors.effective_from)} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Effective To</label>
              <input {...form.register("effective_to")} type="date" className={inp(false)} />
            </div>
          </div>
          {createMutation.isError && (
            <div className="flex items-center gap-2 text-red-600 text-xs">
              <AlertCircle className="w-3.5 h-3.5" /> Failed to save rule.
            </div>
          )}
          <div className="flex gap-2">
            <button type="button" onClick={() => setShowForm(false)} className="flex-1 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm hover:bg-white transition">Cancel</button>
            <button type="submit" disabled={createMutation.isPending}
              className="flex-1 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition flex items-center justify-center gap-2">
              {createMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Save Rule
            </button>
          </div>
        </form>
      )}

      {/* Rules list */}
      {isLoading ? (
        <div className="space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="h-16 bg-gray-100 rounded-xl animate-pulse" />)}</div>
      ) : !rules?.length ? (
        <div className="text-center py-12 text-gray-400">
          <DollarSign className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm">No commission rules yet</p>
        </div>
      ) : (
        <div className="space-y-2">
          {rules.map((rule) => (
            <div key={rule.id} className="bg-white rounded-xl border border-gray-200 p-4">
              <div className="flex items-start justify-between">
                <div>
                  <p className="text-sm font-medium text-gray-900">{rule.name}</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {rule.applies_to_job_type ? `For: ${rule.applies_to_job_type} · ` : "All job types · "}
                    Lead share: {rule.lead_tech_share}%
                  </p>
                  <p className="text-xs text-gray-400">
                    From {formatDate(rule.effective_from)}{rule.effective_to ? ` to ${formatDate(rule.effective_to)}` : " (ongoing)"}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xl font-bold text-blue-600">{rule.rate}%</p>
                  <p className="text-xs text-gray-400">of SC</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Ledger Tab ────────────────────────────────────────────────────────────────

function LedgerTab() {
  const [selectedTechId, setSelectedTechId] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const { data: employees } = useQuery({ queryKey: ["employees", ""], queryFn: fetchEmployees });

  const { data: ledger, isLoading, isFetching } = useQuery({
    queryKey: ["commission-ledger", selectedTechId],
    queryFn: () => fetchLedger(selectedTechId),
    enabled: !!selectedTechId,
  });

  return (
    <div className="space-y-3">
      {/* Technician picker */}
      <div>
        <label className="block text-xs font-medium text-gray-600 mb-1.5">Select Technician</label>
        <select value={selectedTechId} onChange={(e) => setSelectedTechId(e.target.value)}
          className="w-full px-3 py-2.5 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white">
          <option value="">Choose a technician…</option>
          {employees?.map((e) => (
            <option key={e.id} value={e.id}>{e.full_name} — {e.designation}</option>
          ))}
        </select>
      </div>

      {!selectedTechId && (
        <div className="text-center py-12 text-gray-400">
          <Users className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm">Select a technician to view their commission ledger</p>
        </div>
      )}

      {selectedTechId && (isLoading || isFetching) && (
        <div className="space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="h-14 bg-gray-100 rounded-xl animate-pulse" />)}</div>
      )}

      {ledger && !isLoading && (
        <>
          {/* Summary */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-blue-50 rounded-xl p-4">
              <p className="text-xs text-blue-600 mb-1">Total Unpaid</p>
              <p className="text-xl font-bold text-blue-900">{formatCurrency(parseFloat(ledger.total_unpaid))}</p>
            </div>
            <div className="bg-gray-50 rounded-xl p-4">
              <p className="text-xs text-gray-500 mb-1">Total Jobs</p>
              <p className="text-xl font-bold text-gray-900">{ledger.commissions.length}</p>
            </div>
          </div>

          {/* Commission rows */}
          {!ledger.commissions.length ? (
            <p className="text-sm text-gray-400 text-center py-6">No commissions recorded</p>
          ) : (
            <div className="space-y-1.5">
              {ledger.commissions.map((c) => (
                <div key={c.id} className={cn(
                  "bg-white rounded-xl border p-3 cursor-pointer hover:border-blue-300 transition",
                  c.is_paid ? "border-gray-100 opacity-60" : "border-gray-200"
                )} onClick={() => setExpanded(expanded === c.id ? null : c.id)}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      {c.is_paid
                        ? <CheckCircle className="w-4 h-4 text-green-500" />
                        : <DollarSign className="w-4 h-4 text-blue-500" />}
                      <div>
                        <p className="text-sm font-medium text-gray-900">Job #{c.job_number}</p>
                        <p className="text-xs text-gray-500">{c.is_lead ? "Lead tech" : "Support tech"} · {c.rate}% rate</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-bold text-gray-900">{formatCurrency(parseFloat(c.commission_amount))}</p>
                      <p className="text-xs text-gray-400">SC: {formatCurrency(parseFloat(c.sc_amount))}</p>
                    </div>
                  </div>
                  {expanded === c.id && (
                    <div className="mt-2 pt-2 border-t border-gray-100 flex gap-4 text-xs text-gray-500">
                      <span>SC: {formatCurrency(parseFloat(c.sc_amount))}</span>
                      <span>Rate: {c.rate}%</span>
                      <span>Commission: {formatCurrency(parseFloat(c.commission_amount))}</span>
                      <span>{c.is_paid ? "✅ Paid" : "⏳ Unpaid"}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Payouts Tab ───────────────────────────────────────────────────────────────

function PayoutsTab() {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [techFilter, setTechFilter] = useState("");

  const { data: employees } = useQuery({ queryKey: ["employees", ""], queryFn: fetchEmployees });
  const { data: payouts, isLoading } = useQuery({
    queryKey: ["commission-payouts", techFilter],
    queryFn: () => fetchPayouts(techFilter || undefined),
  });

  const form = useForm<PayoutForm>({ resolver: zodResolver(payoutSchema) });

  const createMutation = useMutation({
    mutationFn: (d: PayoutForm) => api.post("/commissions/payouts/", d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["commission-payouts"] }); form.reset(); setShowForm(false); },
  });

  const advanceMutation = useMutation({
    mutationFn: (payoutId: string) => api.patch(`/commissions/payouts/${payoutId}/`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["commission-payouts"] }),
  });

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <select value={techFilter} onChange={(e) => setTechFilter(e.target.value)}
          className="flex-1 px-3 py-2.5 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white">
          <option value="">All technicians</option>
          {employees?.map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
        </select>
        <PermissionGate perm={PERMISSIONS.HR_SALARY_GENERATE}>
          <button onClick={() => setShowForm(!showForm)}
            className="flex items-center gap-2 px-3 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition min-h-[44px]">
            <Plus className="w-4 h-4" /> Create Payout
          </button>
        </PermissionGate>
      </div>

      {/* Create payout form */}
      {showForm && (
        <form onSubmit={form.handleSubmit((d) => createMutation.mutate(d))}
          className="bg-blue-50 border border-blue-200 rounded-xl p-4 space-y-3">
          <p className="text-sm font-semibold text-blue-900">New Payout Batch</p>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Technician *</label>
            <select {...form.register("technician_id")} className={inp(!!form.formState.errors.technician_id)}>
              <option value="">Select…</option>
              {employees?.map((e) => <option key={e.id} value={e.id}>{e.full_name}</option>)}
            </select>
            {form.formState.errors.technician_id && <p className="text-red-500 text-xs mt-1">{form.formState.errors.technician_id.message}</p>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Period Start *</label>
              <input {...form.register("period_start")} type="date" className={inp(!!form.formState.errors.period_start)} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Period End *</label>
              <input {...form.register("period_end")} type="date" className={inp(!!form.formState.errors.period_end)} />
              {form.formState.errors.period_end && <p className="text-red-500 text-xs mt-1">{form.formState.errors.period_end.message}</p>}
            </div>
          </div>
          {createMutation.isError && (
            <div className="flex items-center gap-2 text-red-600 text-xs">
              <AlertCircle className="w-3.5 h-3.5" /> Failed. Check that the technician has unpaid commissions.
            </div>
          )}
          <div className="flex gap-2">
            <button type="button" onClick={() => setShowForm(false)} className="flex-1 py-2 border border-gray-300 text-gray-700 rounded-lg text-sm hover:bg-white transition">Cancel</button>
            <button type="submit" disabled={createMutation.isPending}
              className="flex-1 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition flex items-center justify-center gap-2">
              {createMutation.isPending && <Loader2 className="w-4 h-4 animate-spin" />} Generate
            </button>
          </div>
        </form>
      )}

      {/* Payouts list */}
      {isLoading ? (
        <div className="space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="h-20 bg-gray-100 rounded-xl animate-pulse" />)}</div>
      ) : !payouts?.length ? (
        <div className="text-center py-12 text-gray-400">
          <FileText className="w-8 h-8 mx-auto mb-2 opacity-30" />
          <p className="text-sm">No payouts found</p>
        </div>
      ) : (
        <div className="space-y-2">
          {payouts.map((payout) => {
            const s = PAYOUT_STATUS[payout.status];
            const nextLabel = payout.status === "draft" ? "Approve" : payout.status === "approved" ? "Mark Paid" : null;
            return (
              <div key={payout.id} className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex items-start justify-between gap-3 mb-3">
                  <div>
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="text-sm font-medium text-gray-900">{payout.technician_name || payout.technician}</p>
                      <span className={cn("text-xs font-medium px-2 py-0.5 rounded-full", s.cls)}>{s.label}</span>
                    </div>
                    <p className="text-xs text-gray-500">
                      {formatDate(payout.period_start)} → {formatDate(payout.period_end)}
                    </p>
                    {payout.paid_at && <p className="text-xs text-gray-400">Paid: {formatDate(payout.paid_at)}</p>}
                  </div>
                  <p className="text-lg font-bold text-gray-900 flex-shrink-0">
                    {formatCurrency(parseFloat(payout.total_commission))}
                  </p>
                </div>
                {nextLabel && (
                  <PermissionGate perm={PERMISSIONS.HR_SALARY_GENERATE}>
                    <button
                      onClick={() => advanceMutation.mutate(payout.id)}
                      disabled={advanceMutation.isPending}
                      className={cn(
                        "w-full py-2 rounded-lg text-xs font-medium border transition min-h-[40px] flex items-center justify-center gap-1.5",
                        payout.status === "draft"
                          ? "bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100"
                          : "bg-green-50 text-green-700 border-green-200 hover:bg-green-100"
                      )}>
                      {advanceMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                      {nextLabel}
                    </button>
                  </PermissionGate>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const inp = (err: boolean) => cn(
  "w-full px-3 py-2.5 rounded-lg border text-sm outline-none focus:ring-2 focus:ring-blue-500",
  err ? "border-red-300 bg-red-50" : "border-gray-300 bg-white"
);
