'use client';

import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { cn } from '@/lib/utils';

export function getPageNumbers(current: number, total: number): (number | '...')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  if (current <= 4) return [1, 2, 3, 4, 5, '...', total];
  if (current >= total - 3) return [1, '...', total - 4, total - 3, total - 2, total - 1, total];
  return [1, '...', current - 1, current, current + 1, '...', total];
}

interface PaginationBarProps {
  page: number;
  totalPages: number;
  totalCount?: number;
  loading?: boolean;
  onPageChange: (page: number) => void;
}

export function PaginationBar({ page, totalPages, totalCount, loading, onPageChange }: PaginationBarProps) {
  return (
    <div className="flex items-center justify-between gap-2 shrink-0 border-t border-[var(--border)] pt-3">
      <span className="text-xs text-[var(--text-muted)] shrink-0">
        {totalCount !== undefined ? `${totalCount} record${totalCount !== 1 ? 's' : ''}` : ''}
      </span>

      <div className="flex items-center gap-1">
        <Button
          variant="outline" size="sm"
          className="hidden sm:flex h-8 w-8 p-0"
          onClick={() => onPageChange(1)}
          disabled={page === 1 || loading}
          title="First page"
        >
          <ChevronsLeft className="h-4 w-4" />
        </Button>

        <Button
          variant="outline" size="sm"
          className="h-8 px-2 gap-1"
          onClick={() => onPageChange(page - 1)}
          disabled={page === 1 || loading}
        >
          <ChevronLeft className="h-4 w-4" />
          <span className="hidden sm:inline">Prev</span>
        </Button>

        {getPageNumbers(page, totalPages).map((n, i) =>
          n === '...' ? (
            <span key={`ellipsis-${i}`} className="w-8 text-center text-xs text-[var(--text-muted)] select-none">
              …
            </span>
          ) : (
            <Button
              key={n}
              variant={n === page ? 'default' : 'outline'}
              size="sm"
              className={cn('h-8 w-8 p-0 text-xs', n === page && 'pointer-events-none')}
              onClick={() => onPageChange(n as number)}
              disabled={loading}
            >
              {n}
            </Button>
          )
        )}

        <Button
          variant="outline" size="sm"
          className="h-8 px-2 gap-1"
          onClick={() => onPageChange(page + 1)}
          disabled={page === totalPages || loading}
        >
          <span className="hidden sm:inline">Next</span>
          <ChevronRight className="h-4 w-4" />
        </Button>

        <Button
          variant="outline" size="sm"
          className="hidden sm:flex h-8 w-8 p-0"
          onClick={() => onPageChange(totalPages)}
          disabled={page === totalPages || loading}
          title="Last page"
        >
          <ChevronsRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
