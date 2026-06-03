"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft, Calendar, RefreshCw, CheckCircle,
  Clock, AlertTriangle, X, Loader2, ChevronDown, ChevronUp,
} from "lucide-react";
import Link from "next/link";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { api } from "@/lib/api";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import type { AMCContract, AMCVisit, ContractStatus, VisitStatus } from "@/types/amc";
import { PermissionGate } from "@/components/ui/permission-gate";
import { PERMISSIONS } from "@/lib/permissions";

// ── Status helpers ────────────────────────────────────────────────────────────

const CONTRACT_STATUS: Record<ContractStatus, { label: string; cls: string }> = {
  active:          { label: "Active",       cls: "bg-green-100 text-green-700" },
  expired:         { label: "Expired",      cls: "bg-gray-100 text-gray-600" },
  cancelled:       { label: "Cancelled",    cls: "bg-red-100 text-red-700" },
  pending_renewal: { label: "Renewal Due",  cls: "bg-yellow-100 text-yellow-700" },
};

const VISIT_STATUS: Record<VisitStatus, { label: string; icon: React.ReactNode; cls: string }> = {
  scheduled:   { label: "Scheduled",   icon: <Clock className="w-3.5 h-3.5" />,         cls: "text-blue-600 bg-blue-50" },
  completed:   { label: "Completed",   icon: <CheckCircle className="w-3.5 h-3.5" />,   cls: "text-green-600 bg-green-50" },
  missed:      { label: "Missed",      icon: <AlertTriangle className="w-3.5 h-3.5" />, cls: "text-red-600 bg-red-50" },
  rescheduled: { label: "Rescheduled", icon: <RefreshCw className="w-3.5 h-3.5" />,     cls: "text-indigo-600 bg-indigo-50" },
  cancelled:   { label: "Cancelled",   icon: <X className="w-3.5 h-3.5" />,             cls: "text-gray-500 bg-gray-50" },
};

const PAYMENT_LABELS: Record<string, string> = {
  upfront: "Upfront", quarterly: "Quarterly", monthly: "Monthly",
};

// ── Schemas ───────────────────────────────────────────────────────────────────

const completeSchema = z.object({
  work_done:    z.string().min(5, "Describe work done (min 5 chars)"),
  issues_found: z.string().optional(),
});
type CompleteForm = z.infer<typeof completeSchema>;

const rescheduleSchema = z.object({
  new_date: z.string().min(1, "Pick a date"),
});
type RescheduleForm = z.infer<typeof rescheduleSchema>;

// ── Data fetchers ─────────────────────────────────────────────────────────────

async function fetchContract(id: string): Promise<AMCContract> {
  const res = await api.get(`/amc/contracts/${id}/`);
  return res.data.data;
}

async function fetchVisits(contractId: string): Promise<AMCVisit[]> {
  const res = await api.get(`/amc/contracts/${contractId}/visits/`);
  return Array.isArray(res.data.data) ? res.data.data : (res.data.data ?? []);
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function AMCDetailPage({ params }: { params: { id: string } }) {
  const qc = useQueryClient();

  const { data: contract, isLoading } = useQuery({
    queryKey: ["amc-contract", params.id],
    queryFn: () => fetchContract(params.id),
  });

  const { data: visits, isLoading: visitsLoading } = useQuery({
    queryKey: ["amc-visits", params.id],
    queryFn: () => fetchVisits(params.id),
  });

  const renewMutation = useMutation({
    mutationFn: () => api.post(`/amc/contracts/${params.id}/renew/`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["amc-contract", params.id] }),
  });

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-4 max-w-2xl">
        <div className="h-6 w-32 bg-gray-200 rounded" />
        <div className="h-48 bg-gray-100 rounded-xl" />
      </div>
    );
  }
  if (!contract) return <p className="text-gray-500">Contract not found.</p>;

  const statusCfg = CONTRACT_STATUS[contract.status];
  const daysLeft = Math.ceil(
    (new Date(contract.end_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24)
  );

  return (
    <div className="space-y-4 max-w-2xl">
      {/* Back */}
      <Link href="/amc" className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700">
        <ArrowLeft className="w-4 h-4" /> AMC
      </Link>

      {/* Contract header */}
      <div className="bg-white rounded-xl border border-gray-200 p-5">
        <div className="flex items-start justify-between gap-3 mb-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              <span className="text-xs font-mono text-gray-400">{contract.contract_number}</span>
              <span className={cn("text-xs font-medium px-2 py-0.5 rounded-full", statusCfg.cls)}>
                {statusCfg.label}
              </span>
              {daysLeft > 0 && daysLeft <= 30 && (
                <span className="flex items-center gap-1 text-xs text-yellow-600">
                  <AlertTriangle className="w-3 h-3" />
                  {daysLeft}d left
                </span>
              )}
            </div>
            <h1 className="text-lg font-semibold text-gray-900">{contract.title}</h1>
            <p className="text-sm text-gray-600">{contract.customer_name}</p>
          </div>
          <div className="text-right flex-shrink-0">
            <p className="text-xl font-bold text-gray-900">{formatCurrency(parseFloat(contract.value))}</p>
            <p className="text-xs text-gray-500">{PAYMENT_LABELS[contract.payment_terms] ?? contract.payment_terms}</p>
          </div>
        </div>

        {/* Date + visits row */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          <InfoTile label="Start" value={formatDate(contract.start_date)} />
          <InfoTile label="End"   value={formatDate(contract.end_date)} />
          <InfoTile label="Visits / yr" value={String(contract.visits_per_year || "—")} />
        </div>

        {contract.description && (
          <p className="text-sm text-gray-600 mb-4">{contract.description}</p>
        )}

        {contract.location_address && (
          <p className="text-xs text-gray-500 mb-4">📍 {contract.location_address}</p>
        )}

        {/* Actions */}
        <div className="flex gap-2 flex-wrap">
          <PermissionGate perm={PERMISSIONS.AMC_RENEWALS_MANAGE}>
            {contract.status !== "cancelled" && (
              <button
                onClick={() => renewMutation.mutate()}
                disabled={renewMutation.isPending}
                className="flex items-center gap-2 px-4 py-2.5 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition min-h-[44px]"
              >
                {renewMutation.isPending ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <RefreshCw className="w-4 h-4" />
                )}
                Renew Contract
              </button>
            )}
          </PermissionGate>
          <PermissionGate perm={PERMISSIONS.AMC_CONTRACTS_EDIT}>
            <Link
              href={`/amc/${contract.id}/edit`}
              className="flex items-center gap-2 px-4 py-2.5 border border-gray-300 text-gray-700 rounded-lg text-sm font-medium hover:bg-gray-50 transition min-h-[44px]"
            >
              Edit
            </Link>
          </PermissionGate>
        </div>
      </div>

      {/* Renewal invoices */}
      {contract.renewal_invoices.length > 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-3">Renewal History</h2>
          <div className="space-y-2">
            {contract.renewal_invoices.map((ri) => (
              <div key={ri.id} className="flex justify-between text-xs">
                <span className="text-gray-600">{formatDate(ri.renewal_period_start)} → {formatDate(ri.renewal_period_end)}</span>
                <span className="text-gray-400">{ri.sent_at ? formatDate(ri.sent_at) : "Pending"}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Visit timeline */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Calendar className="w-4 h-4 text-gray-600" />
            <h2 className="text-sm font-semibold text-gray-700">
              Visits ({contract.visits_count})
            </h2>
          </div>
        </div>

        {visitsLoading ? (
          <div className="p-4 space-y-2">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="h-14 bg-gray-100 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : !visits?.length ? (
          <div className="py-10 text-center text-gray-400 text-sm">No visits scheduled yet</div>
        ) : (
          <div className="divide-y divide-gray-50">
            {visits.map((visit) => (
              <VisitRow
                key={visit.id}
                visit={visit}
                onRefresh={() => qc.invalidateQueries({ queryKey: ["amc-visits", params.id] })}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Visit row with inline complete / reschedule ───────────────────────────────

function VisitRow({ visit, onRefresh }: { visit: AMCVisit; onRefresh: () => void }) {
  const [expanded, setExpanded] = useState(false);
  const [mode, setMode] = useState<"complete" | "reschedule" | null>(null);
  const vstCfg = VISIT_STATUS[visit.status];

  const completeForm = useForm<CompleteForm>({ resolver: zodResolver(completeSchema) });
  const rescheduleForm = useForm<RescheduleForm>({ resolver: zodResolver(rescheduleSchema) });

  const completeMutation = useMutation({
    mutationFn: (d: CompleteForm) =>
      api.post(`/amc/visits/${visit.id}/complete/`, {
        work_done: d.work_done,
        issues_found: d.issues_found ?? "",
      }),
    onSuccess: () => { onRefresh(); setMode(null); completeForm.reset(); },
  });

  const rescheduleMutation = useMutation({
    mutationFn: (d: RescheduleForm) =>
      api.post(`/amc/visits/${visit.id}/reschedule/`, { new_date: d.new_date }),
    onSuccess: () => { onRefresh(); setMode(null); rescheduleForm.reset(); },
  });

  const canComplete = visit.status === "scheduled" || visit.status === "rescheduled";

  return (
    <div className="px-4 py-3">
      {/* Visit summary row */}
      <div
        className="flex items-center justify-between gap-2 cursor-pointer"
        onClick={() => setExpanded((e) => !e)}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className={cn("flex items-center justify-center w-7 h-7 rounded-full flex-shrink-0", vstCfg.cls)}>
            {vstCfg.icon}
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-gray-900">Visit #{visit.visit_number}</p>
            <p className="text-xs text-gray-500">
              {formatDate(visit.scheduled_date)}
              {visit.actual_date && ` · Completed ${formatDate(visit.actual_date)}`}
              {visit.technician_name && ` · ${visit.technician_name}`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <span className={cn("text-xs font-medium px-2 py-0.5 rounded-full", vstCfg.cls)}>
            {vstCfg.label}
          </span>
          {expanded ? <ChevronUp className="w-4 h-4 text-gray-400" /> : <ChevronDown className="w-4 h-4 text-gray-400" />}
        </div>
      </div>

      {/* Expanded: completed details or action forms */}
      {expanded && (
        <div className="mt-3 pl-10 space-y-3">
          {/* Show completed visit details */}
          {visit.status === "completed" && visit.work_done && (
            <div className="space-y-1">
              <p className="text-xs font-medium text-gray-500">Work done</p>
              <p className="text-sm text-gray-800">{visit.work_done}</p>
              {visit.issues_found && (
                <>
                  <p className="text-xs font-medium text-gray-500 mt-2">Issues found</p>
                  <p className="text-sm text-orange-700">{visit.issues_found}</p>
                </>
              )}
            </div>
          )}

          {/* Action buttons */}
          {canComplete && mode === null && (
            <div className="flex gap-2">
              <PermissionGate perm={PERMISSIONS.AMC_VISITS_COMPLETE}>
                <button
                  onClick={(e) => { e.stopPropagation(); setMode("complete"); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-green-50 text-green-700 border border-green-200 rounded-lg text-xs font-medium hover:bg-green-100 transition min-h-[36px]"
                >
                  <CheckCircle className="w-3.5 h-3.5" /> Mark Complete
                </button>
              </PermissionGate>
              <PermissionGate perm={PERMISSIONS.AMC_VISITS_SCHEDULE}>
                <button
                  onClick={(e) => { e.stopPropagation(); setMode("reschedule"); }}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 text-indigo-700 border border-indigo-200 rounded-lg text-xs font-medium hover:bg-indigo-100 transition min-h-[36px]"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> Reschedule
                </button>
              </PermissionGate>
            </div>
          )}

          {/* Complete form */}
          {mode === "complete" && (
            <form
              onSubmit={completeForm.handleSubmit((d) => completeMutation.mutate(d))}
              className="space-y-3 bg-green-50 rounded-lg p-3 border border-green-200"
              onClick={(e) => e.stopPropagation()}
            >
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Work done *</label>
                <textarea
                  {...completeForm.register("work_done")}
                  rows={2}
                  placeholder="Describe work performed…"
                  className={cn(
                    "w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-green-500 resize-none",
                    completeForm.formState.errors.work_done ? "border-red-300" : "border-gray-300"
                  )}
                />
                {completeForm.formState.errors.work_done && (
                  <p className="text-red-500 text-xs mt-1">{completeForm.formState.errors.work_done.message}</p>
                )}
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Issues found (optional)</label>
                <textarea
                  {...completeForm.register("issues_found")}
                  rows={1}
                  placeholder="Any problems noted…"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-green-500 resize-none"
                />
              </div>
              {completeMutation.isError && (
                <p className="text-red-500 text-xs">Failed to complete visit. Try again.</p>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setMode(null)}
                  className="flex-1 py-2 border border-gray-300 text-gray-700 rounded-lg text-xs font-medium hover:bg-white transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={completeMutation.isPending}
                  className="flex-1 py-2 bg-green-600 text-white rounded-lg text-xs font-semibold hover:bg-green-700 disabled:opacity-50 transition flex items-center justify-center gap-1.5"
                >
                  {completeMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Confirm
                </button>
              </div>
            </form>
          )}

          {/* Reschedule form */}
          {mode === "reschedule" && (
            <form
              onSubmit={rescheduleForm.handleSubmit((d) => rescheduleMutation.mutate(d))}
              className="space-y-3 bg-indigo-50 rounded-lg p-3 border border-indigo-200"
              onClick={(e) => e.stopPropagation()}
            >
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">New date *</label>
                <input
                  {...rescheduleForm.register("new_date")}
                  type="date"
                  className={cn(
                    "w-full px-3 py-2 border rounded-lg text-sm outline-none focus:ring-2 focus:ring-indigo-500",
                    rescheduleForm.formState.errors.new_date ? "border-red-300" : "border-gray-300"
                  )}
                />
                {rescheduleForm.formState.errors.new_date && (
                  <p className="text-red-500 text-xs mt-1">{rescheduleForm.formState.errors.new_date.message}</p>
                )}
              </div>
              {rescheduleMutation.isError && (
                <p className="text-red-500 text-xs">Failed to reschedule. Try again.</p>
              )}
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setMode(null)}
                  className="flex-1 py-2 border border-gray-300 text-gray-700 rounded-lg text-xs font-medium hover:bg-white transition"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={rescheduleMutation.isPending}
                  className="flex-1 py-2 bg-indigo-600 text-white rounded-lg text-xs font-semibold hover:bg-indigo-700 disabled:opacity-50 transition flex items-center justify-center gap-1.5"
                >
                  {rescheduleMutation.isPending && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                  Save
                </button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-gray-50 rounded-lg px-3 py-2">
      <p className="text-xs text-gray-500 mb-0.5">{label}</p>
      <p className="text-sm font-medium text-gray-900">{value}</p>
    </div>
  );
}
