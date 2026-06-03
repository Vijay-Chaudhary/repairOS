"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  BarChart2, ChevronRight, Download, Loader2, Search,
  AlertCircle, Calendar, Filter,
} from "lucide-react";
import { api } from "@/lib/api";
import { formatCurrency, cn } from "@/lib/utils";
import { REPORT_CATALOG, REPORT_CATEGORIES, REPORT_BY_SLUG } from "@/lib/report-catalog";
import type { ReportMeta, DashboardData, ReportData } from "@/types/reports";

// ── Dashboard widget ──────────────────────────────────────────────────────────

function DashboardSummary() {
  const { data, isLoading } = useQuery<DashboardData>({
    queryKey: ["reports-dashboard"],
    queryFn: async () => {
      const res = await api.get("/reports/dashboard/");
      return res.data.data;
    },
    refetchInterval: 60_000,
  });

  const jobs = data?.jobs_today_by_status ?? {};
  const activeJobs = Object.entries(jobs)
    .filter(([s]) => !["delivered", "cancelled"].includes(s))
    .reduce((sum, [, c]) => sum + c, 0);

  const widgets = [
    { label: "Revenue Today",       value: isLoading ? "…" : `₹${formatCurrency(parseFloat(data?.revenue_today ?? "0"))}`, cls: "text-green-700 bg-green-50" },
    { label: "Outstanding",         value: isLoading ? "…" : `₹${formatCurrency(parseFloat(data?.outstanding_dues ?? "0"))}`, cls: "text-red-700 bg-red-50" },
    { label: "Active Repairs",      value: isLoading ? "…" : String(activeJobs), cls: "text-blue-700 bg-blue-50" },
    { label: "AMC Visits (week)",   value: isLoading ? "…" : String(data?.amc_visits_this_week ?? 0), cls: "text-indigo-700 bg-indigo-50" },
    { label: "Low Stock Alerts",    value: isLoading ? "…" : String(data?.low_stock_alerts ?? 0), cls: "text-orange-700 bg-orange-50" },
    { label: "Expiring Contracts",  value: isLoading ? "…" : String(data?.contracts_expiring_this_month ?? 0), cls: "text-yellow-700 bg-yellow-50" },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 gap-3 mb-6">
      {widgets.map(({ label, value, cls }) => (
        <div key={label} className={`rounded-xl p-3 ${cls}`}>
          <p className="text-lg font-bold">{value}</p>
          <p className="text-xs opacity-80 mt-0.5">{label}</p>
        </div>
      ))}
    </div>
  );
}

// ── Report page ───────────────────────────────────────────────────────────────

export default function ReportsPage() {
  const [selectedSlug, setSelectedSlug] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("All");

  const filtered = REPORT_CATALOG.filter((r) => {
    const matchCat = categoryFilter === "All" || r.category === categoryFilter;
    const matchSearch = !search ||
      r.label.toLowerCase().includes(search.toLowerCase()) ||
      r.description.toLowerCase().includes(search.toLowerCase());
    return matchCat && matchSearch;
  });

  const grouped = REPORT_CATEGORIES.reduce<Record<string, ReportMeta[]>>((acc, cat) => {
    const items = filtered.filter((r) => r.category === cat);
    if (items.length) acc[cat] = items;
    return acc;
  }, {});

  if (selectedSlug) {
    const meta = REPORT_BY_SLUG[selectedSlug];
    return (
      <ReportDetailView
        meta={meta}
        onBack={() => setSelectedSlug(null)}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">Reports</h1>
        <p className="text-sm text-gray-500">{REPORT_CATALOG.length} reports available</p>
      </div>

      <DashboardSummary />

      {/* Search + category filter */}
      <div className="flex gap-2 flex-col sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search reports…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-3 py-2.5 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="flex gap-1 flex-wrap">
          {["All", ...REPORT_CATEGORIES].map((cat) => (
            <button
              key={cat}
              onClick={() => setCategoryFilter(cat)}
              className={cn(
                "px-3 py-1.5 rounded-lg text-xs font-medium border transition",
                categoryFilter === cat
                  ? "bg-blue-600 text-white border-blue-600"
                  : "bg-white text-gray-600 border-gray-300 hover:bg-gray-50"
              )}
            >
              {cat}
            </button>
          ))}
        </div>
      </div>

      {/* Grouped report list */}
      {Object.entries(grouped).map(([category, reports]) => (
        <div key={category}>
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">{category}</p>
          <div className="space-y-1.5">
            {reports.map((report) => (
              <button
                key={report.slug}
                onClick={() => setSelectedSlug(report.slug)}
                className="w-full flex items-center justify-between bg-white rounded-xl border border-gray-200 p-4 hover:border-blue-300 hover:shadow-sm transition text-left"
              >
                <div className="flex items-center gap-3 min-w-0">
                  <div className="w-8 h-8 bg-blue-50 rounded-lg flex items-center justify-center flex-shrink-0">
                    <BarChart2 className="w-4 h-4 text-blue-600" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900">{report.label}</p>
                    <p className="text-xs text-gray-500 truncate">{report.description}</p>
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-gray-400 flex-shrink-0" />
              </button>
            ))}
          </div>
        </div>
      ))}

      {/* GST special reports */}
      <div>
        <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">GST Downloads</p>
        <div className="space-y-1.5">
          {[
            { label: "GSTR-1 (Outward Supplies)", path: "/reports/gstr1" },
            { label: "GSTR-2 Proxy (Inward Supplies)", path: "/reports/gstr2-proxy" },
          ].map(({ label, path }) => (
            <GSTDownloadRow key={label} label={label} path={path} />
          ))}
        </div>
      </div>
    </div>
  );
}

// ── GST download row ──────────────────────────────────────────────────────────

function GSTDownloadRow({ label, path }: { label: string; path: string }) {
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());

  const handleDownload = () => {
    const url = `/api/v1${path}/?month=${month}&year=${year}`;
    window.open(url, "_blank");
  };

  return (
    <div className="flex items-center justify-between bg-white rounded-xl border border-gray-200 p-4">
      <div className="flex items-center gap-3">
        <div className="w-8 h-8 bg-orange-50 rounded-lg flex items-center justify-center flex-shrink-0">
          <Filter className="w-4 h-4 text-orange-600" />
        </div>
        <p className="text-sm font-medium text-gray-900">{label}</p>
      </div>
      <div className="flex items-center gap-2">
        <input type="number" value={month} onChange={(e) => setMonth(Number(e.target.value))} min={1} max={12}
          className="w-14 px-2 py-1.5 border border-gray-300 rounded text-xs outline-none focus:ring-1 focus:ring-blue-500" />
        <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} min={2020} max={2100}
          className="w-20 px-2 py-1.5 border border-gray-300 rounded text-xs outline-none focus:ring-1 focus:ring-blue-500" />
        <button onClick={handleDownload}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-orange-50 text-orange-700 border border-orange-200 rounded-lg text-xs font-medium hover:bg-orange-100 transition min-h-[36px]">
          <Download className="w-3.5 h-3.5" /> CSV
        </button>
      </div>
    </div>
  );
}

// ── Report detail view ────────────────────────────────────────────────────────

function ReportDetailView({ meta, onBack }: { meta: ReportMeta; onBack: () => void }) {
  const today = new Date().toISOString().split("T")[0];
  const firstOfMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split("T")[0];
  const now = new Date();

  const [dateFrom, setDateFrom] = useState(firstOfMonth);
  const [dateTo, setDateTo]     = useState(today);
  const [month, setMonth]       = useState(now.getMonth() + 1);
  const [year, setYear]         = useState(now.getFullYear());
  const [overdueDays, setOverdueDays] = useState(0);
  const [submitted, setSubmitted] = useState(meta.filterType === "none");

  const { data, isLoading, isError, refetch } = useQuery<ReportData>({
    queryKey: ["report", meta.slug, dateFrom, dateTo, month, year, overdueDays],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (meta.filterType === "date_range") {
        params.set("date_from", dateFrom);
        params.set("date_to", dateTo);
      } else if (meta.filterType === "month_year") {
        params.set("month", String(month));
        params.set("year", String(year));
      } else if (meta.filterType === "overdue_days") {
        params.set("overdue_days", String(overdueDays));
      }
      const res = await api.get(`/reports/${meta.slug}/?${params}`);
      return res.data.data;
    },
    enabled: submitted,
  });

  const handleExportCsv = async () => {
    const params = new URLSearchParams({ export: "csv" });
    if (meta.filterType === "date_range") { params.set("date_from", dateFrom); params.set("date_to", dateTo); }
    else if (meta.filterType === "month_year") { params.set("month", String(month)); params.set("year", String(year)); }
    else if (meta.filterType === "overdue_days") { params.set("overdue_days", String(overdueDays)); }
    await api.get(`/reports/${meta.slug}/?${params}`);
    alert("Export queued. Check Export Jobs for the download link.");
  };

  return (
    <div className="space-y-4">
      {/* Back + header */}
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1">
          ← Reports
        </button>
      </div>
      <div>
        <h1 className="text-xl font-semibold text-gray-900">{meta.label}</h1>
        <p className="text-sm text-gray-500">{meta.description}</p>
      </div>

      {/* Filter panel */}
      {meta.filterType !== "none" && (
        <div className="bg-white rounded-xl border border-gray-200 p-4">
          <div className="flex items-center gap-2 mb-3">
            <Calendar className="w-4 h-4 text-gray-600" />
            <p className="text-sm font-semibold text-gray-700">Filters</p>
          </div>

          {meta.filterType === "date_range" && (
            <div className="flex flex-wrap gap-3 items-end">
              <div>
                <label className="block text-xs text-gray-500 mb-1">From</label>
                <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">To</label>
                <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <button onClick={() => { setSubmitted(true); refetch(); }}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition min-h-[40px]">
                Run
              </button>
            </div>
          )}

          {meta.filterType === "month_year" && (
            <div className="flex flex-wrap gap-3 items-end">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Month</label>
                <input type="number" value={month} onChange={(e) => setMonth(Number(e.target.value))} min={1} max={12}
                  className="w-20 px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Year</label>
                <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} min={2020} max={2100}
                  className="w-24 px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <button onClick={() => { setSubmitted(true); refetch(); }}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition min-h-[40px]">
                Run
              </button>
            </div>
          )}

          {meta.filterType === "overdue_days" && (
            <div className="flex gap-3 items-end">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Overdue &gt; (days)</label>
                <input type="number" value={overdueDays} onChange={(e) => setOverdueDays(Number(e.target.value))} min={0}
                  className="w-24 px-3 py-2 border border-gray-300 rounded-lg text-sm outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <button onClick={() => { setSubmitted(true); refetch(); }}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition min-h-[40px]">
                Run
              </button>
            </div>
          )}
        </div>
      )}

      {/* Results */}
      {isLoading && (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
        </div>
      )}

      {isError && (
        <div className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-3">
          <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
          <p className="text-sm text-red-700">Failed to load report. Check your permissions or try again.</p>
        </div>
      )}

      {data && !isLoading && (
        <>
          <div className="flex justify-end">
            <button onClick={handleExportCsv}
              className="flex items-center gap-2 px-3 py-2 border border-gray-300 text-gray-600 rounded-lg text-sm hover:bg-gray-50 transition">
              <Download className="w-4 h-4" /> Export CSV
            </button>
          </div>
          <ReportRenderer data={data} />
        </>
      )}
    </div>
  );
}

// ── Generic report renderer ───────────────────────────────────────────────────

function ReportRenderer({ data }: { data: ReportData }) {
  // Find the first array in the data object to use as rows
  const entries = Object.entries(data);

  // Render each top-level key
  return (
    <div className="space-y-4">
      {entries.map(([key, value]) => {
        if (Array.isArray(value) && value.length > 0) {
          return <DataTable key={key} title={key.replace(/_/g, " ")} rows={value as Record<string, unknown>[]} />;
        }
        if (typeof value === "object" && value !== null && !Array.isArray(value)) {
          return <RecordCard key={key} title={key.replace(/_/g, " ")} record={value as Record<string, unknown>} />;
        }
        if (value !== null && value !== undefined && !Array.isArray(value) && typeof value !== "object") {
          return (
            <div key={key} className="bg-white rounded-xl border border-gray-200 p-4 flex justify-between">
              <span className="text-sm text-gray-600 capitalize">{key.replace(/_/g, " ")}</span>
              <span className="text-sm font-semibold text-gray-900">{String(value)}</span>
            </div>
          );
        }
        return null;
      })}
    </div>
  );
}

function DataTable({ title, rows }: { title: string; rows: Record<string, unknown>[] }) {
  const columns = Object.keys(rows[0]);
  return (
    <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
      <div className="px-4 py-3 border-b border-gray-100">
        <p className="text-sm font-semibold text-gray-700 capitalize">{title}</p>
        <p className="text-xs text-gray-400">{rows.length} row{rows.length !== 1 ? "s" : ""}</p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50">
              {columns.map((col) => (
                <th key={col} className="px-4 py-2.5 text-left text-xs font-medium text-gray-500 whitespace-nowrap">
                  {col.replace(/_/g, " ").toUpperCase()}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {rows.map((row, i) => (
              <tr key={i} className="hover:bg-gray-50">
                {columns.map((col) => (
                  <td key={col} className="px-4 py-2.5 text-gray-700 whitespace-nowrap">
                    {String(row[col] ?? "—")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RecordCard({ title, record }: { title: string; record: Record<string, unknown> }) {
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-4">
      <p className="text-sm font-semibold text-gray-700 capitalize mb-3">{title}</p>
      <div className="space-y-1.5">
        {Object.entries(record).map(([k, v]) => (
          <div key={k} className="flex justify-between">
            <span className="text-xs text-gray-500 capitalize">{k.replace(/_/g, " ")}</span>
            <span className="text-sm text-gray-900">{String(v ?? "—")}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
