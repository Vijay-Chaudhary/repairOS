'use client';

import { useCallback } from 'react';
import { KanbanBoard, type KanbanColumnDef, type KanbanCardBase } from '@/components/shared/KanbanBoard';
import { LeadCard } from './LeadCard';
import type { Lead, LeadStatus } from '@/lib/api/crm';

// ── Re-export for leads/page.tsx ──────────────────────────────────────────────

export interface LeadColumnData {
  status: LeadStatus;
  leads: Lead[];
  isLoading: boolean;
  count: number;
}

// ── Column definitions ────────────────────────────────────────────────────────

const LEAD_KANBAN_COLS: KanbanColumnDef[] = [
  { id: 'new',        label: 'New' },
  { id: 'contacted',  label: 'Contacted' },
  { id: 'interested', label: 'Interested' },
  { id: 'quoted',     label: 'Quoted' },
  { id: 'converted',  label: 'Converted', colorToken: 'var(--success, #16a34a)', collapsible: true, defaultCollapsed: true },
  { id: 'lost',       label: 'Lost',      colorToken: 'var(--danger)',           collapsible: true, defaultCollapsed: true },
];

// ── Valid transitions from backend spec §4.1 ─────────────────────────────────

const LEAD_VALID_TRANSITIONS: Record<string, string[]> = {
  new:       ['contacted', 'lost'],
  contacted: ['interested', 'lost'],
  interested:['quoted', 'lost'],
  quoted:    ['converted', 'lost'],
  converted: [],
  // lost → [] because the re-open target (status_before_lost) is per-card dynamic;
  // handled exclusively via the card's "Re-open" menu action, not drag.
  lost:      [],
};

// ── Transition dialogs ────────────────────────────────────────────────────────

const LEAD_TRANSITION_DIALOGS = {
  lost:      { required: ['reason'], label: 'Why was this lead lost?' },
  converted: { required: [], label: 'Convert lead to customer?' },
};

// ── Shape cards for the generic board ────────────────────────────────────────

interface LeadKanbanCard extends KanbanCardBase {
  lead: Lead;
}

function toKanbanCards(columns: LeadColumnData[]): LeadKanbanCard[] {
  return columns.flatMap(({ status, leads }) =>
    leads.map((lead) => ({ id: lead.id, columnId: status, lead })),
  );
}

// ── LeadBoard ─────────────────────────────────────────────────────────────────

interface LeadBoardProps {
  columns: LeadColumnData[];
  onCardMove: (
    leadId: string,
    fromStatus: LeadStatus,
    toStatus: LeadStatus,
    fields?: Record<string, string>,
  ) => Promise<void>;
}

export function LeadBoard({ columns, onCardMove }: LeadBoardProps) {
  const cards = toKanbanCards(columns);

  const handleCardMove = useCallback(
    async (cardId: string, fromCol: string, toCol: string, fields?: Record<string, string>) => {
      await onCardMove(cardId, fromCol as LeadStatus, toCol as LeadStatus, fields);
    },
    [onCardMove],
  );

  const renderCard = useCallback(
    (card: LeadKanbanCard, _isDragging: boolean) => (
      <LeadCard lead={card.lead} />
    ),
    [],
  );

  return (
    <KanbanBoard
      columns={LEAD_KANBAN_COLS}
      cards={cards}
      validTransitions={LEAD_VALID_TRANSITIONS}
      onCardMove={handleCardMove}
      onColumnReorder={() => {}}
      renderCard={renderCard}
      columnOrderStorageKey="repaiross-kanban-leads-column-order"
      transitionDialogs={LEAD_TRANSITION_DIALOGS}
    />
  );
}
