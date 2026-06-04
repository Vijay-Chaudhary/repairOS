'use client';

import { useState } from 'react';
import { Phone, Mail, MapPin, Star, MessageSquare, Plus, Edit2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Can } from '@/components/shared/Can';
import { Money } from '@/components/shared/Money';
import { TagInput } from './TagInput';
import { LogCommunicationSheet } from './LogCommunicationSheet';
import { TaskComposer } from './TaskComposer';
import type { Customer } from '@/lib/api/crm';
import { formatPhone } from '@/lib/format/phone';
import { formatDate } from '@/lib/format/date';
import { cn } from '@/lib/utils';

interface CustomerProfileHeaderProps {
  customer: Customer;
  onEdit?: () => void;
}

export function CustomerProfileHeader({ customer, onEdit }: CustomerProfileHeaderProps) {
  const [logCommOpen, setLogCommOpen] = useState(false);
  const [taskOpen, setTaskOpen] = useState(false);

  const outstanding = customer.total_outstanding;

  return (
    <div className="border-b border-[var(--border)] bg-[var(--surface)] px-4 pt-4 pb-4">
      {/* Name + type badge + actions */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-h1 text-[var(--text)]">{customer.name}</h1>
            {customer.customer_type === 'business' && (
              <span className="text-xs font-medium bg-[var(--info)]/15 text-[var(--info)] border border-[var(--info)]/30 rounded-full px-2 py-0.5">
                Business
              </span>
            )}
            {customer.whatsapp_optout && (
              <span className="text-xs font-medium bg-[var(--text-muted)]/15 text-[var(--text-muted)] rounded-full px-2 py-0.5">
                WA opt-out
              </span>
            )}
          </div>

          <div className="mt-1 space-y-0.5">
            <a
              href={`tel:${customer.phone}`}
              className="flex items-center gap-1.5 text-body-sm text-[var(--accent)] hover:underline"
            >
              <Phone className="h-3.5 w-3.5 shrink-0" />
              {formatPhone(customer.phone)}
              {!customer.whatsapp_optout && (
                <a
                  href={`https://wa.me/${customer.phone.replace(/\D/g, '')}`}
                  target="_blank"
                  rel="noreferrer"
                  className="ml-1 text-xs text-[var(--success)] hover:underline"
                  onClick={(e) => e.stopPropagation()}
                >
                  WhatsApp
                </a>
              )}
            </a>
            {customer.alternate_phone && (
              <a href={`tel:${customer.alternate_phone}`} className="flex items-center gap-1.5 text-body-sm text-[var(--text-muted)] hover:text-[var(--accent)]">
                <Phone className="h-3.5 w-3.5 shrink-0" />{formatPhone(customer.alternate_phone)}
              </a>
            )}
            {customer.email && (
              <p className="flex items-center gap-1.5 text-body-sm text-[var(--text-muted)]">
                <Mail className="h-3.5 w-3.5 shrink-0" />{customer.email}
              </p>
            )}
            {customer.city && (
              <p className="flex items-center gap-1.5 text-body-sm text-[var(--text-muted)]">
                <MapPin className="h-3.5 w-3.5 shrink-0" />{customer.city}
              </p>
            )}
          </div>
        </div>

        <div className="flex gap-2 shrink-0">
          <Can permission="crm.communications.log">
            <Button size="sm" variant="outline" onClick={() => setLogCommOpen(true)}>
              <MessageSquare className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Log comm</span>
            </Button>
          </Can>
          <Can permission="crm.tasks.manage">
            <Button size="sm" variant="outline" onClick={() => setTaskOpen(true)}>
              <Plus className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Task</span>
            </Button>
          </Can>
          {onEdit && (
            <Can permission="crm.customers.edit">
              <Button size="sm" variant="outline" onClick={onEdit}>
                <Edit2 className="h-3.5 w-3.5" />
              </Button>
            </Can>
          )}
        </div>
      </div>

      {/* KPI strip */}
      <div className="grid grid-cols-3 gap-2 mb-3">
        <div className="rounded-md bg-[var(--surface-2)] px-3 py-2">
          <p className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wide">Jobs</p>
          <p className="text-body font-semibold text-[var(--text)] font-mono">{customer.total_jobs}</p>
        </div>
        <div className="rounded-md bg-[var(--surface-2)] px-3 py-2">
          <p className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wide">Total billed</p>
          <Money amount={customer.total_billed} className="text-body font-semibold" />
        </div>
        <div className={cn(
          'rounded-md px-3 py-2',
          outstanding > 0 ? 'bg-[var(--danger)]/10' : 'bg-[var(--surface-2)]',
        )}>
          <p className="text-[10px] font-semibold text-[var(--text-muted)] uppercase tracking-wide">Outstanding</p>
          <Money
            amount={outstanding}
            className={cn('text-body font-semibold', outstanding > 0 ? 'text-[var(--danger)]' : '')}
          />
        </div>
      </div>

      {/* Tags */}
      {customer.tags.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {customer.tags.map((tag) => (
            <span
              key={tag}
              className="inline-flex items-center gap-1 rounded-full bg-[var(--accent)]/10 text-[var(--accent)] border border-[var(--accent)]/20 px-2 py-0.5 text-xs font-medium"
            >
              <Star className="h-2.5 w-2.5" />{tag}
            </span>
          ))}
        </div>
      )}

      {customer.credit_limit > 0 && (
        <p className="text-xs text-[var(--text-muted)]">
          Credit limit: <Money amount={customer.credit_limit} className="text-xs font-medium" />
        </p>
      )}

      {customer.gstin && (
        <p className="text-xs text-[var(--text-muted)] font-mono mt-0.5">GSTIN: {customer.gstin}</p>
      )}

      <LogCommunicationSheet open={logCommOpen} onOpenChange={setLogCommOpen} customerId={customer.id} />
      <TaskComposer open={taskOpen} onOpenChange={setTaskOpen} customerId={customer.id} />
    </div>
  );
}
