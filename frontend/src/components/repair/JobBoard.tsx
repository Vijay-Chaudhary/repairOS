'use client';

import { useCallback } from 'react';
import { useAuthStore } from '@/lib/stores/authStore';
import { KanbanBoard, type KanbanColumnDef, type KanbanCardBase } from '@/components/shared/KanbanBoard';
import { JobCard } from './JobCard';
import type { JobListItem, JobStatus } from '@/lib/api/repair';

// ── Re-export for jobs/page.tsx ───────────────────────────────────────────────

export interface KanbanColumnData {
  status: JobStatus;
  jobs: JobListItem[];
  isLoading: boolean;
  count: number;
}

// ── Column definitions ────────────────────────────────────────────────────────

const JOB_KANBAN_COLS: KanbanColumnDef[] = [
  { id: 'open',             label: 'Open' },
  { id: 'in_progress',      label: 'In Progress' },
  { id: 'on_hold',          label: 'On Hold',  colorToken: 'var(--warning)' },
  { id: 'ready_for_qc',     label: 'QC' },
  { id: 'ready_for_pickup', label: 'Ready' },
  { id: 'delivered',        label: 'Delivered' },
  { id: 'cancelled',        label: 'Cancelled', colorToken: 'var(--danger)',      collapsible: true, defaultCollapsed: true },
  { id: 'closed',           label: 'Closed',    colorToken: 'var(--text-muted)',  collapsible: true, defaultCollapsed: true },
];

// ── Valid transitions from backend spec §4.1 (Kanban columns only) ────────────

const JOB_VALID_TRANSITIONS: Record<string, string[]> = {
  open:             ['in_progress', 'cancelled'],
  in_progress:      ['on_hold', 'ready_for_qc', 'ready_for_pickup', 'cancelled'],
  on_hold:          ['in_progress', 'cancelled'],
  ready_for_qc:     ['ready_for_pickup'],
  ready_for_pickup: ['delivered', 'in_progress'],
  delivered:        ['closed'],
  closed:           [],
  cancelled:        ['open'],
};

// ── Transition dialogs ────────────────────────────────────────────────────────

const JOB_TRANSITION_DIALOGS = {
  on_hold:   { required: ['reason'], label: 'Reason for hold' },
  cancelled: { required: ['reason'], label: 'Reason for cancellation' },
  delivered: { required: [], label: 'Mark job as delivered?' },
  closed:    { required: [], label: 'Close this job?' },
};

// ── Shape cards for the generic board ────────────────────────────────────────

interface JobCard extends KanbanCardBase {
  job: JobListItem;
}

function toKanbanCards(columns: KanbanColumnData[]): JobCard[] {
  return columns.flatMap(({ status, jobs }) =>
    jobs.map((job) => ({ id: job.id, columnId: status, job })),
  );
}

// ── JobBoard ──────────────────────────────────────────────────────────────────

interface JobBoardProps {
  columns: KanbanColumnData[];
  onCardMove: (
    jobId: string,
    fromStatus: JobStatus,
    toStatus: JobStatus,
    fields?: Record<string, string>,
  ) => Promise<void>;
}

export function JobBoard({ columns, onCardMove }: JobBoardProps) {
  const { hasPermission, user } = useAuthStore();
  const isAdmin = user?.is_platform_admin || hasPermission('tenant.admin');

  const cards = toKanbanCards(columns);

  const handleCardMove = useCallback(
    async (cardId: string, fromCol: string, toCol: string, fields?: Record<string, string>) => {
      await onCardMove(cardId, fromCol as JobStatus, toCol as JobStatus, fields);
    },
    [onCardMove],
  );

  const renderCard = useCallback(
    (card: JobCard, isDragging: boolean) => {
      const validTargets = JOB_VALID_TRANSITIONS[card.job.status] ?? [];
      return (
        <JobCard
          job={card.job}
          kanban={{
            validTargets,
            onMoveTo: (toStatus, fields) =>
              onCardMove(card.job.id, card.job.status, toStatus, fields),
            isAdmin,
          }}
        />
      );
    },
    [onCardMove, isAdmin],
  );

  return (
    <KanbanBoard
      columns={JOB_KANBAN_COLS}
      cards={cards}
      validTransitions={JOB_VALID_TRANSITIONS}
      onCardMove={handleCardMove}
      onColumnReorder={() => {}}
      renderCard={renderCard}
      columnOrderStorageKey="repaiross-kanban-jobs-column-order"
      transitionDialogs={JOB_TRANSITION_DIALOGS}
    />
  );
}
