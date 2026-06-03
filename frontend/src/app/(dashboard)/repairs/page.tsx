"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, Search, Wrench } from "lucide-react";
import Link from "next/link";
import { api } from "@/lib/api";
import { formatDate, formatCurrency, cn } from "@/lib/utils";
import type { CursorPage } from "@/types/api";
import { PermissionGate } from "@/components/ui/permission-gate";
import { PERMISSIONS } from "@/lib/permissions";

interface RepairJob {
  id: string;
  job_number: string;
  customer_name: string;
  customer_phone: string;
  device_type: string;
  brand: string;
  model: string;
  status: string;
  service_charge: string;
  created_at: string;
  technician_name: string | null;
}

const STATUS_COLORS: Record<string, string> = {
  intake: "bg-gray-100 text-gray-700",
  diagnosis: "bg-yellow-100 text-yellow-700",
  waiting_parts: "bg-orange-100 text-orange-700",
  repair: "bg-blue-100 text-blue-700",
  testing: "bg-indigo-100 text-indigo-700",
  qc: "bg-purple-100 text-purple-700",
  ready: "bg-green-100 text-green-700",
  delivered: "bg-gray-100 text-gray-500",
  cancelled: "bg-red-100 text-red-700",
};

const STATUS_LABELS: Record<string, string> = {
  intake: "Intake",
  diagnosis: "Diagnosis",
  waiting_parts: "Waiting Parts",
  repair: "In Repair",
  testing: "Testing",
  qc: "QC",
  ready: "Ready",
  delivered: "Delivered",
  cancelled: "Cancelled",
};

async function fetchJobs(
  search: string,
  status: string,
  cursor: string
): Promise<CursorPage<RepairJob>> {
  const params = new URLSearchParams();
  if (search) params.set("search", search);
  if (status) params.set("status", status);
  if (cursor) params.set("cursor", cursor);
  const res = await api.get(`/repair/jobs/?${params}`);
  return { data: res.data.data, meta: res.data.meta };
}

export default function RepairsPage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [cursor, setCursor] = useState("");
  const [cursorStack, setCursorStack] = useState<string[]>([]);

  const { data, isLoading } = useQuery({
    queryKey: ["repair-jobs", search, statusFilter, cursor],
    queryFn: () => fetchJobs(search, statusFilter, cursor),
    placeholderData: (prev) => prev,
  });

  const resetCursor = () => { setCursor(""); setCursorStack([]); };
  const goNext = () => {
    if (!data?.meta?.next_cursor) return;
    setCursorStack((s) => [...s, cursor]);
    setCursor(data.meta.next_cursor!);
  };
  const goPrev = () => {
    const prev = cursorStack[cursorStack.length - 1] ?? "";
    setCursorStack((s) => s.slice(0, -1));
    setCursor(prev);
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Repairs</h1>
          <p className="text-sm text-gray-500">{data?.data?.length ?? 0} shown</p>
        </div>
        <PermissionGate perm={PERMISSIONS.REPAIR_JOBS_CREATE}>
          <Link
            href="/repairs/new"
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition min-h-[44px]"
          >
            <Plus className="w-4 h-4" />
            New Job
          </Link>
        </PermissionGate>
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-col sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search by customer, device, job#…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); resetCursor(); }}
            className="w-full pl-9 pr-3 py-2.5 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => { setStatusFilter(e.target.value); resetCursor(); }}
          className="px-3 py-2.5 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white"
        >
          <option value="">All statuses</option>
          {Object.entries(STATUS_LABELS).map(([val, label]) => (
            <option key={val} value={val}>{label}</option>
          ))}
        </select>
      </div>

      {/* Job list */}
      {isLoading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="h-20 bg-gray-100 rounded-xl animate-pulse" />
          ))}
        </div>
      ) : data?.data?.length === 0 ? (
        <div className="text-center py-16 text-gray-500">
          <Wrench className="w-10 h-10 mx-auto mb-3 opacity-30" />
          <p className="text-sm">No repair jobs found</p>
        </div>
      ) : (
        <div className="space-y-2">
          {data?.data?.map((job) => (
            <Link
              key={job.id}
              href={`/repairs/${job.id}`}
              className="block bg-white rounded-xl border border-gray-200 p-4 hover:border-blue-300 hover:shadow-sm transition"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-mono text-gray-400">{job.job_number}</span>
                    <span className={cn("text-xs font-medium px-2 py-0.5 rounded-full", STATUS_COLORS[job.status] ?? "bg-gray-100 text-gray-700")}>
                      {STATUS_LABELS[job.status] ?? job.status}
                    </span>
                  </div>
                  <p className="font-medium text-gray-900 text-sm truncate">{job.customer_name}</p>
                  <p className="text-xs text-gray-500 truncate">
                    {job.brand} {job.model} · {job.device_type}
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-sm font-semibold text-gray-900">
                    {formatCurrency(parseFloat(job.service_charge))}
                  </p>
                  <p className="text-xs text-gray-400">{formatDate(job.created_at)}</p>
                </div>
              </div>
              {job.technician_name && (
                <p className="text-xs text-gray-400 mt-1.5 flex items-center gap-1">
                  <Wrench className="w-3 h-3" />
                  {job.technician_name}
                </p>
              )}
            </Link>
          ))}
        </div>
      )}

      {/* Cursor pagination */}
      {(cursorStack.length > 0 || data?.meta?.next_cursor) && (
        <div className="flex items-center justify-center gap-3 pt-2">
          <button onClick={goPrev} disabled={cursorStack.length === 0}
            className="px-4 py-2 text-sm border border-gray-300 rounded-lg disabled:opacity-40 hover:bg-gray-50 min-h-[44px]">
            Previous
          </button>
          <button onClick={goNext} disabled={!data?.meta?.next_cursor}
            className="px-4 py-2 text-sm border border-gray-300 rounded-lg disabled:opacity-40 hover:bg-gray-50 min-h-[44px]">
            Next
          </button>
        </div>
      )}
    </div>
  );
}
