'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCircle2, Clock, AlertCircle, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Can } from '@/components/shared/Can';
import { TaskComposer } from './TaskComposer';
import { crmApi, TASK_PRIORITY_LABELS, type Task, type TaskStatus } from '@/lib/api/crm';
import { qk } from '@/lib/query/keys';
import { ApiError } from '@/lib/api/client';
import { formatDate, formatTime } from '@/lib/format/date';
import { cn } from '@/lib/utils';

const STATUS_ICON: Record<TaskStatus, React.ReactNode> = {
  pending:   <Clock className="h-4 w-4 text-[var(--info)]" />,
  overdue:   <AlertCircle className="h-4 w-4 text-[var(--danger)]" />,
  completed: <CheckCircle2 className="h-4 w-4 text-[var(--success)]" />,
  cancelled: <CheckCircle2 className="h-4 w-4 text-[var(--text-muted)]" />,
};

const PRIORITY_DOT: Record<string, string> = {
  low:    'bg-[var(--text-muted)]',
  normal: 'bg-[var(--info)]',
  high:   'bg-[var(--danger)]',
};

interface TaskListProps {
  tasks: Task[];
  loading?: boolean;
  customerId?: string;
  leadId?: string;
  jobId?: string;
  showComposer?: boolean;
}

export function TaskList({ tasks, loading, customerId, leadId, jobId, showComposer = true }: TaskListProps) {
  const queryClient = useQueryClient();
  const [composerOpen, setComposerOpen] = useState(false);

  const completeMutation = useMutation({
    mutationFn: (id: string) => crmApi.completeTask(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: qk.tasks() });
      if (customerId) queryClient.invalidateQueries({ queryKey: qk.customer(customerId) });
      toast.success('Task completed');
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Failed'),
  });

  if (loading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <div key={i} className="h-16 rounded-lg bg-[var(--surface-2)] animate-pulse" />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {showComposer && (
        <Can permission="crm.tasks.manage">
          <Button size="sm" variant="outline" onClick={() => setComposerOpen(true)}>
            <Plus className="h-3.5 w-3.5" /> New task
          </Button>
        </Can>
      )}

      {tasks.length === 0 ? (
        <p className="text-body-sm text-[var(--text-muted)] py-4">No tasks.</p>
      ) : (
        <div className="space-y-2">
          {tasks.map((task) => (
            <div
              key={task.id}
              className={cn(
                'flex items-start gap-3 p-3 rounded-lg border',
                task.status === 'completed' || task.status === 'cancelled'
                  ? 'border-[var(--border)] bg-[var(--surface-2)] opacity-60'
                  : task.status === 'overdue'
                  ? 'border-[var(--danger)]/30 bg-[var(--danger)]/5'
                  : 'border-[var(--border)] bg-[var(--surface)]',
              )}
            >
              <div className="shrink-0 mt-0.5">{STATUS_ICON[task.status]}</div>
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
                <div className="flex items-center gap-2 mt-1">
                  <span className={cn('w-1.5 h-1.5 rounded-full shrink-0', PRIORITY_DOT[task.priority])} />
                  <span className="text-xs text-[var(--text-muted)]">
                    {TASK_PRIORITY_LABELS[task.priority]} · Due {formatDate(task.due_date)}
                    {task.due_time ? ` ${formatTime(task.due_time)}` : ''}
                  </span>
                  {task.assigned_to_name && (
                    <span className="text-xs text-[var(--text-muted)]">· {task.assigned_to_name}</span>
                  )}
                </div>
              </div>
              {task.status === 'pending' || task.status === 'overdue' ? (
                <Can permission="crm.tasks.manage">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="shrink-0 h-8 w-8 p-0"
                    onClick={() => completeMutation.mutate(task.id)}
                    disabled={completeMutation.isPending}
                    title="Mark complete"
                  >
                    <CheckCircle2 className="h-4 w-4 text-[var(--success)]" />
                  </Button>
                </Can>
              ) : null}
            </div>
          ))}
        </div>
      )}

      <TaskComposer
        open={composerOpen}
        onOpenChange={setComposerOpen}
        customerId={customerId}
        leadId={leadId}
        jobId={jobId}
      />
    </div>
  );
}
