'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { AmcVisit } from '@/lib/api/amc';

interface Props {
  visit: AmcVisit | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (newDate: string) => void;
  isPending: boolean;
}

export function RescheduleDialog({ visit, onOpenChange, onSubmit, isPending }: Props) {
  const [date, setDate] = useState('');

  function handleOpenChange(open: boolean) {
    if (!open) setDate('');
    onOpenChange(open);
  }

  return (
    <Dialog open={!!visit} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Reschedule visit {visit?.visit_number}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <label className="text-body-sm font-medium text-[var(--text)] block mb-1">New date *</label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
            <Button
              className="flex-1"
              disabled={!date || isPending}
              onClick={() => onSubmit(date)}
            >
              {isPending ? 'Saving…' : 'Reschedule'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
