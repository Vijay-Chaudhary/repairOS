'use client';

import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, CheckCircle2, Clock, AlertCircle, Filter } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/EmptyState';
import { PaginationBar } from '@/components/shared/PaginationBar';
import { Can } from '@/components/shared/Can';
import { TaskComposer } from '@/components/crm/TaskComposer';
import { crmApi, TASK_PRIORITY_LABELS, type Task, type TaskStatus, type TaskPriority } from '@/lib/api/crm';
import { qk } from '@/lib/query/keys';
import { ApiError } from '@/lib/api/client';
import { formatDate, formatTime } from '@/lib/format/date';
import { cn } from '@/lib/utils';

type StatusFilter = TaskStatus | 'all';
type PriorityFilter = TaskPriority | 'all';

const STATUS_FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

export default function TasksPage() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('pending');
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>('all');
  const [composerOpen, setComposerOpen] = useState(false);
  const [listPage, setListPage] = useState(1);

  useEffect(() => { setListPage(1); }, [statusFilter, priorityFilter]);

  const filters = {
    status: statusFilter === 'all' ? undefined : statusFilter,
    priority: priorityFilter === 'all' ? undefined : priorityFilter,
    page: listPage,
  };

  const { data, isLoading } = useQuery({
    queryKey: qk.tasks(filters),
    queryFn: () => crmApi.listTasks(filters),
    staleTime: 30_000,
  });

  const completeMutation = useMutation({
    mutationFn: (id: string) => crmApi.completeTask(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.tasks() });
      toast.success('Task completed');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });

  const tasks = data?.items ?? [];

  return (
    <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-h1 text-[var(--text)]">Tasks</h1>
        <Can permission="crm.tasks.manage">
          <Button onClick={() => setComposerOpen(true)}>
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">New task</span>
          </Button>
        </Can>
      </div>

      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        <div className="flex rounded-md border border-[var(--border)] overflow-hidden">
          {STATUS_FILTERS.map(({ value, label }) => (
            <button
              key={value}
              onClick={() => setStatusFilter(value)}
              className={cn(
                'px-3 py-1.5 text-xs font-medium transition-colors',
                statusFilter === value
                  ? 'bg-[var(--accent)] text-white'
                  : 'bg-[var(--surface)] text-[var(--text-muted)] hover:bg-[var(--surface-2)]',
              )}
            >
              {label}
            </button>
          ))}
        </div>

        <Select value={priorityFilter} onValueChange={(v) => setPriorityFilter(v as PriorityFilter)}>
          <SelectTrigger className="h-8 w-[130px] text-xs">
            <Filter className="h-3 w-3 text-[var(--text-muted)]" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All priorities</SelectItem>
            {(Object.keys(TASK_PRIORITY_LABELS) as TaskPriority[]).map((p) => (
              <SelectItem key={p} value={p}>{TASK_PRIORITY_LABELS[p]}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Task list */}
      {isLoading ? (
        <div className="space-y-2">
          {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-16 rounded-lg" />)}
        </div>
      ) : tasks.length === 0 ? (
        <EmptyState
          icon={CheckCircle2}
          title="No tasks"
          description={statusFilter === 'pending' ? 'All clear — no pending tasks.' : 'No tasks matching this filter.'}
          action={statusFilter === 'pending' ? { label: 'Create task', onClick: () => setComposerOpen(true) } : undefined}
        />
      ) : (
        <div className="space-y-2">
          {tasks.map((task) => (
            <TaskRow
              key={task.id}
              task={task}
              onComplete={() => completeMutation.mutate(task.id)}
              completing={completeMutation.isPending}
            />
          ))}
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

      <TaskComposer open={composerOpen} onOpenChange={setComposerOpen} />
    </div>
  );
}

function TaskRow({ task, onComplete, completing }: { task: Task; onComplete: () => void; completing: boolean }) {
  const isActive = task.status === 'pending' || task.status === 'overdue';

  return (
    <div className={cn(
      'flex items-start gap-3 p-4 rounded-lg border transition-colors',
      task.status === 'overdue'
        ? 'border-[var(--danger)]/30 bg-[var(--danger)]/5'
        : task.status === 'completed'
        ? 'border-[var(--border)] bg-[var(--surface-2)] opacity-70'
        : 'border-[var(--border)] bg-[var(--surface)]',
    )}>
      {/* Status icon */}
      <div className="shrink-0 mt-0.5">
        {task.status === 'completed' ? (
          <CheckCircle2 className="h-5 w-5 text-[var(--success)]" />
        ) : task.status === 'overdue' ? (
          <AlertCircle className="h-5 w-5 text-[var(--danger)]" />
        ) : (
          <Clock className="h-5 w-5 text-[var(--info)]" />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className={cn(
          'text-body-sm font-medium',
          task.status === 'completed' ? 'line-through text-[var(--text-muted)]' : 'text-[var(--text)]',
        )}>
          {task.title}
        </p>
        {task.description && (
          <p className="text-xs text-[var(--text-muted)] mt-0.5 truncate">{task.description}</p>
        )}
        <div className="flex items-center gap-3 mt-1 text-xs text-[var(--text-muted)] flex-wrap">
          <span>Due {formatDate(task.due_date)}{task.due_time ? ` at ${formatTime(task.due_time)}` : ''}</span>
          <span className={cn(
            'font-medium',
            task.priority === 'high' ? 'text-[var(--danger)]' : task.priority === 'low' ? 'text-[var(--text-muted)]' : 'text-[var(--info)]',
          )}>
            {TASK_PRIORITY_LABELS[task.priority]}
          </span>
          {task.assigned_to_name && <span>· {task.assigned_to_name}</span>}
          {task.customer_name && <span>· {task.customer_name}</span>}
        </div>
      </div>

      {/* Complete button */}
      {isActive && (
        <Can permission="crm.tasks.manage">
          <Button
            size="sm"
            variant="ghost"
            className="shrink-0 h-8 w-8 p-0"
            onClick={onComplete}
            disabled={completing}
            title="Mark complete"
          >
            <CheckCircle2 className="h-4 w-4 text-[var(--success)]" />
          </Button>
        </Can>
      )}
    </div>
  );
}
