import type { Deal } from '@/lib/api/crm';

const inr = (v: string) => `₹${Number(v).toLocaleString('en-IN')}`;

export function DealCard({ deal }: { deal: Deal }) {
  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--surface)] p-3 space-y-1">
      <p className="text-body-sm font-medium text-[var(--text)] truncate">{deal.title}</p>
      {deal.customer_name && <p className="text-xs text-[var(--text-muted)] truncate">{deal.customer_name}</p>}
      <div className="flex items-center justify-between text-xs">
        <span className="text-[var(--success)] font-medium">{inr(deal.expected_revenue)}</span>
        <span className="text-[var(--text-muted)]">{deal.probability}%</span>
      </div>
      {deal.assigned_to_name && <p className="text-[10px] text-[var(--text-muted)]">{deal.assigned_to_name}</p>}
    </div>
  );
}
