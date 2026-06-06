'use client';

import * as React from 'react';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/EmptyState';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
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

function getPageNumbers(current: number, total: number): (number | '...')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  if (current <= 4) return [1, 2, 3, 4, 5, '...', total];
  if (current >= total - 3) return [1, '...', total - 4, total - 3, total - 2, total - 1, total];
  return [1, '...', current - 1, current, current + 1, '...', total];
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
        <div className="flex items-center justify-between gap-2 shrink-0 border-t border-[var(--border)] pt-3">
          <span className="text-xs text-[var(--text-muted)] shrink-0">
            {totalCount !== undefined ? `${totalCount} record${totalCount !== 1 ? 's' : ''}` : ''}
          </span>

          <div className="flex items-center gap-1">
            {/* First */}
            <Button
              variant="outline" size="sm"
              className="hidden sm:flex h-8 w-8 p-0"
              onClick={() => onPageChange(1)}
              disabled={currentPage === 1 || loading}
              title="First page"
            >
              <ChevronsLeft className="h-4 w-4" />
            </Button>

            {/* Prev */}
            <Button
              variant="outline" size="sm"
              className="h-8 px-2 gap-1"
              onClick={() => onPageChange(currentPage - 1)}
              disabled={currentPage === 1 || loading}
            >
              <ChevronLeft className="h-4 w-4" />
              <span className="hidden sm:inline">Prev</span>
            </Button>

            {/* Page numbers */}
            {getPageNumbers(currentPage, totalPages!).map((n, i) =>
              n === '...' ? (
                <span key={`ellipsis-${i}`} className="w-8 text-center text-xs text-[var(--text-muted)] select-none">
                  …
                </span>
              ) : (
                <Button
                  key={n}
                  variant={n === currentPage ? 'default' : 'outline'}
                  size="sm"
                  className={cn('h-8 w-8 p-0 text-xs', n === currentPage && 'pointer-events-none')}
                  onClick={() => onPageChange(n as number)}
                  disabled={loading}
                >
                  {n}
                </Button>
              )
            )}

            {/* Next */}
            <Button
              variant="outline" size="sm"
              className="h-8 px-2 gap-1"
              onClick={() => onPageChange(currentPage + 1)}
              disabled={currentPage === totalPages || loading}
            >
              <span className="hidden sm:inline">Next</span>
              <ChevronRight className="h-4 w-4" />
            </Button>

            {/* Last */}
            <Button
              variant="outline" size="sm"
              className="hidden sm:flex h-8 w-8 p-0"
              onClick={() => onPageChange(totalPages!)}
              disabled={currentPage === totalPages || loading}
              title="Last page"
            >
              <ChevronsRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
