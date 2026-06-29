'use client';

import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

export function CommandPalette({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="top-[20%] translate-y-0">
        <DialogHeader>
          <DialogTitle className="sr-only">Search</DialogTitle>
        </DialogHeader>
        <Input autoFocus placeholder="Search customers, jobs, invoices…" />
        <p className="text-body-sm text-[var(--text-muted)] py-6 text-center">
          Global search is coming soon.
        </p>
      </DialogContent>
    </Dialog>
  );
}
