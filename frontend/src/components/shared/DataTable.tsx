'use client';

import * as React from 'react';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/EmptyState';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { PaginationBar } from '@/components/shared/PaginationBar';
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
  // Page-number pagination
  page?: number;
  totalPages?: number;
  onPageChange?: (page: number) => void;
  // Cursor-based pagination (legacy / other list pages)
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
  page, totalPages, onPageChange,
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

  const showPagination = onPageChange && totalPages !== undefined && totalPages > 0;
  const currentPage = page ?? 1;

  return (
    <div className={cn('flex flex-col h-full gap-3', className)}>
      <div className="flex-1 min-h-0 overflow-auto rounded-lg border border-[var(--border)] bg-[var(--surface)]">
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

      {/* Cursor-based fallback pagination */}
      {!showPagination && (onNextPage || onPrevPage) && (
        <div className="flex items-center justify-between gap-2 shrink-0 border-t border-[var(--border)] pt-3">
          <span className="text-xs text-[var(--text-muted)]">
            {totalCount !== undefined ? `${totalCount} record${totalCount !== 1 ? 's' : ''}` : ''}
          </span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onPrevPage} disabled={!hasPrevPage || loading}>
              <ChevronLeft className="h-4 w-4" />Prev
            </Button>
            <Button variant="outline" size="sm" onClick={onNextPage} disabled={!hasNextPage || loading}>
              Next<ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {showPagination && (
        <PaginationBar
          page={currentPage}
          totalPages={totalPages!}
          totalCount={totalCount}
          loading={loading}
          onPageChange={onPageChange!}
        />
      )}
    </div>
  );
}
