'use client';

import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { searchApi, type SearchResult, type SearchType } from '@/lib/api/search';
import { qk } from '@/lib/query/keys';

const TYPE_LABELS: Record<SearchType, string> = {
  customer: 'Customers', lead: 'Leads', job: 'Jobs', invoice: 'Invoices',
  product: 'Products', technician: 'Technicians', payment: 'Payments', purchase_order: 'Purchase Orders',
};
const TYPE_ORDER: SearchType[] = ['customer', 'lead', 'job', 'invoice', 'product', 'technician', 'payment', 'purchase_order'];

export function CommandPalette({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [active, setActive] = useState(0);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(q), 250);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    if (!open) { setQ(''); setDebounced(''); setActive(0); }
  }, [open]);

  const enabled = debounced.trim().length >= 2;
  const { data } = useQuery({
    queryKey: qk.search(debounced),
    queryFn: () => searchApi.query(debounced),
    enabled,
    placeholderData: (prev) => prev,
  });

  const results: SearchResult[] = useMemo(() => {
    const rows = data?.results ?? [];
    return [...rows].sort((a, b) => TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type));
  }, [data]);

  useEffect(() => { setActive(0); }, [debounced, data]);

  const go = (r: SearchResult) => { onOpenChange(false); router.push(r.route); };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => Math.min(i + 1, results.length - 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => Math.max(i - 1, 0)); }
    else if (e.key === 'Enter' && results[active]) { e.preventDefault(); go(results[active]); }
  };

  const groups = TYPE_ORDER.filter((t) => results.some((r) => r.type === t));
  let flatIndex = -1;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[20%] translate-y-0">
        <DialogHeader>
          <DialogTitle className="sr-only">Search</DialogTitle>
        </DialogHeader>
        <Input
          autoFocus
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Search customers, jobs, invoices…"
        />
        {!enabled ? (
          <p className="text-body-sm text-[var(--text-muted)] py-6 text-center">Type at least 2 characters.</p>
        ) : results.length === 0 ? (
          <p className="text-body-sm text-[var(--text-muted)] py-6 text-center">No results for “{debounced}”.</p>
        ) : (
          <div className="max-h-80 overflow-auto py-1">
            {groups.map((t) => (
              <div key={t}>
                <div className="px-2 py-1 text-xs font-semibold text-[var(--text-muted)]">{TYPE_LABELS[t]}</div>
                {results.filter((r) => r.type === t).map((r) => {
                  flatIndex += 1;
                  const idx = flatIndex;
                  return (
                    <button
                      key={`${r.type}-${r.id}`}
                      onClick={() => go(r)}
                      onMouseEnter={() => setActive(idx)}
                      className={`w-full text-left px-3 py-2 rounded-md ${idx === active ? 'bg-[var(--surface-2)]' : ''}`}
                    >
                      <span className="text-body-sm text-[var(--text)]">{r.label}</span>
                      {r.sublabel && <span className="ml-2 text-xs text-[var(--text-muted)]">{r.sublabel}</span>}
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
