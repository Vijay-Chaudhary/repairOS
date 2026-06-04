'use client';

import { useState, useEffect, useCallback } from 'react';
import { useParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Download, Loader2, CheckCircle2, XCircle, Clock, ArrowLeft,
} from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import {
  reportApi, REPORT_CATALOGUE, type ExportFormat, type ExportJob,
} from '@/lib/api/reports';
import { useActiveShopStore } from '@/lib/stores/activeShopStore';
import { useOfflineQueueStore } from '@/lib/stores/offlineQueueStore';
import { qk } from '@/lib/query/keys';
import { cn } from '@/lib/utils';
import { money } from '@/lib/format/money';
import { formatDate } from '@/lib/format/date';

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function isMoneyCellKey(key: string) {
  return /amount|revenue|value|total|salary|cost|dues|payable|balance/i.test(key);
}
function isDateCellKey(key: string) {
  return /_date$|_at$|date_/.test(key);
}

function CellValue({ colKey, val }: { colKey: string; val: unknown }) {
  if (val == null || val === '') return <span className="text-[var(--text-muted)]">—</span>;
  if (typeof val === 'number') {
    if (isMoneyCellKey(colKey)) return <span className="tabular-nums">{money(val)}</span>;
    return <span className="tabular-nums">{val}</span>;
  }
  if (typeof val === 'string') {
    if (isDateCellKey(colKey)) return <span>{formatDate(val)}</span>;
    return <span>{val}</span>;
  }
  return <span>{JSON.stringify(val)}</span>;
}

function GenericTable({ data }: { data: Record<string, unknown> }) {
  // Find a top-level array that looks like the rows
  const rowsEntry = Object.entries(data).find(([, v]) => Array.isArray(v) && (v as unknown[]).length > 0);
  const rows = rowsEntry ? (rowsEntry[1] as Record<string, unknown>[]) : [];
  const summaryEntries = Object.entries(data).filter(([k]) => k !== rowsEntry?.[0] && typeof data[k] !== 'object');

  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

  return (
    <div className="space-y-4">
      {/* Summary metrics */}
      {summaryEntries.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {summaryEntries.slice(0, 8).map(([k, v]) => (
            <div key={k} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-3">
              <p className="text-xs text-[var(--text-muted)] capitalize">{k.replace(/_/g, ' ')}</p>
              <p className="text-body font-semibold text-[var(--text)] tabular-nums mt-0.5">
                {typeof v === 'number' ? (isMoneyCellKey(k) ? money(v) : v) : String(v)}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Data table */}
      {rows.length > 0 ? (
        <div className="rounded-lg border border-[var(--border)] overflow-auto">
          <table className="w-full text-body-sm min-w-max">
            <thead>
              <tr className="border-b border-[var(--border)] bg-[var(--surface-2)] text-left">
                {columns.map((col) => (
                  <th key={col} className="px-4 py-2.5 font-medium text-[var(--text-muted)] whitespace-nowrap capitalize">
                    {col.replace(/_/g, ' ')}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-2)]/50">
                  {columns.map((col) => (
                    <td key={col} className={cn('px-4 py-3 text-[var(--text)] whitespace-nowrap', isMoneyCellKey(col) ? 'text-right' : '')}>
                      <CellValue colKey={col} val={row[col]} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : rows.length === 0 && rowsEntry ? (
        <p className="text-body-sm text-[var(--text-muted)] py-8 text-center">No data for the selected filters.</p>
      ) : null}
    </div>
  );
}

function ExportJobChip({ job, onRemove }: { job: ExportJob; onRemove: () => void }) {
  const icon = {
    queued:     <Clock className="h-3.5 w-3.5 text-[var(--text-muted)]" />,
    processing: <Loader2 className="h-3.5 w-3.5 text-[var(--accent)] animate-spin" />,
    ready:      <CheckCircle2 className="h-3.5 w-3.5 text-[var(--success)]" />,
    failed:     <XCircle className="h-3.5 w-3.5 text-[var(--danger)]" />,
  }[job.status];

  return (
    <div className="flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 shadow-sm">
      {icon}
      <span className="text-xs text-[var(--text)] font-medium">
        {job.format.toUpperCase()} export
      </span>
      <span className="text-xs text-[var(--text-muted)] capitalize">{job.status}</span>
      {job.status === 'ready' && job.file_url && (
        <a href={job.file_url} target="_blank" rel="noreferrer" onClick={onRemove}>
          <Button size="sm" variant="ghost" className="h-6 px-2 text-xs">
            <Download className="h-3 w-3 mr-1" /> Download
          </Button>
        </a>
      )}
      {(job.status === 'failed' || job.status === 'ready') && (
        <button
          onClick={onRemove}
          className="text-[var(--text-muted)] hover:text-[var(--text)] text-xs ml-1"
          aria-label="Dismiss"
        >
          ×
        </button>
      )}
    </div>
  );
}

export default function ReportViewPage() {
  const params = useParams();
  const type = params.type as string;
  const { activeShopId, isAllShops } = useActiveShopStore();
  const { isOnline } = useOfflineQueueStore();

  const report = REPORT_CATALOGUE.find((r) => r.type === type);
  const now = new Date();

  // Filter state
  const [dateFrom, setDateFrom] = useState(
    new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0],
  );
  const [dateTo, setDateTo] = useState(now.toISOString().split('T')[0]);
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [overdueDays, setOverdueDays] = useState('30');
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState('');

  // Export jobs tray
  const [exportJobs, setExportJobs] = useState<ExportJob[]>([]);

  // Poll pending export jobs
  useEffect(() => {
    const pending = exportJobs.filter((j) => j.status === 'queued' || j.status === 'processing');
    if (pending.length === 0) return;
    const timer = setInterval(async () => {
      for (const job of pending) {
        try {
          const updated = await reportApi.pollExportJob(job.id);
          setExportJobs((prev) => prev.map((j) => (j.id === updated.id ? updated : j)));
          if (updated.status === 'ready') toast.success('Export ready — click Download');
          if (updated.status === 'failed') toast.error('Export failed');
        } catch {
          // transient error, keep polling
        }
      }
    }, 3000);
    return () => clearInterval(timer);
  }, [exportJobs]);

  // Build filter params
  const buildFilters = useCallback((): Record<string, string | number | undefined> => {
    if (!report) return {};
    const f: Record<string, string | number | undefined> = {};
    if (!isAllShops && activeShopId) f.shop_id = activeShopId;
    if (report.filters.includes('date_range')) {
      f.date_from = dateFrom;
      f.date_to = dateTo;
    }
    if (report.filters.includes('month_year')) {
      f.month = month;
      f.year = year;
    }
    if (report.filters.includes('overdue_days') && overdueDays) {
      f.overdue_days = parseInt(overdueDays, 10);
    }
    if (report.filters.includes('category') && category) f.category = category;
    if (report.filters.includes('status') && status) f.status = status;
    return f;
  }, [report, isAllShops, activeShopId, dateFrom, dateTo, month, year, overdueDays, category, status]);

  const filters = buildFilters();

  const { data: reportData, isLoading, error, refetch } = useQuery({
    queryKey: [qk.revenueReport(filters)[0], type, filters],
    queryFn: () => reportApi.getReport(type, filters),
    enabled: !!report,
    staleTime: 60_000,
  });

  async function handleExport(format: ExportFormat) {
    if (!isOnline) { toast.error('Exports unavailable offline'); return; }
    try {
      const { export_job_id, status: s } = await reportApi.requestExport(type, filters, format);
      const newJob: ExportJob = {
        id: export_job_id,
        report_type: type,
        format,
        status: s,
        created_at: new Date().toISOString(),
      };
      setExportJobs((prev) => [newJob, ...prev]);
      toast.info(`${format.toUpperCase()} export queued`);
    } catch {
      toast.error('Failed to start export');
    }
  }

  const years = [year - 1, year, year + 1];

  if (!report) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-[var(--border)]">
          <Link href="/reports" className="text-[var(--text-muted)] hover:text-[var(--text)]">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <h1 className="text-h1 text-[var(--text)]">Report not found</h1>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <p className="text-body-sm text-[var(--text-muted)]">
            Unknown report type: <span className="font-mono">{type}</span>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--surface)] flex items-center justify-between gap-3 shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Link href="/reports" className="text-[var(--text-muted)] hover:text-[var(--text)] shrink-0">
            <ArrowLeft className="h-5 w-5" />
          </Link>
          <div className="min-w-0">
            <h1 className="text-h1 text-[var(--text)] truncate">{report.label}</h1>
            <p className="text-xs text-[var(--text-muted)]">{report.module} module</p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {report.exports.map((fmt) => (
            <Button
              key={fmt}
              size="sm"
              variant="outline"
              disabled={!isOnline || isLoading}
              onClick={() => handleExport(fmt)}
            >
              <Download className="h-3.5 w-3.5" />
              {fmt.toUpperCase()}
            </Button>
          ))}
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-end gap-3 px-4 py-3 border-b border-[var(--border)] bg-[var(--surface-2)] shrink-0">
        {report.filters.includes('date_range') && (
          <>
            <div>
              <label className="text-xs text-[var(--text-muted)] block mb-1">From</label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="h-9 w-[140px]"
              />
            </div>
            <div>
              <label className="text-xs text-[var(--text-muted)] block mb-1">To</label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="h-9 w-[140px]"
              />
            </div>
          </>
        )}
        {report.filters.includes('month_year') && (
          <>
            <div>
              <label className="text-xs text-[var(--text-muted)] block mb-1">Month</label>
              <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
                <SelectTrigger className="h-9 w-[130px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MONTHS.map((m, i) => <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-xs text-[var(--text-muted)] block mb-1">Year</label>
              <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
                <SelectTrigger className="h-9 w-[90px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {years.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </>
        )}
        {report.filters.includes('overdue_days') && (
          <div>
            <label className="text-xs text-[var(--text-muted)] block mb-1">Overdue days</label>
            <Select value={overdueDays} onValueChange={setOverdueDays}>
              <SelectTrigger className="h-9 w-[120px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {['7', '14', '30', '60', '90'].map((d) => (
                  <SelectItem key={d} value={d}>{d}+ days</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
        {report.filters.includes('category') && (
          <div>
            <label className="text-xs text-[var(--text-muted)] block mb-1">Category</label>
            <Input
              placeholder="All categories"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              className="h-9 w-[150px]"
            />
          </div>
        )}
        {report.filters.includes('status') && (
          <div>
            <label className="text-xs text-[var(--text-muted)] block mb-1">Status</label>
            <Select value={status || 'all'} onValueChange={(v) => setStatus(v === 'all' ? '' : v)}>
              <SelectTrigger className="h-9 w-[120px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All</SelectItem>
                <SelectItem value="open">Open</SelectItem>
                <SelectItem value="closed">Closed</SelectItem>
                <SelectItem value="cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>
        )}
        <Button size="sm" onClick={() => refetch()} disabled={isLoading} className="self-end">
          {isLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Run'}
        </Button>
      </div>

      {/* Export tray */}
      {exportJobs.length > 0 && (
        <div className="flex flex-wrap gap-2 px-4 py-2 border-b border-[var(--border)] bg-[var(--surface)]">
          {exportJobs.map((job) => (
            <ExportJobChip
              key={job.id}
              job={job}
              onRemove={() => setExportJobs((prev) => prev.filter((j) => j.id !== job.id))}
            />
          ))}
        </div>
      )}

      {/* Report content */}
      <div className="flex-1 overflow-auto p-4 md:p-6">
        {isLoading ? (
          <div className="space-y-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-16 rounded-lg" />)}
            </div>
            <Skeleton className="h-64 rounded-lg" />
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <p className="text-body-sm text-[var(--danger)]">Failed to load report.</p>
            <Button size="sm" variant="outline" onClick={() => refetch()}>Retry</Button>
          </div>
        ) : reportData ? (
          <GenericTable data={reportData} />
        ) : (
          <p className="text-body-sm text-[var(--text-muted)] py-8 text-center">
            Adjust the filters and click Run.
          </p>
        )}
      </div>
    </div>
  );
}
