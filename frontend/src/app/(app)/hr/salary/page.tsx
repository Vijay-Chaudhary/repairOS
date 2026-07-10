'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Download, Play } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { PaginationBar } from '@/components/shared/PaginationBar';
import { Money } from '@/components/shared/Money';
import { Can } from '@/components/shared/Can';
import { hrApi, MONTHS, type SlipStatus } from '@/lib/api/hr';
import { qk } from '@/lib/query/keys';
import { useActiveShopStore } from '@/lib/stores/activeShopStore';
import { ApiError } from '@/lib/api/client';

export default function SalaryPage() {
  const queryClient = useQueryClient();
  const { activeShopId, isAllShops } = useActiveShopStore();
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [statusFilter, setStatusFilter] = useState<SlipStatus | 'all'>('all');
  const [pdfLoading, setPdfLoading] = useState<string | null>(null);
  const [listPage, setListPage] = useState(1);

  useEffect(() => { setListPage(1); }, [month, year, statusFilter]);

  const filters = {
    shop_id: isAllShops ? undefined : activeShopId ?? undefined,
    month,
    year,
    status: statusFilter === 'all' ? undefined : statusFilter,
    page: listPage,
  };

  const { data, isLoading } = useQuery({
    queryKey: qk.salarySlips(filters),
    queryFn: () => hrApi.listSalarySlips(filters),
    staleTime: 30_000,
  });

  const generateMutation = useMutation({
    mutationFn: () => {
      if (!activeShopId) throw new Error('No shop selected');
      return hrApi.generateSalarySlips({ month, year, shop_id: activeShopId });
    },
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: qk.salarySlips() });
      toast.success(`Generated ${r.slips.length} salary slip${r.slips.length !== 1 ? 's' : ''}`);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Generation failed'),
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => hrApi.approveSalarySlip(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.salarySlips() });
      toast.success('Slip approved');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });

  async function handleDownloadPdf(slipId: string) {
    setPdfLoading(slipId);
    try {
      const { pdf_url } = await hrApi.getSalaryPdf(slipId);
      window.open(pdf_url, '_blank', 'noreferrer');
    } catch {
      toast.error('Could not fetch PDF');
    } finally {
      setPdfLoading(null);
    }
  }

  const slips = data?.items ?? [];
  const years = [year - 1, year, year + 1];

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b border-[var(--border)] bg-[var(--surface)]">
        <h1 className="text-h1 text-[var(--text)]">Salary Slips</h1>
      </div>

      <div className="flex items-center gap-3 px-4 py-3 border-b border-[var(--border)] flex-wrap">
        <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
          <SelectTrigger className="h-9 w-[120px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {MONTHS.map((m, i) => <SelectItem key={i} value={String(i+1)}>{m}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={String(year)} onValueChange={(v) => setYear(Number(v))}>
          <SelectTrigger className="h-9 w-[90px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            {years.map((y) => <SelectItem key={y} value={String(y)}>{y}</SelectItem>)}
          </SelectContent>
        </Select>
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as SlipStatus | 'all')}>
          <SelectTrigger className="h-9 w-[130px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="approved">Approved</SelectItem>
            <SelectItem value="paid">Paid</SelectItem>
          </SelectContent>
        </Select>
        <Can permission="hr.salary.generate">
          {isAllShops || !activeShopId ? (
            <p className="text-body-sm text-[var(--text-muted)] ml-auto">
              Select a shop to generate slips
            </p>
          ) : (
            <Button
              size="sm"
              className="h-9 ml-auto"
              onClick={() => generateMutation.mutate()}
              disabled={generateMutation.isPending}
            >
              <Play className="h-3.5 w-3.5" />
              {generateMutation.isPending ? 'Generating…' : `Generate for ${MONTHS[month-1]} ${year}`}
            </Button>
          )}
        </Can>
      </div>

      <div className="flex-1 overflow-auto p-4 md:p-6">
        {isLoading ? (
          <div className="space-y-2">{[1,2,3,4].map((i) => <Skeleton key={i} className="h-14" />)}</div>
        ) : slips.length === 0 ? (
          <div className="text-center py-12">
            <p className="text-body-sm text-[var(--text-muted)]">No salary slips for {MONTHS[month-1]} {year}.</p>
            <Can permission="hr.salary.generate">
              <p className="text-xs text-[var(--text-muted)] mt-1">Click &ldquo;Generate&rdquo; to create slips for this month.</p>
            </Can>
          </div>
        ) : (
          <div className="rounded-lg border border-[var(--border)] overflow-hidden">
            <div className="overflow-x-auto"><table className="w-full min-w-max text-body-sm">
              <thead>
                <tr className="border-b border-[var(--border)] bg-[var(--surface-2)] text-left">
                  <th className="px-4 py-2 font-medium text-[var(--text-muted)]">Employee</th>
                  <th className="px-4 py-2 font-medium text-[var(--text-muted)] text-right">Gross</th>
                  <th className="px-4 py-2 font-medium text-[var(--text-muted)] text-right">Deductions</th>
                  <th className="px-4 py-2 font-medium text-[var(--text-muted)] text-right">Net</th>
                  <th className="px-4 py-2 font-medium text-[var(--text-muted)]">Status</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody>
                {slips.map((slip) => (
                  <tr key={slip.id} className="border-b border-[var(--border)] last:border-0">
                    <td className="px-4 py-3">
                      <p className="font-medium text-[var(--text)]">{slip.employee_name}</p>
                      <p className="text-xs text-[var(--text-muted)] font-mono">{slip.employee_code}</p>
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums"><Money amount={slip.gross_earned} /></td>
                    <td className="px-4 py-3 text-right tabular-nums text-[var(--danger)]">
                      <Money amount={slip.total_deductions} />
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums font-semibold">
                      <Money amount={slip.net_salary} />
                    </td>
                    <td className="px-4 py-3"><StatusBadge status={slip.status} /></td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 justify-end">
                        {slip.status === 'draft' && (
                          <Can permission="hr.salary.generate">
                            <Button
                              size="sm" variant="outline" className="h-7 text-xs"
                              onClick={() => approveMutation.mutate(slip.id)}
                              disabled={approveMutation.isPending}
                            >
                              Approve
                            </Button>
                          </Can>
                        )}
                        <Button
                          size="sm" variant="ghost" className="h-7 w-7 p-0"
                          onClick={() => handleDownloadPdf(slip.id)}
                          disabled={pdfLoading === slip.id}
                          title="Download PDF"
                        >
                          <Download className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </div>
        )}
        {data?.meta?.total_pages !== undefined && data.meta.total_pages > 1 && (
          <PaginationBar
            page={listPage}
            totalPages={data.meta.total_pages}
            totalCount={data.meta.count}
            loading={isLoading}
            onPageChange={setListPage}
          />
        )}
      </div>
    </div>
  );
}
