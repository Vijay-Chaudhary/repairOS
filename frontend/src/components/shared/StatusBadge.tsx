import { cn } from '@/lib/utils';

export type JobStatus = 'open' | 'in_progress' | 'on_hold' | 'ready_for_pickup' | 'qc' | 'delivered' | 'closed' | 'cancelled';
export type InvoiceStatus = 'draft' | 'issued' | 'partially_paid' | 'paid' | 'cancelled' | 'returned';
export type PoStatus = 'draft' | 'sent' | 'partially_received' | 'received' | 'cancelled';
export type ContractStatus = 'active' | 'pending_renewal' | 'expired' | 'cancelled';
export type LeadStatus = 'new' | 'contacted' | 'qualified' | 'converted' | 'lost';

type AnyStatus = JobStatus | InvoiceStatus | PoStatus | ContractStatus | LeadStatus | string;

const STATUS_MAP: Record<string, { label: string; className: string }> = {
  // Job statuses
  open: { label: 'Open', className: 'bg-[var(--info)]/15 text-[var(--info)] border-[var(--info)]/30' },
  in_progress: { label: 'In Progress', className: 'bg-[var(--warning)]/15 text-[var(--warning)] border-[var(--warning)]/30' },
  on_hold: { label: 'On Hold', className: 'bg-[#8a6d3b]/15 text-[#8a6d3b] border-[#8a6d3b]/30' },
  ready_for_pickup: { label: 'Ready', className: 'bg-[var(--success)]/15 text-[var(--success)] border-[var(--success)]/30' },
  qc: { label: 'QC', className: 'bg-[var(--success)]/15 text-[var(--success)] border-[var(--success)]/30' },
  delivered: { label: 'Delivered', className: 'bg-[var(--accent)]/15 text-[var(--accent)] border-[var(--accent)]/30' },
  closed: { label: 'Closed', className: 'bg-[var(--text-muted)]/15 text-[var(--text-muted)] border-[var(--text-muted)]/30' },
  cancelled: { label: 'Cancelled', className: 'bg-[var(--danger)]/15 text-[var(--danger)] border-[var(--danger)]/30' },
  // Invoice statuses
  draft: { label: 'Draft', className: 'bg-[var(--text-muted)]/15 text-[var(--text-muted)] border-[var(--text-muted)]/30' },
  issued: { label: 'Issued', className: 'bg-[var(--info)]/15 text-[var(--info)] border-[var(--info)]/30' },
  partially_paid: { label: 'Partial', className: 'bg-[var(--warning)]/15 text-[var(--warning)] border-[var(--warning)]/30' },
  paid: { label: 'Paid', className: 'bg-[var(--success)]/15 text-[var(--success)] border-[var(--success)]/30' },
  returned: { label: 'Returned', className: 'bg-[var(--danger)]/15 text-[var(--danger)] border-[var(--danger)]/30' },
  // PO statuses
  sent: { label: 'Sent', className: 'bg-[var(--info)]/15 text-[var(--info)] border-[var(--info)]/30' },
  partially_received: { label: 'Partial', className: 'bg-[var(--warning)]/15 text-[var(--warning)] border-[var(--warning)]/30' },
  received: { label: 'Received', className: 'bg-[var(--success)]/15 text-[var(--success)] border-[var(--success)]/30' },
  // Contract statuses
  active: { label: 'Active', className: 'bg-[var(--success)]/15 text-[var(--success)] border-[var(--success)]/30' },
  pending_renewal: { label: 'Renewal Due', className: 'bg-[var(--warning)]/15 text-[var(--warning)] border-[var(--warning)]/30' },
  expired: { label: 'Expired', className: 'bg-[var(--danger)]/15 text-[var(--danger)] border-[var(--danger)]/30' },
  // Lead statuses
  new: { label: 'New', className: 'bg-[var(--info)]/15 text-[var(--info)] border-[var(--info)]/30' },
  contacted: { label: 'Contacted', className: 'bg-[var(--warning)]/15 text-[var(--warning)] border-[var(--warning)]/30' },
  qualified: { label: 'Qualified', className: 'bg-[var(--accent)]/15 text-[var(--accent)] border-[var(--accent)]/30' },
  converted: { label: 'Converted', className: 'bg-[var(--success)]/15 text-[var(--success)] border-[var(--success)]/30' },
  lost: { label: 'Lost', className: 'bg-[var(--danger)]/15 text-[var(--danger)] border-[var(--danger)]/30' },
};

interface StatusBadgeProps {
  status: AnyStatus;
  className?: string;
}

export function StatusBadge({ status, className }: StatusBadgeProps) {
  const config = STATUS_MAP[status] ?? {
    label: status.replace(/_/g, ' '),
    className: 'bg-[var(--surface-2)] text-[var(--text-muted)] border-[var(--border)]',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium',
        config.className,
        className
      )}
    >
      {config.label}
    </span>
  );
}
