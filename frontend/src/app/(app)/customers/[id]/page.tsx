'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, Users } from 'lucide-react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/shared/EmptyState';
import { EntityTimeline, type TimelineEvent } from '@/components/shared/EntityTimeline';
import { StatusBadge } from '@/components/shared/StatusBadge';
import { Money } from '@/components/shared/Money';
import { Can } from '@/components/shared/Can';
import { DataTable, type Column } from '@/components/shared/DataTable';
import { CustomerProfileHeader } from '@/components/crm/CustomerProfileHeader';
import { TaskList } from '@/components/crm/TaskList';
import { MergeCustomersDialog } from '@/components/crm/MergeCustomersDialog';
import { CustomerFormDialog } from '@/components/crm/CustomerFormDialog';
import { crmApi, type CommType } from '@/lib/api/crm';
import { repairApi, type JobListItem } from '@/lib/api/repair';
import { qk } from '@/lib/query/keys';
import { formatDate } from '@/lib/format/date';
import { money } from '@/lib/format/money';
import { cn } from '@/lib/utils';

type TimelineFilter = CommType | 'all';

const TIMELINE_FILTERS: Array<{ value: TimelineFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'call', label: 'Calls' },
  { value: 'whatsapp', label: 'WhatsApp' },
  { value: 'visit', label: 'Visits' },
  { value: 'note', label: 'Notes' },
];

const JOB_COLUMNS: Column<JobListItem>[] = [
  { key: 'job_number', header: 'Job #', cell: (r) => <span className="font-mono text-xs">{r.job_number}</span> },
  { key: 'device', header: 'Device', cell: (r) => (
    <span className="text-body-sm">{[r.device_brand, r.device_type].filter(Boolean).join(' ')}</span>
  )},
  { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.status} /> },
  { key: 'sc', header: 'S/C', cell: (r) => <Money amount={r.service_charge} className="text-body-sm" /> },
  { key: 'date', header: 'Date', cell: (r) => <span className="text-body-sm text-[var(--text-muted)]">{formatDate(r.intake_date)}</span> },
];

export default function CustomerProfilePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();

  const [editOpen, setEditOpen] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const [timelineFilter, setTimelineFilter] = useState<TimelineFilter>('all');

  const { data: customer, isLoading, error } = useQuery({
    queryKey: qk.customer(id),
    queryFn: () => crmApi.getCustomer(id),
    staleTime: 30_000,
  });

  const { data: timelineData, isLoading: timelineLoading } = useQuery({
    queryKey: [...qk.customerTimeline(id), timelineFilter],
    queryFn: () => crmApi.getCustomerTimeline(id, timelineFilter === 'all' ? undefined : timelineFilter),
    staleTime: 60_000,
    enabled: !!customer,
  });

  const { data: jobsData, isLoading: jobsLoading } = useQuery({
    queryKey: qk.jobs({ customer_id: id }),
    queryFn: () => repairApi.listJobs({ customer_id: id }),
    staleTime: 60_000,
    enabled: !!customer,
  });

  const { data: tasksData, isLoading: tasksLoading } = useQuery({
    queryKey: qk.tasks({ customer_id: id }),
    queryFn: () => crmApi.listTasks({ customer_id: id }),
    staleTime: 30_000,
    enabled: !!customer,
  });

  if (isLoading) {
    return (
      <div className="p-4 space-y-4">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  if (error || !customer) {
    return (
      <EmptyState
        icon={Users}
        title="Customer not found"
        description="This customer doesn't exist or you don't have access."
        action={{ label: 'Back to customers', onClick: () => router.push('/customers') }}
      />
    );
  }

  return (
    <div className="flex flex-col min-h-full">
      {/* Back nav */}
      <div className="flex items-center gap-2 px-4 pt-3 pb-0">
        <button
          onClick={() => router.back()}
          className="p-1.5 rounded-md hover:bg-[var(--surface-2)] text-[var(--text-muted)]"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <span className="text-body-sm text-[var(--text-muted)]">Customers</span>
        <Can permission="crm.customers.merge">
          <Button
            size="sm"
            variant="ghost"
            className="ml-auto text-[var(--text-muted)]"
            onClick={() => setMergeOpen(true)}
          >
            Merge
          </Button>
        </Can>
      </div>

      {/* Profile header */}
      <CustomerProfileHeader customer={customer} onEdit={() => setEditOpen(true)} />

      {/* Tabs */}
      <Tabs defaultValue="repairs" className="flex-1 min-h-0">
        <div className="border-b border-[var(--border)] bg-[var(--surface)] sticky top-0 z-10 px-4">
          <TabsList className="h-10 bg-transparent gap-0 -mb-px w-full justify-start overflow-x-auto">
            {['repairs', 'timeline', 'tasks', 'financial'].map((tab) => (
              <TabsTrigger
                key={tab}
                value={tab}
                className="rounded-none border-b-2 border-transparent data-[state=active]:border-[var(--accent)] data-[state=active]:text-[var(--accent)] px-3 py-2 text-body-sm capitalize shrink-0"
              >
                {tab === 'repairs' ? 'Repair History' : tab.charAt(0).toUpperCase() + tab.slice(1)}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <div className="flex-1 overflow-auto">
          {/* Repair history */}
          <TabsContent value="repairs" className="p-4 md:p-6 mt-0">
            <DataTable
              columns={JOB_COLUMNS}
              data={jobsData?.items}
              loading={jobsLoading}
              keyExtractor={(r) => r.id}
              onRowClick={(r) => router.push(`/jobs/${r.id}`)}
              emptyTitle="No repair jobs"
              emptyDescription="No repair history for this customer yet."
            />
          </TabsContent>

          {/* Timeline */}
          <TabsContent value="timeline" className="p-4 md:p-6 mt-0">
            {/* Filter chips */}
            <div className="flex gap-2 flex-wrap mb-4">
              {TIMELINE_FILTERS.map(({ value, label }) => (
                <button
                  key={value}
                  onClick={() => setTimelineFilter(value)}
                  className={cn(
                    'px-3 py-1 rounded-full text-xs font-medium border transition-colors',
                    timelineFilter === value
                      ? 'bg-[var(--accent)] border-[var(--accent)] text-white'
                      : 'bg-[var(--surface)] border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--accent)]',
                  )}
                >
                  {label}
                </button>
              ))}
            </div>
            <EntityTimeline
              events={(timelineData?.items ?? []) as TimelineEvent[]}
              loading={timelineLoading}
            />
          </TabsContent>

          {/* Tasks */}
          <TabsContent value="tasks" className="p-4 md:p-6 mt-0">
            <TaskList
              tasks={tasksData?.items ?? []}
              loading={tasksLoading}
              customerId={id}
            />
          </TabsContent>

          {/* Financial summary */}
          <TabsContent value="financial" className="p-4 md:p-6 mt-0">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <FinancialCard label="Total jobs" value={String(customer.total_jobs)} />
              <FinancialCard label="Total billed" value={money(customer.total_billed)} />
              <FinancialCard
                label="Total outstanding"
                value={money(customer.total_outstanding)}
                danger={customer.total_outstanding > 0}
              />
              <FinancialCard
                label="Credit limit"
                value={customer.credit_limit > 0 ? money(customer.credit_limit) : 'No limit'}
              />
              {customer.total_outstanding > 0 && customer.credit_limit > 0 && (
                <FinancialCard
                  label="Available credit"
                  value={money(Math.max(0, customer.credit_limit - customer.total_outstanding))}
                  danger={customer.total_outstanding >= customer.credit_limit}
                />
              )}
            </div>
          </TabsContent>
        </div>
      </Tabs>

      {/* Edit dialog */}
      {editOpen && (
        <CustomerFormDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          shopId={customer.shop_id}
          existing={customer}
          onSuccess={(updated) => {
            queryClient.setQueryData(qk.customer(id), updated);
            setEditOpen(false);
          }}
        />
      )}

      {/* Merge dialog */}
      {mergeOpen && (
        <MergeCustomersDialog
          open={mergeOpen}
          onOpenChange={setMergeOpen}
          sourceCustomer={customer}
          onSuccess={() => router.push('/customers')}
        />
      )}
    </div>
  );
}

function FinancialCard({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className={cn(
      'rounded-lg border p-4',
      danger ? 'border-[var(--danger)]/30 bg-[var(--danger)]/5' : 'border-[var(--border)] bg-[var(--surface)]',
    )}>
      <p className="text-xs font-semibold text-[var(--text-muted)] uppercase tracking-wide mb-1">{label}</p>
      <p className={cn('text-h2 font-mono', danger ? 'text-[var(--danger)]' : 'text-[var(--text)]')}>{value}</p>
    </div>
  );
}
