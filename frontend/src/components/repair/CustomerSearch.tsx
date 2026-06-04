'use client';

import { useState, useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, UserPlus } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { apiGet } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { formatPhone } from '@/lib/format/phone';
import { useDebounce } from '@/lib/hooks/useDebounce';

export interface CustomerOption {
  id: string;
  name: string;
  phone: string;
  email?: string | null;
}

interface CustomerSearchProps {
  value: CustomerOption | null;
  onChange: (customer: CustomerOption | null) => void;
  onCreateNew?: () => void;
}

export function CustomerSearch({ value, onChange, onCreateNew }: CustomerSearchProps) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const debouncedQuery = useDebounce(query, 300);

  const { data, isLoading } = useQuery({
    queryKey: ['customer-search', debouncedQuery],
    queryFn: () =>
      apiGet<{ items: CustomerOption[] }>('/crm/customers/', { q: debouncedQuery, page_size: 8 }),
    enabled: debouncedQuery.length >= 2,
    staleTime: 10_000,
  });

  const customers = data?.items ?? [];

  function handleSelect(customer: CustomerOption) {
    onChange(customer);
    setOpen(false);
    setQuery('');
  }

  function handleClear() {
    onChange(null);
    setQuery('');
  }

  if (value) {
    return (
      <div className="flex items-center justify-between p-3 rounded-md border border-[var(--accent)] bg-[var(--accent)]/5">
        <div>
          <p className="text-body-sm font-medium text-[var(--text)]">{value.name}</p>
          <p className="text-xs text-[var(--text-muted)]">{formatPhone(value.phone)}</p>
        </div>
        <Button variant="ghost" size="sm" onClick={handleClear} className="text-[var(--text-muted)] min-h-[36px]">
          Change
        </Button>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-muted)]" />
        <Input
          placeholder="Search by name or phone…"
          className="pl-9"
          value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
        />
      </div>

      {open && query.length >= 2 && (
        <div className="absolute z-50 w-full mt-1 rounded-md border border-[var(--border)] bg-[var(--surface)] shadow-md overflow-hidden">
          {isLoading ? (
            <div className="p-2 space-y-2">
              {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full" />)}
            </div>
          ) : customers.length === 0 ? (
            <div className="p-3 text-center space-y-2">
              <p className="text-body-sm text-[var(--text-muted)]">No customer found</p>
              {onCreateNew && (
                <Button variant="outline" size="sm" onClick={() => { setOpen(false); onCreateNew(); }}>
                  <UserPlus className="h-4 w-4" />
                  Create new customer
                </Button>
              )}
            </div>
          ) : (
            <ul>
              {customers.map((c) => (
                <li key={c.id}>
                  <button
                    className="w-full text-left px-3 py-2.5 hover:bg-[var(--surface-2)] transition-colors min-h-[44px]"
                    onClick={() => handleSelect(c)}
                  >
                    <p className="text-body-sm font-medium text-[var(--text)]">{c.name}</p>
                    <p className="text-xs text-[var(--text-muted)]">{formatPhone(c.phone)}</p>
                  </button>
                </li>
              ))}
              {onCreateNew && (
                <li className="border-t border-[var(--border)]">
                  <button
                    className="w-full text-left px-3 py-2.5 hover:bg-[var(--surface-2)] transition-colors flex items-center gap-2 text-[var(--accent)] min-h-[44px]"
                    onClick={() => { setOpen(false); onCreateNew(); }}
                  >
                    <UserPlus className="h-4 w-4" />
                    <span className="text-body-sm font-medium">Create new customer</span>
                  </button>
                </li>
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
