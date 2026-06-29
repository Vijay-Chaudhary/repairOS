import type { Task } from '@/lib/api/crm';
import { TASK_PRIORITY_LABELS } from '@/lib/api/crm';
import { formatDate } from '@/lib/format/date';

export function TaskCard({ task }: { task: Task }) {
  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-3 space-y-1">
      <p className="text-body-sm font-medium text-[var(--text)] truncate">{task.title}</p>
      <div className="flex items-center justify-between text-xs text-[var(--text-muted)]">
        <span>{task.assigned_to_name ?? '—'}</span>
        <span>{formatDate(task.due_date)}</span>
      </div>
      <span className="text-[10px] text-[var(--text-muted)]">{TASK_PRIORITY_LABELS[task.priority]}</span>
    </div>
  );
}
