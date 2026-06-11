'use client';

import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { PhotoUploader } from '@/components/shared/PhotoUploader';
import { SignaturePad } from '@/components/shared/SignaturePad';
import type { AmcVisit } from '@/lib/api/amc';

export interface CompletePayload {
  work_done: string;
  issues_found: string;
  photos: string[];
  signature: string | null;
}

interface Props {
  visit: AmcVisit | null;
  onOpenChange: (open: boolean) => void;
  onSubmit: (payload: CompletePayload) => void;
  isPending: boolean;
}

export function VisitCompleteDialog({ visit, onOpenChange, onSubmit, isPending }: Props) {
  const [workDone, setWorkDone] = useState('');
  const [issuesFound, setIssuesFound] = useState('');
  const [photos, setPhotos] = useState<string[]>([]);
  const [signature, setSignature] = useState<string | null>(null);

  function handleOpenChange(open: boolean) {
    if (!open) {
      setWorkDone('');
      setIssuesFound('');
      setPhotos([]);
      setSignature(null);
    }
    onOpenChange(open);
  }

  return (
    <Dialog open={!!visit} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Complete visit {visit?.visit_number}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <label className="text-body-sm font-medium text-[var(--text)] block mb-1">
              Work done <span className="text-[var(--danger)]">*</span>
            </label>
            <textarea
              className="flex min-h-[80px] w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-body text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] resize-none"
              placeholder="Describe the work done during this visit…"
              value={workDone}
              onChange={(e) => setWorkDone(e.target.value)}
            />
          </div>
          <div>
            <label className="text-body-sm font-medium text-[var(--text)] block mb-1">Issues found</label>
            <Input
              placeholder="Any issues found or recommendations…"
              value={issuesFound}
              onChange={(e) => setIssuesFound(e.target.value)}
            />
          </div>
          <div>
            <p className="text-body-sm font-medium text-[var(--text)] mb-2">Photos</p>
            <PhotoUploader value={photos} onChange={setPhotos} />
          </div>
          <div>
            <p className="text-body-sm font-medium text-[var(--text)] mb-2">Customer signature</p>
            <SignaturePad onChange={setSignature} />
          </div>
          <div className="flex gap-3">
            <Button variant="outline" className="flex-1" onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
            <Button
              className="flex-1"
              disabled={!workDone.trim() || isPending}
              onClick={() => onSubmit({ work_done: workDone, issues_found: issuesFound, photos, signature })}
            >
              {isPending ? 'Saving…' : 'Mark complete'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
