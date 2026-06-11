'use client';

import { useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { MoneyInput } from '@/components/shared/MoneyInput';
import { Can } from '@/components/shared/Can';
import type { AmcContract } from '@/lib/api/amc';
import { formatDate } from '@/lib/format/date';

interface Props {
  contract: AmcContract;
  daysToExpiry: number;
  renewalDue: boolean;
  onConfirm: (newEndDate: string, newValue: number | undefined) => void;
  isSubmitting: boolean;
}

export function RenewalPanel({ contract, daysToExpiry, renewalDue, onConfirm, isSubmitting }: Props) {
  const [open, setOpen] = useState(false);
  const [renewEndDate, setRenewEndDate] = useState('');
  const [renewValue, setRenewValue] = useState(contract.value);

  if (!renewalDue) return null;

  return (
    <>
      <div className="flex items-center gap-2 rounded-lg border border-[var(--warning)]/30 bg-[var(--warning)]/10 px-4 py-3">
        <AlertCircle className="h-4 w-4 text-[var(--warning)] shrink-0" />
        <p className="text-body-sm text-[var(--warning)] flex-1">
          {daysToExpiry > 0 ? `Expires in ${daysToExpiry} days` : 'Expired'} — renewal recommended
        </p>
        <Can permission="amc.renewals.manage">
          <Button
            size="sm"
            onClick={() => { setRenewEndDate(''); setRenewValue(contract.value); setOpen(true); }}
          >
            Renew
          </Button>
        </Can>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Renew contract</DialogTitle></DialogHeader>
          <div className="space-y-4">
            <p className="text-body-sm text-[var(--text-muted)]">
              Current expiry: {formatDate(contract.end_date)}. Renewal extends the contract and schedules new visits.
            </p>
            <div>
              <label className="text-body-sm font-medium text-[var(--text)] block mb-1">New end date *</label>
              <Input type="date" value={renewEndDate} onChange={(e) => setRenewEndDate(e.target.value)} />
            </div>
            <div>
              <label className="text-body-sm font-medium text-[var(--text)] block mb-1">New value</label>
              <MoneyInput value={renewValue} onChange={setRenewValue} />
            </div>
            <div className="flex gap-3">
              <Button variant="outline" className="flex-1" onClick={() => setOpen(false)}>Cancel</Button>
              <Button
                className="flex-1"
                disabled={!renewEndDate || isSubmitting}
                onClick={() => onConfirm(renewEndDate, renewValue > 0 ? renewValue : undefined)}
              >
                {isSubmitting ? 'Renewing…' : 'Confirm renewal'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
