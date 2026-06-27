'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Activity, AlertCircle, ChevronRight } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/shared/EmptyState';
import { Can } from '@/components/shared/Can';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { crmApi, COMM_TYPE_LABELS, type CommType, type CommunicationLog } from '@/lib/api/crm';
import { qk } from '@/lib/query/keys';
import { formatDatetime } from '@/lib/format/date';
import { cn } from '@/lib/utils';

const TYPE_DOT: Record<CommType, string> = {
  call: 'bg-[var(--info)]',
  whatsapp: 'bg-[var(--success)]',
  visit: 'bg-[var(--accent)]',
  email: 'bg-[var(--warning)]',
  sms: 'bg-[var(--accent)]',
  note: 'bg-[var(--text-muted)]',
};

/** Where a feed row deep-links: the related customer or lead. */
function rowHref(c: CommunicationLog): string | null {
  if (c.customer_id) return `/customers/${c.customer_id}`;
  if (c.lead_id) return `/leads/${c.lead_id}`;
  return null;
}

function rowTarget(c: CommunicationLog): string {
  return c.customer_name ?? c.lead_name ?? '—';
}

function ActivityRow({ c }: { c: CommunicationLog }) {
  const href = rowHref(c);
  const body = (
    <>
      <div className={cn('w-2 h-2 rounded-full mt-1.5 shrink-0 z-10', TYPE_DOT[c.type])} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-body-sm font-medium text-[var(--text)] truncate">{rowTarget(c)}</span>
          <span className="text-xs rounded px-1.5 py-0.5 bg-[var(--surface-2)] text-[var(--text-muted)] shrink-0">
            {COMM_TYPE_LABELS[c.type]}
          </span>
        </div>
        <p className="text-body-sm text-[var(--text)] mt-0.5 break-words">{c.summary}</p>
        <p className="text-xs text-[var(--text-muted)] mt-0.5">
          {c.logged_by_name && <span className="font-medium">{c.logged_by_name} · </span>}
          {formatDatetime(c.logged_at)}
        </p>
      </div>
      {href && <ChevronRight className="h-4 w-4 text-[var(--text-muted)] mt-1 shrink-0" />}
    </>
  );

  if (href) {
    return (
      <Link
        href={href}
        className="flex gap-3 relative rounded-md -mx-2 px-2 py-1.5 hover:bg-[var(--surface-2)] transition-colors"
      >
        {body}
      </Link>
    );
  }
  return <div className="flex gap-3 relative px-2 py-1.5">{body}</div>;
}

export default function ActivityFeedPage() {
  const [typeFilter, setTypeFilter] = useState<CommType | 'all'>('all');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');

  const filters = {
    type: typeFilter === 'all' ? undefined : typeFilter,
    date_from: dateFrom || undefined,
    date_to: dateTo || undefined,
  };

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: qk.communications(filters),
    queryFn: () => crmApi.listCommunications(filters),
  });

  const items = data?.items ?? [];

  return (
    <Can
      permission="crm.communications.log"
      fallback={
        <div className="p-4 md:p-6 max-w-3xl mx-auto">
          <EmptyState icon={Activity} title="No access" description="You don't have permission to view the activity feed." />
        </div>
      }
    >
      <div className="p-4 md:p-6 max-w-3xl mx-auto space-y-5">
        <div>
          <h1 className="text-h1 text-[var(--text)]">Activity</h1>
          <p className="text-body-sm text-[var(--text-muted)] mt-0.5">
            Every customer &amp; lead communication, newest first.
          </p>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap items-center gap-2">
          <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as CommType | 'all')}>
            <SelectTrigger className="h-9 w-[150px]" aria-label="Type">
              <SelectValue placeholder="All types" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {(Object.entries(COMM_TYPE_LABELS) as [CommType, string][]).map(([v, l]) => (
                <SelectItem key={v} value={v}>{l}</SelectItem>
              ))}
            </SelectContent>
          </Select>

          <input
            type="date"
            aria-label="Logged from"
            className="h-9 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-body-sm text-[var(--text)]"
            value={dateFrom}
            max={dateTo || undefined}
            onChange={(e) => setDateFrom(e.target.value)}
          />
          <input
            type="date"
            aria-label="Logged to"
            className="h-9 rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 text-body-sm text-[var(--text)]"
            value={dateTo}
            min={dateFrom || undefined}
            onChange={(e) => setDateTo(e.target.value)}
          />
        </div>

        {/* Feed */}
        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3, 4].map((i) => (
              <div key={i} className="flex gap-3">
                <Skeleton className="w-2 h-2 rounded-full mt-1.5 shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-1/3 rounded" />
                  <Skeleton className="h-4 w-3/4 rounded" />
                </div>
              </div>
            ))}
          </div>
        ) : isError ? (
          <EmptyState
            icon={AlertCircle}
            title="Couldn't load activity"
            description="Something went wrong fetching the feed."
            action={{ label: 'Retry', onClick: () => refetch() }}
          />
        ) : items.length === 0 ? (
          <EmptyState
            icon={Activity}
            title="No activity yet"
            description="Logged calls, WhatsApp, visits and notes will appear here."
          />
        ) : (
          <div className="relative space-y-1">
            <div className="absolute left-[3px] top-2 bottom-2 w-px bg-[var(--border)]" />
            {items.map((c) => (
              <ActivityRow key={c.id} c={c} />
            ))}
          </div>
        )}
      </div>
    </Can>
  );
}
