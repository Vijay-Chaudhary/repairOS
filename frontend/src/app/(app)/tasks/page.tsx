'use client';

import { useState, useEffect, useCallback } from 'react';
import { useQuery, useQueries, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import {
  Plus, CheckCircle2, Clock, AlertCircle, Filter, User, Users, CalendarDays, Columns3,
} from 'lucide-react';
import {
  addMonths, startOfMonth, endOfMonth, startOfWeek, endOfWeek, format,
} from 'date-fns';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/EmptyState';
import { PaginationBar } from '@/components/shared/PaginationBar';
import { Can } from '@/components/shared/Can';
import { TaskComposer } from '@/components/crm/TaskComposer';
import { TaskCalendar } from '@/components/crm/TaskCalendar';
import { TaskBoard, type TaskColumnData } from '@/components/crm/TaskBoard';
import { crmApi, TASK_PRIORITY_LABELS, TASK_KANBAN_COLS, type Task, type TaskStatus, type TaskPriority } from '@/lib/api/crm';
import { qk } from '@/lib/query/keys';
import { ApiError } from '@/lib/api/client';
import { formatDate, formatTime } from '@/lib/format/date';
import { useAuthStore } from '@/lib/stores/authStore';
import { cn } from '@/lib/utils';

type TaskView = 'my' | 'team' | 'calendar' | 'kanban';

type StatusFilter = TaskStatus | 'all';
type PriorityFilter = TaskPriority | 'all';

const STATUS_FILTERS: Array<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'in_progress', label: 'In Progress' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

const VIEWS: Array<{ value: TaskView; label: string; icon: typeof User }> = [
  { value: 'my', label: 'My tasks', icon: User },
  { value: 'team', label: 'Team tasks', icon: Users },
  { value: 'calendar', label: 'Calendar view', icon: CalendarDays },
  { value: 'kanban', label: 'Kanban view', icon: Columns3 },
];

export default function TasksPage() {
  const queryClient = useQueryClient();
  const myId = useAuthStore((s) => s.user?.id);
  const [view, setView] = useState<TaskView>('my');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('pending');
  const [priorityFilter, setPriorityFilter] = useState<PriorityFilter>('all');
  const [composerOpen, setComposerOpen] = useState(false);
  const [composerDefaultDate, setComposerDefaultDate] = useState<string | undefined>(undefined);
  const [listPage, setListPage] = useState(1);
  const [month, setMonth] = useState(() => startOfMonth(new Date()));

  useEffect(() => { setListPage(1); }, [statusFilter, priorityFilter, view]);

  const isList = view === 'my' || view === 'team';
  const sharedFilters = {
    status: statusFilter === 'all' ? undefined : statusFilter,
    priority: priorityFilter === 'all' ? undefined : priorityFilter,
  };

  // My / Team list
  const listFilters = {
    ...sharedFilters,
    assigned_to: view === 'my' ? myId : undefined,
    page: listPage,
  };
  const { data, isLoading } = useQuery({
    queryKey: qk.tasks(listFilters),
    queryFn: () => crmApi.listTasks(listFilters),
    enabled: isList,
    staleTime: 30_000,
  });

  // Calendar
  const calFilters = {
    ...sharedFilters,
    due_from: format(startOfWeek(startOfMonth(month), { weekStartsOn: 0 }), 'yyyy-MM-dd'),
    due_to: format(endOfWeek(endOfMonth(month), { weekStartsOn: 0 }), 'yyyy-MM-dd'),
    page_size: 200,
  };
  const calQuery = useQuery({
    queryKey: qk.tasks(calFilters),
    queryFn: () => crmApi.listTasks(calFilters),
    enabled: view === 'calendar',
    staleTime: 30_000,
  });

  // Kanban (team-wide, grouped by status)
  const kanbanQueries = useQueries({
    queries: TASK_KANBAN_COLS.map(({ status }) => ({
      queryKey: qk.tasks({ kanban: true, status }),
      queryFn: () => crmApi.listTasks({ status }),
      enabled: view === 'kanban',
      staleTime: 30_000,
    })),
  });
  const kanbanColumns: TaskColumnData[] = TASK_KANBAN_COLS.map(({ status }, i) => ({
    status,
    tasks: kanbanQueries[i]?.data?.items ?? [],
    isLoading: kanbanQueries[i]?.isLoading ?? false,
    count: kanbanQueries[i]?.data?.meta?.count ?? (kanbanQueries[i]?.data?.items?.length ?? 0),
  }));
  const handleTaskMove = useCallback(async (taskId: string, _from: TaskStatus, to: TaskStatus) => {
    await crmApi.updateTask(taskId, { status: to });
    queryClient.invalidateQueries({ queryKey: qk.tasks() });
    toast.success('Task moved');
  }, [queryClient]);

  const openComposer = (date?: string) => {
    setComposerDefaultDate(date);
    setComposerOpen(true);
  };

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
    <div className="p-4 md:p-6 max-w-5xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-h1 text-[var(--text)]">Tasks</h1>
        <div className="flex items-center gap-2">
          <div className="flex rounded-md border border-[var(--border)] overflow-hidden">
            {VIEWS.map(({ value, label, icon: Icon }) => (
              <button
                key={value}
                onClick={() => setView(value)}
                aria-label={label}
                aria-pressed={view === value}
                className={cn('h-9 w-9 flex items-center justify-center transition-colors',
                  view === value ? 'bg-[var(--accent)] text-white' : 'bg-[var(--surface)] text-[var(--text-muted)] hover:bg-[var(--surface-2)]')}
              >
                <Icon className="h-4 w-4" />
              </button>
            ))}
          </div>
          <Can permission="crm.tasks.manage">
            <Button onClick={() => openComposer()}>
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">New task</span>
            </Button>
          </Can>
        </div>
      </div>

      {/* Filters (not for kanban, which groups by status) */}
      {view !== 'kanban' && (
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
      )}

      {view === 'calendar' ? (
        <TaskCalendar
          month={month}
          tasks={calQuery.data?.items ?? []}
          loading={calQuery.isLoading}
          onPrevMonth={() => setMonth((m) => addMonths(m, -1))}
          onNextMonth={() => setMonth((m) => addMonths(m, 1))}
          onToday={() => setMonth(startOfMonth(new Date()))}
          onDayClick={(iso) => openComposer(iso)}
          onTaskClick={(t) => openComposer(t.due_date?.slice(0, 10))}
        />
      ) : view === 'kanban' ? (
        <TaskBoard columns={kanbanColumns} onCardMove={handleTaskMove} />
      ) : (
        <>
          {isLoading ? (
            <div className="space-y-2">
              {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-16 rounded-lg" />)}
            </div>
          ) : tasks.length === 0 ? (
            <EmptyState
              icon={CheckCircle2}
              title="No tasks"
              description={statusFilter === 'pending' ? 'All clear — no pending tasks.' : 'No tasks matching this filter.'}
              action={statusFilter === 'pending' ? { label: 'Create task', onClick: () => openComposer() } : undefined}
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
        </>
      )}

      <TaskComposer open={composerOpen} onOpenChange={setComposerOpen} defaultDueDate={composerDefaultDate} />
    </div>
  );
}

function TaskRow({ task, onComplete, completing }: { task: Task; onComplete: () => void; completing: boolean }) {
  const isActive = task.status === 'pending' || task.status === 'overdue' || task.status === 'in_progress';

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
