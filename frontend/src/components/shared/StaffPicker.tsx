'use client';

import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronsUpDown, Loader2 } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { settingsApi } from '@/lib/api/settings';
import { hrApi } from '@/lib/api/hr';
import { useDebounce } from '@/lib/hooks/useDebounce';
import { cn } from '@/lib/utils';

export interface StaffPickerProps {
  value: string;
  onChange: (id: string) => void;
  source?: 'users' | 'employees';
  role?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

export function StaffPicker({
  value,
  onChange,
  source = 'users',
  role,
  placeholder = 'Search staff…',
  disabled = false,
  className,
}: StaffPickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [selectedLabel, setSelectedLabel] = useState('');

  const debouncedQuery = useDebounce(query, 350);

  const usersQuery = useQuery({
    queryKey: ['staff-picker', 'users', debouncedQuery, role],
    queryFn: () => settingsApi.listUsers({ search: debouncedQuery || undefined, is_active: true, role }),
    enabled: open && source === 'users',
    staleTime: 30_000,
  });

  const employeesQuery = useQuery({
    queryKey: ['staff-picker', 'employees', debouncedQuery],
    queryFn: () => hrApi.listEmployees({ search: debouncedQuery || undefined }),
    enabled: open && source === 'employees',
    staleTime: 30_000,
  });

  const isLoading = source === 'users' ? usersQuery.isLoading : employeesQuery.isLoading;

  const items: Array<{ id: string; primaryLabel: string; secondaryLabel: string }> =
    source === 'users'
      ? (usersQuery.data?.items ?? []).map((u) => ({
          id: u.id,
          primaryLabel: u.full_name,
          secondaryLabel: u.role_names.length > 0 ? u.role_names.join(', ') : u.email,
        }))
      : (employeesQuery.data?.items ?? []).map((e) => ({
          id: e.id,
          primaryLabel: e.full_name,
          secondaryLabel: e.designation ?? e.employee_code,
        }));

  function handleSelect(id: string, label: string) {
    setSelectedLabel(label);
    onChange(id);
    setOpen(false);
    setQuery('');
  }

  useEffect(() => {
    if (!value) setSelectedLabel('');
  }, [value]);

  return (
    <Popover open={open} onOpenChange={(v) => { setOpen(v); if (!v) setQuery(''); }}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            'w-full justify-between min-h-[44px] font-normal text-left',
            !selectedLabel && 'text-[var(--text-muted)]',
            className,
          )}
        >
          <span className="truncate">{selectedLabel || placeholder}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <div className="p-2 border-b border-[var(--border)]">
          <Input
            placeholder="Search by name…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
            className="h-8"
          />
        </div>
        <div className="max-h-60 overflow-y-auto">
          {isLoading && (
            <div className="flex items-center justify-center py-6 gap-2 text-[var(--text-muted)]">
              <Loader2 className="h-4 w-4 animate-spin" />
              <span className="text-body-sm">Searching…</span>
            </div>
          )}
          {!isLoading && items.length === 0 && (
            <p className="py-6 text-center text-body-sm text-[var(--text-muted)]">
              {debouncedQuery ? 'No results found.' : 'Type to search.'}
            </p>
          )}
          {!isLoading && items.map((item) => (
            <button
              key={item.id}
              className={cn(
                'w-full flex items-center gap-3 px-3 py-2.5 text-left min-h-[44px]',
                'hover:bg-[var(--surface-muted)] transition-colors',
                value === item.id && 'bg-[var(--accent)]/10',
              )}
              onClick={() => handleSelect(item.id, item.primaryLabel)}
            >
              <Check
                className={cn('h-4 w-4 shrink-0 text-[var(--accent)]', value !== item.id && 'invisible')}
              />
              <div className="min-w-0">
                <p className="text-body-sm font-medium text-[var(--text)] truncate">{item.primaryLabel}</p>
                <p className="text-xs text-[var(--text-muted)] truncate">{item.secondaryLabel}</p>
              </div>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
}
