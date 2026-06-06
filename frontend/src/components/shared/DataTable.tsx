'use client';

import * as React from 'react';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/EmptyState';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export interface Column<T> {
  key: string;
  header: string;
  cell: (row: T) => React.ReactNode;
  className?: string;
  headerClassName?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[] | undefined;
  loading?: boolean;
  error?: Error | null;
  keyExtractor: (row: T) => string;
  onRowClick?: (row: T) => void;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: { label: string; onClick: () => void };
  hasNextPage?: boolean;
  hasPrevPage?: boolean;
  onNextPage?: () => void;
  onPrevPage?: () => void;
  totalCount?: number;
  className?: string;
}

export function DataTable<T>({
  columns, data, loading, error, keyExtractor, onRowClick,
  emptyTitle = 'No data', emptyDescription, emptyAction,
  hasNextPage, hasPrevPage, onNextPage, onPrevPage,
  totalCount, className,
}: DataTableProps<T>) {
  if (error) {
    return (
      <div className="rounded-lg border border-[var(--danger)]/30 bg-[var(--danger)]/5 p-4 text-body-sm text-[var(--danger)]">
        {error.message || 'Failed to load data.'}
      </div>
    );
  }

  if (!loading && (!data || data.length === 0)) {
    return <EmptyState title={emptyTitle} description={emptyDescription} action={emptyAction} />;
  }

  return (
    <div className={cn('space-y-3', className)}>
      <div className="rounded-lg border border-[var(--border)] overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              {columns.map((col) => (
                <TableHead key={col.key} className={col.headerClassName}>{col.header}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading
              ? Array.from({ length: 8 }).map((_, i) => (
                  <TableRow key={i}>
                    {columns.map((col) => (
                      <TableCell key={col.key}>
                        <Skeleton className="h-4 w-full max-w-[120px]" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              : data!.map((row) => (
                  <TableRow
                    key={keyExtractor(row)}
                    onClick={onRowClick ? () => onRowClick(row) : undefined}
                    className={onRowClick ? 'cursor-pointer' : undefined}
                  >
                    {columns.map((col) => (
                      <TableCell key={col.key} className={col.className}>
                        {col.cell(row)}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
          </TableBody>
        </Table>
      </div>

      {(onNextPage || onPrevPage) && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-xs text-[var(--text-muted)]">
            {totalCount !== undefined ? `${totalCount} total` : ''}
          </span>
          <div className="flex items-center gap-2">
            <Button
              variant="outline" size="sm"
              onClick={onPrevPage}
              disabled={!hasPrevPage || loading}
            >
              <ChevronLeft className="h-4 w-4" />
              Prev
            </Button>
            <Button
              variant="outline" size="sm"
              onClick={onNextPage}
              disabled={!hasNextPage || loading}
            >
              Next
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
