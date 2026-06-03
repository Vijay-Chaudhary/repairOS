"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Users, Calendar, FileText, BarChart2, Plus, Search,
  Check, X, Loader2, ChevronRight, UserCheck, AlertCircle,
} from "lucide-react";
import Link from "next/link";
import { api } from "@/lib/api";
import { formatCurrency, formatDate, cn } from "@/lib/utils";
import { useAuthStore } from "@/stores/auth.store";
import type { Employee, LeaveRequest, SalarySlip, LeaveStatus, SlipStatus } from "@/types/hr";
import { PermissionGate } from "@/components/ui/permission-gate";
import { PERMISSIONS } from "@/lib/permissions";
import { usePermission } from "@/hooks/use-permission";

// ── Constants ─────────────────────────────────────────────────────────────────

const MONTHS = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

const LEAVE_STATUS: Record<LeaveStatus, { label: string; cls: string }> = {
  pending:  { label: "Pending",  cls: "bg-yellow-100 text-yellow-700" },
  approved: { label: "Approved", cls: "bg-green-100 text-green-700" },
  rejected: { label: "Rejected", cls: "bg-red-100 text-red-700" },
};

const SLIP_STATUS: Record<SlipStatus, { label: string; cls: string }> = {
  draft:    { label: "Draft",    cls: "bg-gray-100 text-gray-700" },
  approved: { label: "Approved", cls: "bg-blue-100 text-blue-700" },
  paid:     { label: "Paid",     cls: "bg-green-100 text-green-700" },
};

const EMP_TYPE_LABEL: Record<string, string> = {
  full_time: "Full Time", part_time: "Part Time",
  contract: "Contract",  intern: "Intern",
};

type Tab = "employees" | "attendance" | "leaves" | "payroll";

// ── Data fetchers ─────────────────────────────────────────────────────────────

const fetchEmployees = async (q: string): Promise<Employee[]> => {
  const params = q ? `?q=${encodeURIComponent(q)}` : "";
  const res = await api.get(`/hr/employees/${params}`);
  return res.data.data;
};

const fetchLeaves = async (status: string): Promise<LeaveRequest[]> => {
  const params = status ? `?status=${status}` : "";
  const res = await api.get(`/hr/leave-requests/${params}`);
  return res.data.data;
};

const fetchSlips = async (month: number, year: number): Promise<SalarySlip[]> => {
  const res = await api.get(`/hr/salary-slips/?month=${month}&year=${year}`);
  return res.data.data;
};

// ── Page ──────────────────────────────────────────────────────────────────────

export default function HRPage() {
  const [tab, setTab] = useState<Tab>("employees");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">HR & Payroll</h1>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-lg overflow-x-auto">
        {([
          { id: "employees", icon: Users, label: "Employees" },
          { id: "attendance", icon: Calendar, label: "Attendance" },
          { id: "leaves", icon: UserCheck, label: "Leaves" },
          { id: "payroll", icon: BarChart2, label: "Payroll" },
        ] as const).map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={cn(
              "flex-1 flex items-center justify-center gap-1.5 py-2 text-xs font-medium rounded-md transition whitespace-nowrap px-2",
              tab === id ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
            )}
          >
            <Icon className="w-3.5 h-3.5" />
            {label}
          </button>
        ))}
      </div>

      {tab === "employees" && <EmployeesTab />}
      {tab === "attendance" && <AttendanceTab />}
      {tab === "leaves" && <LeavesTab />}
      {tab === "payroll" && <PayrollTab />}
    </div>
  );
}

// ── Employees Tab ─────────────────────────────────────────────────────────────

function EmployeesTab() {
  const [search, setSearch] = useState("");
  const { data: employees, isLoading } = useQuery({
    queryKey: ["employees", search],
    queryFn: () => fetchEmployees(search),
  });

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search by name, code…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2.5 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <PermissionGate perm={PERMISSIONS.HR_EMPLOYEES_MANAGE}>
          <Link
            href="/hr/new"
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition min-h-[44px]"
          >
            <Plus className="w-4 h-4" />
            Add
          </Link>
        </PermissionGate>
      </div>

      {isLoading ? (
        <div className="space-y-2">{[...Array(4)].map((_, i) => <div key={i} className="h-16 bg-gray-100 rounded-xl animate-pulse" />)}</div>
      ) : employees?.length === 0 ? (
        <EmptyState icon={<Users className="w-8 h-8 opacity-30" />} text="No employees yet" />
      ) : (
        <div className="space-y-2">
          {employees?.map((emp) => (
            <Link
              key={emp.id}
              href={`/hr/${emp.id}`}
              className="flex items-center justify-between bg-white rounded-xl border border-gray-200 p-4 hover:border-blue-300 hover:shadow-sm transition"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-9 h-9 rounded-full bg-indigo-100 flex items-center justify-center flex-shrink-0">
                  <span className="text-indigo-700 font-semibold text-sm">
                    {emp.full_name.charAt(0).toUpperCase()}
                  </span>
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900 truncate">{emp.full_name}</p>
                  <p className="text-xs text-gray-500">{emp.designation} · <span className="font-mono">{emp.employee_code}</span></p>
                </div>
              </div>
              <div className="flex items-center gap-3 flex-shrink-0">
                <div className="text-right hidden sm:block">
                  <p className="text-sm font-semibold text-gray-900">{formatCurrency(parseFloat(emp.gross_salary))}</p>
                  <p className="text-xs text-gray-400">{EMP_TYPE_LABEL[emp.employment_type] ?? emp.employment_type}</p>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-400" />
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Attendance Tab ────────────────────────────────────────────────────────────

const STATUS_OPTIONS = [
  { value: "present",  label: "Present",  cls: "bg-green-50 border-green-300 text-green-700" },
  { value: "absent",   label: "Absent",   cls: "bg-red-50 border-red-300 text-red-700" },
  { value: "half_day", label: "Half Day", cls: "bg-yellow-50 border-yellow-300 text-yellow-700" },
  { value: "leave",    label: "Leave",    cls: "bg-blue-50 border-blue-300 text-blue-700" },
  { value: "holiday",  label: "Holiday",  cls: "bg-purple-50 border-purple-300 text-purple-700" },
];

function AttendanceTab() {
  const qc = useQueryClient();
  const canMark = usePermission(PERMISSIONS.HR_ATTENDANCE_MARK);
  const today = new Date().toISOString().split("T")[0];
  const [date, setDate] = useState(today);
  const [attendance, setAttendance] = useState<Record<string, string>>({});

  const { data: employees } = useQuery({
    queryKey: ["employees", ""],
    queryFn: () => fetchEmployees(""),
  });

  const bulkMutation = useMutation({
    mutationFn: () =>
      api.post("/hr/attendance/bulk/", {
        records: Object.entries(attendance).map(([employee_id, status]) => ({
          employee_id,
          date,
          status,
        })),
      }),
    onSuccess: () => {
      setAttendance({});
      qc.invalidateQueries({ queryKey: ["employees"] });
    },
  });

  const setAll = (status: string) => {
    const all: Record<string, string> = {};
    employees?.forEach((e) => { all[e.id] = status; });
    setAttendance(all);
  };

  const pending = Object.keys(attendance).length;

  return (
    <div className="space-y-4">
      {/* Date picker */}
      <div className="flex items-center gap-3">
        <label className="text-sm font-medium text-gray-700">Date</label>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
        />
        <button onClick={() => setAll("present")} className="text-xs text-green-600 hover:underline">
          All Present
        </button>
        <button onClick={() => setAll("absent")} className="text-xs text-red-500 hover:underline">
          All Absent
        </button>
      </div>

      {/* Employee rows */}
      <div className="space-y-2">
        {employees?.map((emp) => (
          <div key={emp.id} className="bg-white rounded-xl border border-gray-200 p-3">
            <div className="flex items-center justify-between gap-2 mb-2">
              <div>
                <p className="text-sm font-medium text-gray-900">{emp.full_name}</p>
                <p className="text-xs text-gray-500">{emp.designation}</p>
              </div>
              <p className="text-xs font-mono text-gray-400">{emp.employee_code}</p>
            </div>
            <div className="flex gap-1.5 flex-wrap">
              {STATUS_OPTIONS.map(({ value, label, cls }) => (
                <button
                  key={value}
                  onClick={() => setAttendance((a) => ({ ...a, [emp.id]: value }))}
                  className={cn(
                    "px-2.5 py-1.5 rounded-lg text-xs font-medium border transition",
                    attendance[emp.id] === value
                      ? cls
                      : "bg-white border-gray-200 text-gray-500 hover:bg-gray-50"
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Submit */}
      {pending > 0 && canMark && (
        <div className="sticky bottom-4">
          <button
            onClick={() => bulkMutation.mutate()}
            disabled={bulkMutation.isPending}
            className="w-full py-3 bg-blue-600 text-white rounded-xl text-sm font-semibold hover:bg-blue-700 disabled:opacity-50 transition flex items-center justify-center gap-2 shadow-lg"
          >
            {bulkMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            Save {pending} Attendance Record{pending > 1 ? "s" : ""}
          </button>
        </div>
      )}
      {bulkMutation.isSuccess && (
        <p className="text-green-600 text-sm text-center">Attendance saved successfully.</p>
      )}
    </div>
  );
}

// ── Leaves Tab ────────────────────────────────────────────────────────────────

const LEAVE_TYPE_LABEL: Record<string, string> = {
  casual: "Casual", sick: "Sick", earned: "Earned",
  unpaid: "Unpaid", maternity: "Maternity", paternity: "Paternity",
};

function LeavesTab() {
  const qc = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("pending");

  const { data: leaves, isLoading } = useQuery({
    queryKey: ["leaves", statusFilter],
    queryFn: () => fetchLeaves(statusFilter),
  });

  const approveMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "approved" | "rejected" }) =>
      api.patch(`/hr/leave-requests/${id}/`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["leaves"] }),
  });

  return (
    <div className="space-y-3">
      {/* Status filter */}
      <div className="flex gap-1 bg-gray-100 p-1 rounded-lg">
        {(["pending", "approved", "rejected", ""] as const).map((s) => (
          <button
            key={s || "all"}
            onClick={() => setStatusFilter(s)}
            className={cn(
              "flex-1 py-1.5 text-xs font-medium rounded-md transition",
              statusFilter === s ? "bg-white text-gray-900 shadow-sm" : "text-gray-500"
            )}
          >
            {s ? (LEAVE_STATUS[s]?.label ?? s) : "All"}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="h-24 bg-gray-100 rounded-xl animate-pulse" />)}</div>
      ) : leaves?.length === 0 ? (
        <EmptyState icon={<UserCheck className="w-8 h-8 opacity-30" />} text="No leave requests" />
      ) : (
        <div className="space-y-2">
          {leaves?.map((leave) => {
            const s = LEAVE_STATUS[leave.status];
            return (
              <div key={leave.id} className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex items-start justify-between gap-2 mb-3">
                  <div>
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className={cn("text-xs font-medium px-2 py-0.5 rounded-full", s?.cls)}>
                        {s?.label}
                      </span>
                      <span className="text-xs text-gray-500">{LEAVE_TYPE_LABEL[leave.leave_type] ?? leave.leave_type}</span>
                    </div>
                    <p className="text-sm font-medium text-gray-900">{leave.employee_name ?? leave.employee}</p>
                    <p className="text-xs text-gray-500">
                      {formatDate(leave.from_date)} → {formatDate(leave.to_date)} · {leave.days} day{parseFloat(leave.days) > 1 ? "s" : ""}
                    </p>
                    {leave.reason && <p className="text-xs text-gray-400 mt-0.5 italic">{leave.reason}</p>}
                  </div>
                </div>
                {leave.status === "pending" && (
                  <div className="flex gap-2">
                    <button
                      onClick={() => approveMutation.mutate({ id: leave.id, status: "approved" })}
                      disabled={approveMutation.isPending}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-green-50 text-green-700 border border-green-200 rounded-lg text-xs font-medium hover:bg-green-100 transition min-h-[40px]"
                    >
                      <Check className="w-3.5 h-3.5" /> Approve
                    </button>
                    <button
                      onClick={() => approveMutation.mutate({ id: leave.id, status: "rejected" })}
                      disabled={approveMutation.isPending}
                      className="flex-1 flex items-center justify-center gap-1.5 py-2 bg-red-50 text-red-700 border border-red-200 rounded-lg text-xs font-medium hover:bg-red-100 transition min-h-[40px]"
                    >
                      <X className="w-3.5 h-3.5" /> Reject
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Payroll Tab ───────────────────────────────────────────────────────────────

function PayrollTab() {
  const qc = useQueryClient();
  const { user } = useAuthStore();
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [selectedEmpIds, setSelectedEmpIds] = useState<string[]>([]);

  const { data: employees } = useQuery({ queryKey: ["employees", ""], queryFn: () => fetchEmployees("") });
  const { data: slips, isLoading: slipsLoading } = useQuery({
    queryKey: ["salary-slips", month, year],
    queryFn: () => fetchSlips(month, year),
  });

  const generateMutation = useMutation({
    mutationFn: () =>
      api.post("/hr/salary-slips/generate/", {
        shop_id: user?.shop_ids?.[0],
        month,
        year,
        employee_ids: selectedEmpIds,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["salary-slips", month, year] });
      setSelectedEmpIds([]);
    },
  });

  const approveMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: "approved" | "paid" }) =>
      api.patch(`/hr/salary-slips/${id}/`, { status }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["salary-slips", month, year] }),
  });

  const toggleEmp = (id: string) =>
    setSelectedEmpIds((s) => s.includes(id) ? s.filter((x) => x !== id) : [...s, id]);

  return (
    <div className="space-y-4">
      {/* Month/year selector */}
      <div className="flex items-center gap-2">
        <select
          value={month}
          onChange={(e) => setMonth(Number(e.target.value))}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500 bg-white"
        >
          {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
        </select>
        <input
          type="number"
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          min={2020} max={2100}
          className="w-24 px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Existing slips */}
      {slipsLoading ? (
        <div className="space-y-2">{[...Array(3)].map((_, i) => <div key={i} className="h-16 bg-gray-100 rounded-xl animate-pulse" />)}</div>
      ) : slips && slips.length > 0 ? (
        <div className="space-y-2">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wide">
            {MONTHS[month - 1]} {year} — {slips.length} slip{slips.length !== 1 ? "s" : ""}
          </p>
          {slips.map((slip) => {
            const s = SLIP_STATUS[slip.status];
            const emp = employees?.find((e) => e.id === slip.employee);
            return (
              <div key={slip.id} className="bg-white rounded-xl border border-gray-200 p-4">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2 mb-0.5">
                      <p className="text-sm font-medium text-gray-900">{emp?.full_name ?? slip.employee}</p>
                      <span className={cn("text-xs font-medium px-2 py-0.5 rounded-full", s?.cls)}>
                        {s?.label}
                      </span>
                    </div>
                    <p className="text-xs text-gray-500">
                      {slip.present_days} present · {slip.absent_days} absent · {slip.overtime_hours}h OT
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-gray-900">{formatCurrency(parseFloat(slip.net_salary))}</p>
                    <p className="text-xs text-gray-400">Net</p>
                  </div>
                </div>
                {slip.status === "draft" && (
                  <div className="flex gap-2 mt-3">
                    <button
                      onClick={() => approveMutation.mutate({ id: slip.id, status: "approved" })}
                      className="flex-1 py-1.5 text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200 rounded-lg hover:bg-blue-100 transition"
                    >
                      Approve
                    </button>
                  </div>
                )}
                {slip.status === "approved" && (
                  <div className="flex gap-2 mt-3">
                    <button
                      onClick={() => approveMutation.mutate({ id: slip.id, status: "paid" })}
                      className="flex-1 py-1.5 text-xs font-medium bg-green-50 text-green-700 border border-green-200 rounded-lg hover:bg-green-100 transition"
                    >
                      Mark Paid
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      ) : null}

      {/* Generate new slips */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <div className="flex items-center gap-2 mb-3">
          <FileText className="w-4 h-4 text-gray-600" />
          <p className="text-sm font-semibold text-gray-900">Generate Salary Slips</p>
        </div>

        {employees?.length === 0 ? (
          <p className="text-sm text-gray-500">No employees found.</p>
        ) : (
          <>
            <div className="flex gap-2 mb-2">
              <button onClick={() => setSelectedEmpIds(employees?.map((e) => e.id) ?? [])}
                className="text-xs text-blue-600 hover:underline">Select All</button>
              <span className="text-gray-300">|</span>
              <button onClick={() => setSelectedEmpIds([])} className="text-xs text-gray-500 hover:underline">Clear</button>
            </div>
            <div className="space-y-1.5 mb-4 max-h-48 overflow-y-auto">
              {employees?.map((emp) => (
                <label key={emp.id} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={selectedEmpIds.includes(emp.id)}
                    onChange={() => toggleEmp(emp.id)}
                    className="rounded text-blue-600"
                  />
                  <span className="text-sm text-gray-900">{emp.full_name}</span>
                  <span className="text-xs text-gray-400">{formatCurrency(parseFloat(emp.gross_salary))}</span>
                </label>
              ))}
            </div>
            {generateMutation.isError && (
              <div className="flex items-center gap-2 text-red-600 text-xs mb-3">
                <AlertCircle className="w-3.5 h-3.5" />
                Failed to generate. Slips may already exist for this period.
              </div>
            )}
            <button
              onClick={() => generateMutation.mutate()}
              disabled={selectedEmpIds.length === 0 || generateMutation.isPending}
              className="w-full py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-50 transition flex items-center justify-center gap-2 min-h-[44px]"
            >
              {generateMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
              Generate {selectedEmpIds.length > 0 ? `${selectedEmpIds.length} ` : ""}Slip{selectedEmpIds.length !== 1 ? "s" : ""}
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ── Shared ────────────────────────────────────────────────────────────────────

function EmptyState({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <div className="text-center py-12 text-gray-400">
      <div className="flex justify-center mb-3">{icon}</div>
      <p className="text-sm">{text}</p>
    </div>
  );
}
