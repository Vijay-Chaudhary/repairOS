'use client';

// NOTE: Temporary stub introduced with the worklist page (Task 4).
// Task 5 replaces this with the full create/edit sheet (job picker + form).
import type { SparePartListItem } from '@/lib/api/repair';

interface SparePartFormSheetProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  editTarget: SparePartListItem | null;
}

export function SparePartFormSheet({ open }: SparePartFormSheetProps) {
  if (!open) return null;
  return null;
}
