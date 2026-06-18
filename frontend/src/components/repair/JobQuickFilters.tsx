'use client';

import {
  QUICK_PRESETS,
  applyPreset,
  isPresetActive,
  type JobFilterState,
  type JobFilterCtx,
} from '@/lib/repair/jobFilters';
import { cn } from '@/lib/utils';

interface JobQuickFiltersProps {
  filters: JobFilterState;
  onChange: (next: JobFilterState) => void;
  ctx: JobFilterCtx;
}

export function JobQuickFilters({ filters, onChange, ctx }: JobQuickFiltersProps) {
  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {QUICK_PRESETS.map((preset) => {
        const active = isPresetActive(filters, preset.id, ctx);
        return (
          <button
            key={preset.id}
            aria-pressed={active}
            onClick={() => onChange(applyPreset(filters, preset.id, ctx))}
            className={cn(
              'h-8 px-3 rounded-full border text-xs transition-colors min-h-[44px] sm:min-h-0',
              active
                ? 'border-[var(--accent)] bg-[var(--accent)] text-white'
                : 'border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--surface-2)]',
            )}
          >
            {preset.label}
          </button>
        );
      })}
    </div>
  );
}
