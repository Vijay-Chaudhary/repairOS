'use client';

import { useCallback } from 'react';
import { KanbanBoard, type KanbanColumnDef, type KanbanCardBase } from '@/components/shared/KanbanBoard';
import { DealCard } from './DealCard';
import type { Deal, DealStage } from '@/lib/api/crm';

export interface DealColumnData {
  stage: DealStage;
  deals: Deal[];
  isLoading: boolean;
  count: number;
}

const DEAL_KANBAN_COLS: KanbanColumnDef[] = [
  { id: 'qualification', label: 'Qualification', colorToken: 'var(--accent)' },
  { id: 'proposal',      label: 'Proposal',      colorToken: 'var(--status-progress)' },
  { id: 'negotiation',   label: 'Negotiation',   colorToken: 'var(--warning)' },
  { id: 'won',           label: 'Won',           colorToken: 'var(--success)', collapsible: true, defaultCollapsed: true },
  { id: 'lost',          label: 'Lost',          colorToken: 'var(--danger)',  collapsible: true, defaultCollapsed: true },
];

const DEAL_VALID_TRANSITIONS: Record<string, string[]> = {
  qualification: ['proposal', 'won', 'lost'],
  proposal:      ['negotiation', 'won', 'lost'],
  negotiation:   ['won', 'lost'],
  won:           [],
  lost:          [],
};

const DEAL_TRANSITION_DIALOGS = {
  lost: { required: ['reason'], label: 'Why was this deal lost?' },
  won:  { required: [], label: 'Mark this deal as won?' },
};

interface DealKanbanCard extends KanbanCardBase {
  deal: Deal;
}

function toKanbanCards(columns: DealColumnData[]): DealKanbanCard[] {
  return columns.flatMap(({ stage, deals }) =>
    deals.map((deal) => ({ id: deal.id, columnId: stage, deal })),
  );
}

interface DealBoardProps {
  columns: DealColumnData[];
  onCardMove: (dealId: string, fromStage: DealStage, toStage: DealStage, fields?: Record<string, string>) => Promise<void>;
}

export function DealBoard({ columns, onCardMove }: DealBoardProps) {
  const cards = toKanbanCards(columns);

  const handleCardMove = useCallback(
    async (cardId: string, fromCol: string, toCol: string, fields?: Record<string, string>) => {
      await onCardMove(cardId, fromCol as DealStage, toCol as DealStage, fields);
    },
    [onCardMove],
  );

  const renderCard = useCallback((card: DealKanbanCard) => <DealCard deal={card.deal} />, []);

  const columnCounts = Object.fromEntries(columns.map((c) => [c.stage, c.count]));
  const isLoadingMap = Object.fromEntries(columns.map((c) => [c.stage, c.isLoading]));

  return (
    <KanbanBoard
      columns={DEAL_KANBAN_COLS}
      cards={cards}
      validTransitions={DEAL_VALID_TRANSITIONS}
      onCardMove={handleCardMove}
      onColumnReorder={() => {}}
      renderCard={renderCard}
      columnOrderStorageKey="repaiross-kanban-deals-column-order"
      transitionDialogs={DEAL_TRANSITION_DIALOGS}
      columnCounts={columnCounts}
      isLoadingMap={isLoadingMap}
      emptyLabel="No deals in this stage"
    />
  );
}
