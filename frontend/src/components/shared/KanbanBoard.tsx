'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  TouchSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  closestCorners,
  type DragStartEvent,
  type DragOverEvent,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  horizontalListSortingStrategy,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { toast } from 'sonner';
import { GripVertical, ChevronDown, ChevronRight, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

// ── Types ────────────────────────────────────────────────────────────────────

export interface KanbanColumnDef {
  id: string;
  label: string;
  colorToken?: string;
  collapsible?: boolean;
  defaultCollapsed?: boolean;
}

export interface KanbanCardBase {
  id: string;
  columnId: string;
}

export interface TransitionDialog {
  required: string[];
  label: string;
}

export interface KanbanBoardProps<T extends KanbanCardBase> {
  columns: KanbanColumnDef[];
  cards: T[];
  validTransitions: Record<string, string[]>;
  onCardMove: (
    cardId: string,
    fromCol: string,
    toCol: string,
    fields?: Record<string, string>,
  ) => Promise<void>;
  onColumnReorder: (newOrder: string[]) => void;
  renderCard: (card: T, isDragging: boolean) => React.ReactNode;
  columnOrderStorageKey: string;
  transitionDialogs?: Record<string, TransitionDialog>;
  columnCounts?: Record<string, number>;
  isLoadingMap?: Record<string, boolean>;
  emptyLabel?: string;
}

// ── localStorage helpers ─────────────────────────────────────────────────────

function loadOrder(key: string, fallback: string[]): string[] {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return fallback;
    const ids = parsed as string[];
    // Only keep ids that still exist; append any new ones at the end
    const valid = ids.filter((id) => fallback.includes(id));
    const added = fallback.filter((id) => !valid.includes(id));
    return [...valid, ...added];
  } catch {
    return fallback;
  }
}

function saveOrder(key: string, order: string[]): void {
  try { localStorage.setItem(key, JSON.stringify(order)); } catch { /* ignore */ }
}

function loadCollapsed(key: string): Record<string, boolean> {
  try {
    const raw = localStorage.getItem(`${key}-collapsed`);
    if (!raw) return {};
    return JSON.parse(raw) as Record<string, boolean>;
  } catch {
    return {};
  }
}

function saveCollapsed(key: string, state: Record<string, boolean>): void {
  try { localStorage.setItem(`${key}-collapsed`, JSON.stringify(state)); } catch { /* ignore */ }
}

// ── Transition dialog component ───────────────────────────────────────────────

interface TransitionDialogProps {
  open: boolean;
  config: TransitionDialog;
  onConfirm: (fields: Record<string, string>) => void;
  onCancel: () => void;
}

function TransitionDialogModal({ open, config, onConfirm, onCancel }: TransitionDialogProps) {
  const [value, setValue] = useState('');

  useEffect(() => {
    if (open) setValue('');
  }, [open]);

  const hasField = config.required.length > 0;
  const fieldName = config.required[0] ?? 'reason';
  const canSubmit = !hasField || value.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onCancel(); }}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{config.label}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          {hasField && (
            <div>
              <label className="text-body-sm font-medium text-[var(--text)] block mb-1 capitalize">
                {fieldName} <span className="text-[var(--danger)]">*</span>
              </label>
              <Input
                placeholder={`Enter ${fieldName}…`}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && canSubmit) onConfirm({ [fieldName]: value }); }}
                autoFocus
              />
            </div>
          )}
          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" onClick={onCancel}>
              Cancel
            </Button>
            <Button
              className="flex-1"
              disabled={!canSubmit}
              onClick={() => onConfirm(hasField ? { [fieldName]: value } : {})}
            >
              Confirm
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── SortableColumn ────────────────────────────────────────────────────────────

interface SortableColumnProps<T extends KanbanCardBase> {
  colDef: KanbanColumnDef;
  cards: T[];
  collapsed: boolean;
  onToggleCollapse: () => void;
  activeCardId: string | null;
  overColumnId: string | null;
  renderCard: (card: T, isDragging: boolean) => React.ReactNode;
  isValidTarget: boolean;
  apiCount?: number;
  isLoading?: boolean;
  emptyLabel?: string;
}

function SortableColumn<T extends KanbanCardBase>({
  colDef,
  cards,
  collapsed,
  onToggleCollapse,
  activeCardId,
  renderCard,
  isValidTarget,
  apiCount,
  isLoading,
  emptyLabel,
}: SortableColumnProps<T>) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging: isColDragging,
  } = useSortable({ id: `col:${colDef.id}`, data: { type: 'column' } });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isColDragging ? 0.4 : 1,
  };

  const isDraggingCard = activeCardId !== null;

  const displayCount = apiCount ?? cards.length;

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'flex-none flex flex-col rounded-lg transition-colors',
        collapsed ? 'w-10' : 'w-[272px]',
        isDraggingCard && isValidTarget && 'ring-2 ring-[var(--accent)] ring-offset-1',
        isDraggingCard && !isValidTarget && activeCardId && 'opacity-60',
      )}
    >
      {/* Colored accent stripe */}
      {!collapsed && colDef.colorToken && (
        <div
          className="h-[3px] rounded-t-lg mb-1 shrink-0"
          style={{ background: colDef.colorToken }}
        />
      )}

      {/* Column header */}
      <div
        className={cn(
          'flex items-center gap-1 mb-2 px-1 min-h-[44px]',
          collapsed ? 'flex-col justify-center' : 'justify-between',
        )}
      >
        {/* Drag grip — column reorder handle */}
        <button
          {...attributes}
          {...listeners}
          className="p-1 rounded cursor-grab active:cursor-grabbing text-[var(--text-muted)] hover:text-[var(--text)] touch-none shrink-0"
          title="Drag to reorder column"
          aria-label={`Drag ${colDef.label} column`}
          tabIndex={-1}
        >
          <GripVertical className="h-4 w-4" />
        </button>

        {!collapsed && (
          <div className="flex items-center gap-1.5 flex-1 min-w-0">
            <h3 className="text-body-sm font-semibold text-[var(--text)] truncate">
              {colDef.label}
            </h3>
          </div>
        )}

        <div className="flex items-center gap-1 shrink-0">
          <span
            className={cn(
              'min-w-[20px] h-5 rounded-full text-[10px] font-semibold px-1.5 flex items-center justify-center',
              displayCount > 0
                ? 'bg-[var(--accent)]/15 text-[var(--accent)]'
                : 'bg-[var(--surface-2)] text-[var(--text-muted)]',
            )}
          >
            {displayCount}
          </span>

          {colDef.collapsible && (
            <button
              onClick={onToggleCollapse}
              className="p-1 rounded text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--surface-2)] min-h-[44px] min-w-[44px] flex items-center justify-center"
              title={collapsed ? `Expand ${colDef.label}` : `Collapse ${colDef.label}`}
              aria-label={collapsed ? `Expand ${colDef.label}` : `Collapse ${colDef.label}`}
            >
              {collapsed ? (
                <ChevronRight className="h-3.5 w-3.5" />
              ) : (
                <ChevronDown className="h-3.5 w-3.5" />
              )}
            </button>
          )}
        </div>
      </div>

      {/* Column body */}
      {!collapsed && (
        <SortableContext
          items={cards.map((c) => c.id)}
          strategy={verticalListSortingStrategy}
        >
          <div
            className={cn(
              'bg-[var(--surface-2)] rounded-lg p-2 flex-1 space-y-2 min-h-[120px]',
              isDraggingCard && isValidTarget && 'bg-[var(--accent)]/5',
            )}
          >
            {isLoading ? (
              <>
                <div className="animate-pulse bg-[var(--border)] rounded-md h-[72px]" />
                <div className="animate-pulse bg-[var(--border)] rounded-md h-[72px] opacity-60" />
              </>
            ) : cards.length === 0 ? (
              <div className="flex items-center justify-center h-16">
                <p className="text-xs text-[var(--text-muted)]">{emptyLabel ?? 'Nothing here'}</p>
              </div>
            ) : (
              cards.map((card) => (
                <SortableCard
                  key={card.id}
                  card={card}
                  renderCard={renderCard}
                  isActiveDrag={activeCardId === card.id}
                />
              ))
            )}
          </div>
        </SortableContext>
      )}
    </div>
  );
}

// ── SortableCard ──────────────────────────────────────────────────────────────

interface SortableCardProps<T extends KanbanCardBase> {
  card: T;
  renderCard: (card: T, isDragging: boolean) => React.ReactNode;
  isActiveDrag: boolean;
}

function SortableCard<T extends KanbanCardBase>({
  card,
  renderCard,
  isActiveDrag,
}: SortableCardProps<T>) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: card.id, data: { type: 'card', card } });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      className={cn(
        'rounded-md touch-none',
        isDragging || isActiveDrag
          ? 'opacity-40 shadow-lg ring-2 ring-[var(--accent)]/40'
          : '',
      )}
      role="listitem"
    >
      {renderCard(card, isDragging)}
    </div>
  );
}

// ── KanbanBoard ───────────────────────────────────────────────────────────────

export function KanbanBoard<T extends KanbanCardBase>({
  columns: columnDefs,
  cards: allCards,
  validTransitions,
  onCardMove,
  onColumnReorder,
  renderCard,
  columnOrderStorageKey,
  transitionDialogs,
  columnCounts,
  isLoadingMap,
  emptyLabel,
}: KanbanBoardProps<T>) {
  const defaultOrder = columnDefs.map((c) => c.id);

  const [columnOrder, setColumnOrder] = useState<string[]>(() =>
    loadOrder(columnOrderStorageKey, defaultOrder),
  );

  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(() => {
    const stored = loadCollapsed(columnOrderStorageKey);
    const defaults: Record<string, boolean> = {};
    for (const col of columnDefs) {
      defaults[col.id] = stored[col.id] ?? (col.defaultCollapsed ?? false);
    }
    return defaults;
  });

  // Optimistic card placement: columnId per card
  const [optimisticCols, setOptimisticCols] = useState<Record<string, string>>({});

  // Active drag state
  const [activeCardId, setActiveCardId] = useState<string | null>(null);
  const [activeColId, setActiveColId] = useState<string | null>(null);
  const [overColumnId, setOverColumnId] = useState<string | null>(null);

  // Pending transition dialog
  const [pendingMove, setPendingMove] = useState<{
    cardId: string;
    fromCol: string;
    toCol: string;
    config: TransitionDialog;
  } | null>(null);

  const movingRef = useRef(false);

  // Sensors: pointer (desktop) + touch (mobile long-press) + keyboard
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 250, tolerance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const getCardColumnId = useCallback(
    (cardId: string): string | undefined => {
      if (optimisticCols[cardId]) return optimisticCols[cardId];
      return allCards.find((c) => c.id === cardId)?.columnId;
    },
    [allCards, optimisticCols],
  );

  function toggleCollapse(colId: string) {
    setCollapsed((prev) => {
      const next = { ...prev, [colId]: !prev[colId] };
      saveCollapsed(columnOrderStorageKey, next);
      return next;
    });
  }

  function resetColumnOrder() {
    setColumnOrder(defaultOrder);
    saveOrder(columnOrderStorageKey, defaultOrder);
    onColumnReorder(defaultOrder);
  }

  // ── Drag handlers ──────────────────────────────────────────────────────────

  function handleDragStart(event: DragStartEvent) {
    const { active } = event;
    if (active.data.current?.type === 'card') {
      setActiveCardId(String(active.id));
    } else if (String(active.id).startsWith('col:')) {
      setActiveColId(String(active.id).slice(4));
    }
  }

  function handleDragOver(event: DragOverEvent) {
    const { over } = event;
    if (!over) { setOverColumnId(null); return; }

    const overId = String(over.id);
    if (overId.startsWith('col:')) {
      setOverColumnId(overId.slice(4));
    } else {
      // over a card — find that card's column
      const card = allCards.find((c) => c.id === overId);
      if (card) setOverColumnId(optimisticCols[overId] ?? card.columnId);
    }
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveCardId(null);
    setActiveColId(null);
    setOverColumnId(null);

    if (!over) return;

    const activeId = String(active.id);
    const overId = String(over.id);

    // Column reorder
    if (activeId.startsWith('col:')) {
      const fromColId = activeId.slice(4);
      const toColId = overId.startsWith('col:') ? overId.slice(4) : null;
      if (!toColId || fromColId === toColId) return;
      setColumnOrder((prev) => {
        const from = prev.indexOf(fromColId);
        const to = prev.indexOf(toColId);
        if (from < 0 || to < 0) return prev;
        const next = arrayMove(prev, from, to);
        saveOrder(columnOrderStorageKey, next);
        onColumnReorder(next);
        return next;
      });
      return;
    }

    // Card move
    if (active.data.current?.type !== 'card') return;

    const fromColId = getCardColumnId(activeId);
    if (!fromColId) return;

    let toColId: string;
    if (overId.startsWith('col:')) {
      toColId = overId.slice(4);
    } else {
      const overCard = allCards.find((c) => c.id === overId);
      toColId = overCard ? (optimisticCols[overId] ?? overCard.columnId) : fromColId;
    }

    if (fromColId === toColId) return;

    const validTargets = validTransitions[fromColId] ?? [];
    if (!validTargets.includes(toColId)) {
      toast.error('Invalid status transition');
      return;
    }

    // Check if dialog required
    const dialogConfig = transitionDialogs?.[toColId];
    if (dialogConfig) {
      setPendingMove({ cardId: activeId, fromCol: fromColId, toCol: toColId, config: dialogConfig });
      return;
    }

    executeMove(activeId, fromColId, toColId);
  }

  async function executeMove(
    cardId: string,
    fromCol: string,
    toCol: string,
    fields?: Record<string, string>,
  ) {
    if (movingRef.current) return;
    movingRef.current = true;

    // Optimistic
    setOptimisticCols((prev) => ({ ...prev, [cardId]: toCol }));

    try {
      await onCardMove(cardId, fromCol, toCol, fields);
    } catch {
      // Revert
      setOptimisticCols((prev) => {
        const next = { ...prev };
        delete next[cardId];
        return next;
      });
      toast.error('Failed to move card — reverted');
    } finally {
      movingRef.current = false;
    }
  }

  // ── Build ordered columns with their cards ─────────────────────────────────

  const orderedCols = columnOrder
    .map((id) => columnDefs.find((c) => c.id === id))
    .filter(Boolean) as KanbanColumnDef[];

  const cardsForColumn = useCallback(
    (colId: string): T[] => {
      return allCards.filter(
        (card) => (optimisticCols[card.id] ?? card.columnId) === colId,
      );
    },
    [allCards, optimisticCols],
  );

  const activeCard = activeCardId
    ? allCards.find((c) => c.id === activeCardId)
    : null;

  return (
    <>
      {/* Toolbar */}
      <div className="flex justify-end mb-3">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs text-[var(--text-muted)] gap-1"
          onClick={resetColumnOrder}
          title="Restore default column order"
        >
          <RotateCcw className="h-3 w-3" />
          Reset column order
        </Button>
      </div>

      {/* Board */}
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
      >
        <SortableContext
          items={columnOrder.map((id) => `col:${id}`)}
          strategy={horizontalListSortingStrategy}
        >
          <div className="flex gap-3 overflow-x-auto snap-x snap-mandatory pb-4 -mx-4 px-4 md:mx-0 md:px-0 [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-track]:bg-[var(--surface-2)] [&::-webkit-scrollbar-thumb]:bg-[var(--border)] [&::-webkit-scrollbar-thumb]:rounded-full">
            {orderedCols.map((colDef) => {
              const colCards = cardsForColumn(colDef.id);
              const isValidDrop = activeCardId
                ? (validTransitions[getCardColumnId(activeCardId) ?? ''] ?? []).includes(colDef.id)
                : false;

              return (
                <SortableColumn
                  key={colDef.id}
                  colDef={colDef}
                  cards={colCards}
                  collapsed={collapsed[colDef.id] ?? false}
                  onToggleCollapse={() => toggleCollapse(colDef.id)}
                  activeCardId={activeCardId}
                  overColumnId={overColumnId}
                  renderCard={renderCard}
                  isValidTarget={isValidDrop}
                  apiCount={columnCounts?.[colDef.id]}
                  isLoading={isLoadingMap?.[colDef.id]}
                  emptyLabel={emptyLabel}
                />
              );
            })}
          </div>
        </SortableContext>

        {/* Drag overlay — floating card while dragging */}
        <DragOverlay>
          {activeCard && (
            <div className="shadow-2xl ring-2 ring-[var(--accent)]/30 rounded-md rotate-1 opacity-95 w-[264px]">
              {renderCard(activeCard, true)}
            </div>
          )}
          {activeColId && (
            <div className="shadow-xl opacity-80 w-[272px] h-16 bg-[var(--surface-2)] rounded-lg border border-[var(--border)]" />
          )}
        </DragOverlay>
      </DndContext>

      {/* Transition dialog */}
      {pendingMove && (
        <TransitionDialogModal
          open
          config={pendingMove.config}
          onConfirm={(fields) => {
            const { cardId, fromCol, toCol } = pendingMove;
            setPendingMove(null);
            executeMove(cardId, fromCol, toCol, fields);
          }}
          onCancel={() => setPendingMove(null)}
        />
      )}
    </>
  );
}
