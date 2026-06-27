'use client';

import { Phone, MessageCircle, PhoneOutgoing } from 'lucide-react';
import { formatPhone, normalizePhone } from '@/lib/format/phone';
import { cn } from '@/lib/utils';

interface PhoneActionsProps {
  phone: string;
  /** Hide the WhatsApp (wa.me) link when the contact has opted out. */
  whatsappOptout?: boolean;
  /** When provided, shows a quick "Log call" button (opens the LogCommunicationSheet). */
  onLogCall?: () => void;
  /** Muted styling for secondary placements (alternate phone, dense table rows). */
  muted?: boolean;
  className?: string;
}

const stop = (e: React.MouseEvent) => e.stopPropagation();

/**
 * Click-to-call (`tel:`) + click-to-WhatsApp (`wa.me`) links for a phone number,
 * with an optional quick "Log call" affordance. Safe inside clickable rows/cards
 * — all interactive elements stop propagation.
 */
export function PhoneActions({ phone, whatsappOptout, onLogCall, muted, className }: PhoneActionsProps) {
  const display = formatPhone(phone);
  const tel = normalizePhone(phone);
  const waDigits = tel.replace(/\D/g, '');

  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <a
        href={`tel:${tel}`}
        onClick={stop}
        aria-label={`Call ${display}`}
        className={cn(
          'inline-flex items-center gap-1 text-xs hover:underline',
          muted ? 'text-[var(--text-muted)] hover:text-[var(--accent)]' : 'text-[var(--accent)]',
        )}
      >
        <Phone className="h-3 w-3 shrink-0" />
        {display}
      </a>

      {!whatsappOptout && (
        <a
          href={`https://wa.me/${waDigits}`}
          target="_blank"
          rel="noreferrer"
          onClick={stop}
          aria-label={`WhatsApp ${display}`}
          className="inline-flex items-center text-[var(--success)] hover:text-[var(--success)]/80"
        >
          <MessageCircle className="h-3.5 w-3.5 shrink-0" />
        </a>
      )}

      {onLogCall && (
        <button
          type="button"
          onClick={(e) => { stop(e); onLogCall(); }}
          aria-label="Log call"
          title="Log call"
          className="inline-flex items-center text-[var(--text-muted)] hover:text-[var(--accent)]"
        >
          <PhoneOutgoing className="h-3.5 w-3.5 shrink-0" />
        </button>
      )}
    </span>
  );
}
