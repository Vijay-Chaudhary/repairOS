'use client';

import { useCallback } from 'react';
import { KanbanBoard, type KanbanColumnDef, type KanbanCardBase } from '@/components/shared/KanbanBoard';
import { TaskCard } from './TaskCard';
import type { Task, TaskStatus } from '@/lib/api/crm';

export interface TaskColumnData {
  status: TaskStatus;
  tasks: Task[];
  isLoading: boolean;
  count: number;
}

const TASK_KANBAN_COLS: KanbanColumnDef[] = [
  { id: 'pending',     label: 'To-do',       colorToken: 'var(--accent)' },
  { id: 'in_progress', label: 'In Progress', colorToken: 'var(--status-progress)' },
  { id: 'completed',   label: 'Done',        colorToken: 'var(--success)' },
  { id: 'cancelled',   label: 'Cancelled',   colorToken: 'var(--danger)', collapsible: true, defaultCollapsed: true },
];

const TASK_VALID_TRANSITIONS: Record<string, string[]> = {
  pending:     ['in_progress', 'completed', 'cancelled'],
  in_progress: ['completed', 'cancelled', 'pending'],
  completed:   ['pending', 'in_progress'],
  cancelled:   ['pending'],
};

interface TaskKanbanCard extends KanbanCardBase {
  task: Task;
}

function toKanbanCards(columns: TaskColumnData[]): TaskKanbanCard[] {
  return columns.flatMap(({ status, tasks }) =>
    tasks.map((task) => ({ id: task.id, columnId: status, task })),
  );
}

interface TaskBoardProps {
  columns: TaskColumnData[];
  onCardMove: (taskId: string, fromStatus: TaskStatus, toStatus: TaskStatus) => Promise<void>;
}

export function TaskBoard({ columns, onCardMove }: TaskBoardProps) {
  const cards = toKanbanCards(columns);

  const handleCardMove = useCallback(
    async (cardId: string, fromCol: string, toCol: string) => {
      await onCardMove(cardId, fromCol as TaskStatus, toCol as TaskStatus);
    },
    [onCardMove],
  );

  const renderCard = useCallback((card: TaskKanbanCard) => <TaskCard task={card.task} />, []);
  const columnCounts = Object.fromEntries(columns.map((c) => [c.status, c.count]));
  const isLoadingMap = Object.fromEntries(columns.map((c) => [c.status, c.isLoading]));

  return (
    <KanbanBoard
      columns={TASK_KANBAN_COLS}
      cards={cards}
      validTransitions={TASK_VALID_TRANSITIONS}
      onCardMove={handleCardMove}
      onColumnReorder={() => {}}
      renderCard={renderCard}
      columnOrderStorageKey="repaiross-kanban-tasks-column-order"
      columnCounts={columnCounts}
      isLoadingMap={isLoadingMap}
      emptyLabel="No tasks in this stage"
    />
  );
}
